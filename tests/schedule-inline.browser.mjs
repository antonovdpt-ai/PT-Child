// Real local Chromium → local HTTP adapter → PostgreSQL (PGlite).
// Uses the existing migrations and RPC, fictional data and no production network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const owner = '11111111-1111-4111-8111-111111111111';
const child = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const day = '2030-01-14';
const shell = (await readFile(new URL('index.html', root), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const script = `
  import { renderCabinet } from '/cabinet.js';
  import { escapeHtml } from '/security-utils.mjs';
  const api = async (path, args) => (await fetch(path, args ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(args)} : {})).json();
  const sb = {
    from(table) { return {select(){return this}, eq(){return this}, order(){return this},
      range:() => api('/api/'+table), then:(resolve,reject)=>api('/api/'+table).then(resolve,reject)}; },
    rpc:(name,args)=>api('/api/rpc/'+name,args)
  };
  window.confirm = () => true;
  document.body.dataset.specialistReady='true'; document.body.classList.add('is-authenticated');
  await renderCabinet({app:document.getElementById('app'),sb,state:{},user:{id:'${owner}'},esc:escapeHtml,renderPatients(){},renderProfile(){}});
  while (!document.querySelector('[data-copy]')) await new Promise(r=>setTimeout(r,5));
  const date=document.querySelector('[data-date]'); date.value='${day}'; date.dispatchEvent(new Event('change'));
  window.fixtureReady=true;
`;

test('inline time creation, move, conflict and reload work through actual SQL at mobile and desktop widths', async t => {
  const db = new PGlite({ extensions: { btree_gist } });
  let browser, server;
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select '${owner}'::uuid$$;
      create function public.account_is_active() returns boolean language sql stable as $$select true$$;
      create table public.patients(id uuid primary key, therapist_id uuid not null references auth.users, display_name text not null);
      create table public.sessions(id uuid primary key, therapist_id uuid references auth.users, patient_id uuid references public.patients);
      insert into auth.users values ('${owner}');
      insert into public.patients values ('${child}','${owner}','Вымышленный пациент');
      grant usage on schema public,auth to authenticated; grant select,update on public.patients to authenticated; grant select on public.sessions to authenticated;`);
    for (const migration of ['20260923_005_specialist_schedule.sql', '20260923_006_schedule_calendar.sql']) {
      await db.exec(await readFile(new URL(`supabase/migrations/${migration}`, root), 'utf8'));
    }
    await db.exec(`update public.patients set schedule_price_kopecks=300000; set role authenticated;`);
    server = createServer(async (req, res) => {
      try {
        let path = new URL(req.url, 'http://127.0.0.1').pathname;
        const baseline = path.startsWith('/baseline/');
        if (baseline) path = path.slice('/baseline'.length);
        if (path.startsWith('/api/')) {
          res.setHeader('Content-Type', 'application/json');
          if (path === '/api/rpc/save_schedule_entries' && req.method === 'POST') {
            let body = ''; for await (const chunk of req) body += chunk;
            const args = JSON.parse(body);
            const result = await db.query('select public.save_schedule_entries($1::jsonb,$2::boolean) as saved', [JSON.stringify(args.entries), args.save_tariff]);
            res.end(JSON.stringify({ data: result.rows[0].saved, error: null })); return;
          }
          const table = path.slice(5);
          if (!['appointments', 'patients', 'patient_contacts'].includes(table)) { res.writeHead(404).end(); return; }
          const data = table === 'patient_contacts' ? [] : (await db.query(`select * from public.${table}`)).rows;
          res.end(JSON.stringify({ data, error: null })); return;
        }
        if (path === '/fixture') { res.setHeader('Content-Type', 'text/html'); res.end(shell.replace('</body>', `<script type="module" src="${baseline ? '/baseline' : ''}/fixture.js"></script></body>`)); return; }
        if (path === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(baseline ? script.replaceAll("from '/", "from '/baseline/") : script); return; }
        if (!/^\/[a-zA-Z0-9.-]+$/.test(path)) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : /\.m?js$/.test(path) ? 'text/javascript' : 'image/png');
        res.end(baseline ? execFileSync('git', ['show', `15b9def8c6460af1d54980a3f0e78a660634a5c2:${path.slice(1)}`], { cwd: root }) : await readFile(new URL(path.slice(1), root)));
      } catch (error) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: null, error: { code: error.code, message: error.message } }));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote'] });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const screenshots = process.env.SCHEDULE_SCREENSHOT_DIR;
    if (screenshots) await mkdir(screenshots, { recursive: true });
    for (const width of [375, 390, 768, 1440]) await t.test(`${width}px`, async () => {
      await db.query('delete from public.appointments');
      const context = await browser.newContext({ viewport: { width, height: 980 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
        isMobile: width < 700, hasTouch: width < 700 });
      const page = await context.newPage(), errors = [], external = [];
      page.setDefaultTimeout(10000);
      await page.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      page.on('pageerror', error => errors.push(error.message));
      const label = hour => page.locator(`[data-day="${day}"] [data-time="${hour}"]`);
      const edit = async (hour, time, key = 'Enter') => {
        await label(hour).click(); const input = page.locator('[data-time-input]');
        await input.fill(time); await input.press(key);
        await input.waitFor({ state: 'detached' });
      };
      const persisted = async () => (await db.query('select * from public.appointments order by starts_at')).rows;
      const layout = () => page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        slot: [...document.querySelectorAll('.calendar-slot')].slice(0, 1).map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
        overflow: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.tagName}.${el.className}`) }));
      try {
        await page.goto(`${origin}/baseline/fixture`); await page.waitForFunction(() => window.fixtureReady);
        const before = await layout();
        await page.goto(`${origin}/fixture`);
        await page.waitForFunction(() => window.fixtureReady || document.querySelector('.error')?.textContent);
        assert.ok(await page.evaluate(() => window.fixtureReady), await page.locator('#app').innerText());
        assert.deepEqual(await layout(), before, 'idle calendar geometry matches the restored production baseline');
        t.diagnostic(`${width}px initial layout ${JSON.stringify(before)}`);
        const rows = await page.locator(`[data-day="${day}"] .calendar-slot`).count();
        assert.equal(rows, 13, 'the existing hourly grid stays intact');
        await label(11).click();
        const input = page.locator('[data-time-input]'); await input.fill('11:30');
        const bounds = await input.boundingBox(), cell = await input.locator('..').boundingBox();
        assert.ok(bounds.width <= cell.width && bounds.x >= cell.x && bounds.x + bounds.width <= cell.x + cell.width + 1);
        if (screenshots && [390, 1440].includes(width)) await page.screenshot({ path: `${screenshots}/schedule-${width}-editing.png`, fullPage: true });
        // Mobile-friendly blur confirmation followed by the same booking click.
        await page.locator(`[data-day="${day}"] [data-slot="11"]`).click();
        await page.locator('dialog').waitFor({ state: 'visible' });
        assert.equal(await page.locator('dialog [name="hour"] option:checked').innerText(), '11:30');
        assert.equal(await page.locator('[name="time"], [data-custom-time]').count(), 0);
        await page.locator(`[data-patient="${child}"]`).click();
        await page.locator('dialog button[type="submit"]').click();
        await page.locator('dialog').waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.querySelector('[data-time="11"]')?.textContent === '11:30');
        const saved = (await persisted())[0];
        await page.locator(`[data-edit="${saved.id}"]`).waitFor();
        assert.equal(saved.starts_at.toISOString(), `${day}T08:30:00.000Z`, 'Moscow 11:30 is stored as UTC 08:30');
        assert.equal(saved.ends_at - saved.starts_at, 3600000);
        assert.equal(await page.locator(`[data-day="${day}"] [data-slot="12"]`).count(), 0);
        await page.reload(); await page.waitForFunction(() => window.fixtureReady);
        assert.equal(await label(11).innerText(), '11:30', 'a real page reload reads minute start from PostgreSQL');
        if (screenshots && [390, 1440].includes(width)) await page.screenshot({ path: `${screenshots}/schedule-${width}-saved.png`, fullPage: true });
        await edit(11, '11:45');
        await page.waitForFunction(() => document.querySelector('[data-time="11"]')?.textContent === '11:45');
        assert.equal((await persisted())[0].starts_at.toISOString(), `${day}T08:45:00.000Z`);
        await edit(11, '11:15', 'Escape'); assert.equal(await label(11).innerText(), '11:45');
        await edit(13, '13:00'); // unchanged value must also close cleanly
        const neighbor = { patient_id: child, starts_at: `${day}T10:00:00Z`, ends_at: `${day}T11:00:00Z`,
          kind: 'appointment', status: 'planned', price_kopecks: 300000, paid_kopecks: 0 };
        await db.query('select public.save_schedule_entries($1::jsonb,false)', [JSON.stringify([neighbor])]);
        await page.locator('[data-refresh]').click();
        await label(13).waitFor(); const beforeConflict = await persisted();
        await edit(11, '12:30');
        await page.getByRole('alert').filter({ hasText: 'Это время уже занято' }).waitFor();
        assert.deepEqual(await persisted(), beforeConflict);
        assert.equal(await label(11).innerText(), '11:45');
        assert.equal(await label(13).innerText(), '13:00');
        assert.equal(await page.locator(`[data-day="${day}"] .calendar-slot`).count(), rows);
        const after = await layout();
        assert.ok(after.scroll <= Math.max(width + 1, before.scroll), `no new horizontal overflow: ${JSON.stringify(after)}`);
        assert.deepEqual(external, []); assert.deepEqual(errors, []);
      } catch (error) {
        throw new Error(`${error.message}\nPage errors: ${JSON.stringify(errors)}\nApp: ${await page.locator('#app').innerText()}`, { cause: error });
      } finally { await context.close(); }
    });
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});

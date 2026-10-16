// Isolated real-browser test: no auth, credentials, production host, or patient data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const root = new URL('../', import.meta.url);
const html = (await readFile(new URL('index.html', root), 'utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

test('minute-level calendar works in Chromium at mobile and desktop widths', async t => {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (path === '/fixture') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
      if (!/^\/[a-zA-Z0-9.-]+$/.test(path)) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : path.endsWith('.js') || path.endsWith('.mjs') ? 'text/javascript' : 'image/png');
      res.end(await readFile(new URL(path.slice(1), root)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
    for (const width of [375, 390, 768, 1440]) await t.test(`${width}px`, async () => {
      const page = await browser.newPage({ viewport:{ width, height:980 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
        const dateKey = await page.evaluate(async () => {
          const {renderCabinet} = await import('/cabinet.js');
          const {escapeHtml} = await import('/security-utils.mjs');
          document.body.dataset.specialistReady='true';
          document.body.classList.add('is-authenticated');
          const start = new Date();
          start.setDate(start.getDate()+8);
          start.setHours(8,30,0,0);
          const dateKey = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
          const row={id:'fictional-visit',therapist_id:'fictional-therapist',patient_id:'fictional-patient',
            starts_at:start.toISOString(),ends_at:new Date(start.getTime()+3600000).toISOString(),
            kind:'appointment',status:'planned',price_kopecks:300000,paid_kopecks:0,
            initial_name:null,note:null,updated_at:start.toISOString()};
          const appointments=[row], patients=[{id:'fictional-patient',display_name:'Вымышленный пациент',schedule_price_kopecks:300000}];
          const sb={
            from(table){
              return {select(){return this},eq(){return this},order(){return this},
                async range(from,to){return {data:(table==='appointments'?appointments:patients).slice(from,to+1),error:null}}};
            },
            async rpc(name,args){
              if(name==='save_schedule_entries'){
                for(const entry of args.entries){
                  const index=appointments.findIndex(item=>item.id===entry.id);
                  if(index>=0)appointments[index]={...appointments[index],...entry,updated_at:new Date().toISOString()};
                  else appointments.push({...entry,id:'fictional-new'});
                }
              }
              return {data:1,error:null};
            }
          };
          const app=document.getElementById('app');
          window.syntheticAppointments=appointments;
          await renderCabinet({app,sb,state:{},user:{id:'fictional-therapist'},esc:escapeHtml,
            renderPatients(){},renderProfile(){}});
          return dateKey;
        });
        await page.locator('[data-copy]').waitFor();
        await page.locator('[data-date]').fill(dateKey);
        const existing=page.locator('[data-edit="fictional-visit"]');
        await existing.waitFor({state:'visible'});
        assert.match(await existing.innerText(), /08:30/);
        assert.equal(await page.locator('[data-slot="9"]').count(),0, '09:00 block overlaps 08:30–09:30');
        const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
        assert.ok(metrics.scroll<=metrics.viewport+1,`horizontal overflow: ${JSON.stringify(metrics)}`);
        await page.locator('[data-custom-time]').click();
        const time=page.locator('dialog input[name="time"]');
        await time.waitFor({state:'visible'});
        assert.equal(await time.inputValue(),'08:00');
        await time.fill('10:20');
        assert.equal(await time.inputValue(),'10:20');
        await page.locator('dialog [data-close]').first().click();
        await existing.click();
        assert.equal(await time.inputValue(),'08:30','editing preserves existing minutes');
        await time.fill('09:45');
        await page.locator('dialog .schedule-editor button[type="submit"]').click();
        await page.waitForFunction(()=>new Date(window.syntheticAppointments[0].starts_at).getMinutes()===45);
        await page.waitForFunction(()=>document.querySelector('[data-edit="fictional-visit"]')?.textContent.includes('09:45'));
        assert.equal(await page.locator('[data-slot="10"]').count(),0,'10:00 also overlaps 09:45–10:45');
        assert.deepEqual(errors,[]);
      } finally { await page.close(); }
    });
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});

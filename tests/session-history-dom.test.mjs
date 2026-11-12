import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { makeSessionHistoryClient } from './fixtures/session-history-client.mjs';

test('patient card renders active visits and saves an inline clinical edit without changing the date', async () => {
  const window = new Window({ url: 'https://fizira.test' });
  for (const key of ['document', 'sessionStorage', 'localStorage', 'FormData', 'Event', 'CSS']) globalThis[key] = window[key];
  globalThis.window = window;
  globalThis.confirm = () => true;
  const client = makeSessionHistoryClient();
  globalThis.fiziraTestClient = client;
  const plan = { main_task: 'Тестовый план' };
  client.patient.next_session_plan = plan;
  document.body.innerHTML = '<div id="headerActions"></div><main id="app"></main>';

  const appUrl = new URL('../app.js', import.meta.url);
  const appSource = (await readFile(appUrl, 'utf8'))
    .replace(/^import .*@supabase.*$/m, 'const createClient = () => globalThis.fiziraTestClient;')
    .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(path, appUrl).href}'`);
  await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);
  const waitFor = async query => {
    for (let i = 0; i < 50; i++) {
      const value = typeof query === 'string' ? document.querySelector(query) : query();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${query}`);
  };

  (await waitFor('[data-pid]')).click();
  assert.match((await waitFor('.patient-session-count')).textContent, /Проведено занятий: 3/);
  document.querySelector('[data-tab="sessions"]').click();
  const list = await waitFor('.session-history-card');
  assert.deepEqual([...list.querySelectorAll('dd')].map(el => el.textContent), ['3', '2', '2']);
  assert.deepEqual([...list.querySelectorAll('[data-session]')].map(el => el.dataset.session),
    ['synthetic-empty', 'synthetic-filled', 'synthetic-manual']);
  assert.match(list.textContent, /10:30/);
  assert.match(list.textContent, /Время не указано/);
  assert.doesNotMatch(list.textContent, /Скрытая запись/);

  const row = list.querySelector('[data-session="synthetic-empty"]');
  assert.match(row.textContent, /Без описания/);
  assert.equal(row.querySelector('[data-del-session]'), null);
  row.open = true;
  row.querySelector('[data-edit-session]').click();
  const form = row.querySelector('form');
  assert.equal(form.elements.session_date.readOnly, true);
  assert.equal(form.elements.note.required, false);
  assert.match(form.querySelector('#sessionScheduleHint').textContent, /в расписании/);
  assert.equal(form.elements.attach_plan.checked, false);
  form.elements.attach_plan.checked = true;
  form.elements.session_transcript.value = 'Тестовая диктовка.';
  await form.querySelector('#analyzeSessionBtn').onclick();
  assert.equal(form.elements.note.value, 'Черновик по диктовке.');
  await form.onsubmit(new Event('submit', { cancelable: true }));
  assert.equal(client.writes[0].action, 'update');
  assert.equal(client.writes[0].values.session_date, undefined);
  assert.equal(client.writes[0].values.note, 'Черновик по диктовке.');
  assert.deepEqual(client.writes[0].values.planned_session, plan);
  assert.equal(client.patient.next_session_plan, null);
  assert.equal(client.sessions.length, 4);
  assert.match(document.querySelector('[data-session="synthetic-empty"]').textContent, /Заполнено/);

  document.querySelector('#newManualSession').click();
  const manualForm = document.querySelector('#manualSessionEditor form');
  assert.equal(manualForm.elements.session_date.readOnly, false);
  await manualForm.onsubmit(new Event('submit', { cancelable: true }));
  assert.equal(client.writes.at(-1).action, 'insert');
  assert.equal(client.writes.at(-1).values.note, null);
  assert.match(document.querySelector('[data-session="synthetic-created"]').textContent, /Без описания/);
});

import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { Window } = require('happy-dom');
const { renderCabinet } = await import('../cabinet.js');

const waitFor = async predicate => {
  for (let i = 0; i < 100; i++) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Timed out waiting for calendar UI');
};

test('calendar supports patient search, parent contacts, debt and profile navigation', async () => {
  const window = new Window({ url:'https://app.fizira.test' });
  Object.assign(globalThis, { window, document:window.document, localStorage:window.localStorage, FormData:window.FormData, Event:window.Event });
  window.confirm = () => true; window.alert = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
  window.HTMLDialogElement.prototype.close = function(){ this.open = false; };
  document.body.innerHTML = '<main id="app"></main>';
  const appointments = [
    { id:'old', therapist_id:'u1', patient_id:'p1', starts_at:'2026-09-23T08:00:00.000Z', ends_at:'2026-09-23T09:00:00.000Z', kind:'appointment', status:'completed', price_kopecks:300000, paid_kopecks:0, note:null, initial_name:null, updated_at:'2026-09-23T08:00:00.000Z' },
    { id:'next', therapist_id:'u1', patient_id:'p1', starts_at:'2026-09-23T09:00:00.000Z', ends_at:'2026-09-23T10:00:00.000Z', kind:'appointment', status:'planned', price_kopecks:300000, paid_kopecks:0, note:null, initial_name:null, updated_at:'2026-09-23T08:00:00.000Z' }
  ];
  const patients = [{ id:'p1', therapist_id:'u1', display_name:'Иван Тестов', schedule_price_kopecks:300000 }, { id:'p2', therapist_id:'u1', display_name:'Мария Пример', schedule_price_kopecks:250000 }];
  const contacts = [{ patient_id:'p1', therapist_id:'u1', full_name:'Елена Тестова', relation:'мама', phone:'+7 900 000-00-00', is_primary:true }];
  class Query {
    constructor(table){ this.table=table; this.filters=[]; this.action='select'; }
    select(){ return this } eq(k,v){ this.filters.push([k,v]); return this } order(){ return this }
    range(from,to){ return this.result().then(r=>({...r,data:r.data.slice(from,to+1)})) }
    delete(){ this.action='delete'; return this }
    then(resolve,reject){ return this.result().then(resolve,reject) }
    async result(){ let data=this.table==='appointments'?appointments:this.table==='patients'?patients:contacts; data=data.filter(r=>this.filters.every(([k,v])=>r[k]===v)); return {data,error:null}; }
  }
  let lastRpc;
  const sb = { from:t=>new Query(t), rpc:async(name,args)=>{ lastRpc={name,args}; return {data:1,error:null}; } };
  const app = document.querySelector('#app');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  await renderCabinet({ app, sb, state:{patients}, user:{id:'u1'}, esc, renderPatients:()=>{}, renderProfile:()=>app.innerHTML='<div>PROFILE FORM</div>' });
  await waitFor(() => app.querySelector('[data-copy]'));
  assert.doesNotMatch(app.textContent, /Добавить блок|Окончание/);
  const appointmentDay = app.querySelector('[data-day="2026-09-23"]');
  appointmentDay.open = true;
  appointmentDay.dispatchEvent(new Event('toggle'));
  const nextEntry = await waitFor(() => app.querySelector('[data-edit="next"]'));
  assert.ok(nextEntry, app.innerHTML);
  nextEntry.click();
  const search = app.querySelector('[data-search]');
  assert.equal(search.value, 'Иван Тестов', 'existing appointment shows the selected patient in the field');
  search.value='Иван'; search.dispatchEvent(new Event('input'));
  [...app.querySelectorAll('[data-patient]')].find(b => b.textContent.includes('Иван')).click();
  assert.equal(search.value, 'Иван Тестов', 'patient name stays visible after selection');
  await waitFor(() => app.textContent.includes('Елена Тестова'));
  assert.equal(app.querySelector('[name="price"]').value, '3000');
  assert.match(app.querySelector('[data-balance]').textContent, /3\s?000/);
  app.querySelector('[data-close]').click();
  [...app.querySelectorAll('[data-nav]')].find(b => b.textContent === 'Профиль').click();
  assert.match(app.textContent, /PROFILE FORM/);
  assert.equal(app.querySelector('[aria-current="page"]').textContent, 'Профиль');
  assert.equal(lastRpc, undefined);
});

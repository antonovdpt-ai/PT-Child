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
  const toDayKey = date => [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
  const today = new Date();
  const todayKey = toDayKey(today);
  const futureKey = toDayKey(
    new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + 7
    ))
  );
  const atHour = (day, hour) =>
    `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const appointments = [
    { id:'old', therapist_id:'u1', patient_id:'p1', starts_at:atHour(todayKey, 8), ends_at:atHour(todayKey, 9), kind:'appointment', status:'completed', price_kopecks:300000, paid_kopecks:0, note:null, initial_name:null, updated_at:atHour(todayKey, 8) },
    { id:'next', therapist_id:'u1', patient_id:'p1', starts_at:atHour(todayKey, 9), ends_at:atHour(todayKey, 10), kind:'appointment', status:'planned', price_kopecks:300000, paid_kopecks:0, note:null, initial_name:null, updated_at:atHour(todayKey, 8) },
    { id:'future', therapist_id:'u1', patient_id:'p1', starts_at:atHour(futureKey, 9), ends_at:atHour(futureKey, 10), kind:'appointment', status:'planned', price_kopecks:300000, paid_kopecks:0, note:null, initial_name:null, updated_at:atHour(todayKey, 8) }
  ];
  const patients = [{ id:'p1', therapist_id:'u1', display_name:'Иван Тестов', schedule_price_kopecks:300000 }, { id:'p2', therapist_id:'u1', display_name:'Мария Пример', schedule_price_kopecks:250000 }, { id:'p3', therapist_id:'u1', display_name:'Новый Пациент', schedule_price_kopecks:null }];
  const contacts = [{ patient_id:'p1', therapist_id:'u1', full_name:'Елена Тестова', relation:'мама', phone:'+7 900 000-00-00', is_primary:true }];
  class Query {
    constructor(table){ this.table=table; this.filters=[]; this.action='select'; }
    select(){ return this } eq(k,v){ this.filters.push([k,v]); return this } order(){ return this }
    range(from,to){ return this.result().then(r=>({...r,data:r.data.slice(from,to+1)})) }
    delete(){ this.action='delete'; return this }
    then(resolve,reject){ return this.result().then(resolve,reject) }
    async result(){ let data=this.table==='appointments'?appointments:this.table==='patients'?patients:contacts; data=data.filter(r=>this.filters.every(([k,v])=>r[k]===v)); return {data,error:null}; }
  }
  let lastRpc, sequence = 0, rpcs = [];
  const sb = { from:t=>new Query(t), rpc:async(name,args)=>{
    lastRpc={name,args}; rpcs.push(lastRpc);
    if (name === 'save_schedule_entries') {
      for (const entry of args.entries) {
        const saved = entry.id ? appointments.find(row => row.id === entry.id) : null;
        const next = { ...entry, id:entry.id || `created-${++sequence}`, updated_at:`2026-09-23T10:00:0${sequence}.000Z` };
        delete next.expected_updated_at;
        if (saved) Object.assign(saved, next); else appointments.push(next);
        if (args.save_tariff && next.patient_id) patients.find(patient => patient.id === next.patient_id).schedule_price_kopecks = next.price_kopecks;
      }
    }
    return {data:1,error:null};
  } };
  const app = document.querySelector('#app');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  await renderCabinet({ app, sb, state:{patients}, user:{id:'u1'}, esc, renderPatients:()=>{}, renderProfile:()=>app.innerHTML='<div>PROFILE FORM</div>' });
  await waitFor(() => app.querySelector('[data-copy]'));
  assert.doesNotMatch(app.textContent, /Добавить блок|Окончание/);
  const appointmentDay = app.querySelector(`[data-day="${todayKey}"]`);
  appointmentDay.open = true;
  appointmentDay.dispatchEvent(new Event('toggle'));
  await waitFor(() => app.querySelector('[data-edit="next"]'));
  assert.equal(appointments.find(row => row.id === 'next').status, 'completed', 'today and past appointments become completed automatically');
  assert.equal(appointments.find(row => row.id === 'future').status, 'planned', 'future appointments stay planned');
  const visitStatus = app.querySelector('[data-status="next"]');
  assert.equal(visitStatus.value, 'completed');
  visitStatus.value = 'cancelled'; visitStatus.dispatchEvent(new Event('change'));
  await waitFor(() => appointments.find(row => row.id === 'next').status === 'cancelled');
  assert.equal(app.querySelector('dialog'), null, 'inline status does not open the editor');
  const cancelledStatus = await waitFor(() => app.querySelector('[data-status="next"]'));
  cancelledStatus.value = 'no_show'; cancelledStatus.dispatchEvent(new Event('change'));
  await waitFor(() => appointments.find(row => row.id === 'next').status === 'no_show');
  const noShowStatus = await waitFor(() => app.querySelector('[data-status="next"]'));
  noShowStatus.value = 'completed'; noShowStatus.dispatchEvent(new Event('change'));
  await waitFor(() => appointments.find(row => row.id === 'next').status === 'completed');
  const unpaid = app.querySelector('[data-payment="next"]');
  assert.equal(unpaid.textContent, 'Не оплачено');
  unpaid.click();
  await waitFor(() => app.querySelector('[data-payment="next"]')?.textContent === 'Оплачено');
  assert.equal(app.querySelector('dialog'), null, 'inline payment does not open the editor');
  assert.equal(appointments.find(row => row.id === 'next').paid_kopecks, 300000);
  app.querySelector('[data-payment="next"]').click();
  await waitFor(() => app.querySelector('[data-payment="next"]')?.textContent === 'Не оплачено');
  assert.equal(appointments.find(row => row.id === 'next').paid_kopecks, 0, 'payment can be reversed inline');
  app.querySelector('[data-payment="next"]').click();
  await waitFor(() => app.querySelector('[data-payment="next"]')?.textContent === 'Оплачено');
  app.querySelector('[data-edit="next"]').click();
  const search = app.querySelector('[data-search]');
  assert.equal(search.value, 'Иван Тестов', 'existing appointment shows the selected patient in the field');
  search.value='Мария'; search.dispatchEvent(new Event('input'));
  assert.match(app.querySelector('[data-selection]').textContent, /Выбери пациента/, 'typing a replacement clears the stale patient selection');
  [...app.querySelectorAll('[data-patient]')].find(b => b.textContent.includes('Мария')).click();
  assert.equal(search.value, 'Мария Пример', 'a paid appointment can be corrected to another patient');
  assert.equal(app.querySelector('[data-selection]').textContent, 'Выбрано: Мария Пример');
  assert.equal(app.querySelector('[name="price"]').value, '2500', 'replacement patient tariff is loaded');
  app.querySelector('.schedule-editor').dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
  await waitFor(() => !app.querySelector('dialog'));
  assert.equal(appointments.find(row => row.id === 'next').patient_id, 'p2', 'replacement patient is persisted');
  assert.equal(appointments.find(row => row.id === 'next').paid_kopecks, 250000, 'paid status follows the corrected appointment price');
  await waitFor(() => app.querySelector('[data-edit="next"]'));
  assert.match(app.querySelector('[data-edit="next"]').textContent, /Мария Пример/, 'calendar row shows the replacement patient');
  app.querySelector('[data-edit="next"]').click();
  const correctedSearch = app.querySelector('[data-search]');
  correctedSearch.value='Иван'; correctedSearch.dispatchEvent(new Event('input'));
  [...app.querySelectorAll('[data-patient]')].find(b => b.textContent.includes('Иван')).click();
  assert.equal(correctedSearch.value, 'Иван Тестов', 'patient name stays visible after selection');
  await waitFor(() => app.textContent.includes('Елена Тестова'));
  assert.equal(app.querySelector('[name="price"]').value, '3000');
  assert.match(app.querySelector('[data-balance]').textContent, /3\s?000/);
  app.querySelector('[data-close]').click();
  app.querySelector('[data-slot="10"]').click();
  const newSearch = app.querySelector('[data-search]');
  newSearch.value='Новый'; newSearch.dispatchEvent(new Event('input'));
  [...app.querySelectorAll('[data-patient]')].find(b => b.textContent.includes('Новый')).click();
  assert.equal(app.querySelector('[name="save_tariff"]').checked, true, 'first tariff is selected for saving automatically');
  const price = app.querySelector('[name="price"]');
  price.value = '2750'; price.dispatchEvent(new Event('input'));
  app.querySelector('.schedule-editor').dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
  await waitFor(() => !app.querySelector('dialog'));
  assert.equal(rpcs.some(call => call.name === 'save_schedule_entries' && call.args.save_tariff === true), true);
  assert.equal(patients.find(patient => patient.id === 'p3').schedule_price_kopecks, 275000, 'first price is attached to the patient');
  [...app.querySelectorAll('[data-nav]')].find(b => b.textContent === 'Профиль').click();
  assert.match(app.textContent, /PROFILE FORM/);
  assert.equal(app.querySelector('[aria-current="page"]').textContent, 'Профиль');
  assert.equal(lastRpc.name, 'save_schedule_entries');
});
test('pending real calendar reads stop before auto-completion and cannot restore retired account UI',async()=>{const window=new Window({url:'https://app.fizira.test'});Object.assign(globalThis,{window,document:window.document,localStorage:window.localStorage,FormData:window.FormData,Event:window.Event});window.document.body.innerHTML='<main id="app"></main>';const app=window.document.querySelector('main');let current=true,resolveRows;const deferred=new Promise(r=>resolveRows=r),rpcCalls=[];const query={select(){return this},eq(){return this},order(){return this},range(){return deferred;}};const sb={from:()=>query,rpc:async(name,args)=>{rpcCalls.push([name,args]);return {data:[]};}};await renderCabinet({app,sb,state:{},user:{id:'old'},esc:String,renderPatients(){},renderProfile(){},isCurrent:()=>current});const oldNav=app.querySelector('[data-nav="schedule"]');current=false;app.textContent='new-account';resolveRows({data:[{id:'old-private',kind:'appointment',patient_id:'old-child',starts_at:'2020-01-01T10:00:00Z',ends_at:'2020-01-01T11:00:00Z',status:'planned',price_kopecks:0,paid_kopecks:0}]});await new Promise(r=>setTimeout(r,20));oldNav.click();assert.equal(app.textContent,'new-account');assert.deepEqual(rpcCalls,[]);});
test('schedule editor preserves same-account inputs and finishes save; changed account cancels the awaited continuation',async()=>{const {openScheduleEditor}=await import('../schedule-editor.js');for(const switchAccount of [false,true]){const window=new Window({url:'https://app.fizira.test'});Object.assign(globalThis,{window,document:window.document,localStorage:window.localStorage,FormData:window.FormData,Event:window.Event});window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};window.document.body.innerHTML='<main id="app"></main>';const app=window.document.querySelector('main');let current=true,resolveSave,saved=0;const sb={from:()=>({select(){return this},eq(){return this},order:async()=>({data:[]})}),rpc:()=>new Promise(r=>resolveSave=r)};openScheduleEditor({app,sb,user:{id:'old'},patients:[],appointments:[],date:'2026-10-03',hour:10,esc:String,isCurrent:()=>current,onSaved:async()=>saved++});app.querySelector('[data-patient=""]').click();const form=app.querySelector('form');form.elements.initial_name.value='unsaved initial visitor';form.elements.price.value='3000';assert.equal(form.elements.initial_name.value,'unsaved initial visitor');form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>resolveSave);if(switchAccount){current=false;app.replaceChildren();}resolveSave({});await new Promise(r=>setTimeout(r,10));assert.equal(saved,switchAccount?0:1);assert.ok(!app.querySelector('dialog'));}});

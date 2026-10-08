import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {openScheduleEditor} from '../schedule-editor.js';
import {escapeHtml} from '../security-utils.mjs';
import {readFile} from 'node:fs/promises';

async function editor(row) {
  const window=new Window({url:'https://fizira.test'}),document=window.document;
  Object.assign(globalThis,{window,document});
  const app=document.createElement('main');document.body.append(app);
  const q=new Proxy({then:resolve=>Promise.resolve({data:[],error:null}).then(resolve)},{get:(t,k)=>t[k]||(()=>q)});
  openScheduleEditor({app,sb:{from:()=>q},user:{id:'owner'},patients:[{id:'child',display_name:'Вымышленный ребёнок',schedule_price_kopecks:350000}],appointments:[],patientId:'child',row,esc:escapeHtml,onSaved(){}});
  return {document,async close(){await window.happyDOM.abort();}};
}
test('preselecting current patient applies stored tariff to a new appointment',async()=>{
  const h=await editor();try {assert.equal(h.document.querySelector('[name="price"]').value,'3500');assert.equal(h.document.querySelector('[name="save_tariff"]').checked,false);} finally {await h.close();}
});
test('preselection never overwrites an existing appointment price or partial payment',async()=>{
  const h=await editor({id:'saved',patient_id:'child',starts_at:'2026-10-09T10:00:00Z',ends_at:'2026-10-09T11:00:00Z',kind:'appointment',status:'planned',price_kopecks:250000,paid_kopecks:100000});
  try {assert.equal(h.document.querySelector('[name="price"]').value,'2500');assert.equal(h.document.querySelector('[name="save_tariff"]').checked,false);assert.equal(h.document.querySelector('[name="paid"]').checked,false);assert.match(h.document.querySelector('.help').textContent,/1\s?000/);} finally {await h.close();}
});

test('the specialist patient loader retains the tariff consumed by the overview editor',async()=>{
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('async function loadPatients() {'),source.indexOf('async function countsForPatients()'));
  const row={id:'child',therapist_id:'owner',display_name:'Вымышленный ребёнок',schedule_price_kopecks:350000},state={patients:[]};let selected=[];
  const query={select(fields){selected=fields.split(',').map(x=>x.trim());return this;},order(){return Promise.resolve({data:[Object.fromEntries(Object.entries(row).filter(([key])=>selected.includes(key)))],error:null});}};
  const env={state,roleGate:{canNavigate:()=>true},authViewRevision:1,sb:{from:()=>query}};
  const load=new Function('env',`with(env){${body};return loadPatients;}`)(env);
  await load();assert.equal(state.patients[0].schedule_price_kopecks,350000);
});

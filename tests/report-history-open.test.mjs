import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFixture} from './parent-report-fixture.mjs';

for (const status of ['draft','publication_error','publishing','published','archived']) test(`initial history ${status} retains the correct text and export permission`,async()=>{
 const frozen=['published','archived'].includes(status);
 const report={id:'history',patient_id:'fictional-child',therapist_id:'fictional-specialist',publication_status:status,published_at:frozen?'2026-10-01':null,published_snapshot:frozen?{complaint:'Зафиксированный текст',therapist_name:'Специалист'}:null,complaint:'Текущий черновик',created_at:'2026-10-01'};
 const h=await workspaceFixture({reports:[report]});
 try {await h.root.querySelector('[data-open-parent-report]').onclick();
  const field=h.root.querySelector('[name=complaint]');assert.equal(field.value,frozen?'Зафиксированный текст':'Текущий черновик');assert.equal(field.readOnly,!['draft','publication_error'].includes(status));
  if(status==='publishing'){assert.equal(h.root.querySelector('[data-initial-pdf]').hidden,true);return;}
  await h.root.querySelector('[data-prepare-pdf]').onclick();assert.equal(h.root.querySelector('[data-share-pdf]').disabled,false);assert.equal(h.calls.filter(c=>c.operation).length,0);assert.equal(h.calls.at(-1).body.report_id,'history');
  assert.equal(h.root.querySelector('[data-edit-pdf]').hidden,frozen);
 } finally {await h.close();}
});

test('legacy published history with unavailable text still exports original without substituting live text',async()=>{
 const h=await workspaceFixture({reports:[{id:'history',patient_id:'fictional-child',therapist_id:'fictional-specialist',publication_status:'published',published_at:'2026-10-01',published_snapshot:null,complaint:'Do not use this live text'}]});
 try {await h.root.querySelector('[data-open-parent-report]').onclick();assert.equal(h.root.querySelector('[name=complaint]').value,'');await h.root.querySelector('[data-prepare-pdf]').onclick();assert.equal(h.calls.at(-1).body.report_id,'history');assert.equal(h.calls.filter(c=>c.operation).length,0);} finally {await h.close();}
});

test('history never renders a report owned by another specialist or patient',async()=>{
 const h=await workspaceFixture({reports:[{id:'foreign',patient_id:'fictional-child',therapist_id:'other-specialist',complaint:'PRIVATE'},{id:'other-child',patient_id:'another-child',therapist_id:'fictional-specialist',complaint:'PRIVATE'}]});
 try {assert.equal(h.root.querySelectorAll('[data-open-parent-report]').length,0);assert.equal(h.root.textContent.includes('PRIVATE'),false);}finally{await h.close();}
});

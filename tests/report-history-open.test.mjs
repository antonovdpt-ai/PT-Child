import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { mountReportPdfExport } from '../report-pdf-export.mjs';

import { reportOpenSource, reportPdfMountSource, reportOpenHtml } from './report-history-fixture.mjs';

function setup(report) {
  const window = new Window(), document = window.document, calls = [];
  document.body.innerHTML = reportOpenHtml;
  window.confirm = () => true;
  document.getElementById('parentReportEditor').scrollIntoView = () => {};
  let current = true;
  const env = { window, document, mountReportPdfExport, state:{tab:'overview',parentReports:[report],profile:{}}, user:{id:'owner',user_metadata:{}}, p:{id:'child'},
    parentReportEditor:document.getElementById('parentReportEditor'), editParentReportBtn:document.getElementById('editParentReportBtn'), saveParentReportPdfBtn:document.getElementById('saveParentReportPdfBtn'), generateParentReportBtn:document.getElementById('generateParentReportBtn'), editingParentReportId:null,
    parentReportEditorRevision:0, accountIsCurrent:() => current, setParentReportStatus(){}, renderPatient(){calls.push('navigation');}, openParentReportPrintView(){calls.push('print');},
    sb:{functions:{invoke:async (name,{body}) => {calls.push({name,body});return {data:new Blob(['%PDF-1.7\nfictional'],{type:'application/pdf'})};}}}
  };
  new Function('env', `with(env){${reportPdfMountSource}\n${reportOpenSource}}`)(env);
  return {window,document,env,calls,retire:() => {current=false;}};
}

test('history opens text and file export without routing to Parent Cabinet', async t => {
  for (const [status,publishedAt,snapshot,expected,canEdit] of [
    ['draft',null,null,'Текущий черновик',true],
    ['publication_error',null,null,'Текущий черновик',true],
    ['publishing',null,null,'Текущий черновик',false],
    ['published','2026-10-01',{complaint:'Зафиксированный текст',therapist_name:'Специалист'},'Зафиксированный текст',false],
    ['archived','2026-10-01',{complaint:'Архивный текст',therapist_name:'Специалист'},'Архивный текст',false],
    ['published','2026-10-01',null,'',false]
  ]) await t.test(status+(snapshot?' snapshot':' no snapshot'), async () => {
    const h = setup({id:'report',patient_id:'child',therapist_id:'owner',publication_status:status,published_at:publishedAt,published_snapshot:snapshot,complaint:'Текущий черновик',therapist_name:'Специалист'});
    try {
      await h.document.querySelector('[data-open-parent-report]').onclick();
      assert.equal(h.env.state.tab,'overview');
      assert.equal(h.env.parentReportEditor.style.display,'block');
      assert.equal(h.document.getElementById('reportComplaint').value,expected);
      assert.equal(h.document.getElementById('reportComplaint').readOnly,true);
      assert.equal(h.env.editParentReportBtn.style.display,canEdit?'block':'none');
      assert.equal(h.env.saveParentReportPdfBtn.style.display,canEdit?'block':'none');
      assert.deepEqual(h.calls,[]);
      await h.document.querySelector('[data-pdf-parent-report]').onclick();
      assert.equal(h.env.state.tab,'overview');
      assert.deepEqual(h.calls,[]);
      if(status==='publishing') return;
      await h.document.querySelector('[data-prepare-pdf]').onclick();
      assert.equal(h.document.querySelector('[data-share-pdf]').disabled,false);
      assert.deepEqual(h.calls,[{name:'generate-parent-report-pdf',body:{report_id:'report',report_kind:'initial',mode:'export'}}]);
      if(!canEdit) { await h.env.editParentReportBtn.onclick?.(); assert.equal(h.document.getElementById('reportComplaint').readOnly,true); }
    } finally { await h.window.happyDOM.abort(); }
  });
});

test('late AI draft cannot overwrite a different opened frozen report', async () => {
  const h=setup({id:'report',publication_status:'published',published_at:'2026-10-01',published_snapshot:{complaint:'Сохранённый текст'}});
  let finish;
  h.env.prepareParentReportDraft=()=>new Promise(resolve=>{finish=resolve;});
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=source.indexOf('if (generateParentReportBtn) {\n  generateParentReportBtn.onclick');
  const end=source.indexOf('if (saveParentReportPdfBtn) {\n  saveParentReportPdfBtn.onclick',start);
  new Function('env',`with(env){${reportPdfMountSource}\n${source.slice(start,end)}}`)(h.env);
  try {
    h.env.parentReportEditor.style.display='block';
    const pending=h.env.generateParentReportBtn.onclick();
    await h.document.querySelector('[data-open-parent-report]').onclick();
    finish({complaint:'Поздний черновик ИИ'});await pending;
    assert.equal(h.document.getElementById('reportComplaint').value,'Сохранённый текст');
    assert.equal(h.env.editingParentReportId,'report');
  } finally {await h.window.happyDOM.abort();}
});

test('late consultation save cannot replace the opened report identity or PDF control', async () => {
  const h=setup({id:'report',publication_status:'published',published_at:'2026-10-01',published_snapshot:{complaint:'Сохранённый текст'}});
  let finish;
  h.env.user.id='owner';h.env.loadPatientData=async()=>{};h.env.setTimeout=()=>{};
  h.env.sb.from=()=>{const q={insert(){return q;},select(){return q;},single(){return new Promise(resolve=>{finish=resolve;});}};return q;};
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=source.indexOf('if (saveParentReportPdfBtn) {\n  saveParentReportPdfBtn.onclick');
  const end=source.indexOf("document.querySelectorAll('[data-report-pdf-export]')",start);
  new Function('env',`with(env){${reportPdfMountSource}\n${source.slice(start,end)}}`)(h.env);
  try {
    h.env.parentReportEditor.style.display='block';h.document.getElementById('reportComplaint').value='Новый черновик';
    const pending=h.env.saveParentReportPdfBtn.onclick();
    await h.document.querySelector('[data-open-parent-report]').onclick();
    finish({data:{id:'other-saved-report'},error:null});await pending;
    assert.equal(h.env.editingParentReportId,'report');assert.equal(h.document.getElementById('reportComplaint').value,'Сохранённый текст');
    await h.document.querySelector('[data-prepare-pdf]').onclick();
    assert.equal(h.calls.at(-1).body.report_id,'report');
  } finally {await h.window.happyDOM.abort();}
});

test('retired report opening handlers do not change the current view', async () => {
  const h=setup({id:'report',publication_status:'published',published_at:'2026-10-01'});
  try {h.retire();await h.document.querySelector('[data-open-parent-report]').onclick();await h.document.querySelector('[data-pdf-parent-report]').onclick();assert.equal(h.env.parentReportEditor.style.display,'none');assert.deepEqual(h.calls,[]);} finally {await h.window.happyDOM.abort();}
});

test('new consultation after a frozen report restores an empty editable draft', async () => {
  const h=setup({id:'report',publication_status:'published',published_at:'2026-10-01',published_snapshot:{complaint:'Сохранённый текст'}});
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=source.indexOf('if (parentReportBtn && parentReportEditor) {');
  const end=source.indexOf('if (closeParentReportBtn && parentReportEditor)',start);
  h.env.parentReportBtn=h.document.createElement('button');
  new Function('env',`with(env){${source.slice(start,end)}}`)(h.env);
  try {
    await h.document.querySelector('[data-open-parent-report]').onclick();
    h.env.saveParentReportPdfBtn.disabled=true;h.env.generateParentReportBtn.disabled=true;
    h.env.parentReportBtn.onclick();
    assert.equal(h.env.editingParentReportId,null);
    assert.equal(h.document.getElementById('reportComplaint').value,'');assert.equal(h.document.getElementById('reportComplaint').readOnly,false);
    assert.equal(h.env.saveParentReportPdfBtn.style.display,'block');assert.equal(h.env.saveParentReportPdfBtn.disabled,false);
    assert.equal(h.env.generateParentReportBtn.style.display,'block');assert.equal(h.env.generateParentReportBtn.disabled,false);
    assert.equal(h.document.querySelector('[data-prepare-pdf]'),null);
  } finally {await h.window.happyDOM.abort();}
});

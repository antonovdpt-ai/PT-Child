import test from 'node:test';
import assert from 'node:assert/strict';
import {flowerFixture} from './patient-flower-fixture.mjs';
import {updateOverviewReport} from '../patient-overview.mjs';

test('simultaneous overview transitions leave exactly one active section', async () => {
  const h = await flowerFixture({overview:true});
  try {
    const buttons = h.document.querySelectorAll('[data-overview-tab]');
    await Promise.all([buttons[0].onclick(),buttons[1].onclick()]);
    assert.equal(h.document.querySelectorAll('#tabContent').length,1);
    assert.equal(h.document.querySelectorAll('[data-patient-section]:not([hidden])').length,1);
    assert.equal(h.document.querySelector('#tabContent').dataset.patientSection,h.state.tab);
  } finally {await h.close();}
});

test('a report created elsewhere joins overview history without replacing the editor', async () => {
  const h=await flowerFixture({overview:true});
  try {
    const editor=h.document.querySelector('[data-report-editor]');
    await h.document.querySelector('[data-tab="parent"]').onclick();
    h.state.parentReports.push({id:'created-in-parent',patient_id:h.patient.id,therapist_id:'owner',created_at:'2026-10-08T10:00:00Z',publication_status:'draft',complaint:'Новый сохранённый отчёт'});
    await h.document.querySelector('[data-tab="overview"]').onclick();
    assert.ok(h.document.querySelector('[data-report-editor]')===editor);
    await h.document.querySelector('[data-overview-report]').onclick();
    assert.equal(editor.hidden,false);
    assert.equal(editor.querySelector('[name="complaint"]').value,'Новый сохранённый отчёт');
  } finally {await h.close();}
});

test('clicking the current section while a save completes retains the active panel', async () => {
  const h=await flowerFixture({overview:true});
  try {
    const panel=h.document.querySelector('#tabContent');
    const button=h.document.querySelector('[data-tab="overview"]');
    const pending=button.onclick();
    panel.dataset.needsRefresh='true';
    await pending;
    assert.equal(h.document.querySelectorAll('#tabContent').length,1);
    assert.ok(h.document.querySelector('#tabContent').isConnected);
  } finally {await h.close();}
});

test('switching sections retains the same unsaved form and handler without rerendering the patient', async () => {
  const h = await flowerFixture();
  try {
    await h.document.querySelector('[data-tab="goals"]').onclick();
    const panel = h.document.querySelector('#tabContent');
    panel.innerHTML = '<form><input value="Несохранённая цель"></form>';
    const form = panel.querySelector('form'), input = panel.querySelector('input');
    let submissions = 0;
    form.onsubmit = event => { event.preventDefault(); submissions++; };
    await h.document.querySelector('[data-tab="assessment"]').onclick();
    await h.document.querySelector('[data-tab="goals"]').onclick();
    assert.ok(h.document.querySelector('#tabContent') === panel, 'Section navigation recreated the unsaved form');
    assert.ok(panel.querySelector('input') === input);
    assert.equal(input.value, 'Несохранённая цель');
    form.dispatchEvent(new h.window.Event('submit', {cancelable:true}));
    assert.equal(submissions, 1);
  } finally {await h.close();}
});

test('patient navigation exposes seven petals linked to existing sections', async () => {
  const h = await flowerFixture();
  try {
    assert.equal(h.document.querySelectorAll('.flower-petal').length, 7);
    assert.equal(h.document.querySelector('[data-flower-toggle]').getAttribute('aria-expanded'), 'true');
    for (const key of ['goals','assessment','sessions','progress','media','parent','overview']) {
      await h.document.querySelector(`[data-tab="${key}"]`).onclick();
      assert.equal(h.state.tab,key);
      assert.equal(h.document.querySelector('#tabContent').dataset.patientSection,key);
      assert.equal(h.document.querySelector('[aria-current="page"]').dataset.tab,key);
      assert.equal(h.document.querySelector('[data-flower-toggle]').getAttribute('aria-expanded'),'false');
    }
  } finally {await h.close();}
});

test('returning to overview updates saved facts while keeping the report editor DOM', async () => {
  const h = await flowerFixture({overview:true});
  try {
    await h.settle();
    const overview = h.document.querySelector('.patient-overview');
    const reportFields = h.document.querySelector('[data-report-editor]');
    await h.document.querySelector('[data-tab="goals"]').onclick();
    h.state.goals.push({id:'saved-goal',patient_id:'child-a',status:'active',title:'Новая сохранённая цель'});
    await h.document.querySelector('[data-tab="overview"]').onclick();
    await h.settle();
    assert.ok(h.document.querySelector('.patient-overview') === overview);
    assert.match(overview.textContent,/Новая сохранённая цель/);
    assert.ok(h.document.querySelector('[data-report-editor]') === reportFields);
    assert.ok(h.document.querySelector('.parent-report-workspace').parentReportController);
  } finally {await h.close();}
});

test('folding keeps the current form DOM and stores only a layout preference', async () => {
  const h = await flowerFixture();
  try {
    const content=h.document.querySelector('#tabContent');content.innerHTML='<input value="Несохранённая запись">';
    h.document.querySelector('[data-flower-toggle]').click();
    assert.equal(h.document.querySelector('#tabContent'),content);
    assert.equal(content.querySelector('input').value,'Несохранённая запись');
    assert.equal(h.state.tab,'overview');
    const stored=Object.fromEntries(Array.from({length:h.window.localStorage.length},(_,i)=>{const key=h.window.localStorage.key(i);return [key,h.window.localStorage.getItem(key)];}));
    assert.deepEqual(stored,{'fizira:flower-compact':'1'});
    h.render();
    assert.equal(h.document.querySelector('[data-flower-toggle]').getAttribute('aria-expanded'),'false');
    h.document.querySelector('[data-flower-toggle]').click();
    assert.equal(h.document.querySelector('[data-flower-toggle]').getAttribute('aria-expanded'),'true');
  } finally {await h.close();}
});

test('patient details stay escaped and full complaint is available on demand', async () => {
  const h=await flowerFixture({patient:{display_name:'<img src=x onerror=alert(1)>',primary_complaint:'Длинная жалоба '.repeat(80)+'<script>bad()</script>'}});
  try {
    assert.equal(h.document.querySelectorAll('h1 img,script').length,0);
    h.document.querySelector('[data-patient-details]').click();
    assert.equal(h.document.querySelector('dialog p').textContent,h.patient.primary_complaint);
    assert.ok(h.document.querySelector('dialog').open);
    h.document.querySelector('[data-close-details]').click();
    assert.equal(h.document.querySelector('dialog').open,false);
    h.document.querySelector('#editPatient').click();h.document.querySelector('#backPatients').click();
    assert.deepEqual(h.calls.filter(c=>c.action).map(c=>c.action),['edit','patients']);
  } finally {await h.close();}
});

test('overview shows saved facts and opens saved report without Parent Cabinet', async () => {
  const h=await flowerFixture({overview:true,state:{
    goals:[{id:'goal',patient_id:'child-a',title:'Стоять у опоры',status:'active',progress:30},{id:'done',patient_id:'child-a',title:'Завершено',status:'achieved',progress:100}],
    sessions:[{id:'session',patient_id:'child-a',session_date:'2026-10-01',dynamics_status:'stable',function_changes:'Без новых изменений'}],
    parentReports:[{id:'saved-report',patient_id:'child-a',therapist_id:'owner',created_at:'2026-10-01T10:00:00Z',publication_status:'draft',complaint:'Сохранённый текст'}]
  }});
  try {
    await h.settle();
    const overview=h.document.querySelector('.patient-overview');assert.ok(overview);
    assert.match(overview.textContent,/Стоять у опоры/);assert.doesNotMatch(overview.textContent,/Положительная тенденция/);
    await overview.querySelector('[data-overview-report]').onclick();
    assert.equal(h.state.tab,'overview');
    assert.equal(h.document.querySelector('[name="complaint"]').value,'Сохранённый текст');
    assert.equal(h.document.querySelector('[data-report-editor]').hidden,false);
  } finally {await h.close();}
});

test('latest report compares initial and session reports, excludes another patient and refreshes after changes',async()=>{
  const initial={id:'initial',patient_id:'child-a',created_at:'2026-10-01T10:00:00Z'};
  const session={id:'session-report',patient_id:'child-a',session_id:'visit',created_at:'2026-10-07T10:00:00Z'};
  const foreign={...session,id:'foreign',patient_id:'child-b',created_at:'2026-10-08T10:00:00Z'};
  const h=await flowerFixture({overview:true,state:{parentReports:[initial],parentSessionReports:[session,foreign]}});
  try {
    const root=h.document.querySelector('.patient-overview'),button=root.querySelector('[data-overview-report]');
    assert.equal(button.dataset.overviewReport,session.id);assert.equal(button.dataset.reportKind,'session');assert.equal(button.dataset.reportSession,'visit');
    assert.match(button.textContent,/Отчёт занятия/);
    updateOverviewReport(root,{patientId:'child-a',reports:[initial],sessionReports:[]});
    assert.equal(button.dataset.overviewReport,initial.id);assert.equal(button.dataset.reportKind,'initial');assert.match(button.textContent,/Первичный отчёт/);
    updateOverviewReport(root,{patientId:'child-a',reports:[],sessionReports:[]});
    assert.equal(button.dataset.overviewReport,'');assert.match(button.textContent,/Подготовить отчёт/);
  } finally {await h.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {workspaceFixture} from './parent-report-fixture.mjs';
const owner='fictional-specialist',child='fictional-child';
const start=h=>h.root.querySelector('[data-start-report]').onclick();
const generate=h=>h.root.querySelector('[data-prepare-pdf]').onclick();

test('absent report has one action; launch creates AI text and automatically saves',async()=>{
 let saved;const persisted=new Promise(r=>saved=r),h=await workspaceFixture({onSaved:saved});
 try {assert.equal(h.root.dataset.state,'EMPTY');assert.equal([...h.root.querySelectorAll('button')].filter(b=>!b.closest('[hidden]')).length,1);await start(h);
 assert.equal(h.root.querySelector('[name=complaint]').value,'Причина обращения');await persisted;assert.equal(h.rows.length,1);assert.equal(h.rows[0].publication_status,'draft');assert.equal(h.rows[0].therapist_name,'Анна Тестовая');assert.match(h.root.querySelector('[data-save-status]').textContent,/Сохранено/);
 } finally {await h.close();}
});
test('AI error retains manual editor and retry recovers without a browser dialog',async()=>{
 let attempt=0;const h=await workspaceFixture({prepareDraft:async()=>{if(++attempt===1)throw Error('private stack');return {complaint:'После повтора'};}});
 try {await start(h);assert.match(h.root.textContent,/Не удалось подготовить отчёт/);assert.equal(h.root.textContent.includes('private stack'),false);await h.root.querySelector('[data-retry-draft]').onclick();assert.equal(h.root.querySelector('[name=complaint]').value,'После повтора');await h.flow.flush();assert.equal(h.rows.length,1);} finally {await h.close();}
});
test('PDF generation saves latest edits implicitly and does not create parent permissions',async()=>{
 const h=await workspaceFixture();try {await start(h);h.input('recommendations','Самая свежая рекомендация');await generate(h);
 assert.equal(h.rows.length,1);assert.equal(h.rows[0].recommendations,'Самая свежая рекомендация');assert.equal(h.root.dataset.state,'PDF_READY');assert.equal(h.root.querySelector('[data-report-fields]').hidden,true);assert.ok(h.root.querySelector('[data-pdf-preview]'));
 assert.deepEqual(h.calls.filter(c=>c.name),[{name:'generate-parent-report-pdf',body:{report_id:'report-1',report_kind:'initial',mode:'export'}}]);
 await h.root.querySelector('[data-edit-pdf]').onclick();assert.equal(h.root.querySelector('[data-report-fields]').hidden,false);assert.equal(h.root.querySelector('[name=recommendations]').value,'Самая свежая рекомендация');
 } finally {await h.close();}
});
test('save failure keeps unsaved text, blocks export, and successful retry saves one draft',async()=>{
 const h=await workspaceFixture({failSave:true});try {await start(h);h.input('complaint','Не потерять текст');await generate(h);assert.equal(h.root.querySelector('[name=complaint]').value,'Не потерять текст');assert.match(h.root.textContent,/Изменения пока не сохранены/);assert.equal(h.calls.filter(c=>c.name).length,0);
 h.setFailSave(false);await generate(h);assert.equal(h.rows.length,1);assert.equal(h.rows[0].complaint,'Не потерять текст');assert.equal(h.root.dataset.state,'PDF_READY');} finally {await h.close();}
});
test('serialized writes capture edits arriving during an insert before export',async()=>{
 let finish,entered;const started=new Promise(r=>entered=r);let first=true;
 const h=await workspaceFixture({beforeWrite:async()=>{if(first){first=false;entered();await new Promise(r=>finish=r);}}});
 try {await start(h);const pending=generate(h);await started;h.input('complaint','Изменено во время сохранения');finish();await pending;
 assert.equal(h.rows.length,1);assert.equal(h.rows[0].complaint,'Изменено во время сохранения');assert.equal(h.calls.filter(c=>c.operation==='insert').length,1);assert.equal(h.root.dataset.state,'PDF_READY');
 } finally {await h.close();}
});
test('switching reports retires late AI and saves; frozen history uses snapshot only',async()=>{
 let finish;const report={id:'frozen',patient_id:child,therapist_id:owner,publication_status:'published',published_at:'2026-10-01',published_snapshot:{complaint:'Зафиксированный текст'},complaint:'Новый клинический текст',created_at:'2026-10-01'};
 const h=await workspaceFixture({reports:[report],prepareDraft:()=>new Promise(r=>finish=r)});
 try {const pending=start(h);await h.root.querySelector('[data-open-parent-report]').onclick();finish({complaint:'Поздний ИИ'});await pending;
 assert.equal(h.root.querySelector('[name=complaint]').value,'Зафиксированный текст');assert.equal(h.root.querySelector('[name=complaint]').readOnly,true);await generate(h);assert.equal(h.calls.filter(c=>c.operation).length,0);assert.equal(h.calls.at(-1).body.report_id,'frozen');assert.equal(h.root.querySelector('[data-edit-pdf]').hidden,true);
 } finally {await h.close();}
});
test('retired patient never accepts pending PDF or starts a new write',async()=>{
 const h=await workspaceFixture();try {await start(h);const retained=h.root.querySelector('[data-prepare-pdf]');h.retire();await h.flow.flush();assert.equal(h.rows.length,0);await retained.onclick();assert.equal(h.calls.length,0);} finally {await h.close();}
});
test('initial draft history is separately updated and remains editable without rerendering fields',async()=>{
 const h=await workspaceFixture();try {await start(h);h.input('complaint','Отредактированная причина');await h.flow.flush();const field=h.root.querySelector('[name=complaint]');assert.equal(h.root.querySelectorAll('[data-open-parent-report]').length,1);assert.equal(field.value,'Отредактированная причина');await h.root.querySelector('[data-close-report]').onclick();await h.root.querySelector('[data-open-parent-report]').onclick();assert.equal(h.root.querySelector('[name=complaint]').value,'Отредактированная причина');assert.equal(h.root.querySelector('[name=complaint]').readOnly,false);} finally {await h.close();}
});
test('opening the current dirty history report keeps latest text and the new CAS revision',async()=>{
 const h=await workspaceFixture();try {await start(h);await h.flow.flush();h.input('complaint','Правка перед повторным открытием');await h.root.querySelector('[data-open-parent-report]').onclick();
 assert.equal(h.root.querySelector('[name=complaint]').value,'Правка перед повторным открытием');h.input('complaint','Следующая правка');assert.equal(await h.flow.flush(),'report-1');assert.equal(h.rows[0].complaint,'Следующая правка');
 }finally{await h.close();}
});
test('clearing an existing draft persists deletions on close and blocks empty PDF',async()=>{
 const h=await workspaceFixture();try {await start(h);await h.flow.flush();for(const key of ['complaint','strengths','observations','goals','progress','recommendations'])h.input(key,'');await h.root.querySelector('[data-close-report]').onclick();
 for(const key of ['complaint','strengths','observations','goals','progress','recommendations'])assert.equal(h.rows[0][key],null);await h.root.querySelector('[data-open-parent-report]').onclick();assert.equal(h.root.querySelector('[name=complaint]').value,'');await generate(h);assert.equal(h.calls.filter(c=>c.name).length,0);
 }finally{await h.close();}
});
test('same-account navigation flushes pending debounce and save failure retains the editor',async()=>{
 const h=await workspaceFixture();try {await start(h);await h.flow.flush();h.input('complaint','Правка перед переходом');assert.equal(await h.flow.beforeLeave(),true);assert.equal(h.rows[0].complaint,'Правка перед переходом');
 h.setFailSave(true);h.input('complaint','Остаться до сохранения');assert.equal(await h.flow.beforeLeave(),false);assert.equal(h.root.querySelector('[name=complaint]').value,'Остаться до сохранения');assert.equal(h.root.querySelector('[name=complaint]').disabled,false);
 }finally{await h.close();}
});

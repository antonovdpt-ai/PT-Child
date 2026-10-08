import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { renderParentPortalSpecialist, renderParentSessionReportEditor } from '../parent-specialist.js';
const user={id:'therapist'},patient={id:'child',therapist_id:'therapist'};
const contact={id:'contact',patient_id:'child',therapist_id:'therapist',full_name:'Анна Смирнова',email:'anna@example.test'};
const session={id:'session',patient_id:'child',therapist_id:'therapist',note:'SOURCE_SECRET',ai_draft:'AI_SECRET',tolerance:'TOLERANCE_SECRET'};
const report={id:'report',patient_id:'child',therapist_id:'therapist',session_id:'session',publication_status:'draft',what_did:'Поиграли',pdf_storage_path:'PRIVATE_PATH',published_media:[{storage_path:'PRIVATE_PATH'}]};
const tick=()=>new Promise(r=>setTimeout(r,0));
test('confirmed invitation send remains visible after authoritative portal remount',async()=>{
 const h=harness();
 h.options.refresh=async invitationSent=>{
  h.rows.parent_invitations=[{id:'invite',contact_id:contact.id,patient_id:patient.id,therapist_id:user.id,email_normalized:contact.email,expires_at:'2099-01-02T12:00:00Z'}];
  await renderParentPortalSpecialist({...h.options,invitationSent});
 };
 await renderParentPortalSpecialist(h.options);await click(h,'[data-invite]');
 assert.match(h.root.querySelector('[data-status]').textContent,/Приглашение отправлено/);
 assert.match(h.root.querySelector('[data-contact]').textContent,/Приглашение создано/);
 await renderParentPortalSpecialist(h.options);
 assert.equal(h.root.querySelector('[data-status]').textContent,'','ordinary reload must not claim a new email send');
});
test('real patient list projection supplies authoritative owner to the mounted parent tab',async()=>{
 const h=harness();h.root.id='tabContent';
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const load=source.slice(source.indexOf('async function loadPatients()'),source.indexOf('async function countsForPatients()'));
 const tab=source.slice(source.indexOf('function renderTab('),source.indexOf('let editingContactId = null;'))+'}';
 const row={...patient,display_name:'ТЕСТ: ребёнок из списка'};
 const sb={...h.options.sb,from(table){if(table!=='patients')return h.options.sb.from(table);let columns;const q={select(value){columns=value.split(',');return q;},order(){return q;},then(resolve){return Promise.resolve({data:[Object.fromEntries(columns.map(k=>[k,row[k]]))],error:null}).then(resolve);}};return q;}};
 const env={sb,document:h.window.document,user,roleGate:{canNavigate:()=>true},authViewRevision:1,state:{patients:[],patientId:patient.id,tab:'parent',contacts:[contact]},SUPABASE_URL:'https://auth.fizira.com',renderParentPortalSpecialist,renderPatient(){},loadPatientData:async()=>{}};
 const code=new Function('env',`with(env){${load}\n${tab}\nreturn {loadPatients,renderTab};}`)(env);
 await code.loadPatients();code.renderTab(env.state.patients[0]);await tick();await tick();
 assert.ok(h.root.querySelector('[data-add-parent]'),'parent controls must mount for a child loaded by the real list query');
 h.root.replaceChildren();code.renderTab({...env.state.patients[0],therapist_id:'different-specialist'});await tick();
 assert.equal(h.root.textContent,'','an unowned child must remain rejected');
});
function harness(seed={}) {
 const window=new Window();window.document.body.innerHTML='<main></main>';const root=window.document.querySelector('main');let current=true,confirm=true,refreshes=0;window.confirm=()=>confirm;
 const rows={parent_invitations:[],parent_child_access:[],parent_reports:[],parent_session_reports:[],parent_goal_publications:[],goals:[],sessions:[session],patient_media:[],parent_session_report_media:[],...seed};const calls=[];let delayed, readDelay, responseDelay;
 const sb={from(table){let op='select',payload,filters=[],columns,orders=[];const q={select(v){columns=v;return this},eq(k,v){filters.push([k,v]);return this},order(k,{ascending=true}={}){orders.push([k,ascending]);return this},limit(){return this},insert(v){op='insert';payload=v;return this},update(v){op='update';payload=v;return this},delete(){op='delete';return this},single(){this.one=true;return this},then(resolve,reject){calls.push({table,op,payload,filters,columns,orders});let data=rows[table].filter(row=>filters.every(([k,v])=>row[k]===v));for(const [k,ascending] of [...orders].reverse())data.sort((a,b)=>String(a[k]||'').localeCompare(String(b[k]||''))*(ascending?1:-1));if(op==='insert'){const items=(Array.isArray(payload)?payload:[payload]).map(x=>({id:'new-'+rows[table].length,publication_status:'draft',...x}));rows[table].push(...items);data=items[0];}if(op==='update')data.forEach(x=>Object.assign(x,payload));if(op==='delete')rows[table]=rows[table].filter(x=>!data.includes(x));data=structuredClone(data);if(this.one&&Array.isArray(data))data=data[0];if(responseDelay)return responseDelay({table,op,data,error:null}).then(resolve,reject);if(readDelay&&op==='select')return readDelay({data,error:null}).then(resolve,reject);return Promise.resolve({data,error:null}).then(resolve,reject);}};return q;},functions:{async invoke(name,{body}){const expected={ 'create-parent-invitation':['contact_id','patient_id'],'resend-parent-invitation':['invitation_id'],'revoke-parent-access':['access_id'],'generate-parent-report-pdf':['report_id','report_kind']}[name];assert.deepEqual(Object.keys(body).sort(),expected.sort());calls.push({name,body});if(delayed)return delayed();if(seed.pdfError){const row=rows.parent_session_reports.find(x=>x.id===body.report_id);if(row)row.publication_status='publication_error';return {error:{message:'PRIVATE_PATH'}};}if(name==='generate-parent-report-pdf'){const row=rows[body.report_kind==='initial'?'parent_reports':'parent_session_reports'].find(x=>x.id===body.report_id);if(row){row.publication_status='published';row.published_at='2026-10-01';}}return {data:{ok:true,expires_at:'2099-01-01',publication_status:'published'},error:null};}}};
 sb.storage={from(){return {createSignedUrl:async(path)=>({data:{signedUrl:'https://auth.fizira.com/storage/v1/object/sign/patient-media/'+path+'?token=source-signature'},error:null})}}};
 const options={root,sb,user,patient,storageOrigin:'https://auth.fizira.com',contacts:[contact],isCurrent:()=>current,refresh:async()=>{refreshes++}};
 return {window,root,rows,calls,options,setCurrent(v){current=v},setConfirm(v){confirm=v},setDelay(fn){delayed=fn},setReadDelay(fn){readDelay=fn},setResponseDelay(fn){responseDelay=fn},get refreshes(){return refreshes}};
}
async function click(h,selector){const b=h.root.querySelector(selector);assert.ok(b,selector);b.click();await tick();await tick();}
test('cached parent facts refresh saved lists and retain unsaved contact and report forms',async()=>{
 const h=harness({parent_reports:[{id:'initial',patient_id:patient.id,therapist_id:user.id,publication_status:'draft',complaint:'Сохранённый текст'}]});
 try {
  await renderParentPortalSpecialist(h.options);await click(h,'[data-add-parent]');
  const form=h.root.querySelector('[data-parent-contact-form]');form.querySelector('[name=full_name]').value='Вымышленный черновик';
  await click(h,'[data-open-initial]');
  const editor=h.root.querySelector('[data-initial-editor]');editor.querySelector('[name=complaint]').value='Несохранённая правка';
  h.rows.parent_goal_publications.push({id:'publication',patient_id:patient.id,therapist_id:user.id,title:'Новая опубликованная цель',published_at:'2026-10-08',status:'in_progress'});
  h.rows.sessions.push({...session,id:'new-session',session_date:'2026-10-08'});
  await h.root.refreshPatientFacts();
  assert.ok(h.root.querySelector('[data-parent-contact-form]')===form);assert.equal(form.querySelector('[name=full_name]').value,'Вымышленный черновик');
  assert.ok(h.root.querySelector('[data-initial-editor]')===editor);assert.equal(editor.querySelector('[name=complaint]').value,'Несохранённая правка');
  assert.match(h.root.querySelector('[data-parent-goal-list]').textContent,/Новая опубликованная цель/);
  assert.ok(h.root.querySelector('[data-session="new-session"]'));
  assert.match(h.root.querySelector('[data-parent-visibility]').textContent,/цели — 1/);
 } finally {await h.window.happyDOM.abort();}
});
test('contact lifecycle states use IDs only, confirmation and no sensitive markup',async()=>{
 const h=harness({parent_invitations:[{id:'invite',contact_id:'contact',patient_id:'child',therapist_id:'therapist',expires_at:'2099-01-01',token_digest:'TOKEN_SECRET'}]});await renderParentPortalSpecialist(h.options);
 assert.match(h.root.textContent,/Кабинет родителя|Приглашение отправлено/);assert.match(h.root.textContent,/anna@example.test/);assert.doesNotMatch(h.root.innerHTML,/TOKEN_SECRET|PRIVATE_PATH|SOURCE_SECRET/);
 await click(h,'[data-resend]');assert.deepEqual(h.calls.find(x=>x.name).body,{invitation_id:'invite'});
 const a=harness({parent_child_access:[{id:'access',contact_id:'contact',patient_id:'child',therapist_id:'therapist',status:'active'}]});await renderParentPortalSpecialist(a.options);assert.match(a.root.textContent,/Активирован/);a.setConfirm(false);await click(a,'[data-revoke]');assert.equal(a.calls.filter(x=>x.name).length,0);a.setConfirm(true);await click(a,'[data-revoke]');assert.deepEqual(a.calls.find(x=>x.name).body,{access_id:'access'});
 const r=harness({parent_child_access:[{id:'access',contact_id:'contact',patient_id:'child',therapist_id:'therapist',status:'revoked'}]});await renderParentPortalSpecialist(r.options);assert.match(r.root.textContent,/Доступ отозван/);
 const n=harness();await renderParentPortalSpecialist(n.options);assert.match(n.root.textContent,/Не приглашён/);await click(n,'[data-invite]');assert.deepEqual(n.calls.find(x=>x.name).body,{patient_id:'child',contact_id:'contact'});
});
test('legacy nullable email remains editable and invalid email cannot invite',async()=>{const h=harness();h.options.contacts=[{...contact,email:null}];await renderParentPortalSpecialist(h.options);assert.equal(h.root.querySelector('[data-invite]').disabled,true);h.root.querySelector('[data-contact] [name=email]').value='bad';await click(h,'[data-save-email]');assert.equal(h.calls.filter(x=>x.op==='update').length,0);h.root.querySelector('[data-contact] [name=email]').value='ANNA@example.test';await click(h,'[data-save-email]');assert.deepEqual(h.calls.find(x=>x.op==='update').payload,{email:'anna@example.test'});});
test('session editor writes four safe fields and explicitly selected owned photo IDs only',async()=>{const h=harness({patient_media:[{id:'photo',patient_id:'child',therapist_id:'therapist',media_type:'photo',storage_path:'therapist/photo.jpg'},{id:'foreign',patient_id:'other',therapist_id:'therapist',media_type:'photo',storage_path:'therapist/photo.jpg'}]});await renderParentSessionReportEditor({...h.options,session});assert.doesNotMatch(h.root.innerHTML,/SOURCE_SECRET|AI_SECRET|TOLERANCE_SECRET|PRIVATE_PATH|foreign/);assert.deepEqual([...h.root.querySelectorAll('textarea')].map(x=>x.name),['what_did','what_worked','attention','home_recommendations']);h.root.querySelector('[name=what_did]').value='Поиграли';h.root.querySelector('img').dispatchEvent(new h.window.Event('load'));h.root.querySelector('[name=media]').checked=true;await click(h,'[data-save-report]');const write=h.calls.find(x=>x.table==='parent_session_reports'&&x.op==='insert');assert.deepEqual(Object.keys(write.payload).sort(),['patient_id','therapist_id','session_id','what_did','what_worked','attention','home_recommendations'].sort());const selection=h.calls.find(x=>x.table==='parent_session_report_media'&&x.op==='insert');assert.deepEqual(selection.payload[0],{parent_session_report_id:'new-0',patient_media_id:'photo',patient_id:'child',therapist_id:'therapist',position:0});});
test('publication confirms, uses exact server contract, error permits retry',async()=>{const h=harness({parent_session_reports:[{...report}],pdfError:true});await renderParentSessionReportEditor({...h.options,session});h.setConfirm(false);await click(h,'[data-publish-report]');assert.equal(h.calls.filter(x=>x.name).length,0);h.setConfirm(true);await click(h,'[data-publish-report]');assert.match(h.root.textContent,/Ошибка публикации/);assert.doesNotMatch(h.root.innerHTML,/PRIVATE_PATH/);assert.equal(h.root.querySelector('[data-publish-report]').disabled,false);assert.deepEqual(h.calls.find(x=>x.name).body,{report_id:'report',report_kind:'session'});});
test('published reports are immutable; new version copies allowlisted content without metadata',async()=>{const h=harness({parent_session_reports:[{...report,publication_status:'published',published_at:'2026-10-01'}]});await renderParentSessionReportEditor({...h.options,session});assert.ok([...h.root.querySelectorAll('textarea')].every(x=>x.readOnly));assert.equal(h.root.querySelector('[data-save-report]'),null);await click(h,'[data-new-version]');const write=h.calls.find(x=>x.op==='insert');assert.equal(write.payload.what_did,'Поиграли');assert.ok(!('published_at' in write.payload));assert.ok(!('pdf_storage_path' in write.payload));});
test('stale handlers and async continuations cannot write, refresh or restore old child DOM',async()=>{const h=harness({parent_session_reports:[{...report}]});await renderParentSessionReportEditor({...h.options,session});const handler=h.root.querySelector('[data-publish-report]');let finish;h.setDelay(()=>new Promise(r=>finish=r));handler.click();await tick();h.setCurrent(false);h.root.textContent='new child';finish({data:{publication_status:'published'}});await tick();assert.equal(h.refreshes,0);assert.equal(h.root.textContent,'new child');handler.click();await tick();assert.equal(h.calls.filter(x=>x.name).length,1);});
test('stale reads cannot render portal and detached editor cannot execute actions',async()=>{const h=harness();h.setCurrent(false);await renderParentPortalSpecialist(h.options);assert.equal(h.root.textContent,'');assert.equal(h.calls.length,0);const s=harness({parent_session_reports:[{...report}]});await renderParentSessionReportEditor({...s.options,session});const b=s.root.querySelector('[data-save-report]');s.root.remove();b.click();await tick();assert.equal(s.calls.filter(x=>x.op==='update').length,0);});
test('parent goal section is read-only and sends management to ordinary Goals',async()=>{const h=harness({parent_goal_publications:[{id:'publication',goal_id:'goal',patient_id:'child',therapist_id:'therapist',title:'Игра стоя',description:'С поддержкой',status:'in_progress',published_at:'2026-10-06'}]});let managed=0;h.options.manageGoals=()=>{managed++};await renderParentPortalSpecialist(h.options);assert.equal(h.root.querySelector('[data-goal-form]'),null);assert.equal(h.root.querySelector('[data-publish-goal]'),null);assert.match(h.root.textContent,/Опубликовано целей: 1/);assert.match(h.root.textContent,/Игра стоя/);await click(h,'[data-manage-goals]');assert.equal(managed,1);assert.equal(h.calls.filter(x=>x.table==='parent_goal_publications'&&x.op!=='select').length,0);});
test('root integrates portal tab, nullable contact email, guarded refresh and versioned module',()=>{const src=readFileSync(new URL('../app.js',import.meta.url),'utf8');assert.match(src,/Кабинет родителя/);assert.match(src,/renderParentPortalSpecialist/);assert.match(src,/renderParentSessionReportEditor/);assert.match(src,/name="email"/);assert.match(src,/state.patientId !== pid/);});

test('successful publication retires editing and refreshes parent visibility',async()=>{const h=harness({parent_session_reports:[{...report}]});await renderParentSessionReportEditor({...h.options,session});await click(h,'[data-publish-report]');assert.equal(h.refreshes,1);assert.equal(h.root.querySelector('[data-save-report]'),null);assert.match(h.root.textContent,/Опубликовано для родителя/);});
test('retry re-reads authoritative publication_error before updating draft, then publishes',async()=>{const h=harness({parent_session_reports:[{...report}],pdfError:true});await renderParentSessionReportEditor({...h.options,session});await click(h,'[data-publish-report]');await click(h,'[data-publish-report]');const writes=h.calls.filter(x=>x.table==='parent_session_reports'&&x.op==='update');assert.equal(writes.at(-1).filters.find(([k])=>k==='publication_status')[1],'publication_error');});
test('pending read on reused root cannot replace new child; same view preserves typed fields',async()=>{const h=harness();let finish;h.setReadDelay(data=>new Promise(r=>finish=()=>r(data)));const pending=renderParentSessionReportEditor({...h.options,session});await tick();h.setCurrent(false);h.root.textContent='new child';finish();await pending;assert.equal(h.root.textContent,'new child');const a=harness();await renderParentSessionReportEditor({...a.options,session});a.root.querySelector('[name=what_did]').value='unsaved';await tick();assert.equal(a.root.querySelector('[name=what_did]').value,'unsaved');});
test('initial report authoring opens actual saved draft and publishes only checked safe fields',async()=>{const h=harness({parent_reports:[{id:'initial',patient_id:'child',therapist_id:'therapist',publication_status:'draft',complaint:'Safe wording',published_snapshot:{note:'SOURCE_SECRET'},pdf_storage_path:'PRIVATE_PATH'}]});await renderParentPortalSpecialist(h.options);await click(h,'[data-open-initial]');const editor=h.root.querySelector('[data-initial-editor]');assert.deepEqual([...editor.querySelectorAll('textarea')].map(x=>x.name),['complaint','strengths','observations','goals','progress','recommendations']);assert.equal(editor.querySelector('[name=complaint]').value,'Safe wording');assert.doesNotMatch(editor.innerHTML,/PRIVATE_PATH|SOURCE_SECRET/);await click(h,'[data-publish-report]');const w=h.calls.find(x=>x.table==='parent_reports'&&x.op==='update');assert.ok(!('published_snapshot' in w.payload));assert.deepEqual(h.calls.find(x=>x.name).body,{report_id:'initial',report_kind:'initial'});});
test('real root portal callback checks captured child and mounted view around injected refresh',async()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8'),window=new Window();window.document.body.innerHTML='<div id="tabContent"></div>';let options,loads=0,renders=0,finish;
 const env={document:window.document,authViewRevision:1,user:{id:'therapist'},state:{patientId:'child',tab:'parent',contacts:[contact]},roleGate:{canNavigate:()=>true},SUPABASE_URL:'https://auth.fizira.com',sb:{},renderParentPortalSpecialist(o){options=o},loadPatientData:async()=>{loads++;await new Promise(r=>finish=r)},renderPatient(){renders++}};
 const part=source.slice(source.indexOf('function renderTab('),source.indexOf('init().catch'));
 const render=new Function('env',`with(env){return (${part});}`)(env);render(patient);assert.equal(options.isCurrent(),true);const pending=options.refresh();env.state.patientId='other';finish();await pending;assert.equal(renders,0);await options.refresh();assert.equal(loads,1);env.state.patientId='child';assert.equal(options.isCurrent(),true);env.authViewRevision++;assert.equal(options.isCurrent(),false);await options.refresh();assert.equal(loads,1);
});
test('real patient loader does not install stale child response after selection changes',async()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');let finish;const wait=new Promise(r=>finish=r);const env={authViewRevision:1,roleGate:{canNavigate:()=>true},state:{patientId:'child',goals:['new child state']},sb:{from(){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},then(resolve){return wait.then(()=>resolve({data:[{id:'old child'}]}))}};return q}}};
 const part=source.slice(source.indexOf('async function loadPatientData() {'),source.indexOf('function goalsHtml('));const load=new Function('env',`with(env){return (${part});}`)(env);const pending=load();env.state.patientId='other';finish();await pending;assert.deepEqual(env.state.goals,['new child state']);
});

test('stale selected-media deletion continuation cannot insert selections or publish',async()=>{const h=harness({parent_session_reports:[{...report}],patient_media:[{id:'photo',patient_id:'child',therapist_id:'therapist',media_type:'photo',storage_path:'therapist/photo.jpg'}]});await renderParentSessionReportEditor({...h.options,session});h.root.querySelector('img').dispatchEvent(new h.window.Event('load'));h.root.querySelector('[name=media]').checked=true;let finish;h.setResponseDelay(r=>r.table==='parent_session_report_media'&&r.op==='delete'?new Promise(resolve=>finish=()=>resolve(r)):Promise.resolve(r));h.root.querySelector('[data-publish-report]').click();await tick();h.setCurrent(false);h.root.textContent='new child';finish();await tick();assert.equal(h.calls.filter(x=>x.op==='insert').length,0);assert.equal(h.calls.filter(x=>x.name).length,0);assert.equal(h.root.textContent,'new child');});

test('actual session-tab handler supplies identity only and stops on retired child',async()=>{const src=readFileSync(new URL('../app.js',import.meta.url),'utf8'),start=src.indexOf('    const parentSessionRoot = document.createElement');const end=src.indexOf("    const form = document.getElementById('sessionForm')",start);const h=harness();h.root.innerHTML='<button data-parent-session="session"></button>';let current=true,options;const env={document:h.window.document,box:h.root,state:{sessions:[session]},accountIsCurrent:()=>current,sb:h.options.sb,accountUserId:user.id,SUPABASE_URL:'https://auth.fizira.com',p:patient,refreshParentControls(){},renderParentSessionReportEditor(o){options=o}};new Function('env',`with(env){${src.slice(start,end)}}`)(env);h.root.querySelector('button').click();assert.deepEqual(options.session,{id:'session',patient_id:'child',therapist_id:'therapist'});options=null;current=false;h.root.querySelector('button').click();assert.equal(options,null);});
test('session editor load failure displays an actionable message',async()=>{const h=harness();h.options.sb={from(){throw new Error('PRIVATE_PATH')}};await renderParentSessionReportEditor({...h.options,session});assert.match(h.root.textContent,/Не удалось загрузить отчёт/);assert.doesNotMatch(h.root.innerHTML,/PRIVATE_PATH/);});
test('photo selection shows an owned source preview and date with trusted signed URL only',async()=>{const h=harness({patient_media:[{id:'photo',patient_id:'child',therapist_id:'therapist',media_type:'photo',storage_path:'therapist/photo.jpg',captured_at:'2026-10-01'}]});h.options.storageOrigin='https://auth.fizira.com';const signs=[];h.options.sb.storage={from(bucket){assert.equal(bucket,'patient-media');return {async createSignedUrl(path,ttl){signs.push({path,ttl});return {data:{signedUrl:'https://auth.fizira.com/storage/v1/object/sign/patient-media/therapist/photo.jpg?token=signed-source'},error:null}}}}};await renderParentSessionReportEditor({...h.options,session});await tick();const img=h.root.querySelector('img');assert.ok(img);assert.match(img.src,/^https:\/\/auth.fizira.com/);assert.match(h.root.textContent,/2026/);assert.deepEqual(signs,[{path:'therapist/photo.jpg',ttl:60}]);img.dispatchEvent(new h.window.Event('error'));assert.match(h.root.textContent,/Фото недоступно/);});
test('untrusted or stale source signing cannot attach an image and cannot reveal artifact paths',async()=>{const h=harness({patient_media:[{id:'photo',patient_id:'child',therapist_id:'therapist',media_type:'photo',storage_path:'therapist/photo.jpg'},{id:'artifact',patient_id:'child',therapist_id:'therapist',media_type:'photo',storage_path:'therapist/parent-reports/PRIVATE_PATH.jpg'}]});h.options.storageOrigin='https://auth.fizira.com';let finish;const calls=[];h.options.sb.storage={from(){return {createSignedUrl(path){calls.push(path);return new Promise(r=>finish=r)}}}};const pending=renderParentSessionReportEditor({...h.options,session});await tick();h.setCurrent(false);h.root.textContent='new child';finish({data:{signedUrl:'https://evil.test/private'}});await pending;assert.equal(h.root.textContent,'new child');assert.deepEqual(calls,['therapist/photo.jpg']);const a=harness({patient_media:[{id:'photo',patient_id:'child',therapist_id:'therapist',media_type:'photo',storage_path:'therapist/photo.jpg'}]});a.options.storageOrigin='https://auth.fizira.com';a.options.sb.storage={from(){return {createSignedUrl:async()=>({data:{signedUrl:'https://evil.test/private'}})}}};await renderParentSessionReportEditor({...a.options,session});assert.equal(a.root.querySelector('img')?.getAttribute('src'),null);assert.doesNotMatch(a.root.innerHTML,/evil.test/);});
test('an already selected photo must load before save or publication can proceed',async()=>{const h=harness({parent_session_reports:[{...report}],patient_media:[{id:'photo',patient_id:'child',therapist_id:'therapist',media_type:'photo',storage_path:'therapist/photo.jpg'}],parent_session_report_media:[{parent_session_report_id:'report',patient_media_id:'photo',patient_id:'child',therapist_id:'therapist',position:0}]});await renderParentSessionReportEditor({...h.options,session});await click(h,'[data-publish-report]');assert.equal(h.calls.filter(x=>x.op==='update'||x.op==='delete'||x.name).length,0);assert.match(h.root.textContent,/Дождитесь загрузки/);});

// Regressions: a specialist must complete contact creation without leaving this tab.
test('portal creates representative with owned contact ID before inviting, never forwards an email to Edge', async()=>{
 const h=harness({patient_contacts:[]}); h.options.contacts=[];
 await renderParentPortalSpecialist(h.options);
 assert.match(h.root.textContent,/Родители и представители/);
 await click(h,'[data-add-parent]');
 const form=h.root.querySelector('[data-parent-contact-form]'); assert.ok(form);
 form.elements.full_name.value='  Анна Тестовая  ';form.elements.relation.value='Мать';
 form.elements.email.value='  ANNA@example.test  ';form.elements.phone.value='+70000000000';
 await click(h,'[data-save-parent]');
 const write=h.calls.find(x=>x.table==='patient_contacts'&&x.op==='insert');
 assert.deepEqual(write.payload,{patient_id:'child',therapist_id:'therapist',full_name:'Анна Тестовая',relation:'Мать',email:'anna@example.test',phone:'+70000000000'});
 assert.equal(h.calls.filter(x=>x.name).length,0);
 h.options.contacts=h.rows.patient_contacts;await renderParentPortalSpecialist(h.options);
 await click(h,'[data-invite]');
 assert.deepEqual(h.calls.find(x=>x.name).body,{patient_id:'child',contact_id:'new-0'});
});
test('representative creation requires name, relationship and valid email and survives a failed save',async()=>{
 const h=harness({patient_contacts:[]});h.options.contacts=[];await renderParentPortalSpecialist(h.options);await click(h,'[data-add-parent]');
 const f=h.root.querySelector('[data-parent-contact-form]');
 f.elements.email.value='bad';await f.onsubmit({preventDefault(){}});assert.equal(h.calls.filter(x=>x.op==='insert').length,0);
 f.elements.full_name.value='Анна';f.elements.relation.value='Мать';f.elements.email.value='anna@example.test';
 h.setResponseDelay(async r=>r.op==='insert'?{data:null,error:{message:'PRIVATE_PATH'}}:r);
 await f.onsubmit({preventDefault(){}});
 assert.equal(f.elements.full_name.value,'Анна');assert.match(h.root.textContent,/Не удалось сохранить/);assert.doesNotMatch(h.root.innerHTML,/PRIVATE_PATH/);
});
test('pending invitation shows its saved address and expiry; expired invitation never looks active',async()=>{
 const row={id:'invite',contact_id:'contact',patient_id:'child',therapist_id:'therapist',created_at:'2026-01-01',expires_at:'2099-01-02T12:00:00Z',email_normalized:'original@example.test'};
 const h=harness({parent_invitations:[row]});await renderParentPortalSpecialist(h.options);
 assert.match(h.root.textContent,/original@example.test/);assert.match(h.root.textContent,/2099/);assert.ok(h.root.querySelector('[data-resend]'));
 const expired=harness({parent_invitations:[{...row,expires_at:'2020-01-01'}]});await renderParentPortalSpecialist(expired.options);
 assert.match(expired.root.textContent,/Срок приглашения истёк/);assert.ok(expired.root.querySelector('[data-resend]'));
});
test('active and revoked contacts reflect persisted access and allow revoke or a new invitation respectively',async()=>{
 const h=harness({parent_child_access:[{id:'access',contact_id:'contact',patient_id:'child',therapist_id:'therapist',status:'active'}]});await renderParentPortalSpecialist(h.options);
 assert.match(h.root.querySelector('[data-contact]').textContent,/Доступ активен/);assert.ok(h.root.querySelector('[data-contact] [data-revoke]'));assert.equal(h.root.querySelector('[data-invite]'),null);
 const r=harness({parent_child_access:[{id:'access',contact_id:'contact',patient_id:'child',therapist_id:'therapist',status:'revoked'}]});await renderParentPortalSpecialist(r.options);
 assert.match(r.root.querySelector('[data-contact]').textContent,/Доступ отозван/);assert.ok(r.root.querySelector('[data-invite]'));
});
test('failed delivery and unconfirmed Edge success never display successful send',async()=>{
 const h=harness();h.setDelay(async()=>({data:{ok:false},error:null}));await renderParentPortalSpecialist(h.options);await click(h,'[data-invite]');
 assert.equal(h.refreshes,0);assert.match(h.root.textContent,/Не удалось/);assert.equal(h.root.querySelector('[data-invite]').disabled,false);
});
test('a stale contact form cannot create a parent for the previous child',async()=>{
 const h=harness({patient_contacts:[]});h.options.contacts=[];await renderParentPortalSpecialist(h.options);await click(h,'[data-add-parent]');
 const f=h.root.querySelector('[data-parent-contact-form]');f.elements.full_name.value='Анна';f.elements.relation.value='Мать';f.elements.email.value='anna@example.test';h.setCurrent(false);
 await f.onsubmit({preventDefault(){}});assert.equal(h.calls.filter(x=>x.op==='insert').length,0);
});
test('a saved contact is not inserted again when refresh fails',async()=>{
 const h=harness({patient_contacts:[]});h.options.contacts=[];h.options.refresh=async()=>{throw Error('load failed')};
 await renderParentPortalSpecialist(h.options);await click(h,'[data-add-parent]');const f=h.root.querySelector('[data-parent-contact-form]');
 f.elements.full_name.value='Анна';f.elements.relation.value='Мать';f.elements.email.value='anna@example.test';
 await f.onsubmit({preventDefault(){}});await f.onsubmit({preventDefault(){}});
 assert.equal(h.calls.filter(x=>x.op==='insert').length,1);assert.match(h.root.textContent,/Контакт сохранён.*обновить/);
});
test('every active user on the same saved contact remains individually visible and revocable',async()=>{
 const base={contact_id:'contact',patient_id:'child',therapist_id:'therapist',status:'active'};
 const h=harness({parent_child_access:[{...base,id:'access-a',parent_user_id:'parent-a'},{...base,id:'access-b',parent_user_id:'parent-b'}],parent_invitations:[{id:'invite-a',contact_id:'contact',patient_id:'child',therapist_id:'therapist',accepted_at:'2026-10-01',accepted_by:'parent-a',email_normalized:'a@example.test'},{id:'invite-b',contact_id:'contact',patient_id:'child',therapist_id:'therapist',accepted_at:'2026-10-02',accepted_by:'parent-b',email_normalized:'b@example.test'}]});
 await renderParentPortalSpecialist(h.options);
 assert.deepEqual([...h.root.querySelectorAll('[data-revoke]')].map(b=>b.dataset.revoke).sort(),['access-a','access-b']);
 assert.match(h.root.textContent,/a@example.test/);assert.match(h.root.textContent,/b@example.test/);
 await click(h,'[data-revoke="access-b"]');assert.deepEqual(h.calls.find(x=>x.name).body,{access_id:'access-b'});
});
test('typing an unsaved email cannot send an invitation to the previous saved address',async()=>{
 for(const pending of [false,true]){
  const h=harness(pending?{parent_invitations:[{id:'invite',contact_id:'contact',patient_id:'child',therapist_id:'therapist',expires_at:'2099-01-01'}]}:{});
  await renderParentPortalSpecialist(h.options);
  const input=h.root.querySelector('[data-contact] [name=email]');input.value='different@example.test';input.dispatchEvent(new h.window.Event('input'));
  const button=h.root.querySelector(pending?'[data-resend]':'[data-invite]');assert.equal(button.disabled,true);
  await button.onclick();assert.equal(button.disabled,true);assert.equal(h.calls.filter(x=>x.name).length,0);assert.match(h.root.textContent,/Сохраните email/);
 }
});

// Initial editor moved to its own workspace; preserve publication CAS coverage.
test('initial autosave refuses a report published concurrently',async()=>{
 const {workspaceFixture}=await import('./parent-report-fixture.mjs');const h=await workspaceFixture();
 try{await h.root.querySelector('[data-start-report]').onclick();await h.flow.flush();h.rows[0].publication_status='published';h.rows[0].published_at='2026-10-01';h.input('complaint','Cannot overwrite published text');await h.root.querySelector('[data-prepare-pdf]').onclick();assert.equal(h.calls.filter(c=>c.name).length,0);assert.notEqual(h.rows[0].complaint,'Cannot overwrite published text');assert.match(h.root.textContent,/Изменения пока не сохранены/);}finally{await h.close();}
});

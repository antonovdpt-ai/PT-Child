import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createParentDatabaseFixture} from '../../tests/parent-database-fixture.mjs';
const script=new URL('./test-parent-portal-rls.mjs',import.meta.url);
test('synthetic gate refuses missing confirmation, non-isolated and known production targets before fetch',async()=>{
 const {validateTarget}=await import(script);
 for(const env of [{},{FIZIRA_PARENT_PORTAL_E2E_CONFIRM:'synthetic-parent-portal-test'},{FIZIRA_PARENT_PORTAL_E2E_CONFIRM:'synthetic-parent-portal-test',FIZIRA_PARENT_PORTAL_TARGET:'isolated-disposable',SUPABASE_URL:'https://auth.fizira.com'}])assert.throws(()=>validateTarget(env),/Refusing/);
 assert.equal(validateTarget({FIZIRA_PARENT_PORTAL_E2E_CONFIRM:'synthetic-parent-portal-test',FIZIRA_PARENT_PORTAL_TARGET:'isolated-disposable',SUPABASE_URL:'https://disposable.example.invalid'}),'https://disposable.example.invalid');
 const r=spawnSync(process.execPath,[script.pathname],{env:{PATH:process.env.PATH},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Refusing/);
});
test('fixture reserves invitations before Auth insertion and uses exactly parent roles',async()=>{
 const s=await readFile(script,'utf8');for(const term of ['@example.invalid','issue_parent_invitation_record','accept_parent_invitation','current_app_roles','parent_portal_children','parent_portal_report','parent-report-file','generate-parent-report-pdf','revoke_parent_access_record','AbortSignal.timeout','retained','cleanupErrors','finally'])assert.ok(s.includes(term),term);
 assert.doesNotMatch(s,/disable trigger|grant .*service_role|delete.*(?:user_consents|parent_signup_reservations)/i);
});
test('cleanup is bounded, checks failures, retains immutable records and attempts every resource',async()=>{
 const {cleanupResources}=await import(script),calls=[];
 await assert.rejects(cleanupResources({paths:['source','artifact'],patients:['child'],users:['parent','specialist']},async(path,options)=>{calls.push(path);return {status:path.includes('source')?500:204,body:null};},()=>{}),/cleanup failed/);
 assert.equal(calls.length,5);assert.ok(calls.some(p=>p.includes('artifact')));assert.ok(calls.some(p=>p.includes('specialist')));
});
test('readonly verifier runs through012 and detects effective source/Storage authorization changes',async()=>{
 const h=await createParentDatabaseFixture();try{
 for(const file of ['20261003_011_parent_role_boundaries.sql','20261003_012_parent_publication_archive.sql'])await h.db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
 await h.query("insert into storage.buckets(id,name,public) values('patient-media','patient-media',false)");
 const entry=await readFile(new URL('../../supabase/verification/verify_parent_portal.sql',import.meta.url),'utf8');assert.match(entry,/begin read only/i);assert.match(entry,/\\ir verify_migration.sql/);assert.match(entry,/rollback/i);
 const full=(await readFile(new URL('../../supabase/verification/verify_migration.sql',import.meta.url),'utf8')).replace(/\\set[^\n]*\n/g,'');
 const definitions=await readFile(new URL('../../supabase/verification/verify_parent_portal_definitions.sql',import.meta.url),'utf8');
 const sql=entry.replace(/\\set[^\n]*\n/g,'').replace('\\ir verify_migration.sql',()=>full).replace('\\ir verify_parent_portal_definitions.sql',()=>definitions);
 await h.db.exec(sql);
 const assertions=sql.replace(/begin read only;/i,'').replace(/rollback;\s*$/i,'');
 for(const mutation of ["update storage.buckets set public=true",'drop index parent_child_access_one_active','drop index parent_invitations_one_pending_contact','alter table patients disable row level security',"alter table parent_reports drop constraint parent_reports_publication_check;alter table parent_reports add constraint parent_reports_publication_check check(true)"]){
 await h.db.exec('begin');await h.db.exec(mutation);await assert.rejects(h.db.exec(assertions));await h.db.exec('rollback');}
 for(const mutation of ['alter policy specialist_role_required on patients using(true)','alter policy specialist_role_required on storage.objects with check(true)','grant execute on function claim_parent_publication(uuid,uuid,text) to authenticated']){
 await h.db.exec('begin');await h.db.exec(mutation);await assert.rejects(h.db.exec(full));await h.db.exec('rollback');}
 }finally{await h.db.close();}
});

test('offline transport exercises reservation→Auth→acceptance, own publication and checked teardown',async()=>{
 const {runSynthetic}=await import(script);
 const env={FIZIRA_PARENT_PORTAL_E2E_CONFIRM:'synthetic-parent-portal-test',FIZIRA_PARENT_PORTAL_TARGET:'isolated-disposable',SUPABASE_URL:'https://disposable.example.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'};
 const {randomUUID,createHash}=await import('node:crypto');
 async function scenario(fault){
  const users=new Map(),tables=new Map(),invitations=new Map(),access=new Map(),objects=new Set(),events=[],audit=[];
  const rows=table=>{if(!tables.has(table))tables.set(table,new Map());return tables.get(table);};
  const response=(status,body)=>new Response(body===undefined?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const projection=report=>({id:report.id,kind:'session',published_at:'2026-10-04',revision:1,snapshot:{what_did:report.what_did,what_worked:report.what_worked,attention:report.attention,home_recommendations:report.home_recommendations},media_ids:report.published_media.map(m=>m.id)});
  const canSee=(user,patient)=>[...access.values()].some(a=>a.user===user.id&&a.patient===patient&&!a.revoked);
  const fake=async(input,options={})=>{
   const url=new URL(input),path=url.pathname,method=options.method||'GET',token=options.headers?.Authorization?.slice(7),actor=users.get(token),isService=token==='service';
   const body=options.body&&typeof options.body==='string'&&options.headers?.['Content-Type']==='application/json'?JSON.parse(options.body):options.body;
   assert.ok(options.signal,'all requests must be bounded');
   if(path==='/signed')return response(200,'signed fixture bytes');
   if(path==='/auth/v1/admin/users'&&method==='POST'){
    assert.match(body.email,/@example\.invalid$/);const id=randomUUID(),reserved=[...invitations.values()].some(inv=>inv.email===body.email);
    const user={id,email:body.email,role:reserved?null:'specialist'};users.set(id,user);events.push(reserved?'reserved-auth':'specialist-auth');return response(200,{id});
   }
   if(path==='/auth/v1/token'){const user=[...users.values()].find(u=>u.email===body.email);return response(200,{access_token:user.id});}
   if(path.startsWith('/auth/v1/admin/users/')&&method==='DELETE'){users.delete(path.split('/').at(-1));events.push('cleanup-auth');return response(200,{});}
   if(path.startsWith('/rest/v1/rpc/')){
    const name=path.split('/').at(-1);
    if(name==='issue_parent_invitation_record'){
     assert.ok(isService);const c=rows('patient_contacts').get(body.p_contact_id),id=randomUUID();invitations.set(id,{email:c.email,digest:body.p_token_digest,patient:body.p_patient_id});events.push('reservation');return response(200,[{invitation_id:id}]);
    }
    if(name==='current_app_roles')return response(200,actor.role?[{role:actor.role}]:[]);
    const inv=[...invitations.values()].find(i=>i.digest===createHash('sha256').update(body.p_token||'').digest('hex'));
    if(name==='parent_invitation_state')return response(200,{state:inv.accepted?'accepted':'valid',...(inv.accepted?{}:{auth_flow:'new'})});
    if(name==='accept_parent_invitation'){
     if(inv.accepted)return response(400,{});assert.equal(inv.email,actor.email);assert.equal(actor.role,null);inv.accepted=true;actor.role=fault==='dualRole'?'specialist':'parent';const id=randomUUID();access.set(id,{user:actor.id,patient:inv.patient});audit.push(actor.email);events.push('accept');return response(200,id);
    }
    if(name==='revoke_parent_access_record'){access.get(body.p_access_id).revoked=true;return response(200,1);}
    if(name==='parent_portal_children')return response(200,[...rows('patients').values()].filter(c=>canSee(actor,c.id)).map(c=>({id:c.id,display_name:c.display_name,date_of_birth:c.date_of_birth})));
    if(name==='parent_portal_report'){const r=rows('parent_session_reports').get(body.p_report_id);return response(200,{report:r&&r.publication_status==='published'&&canSee(actor,r.patient_id)?projection(r):null});}
    const patient=body.p_patient_id,visible=canSee(actor,patient),kind=name.replace('parent_portal_','');
    if(!visible)return response(200,kind==='dashboard'?{child:null}:[]);
    if(kind==='dashboard')return response(200,{child:{id:patient},schedule:[{status:'planned'}]});
    if(kind==='reports')return response(200,[...rows('parent_session_reports').values()].filter(r=>r.patient_id===patient&&r.publication_status==='published').map(projection));
    if(kind==='goals')return response(200,[...rows('parent_goal_publications').values()].filter(g=>g.patient_id===patient).map(g=>({title:g.title,status:g.status})));
    if(kind==='schedule')return response(200,[{starts_at:'2030-04-15T10:00Z',ends_at:'2030-04-15T11:00Z',status:'planned'}]);
    if(kind==='dynamics')return response(200,[{scale:'gmfm66',value_numeric:42}]);
    if(kind==='notifications')return response(200,[{type:'report_published'}]);
    throw Error('Unhandled RPC '+name);
   }
   if(path.startsWith('/rest/v1/')){
    const table=path.split('/').at(-1),id=url.searchParams.get('id')?.slice(3),r=rows(table).get(id);
    if(method==='POST'){
     if(actor?.role==='parent'&&fault!=='ownSource')return response(403,{});
     const row={...body,id:body.id||randomUUID()};rows(table).set(row.id,row);return response(201,[row]);
    }
    if(method==='GET')return response(200,actor?.role==='parent'?[]:[...rows(table).values()].filter(row=>(!id||row.id===id)&&(isService||row.therapist_id===actor.id)));
    if(method==='PATCH'){
     if(r.publication_status==='published'&&body.publication_status!=='archived')return response(400,{});Object.assign(r,body);return response(200,[r]);
    }
    if(method==='DELETE'){
     if(r?.publication_status==='published')return response(400,{});
     if(table==='patients'){for(const map of tables.values())for(const [key,row]of map)if(row.patient_id===id)map.delete(key);events.push('cleanup-patient');}
     rows(table).delete(id);return response(isService?204:200,isService?undefined:r?[r]:[]);
    }
   }
   if(path==='/functions/v1/generate-parent-report-pdf'){
    const r=rows('parent_session_reports').get(body.report_id),selected=[...rows('parent_session_report_media').values()].filter(m=>m.parent_session_report_id===r.id),prefix=`${actor.id}/parent-reports/session/${r.id}/1`;
    Object.assign(r,{publication_status:'published',pdf_storage_path:prefix+'.pdf',published_media:selected.map(m=>({id:m.patient_media_id,storage_path:prefix+'/'+m.patient_media_id+'.png'}))});objects.add(r.pdf_storage_path);for(const m of r.published_media)objects.add(m.storage_path);events.push('publication');return response(200,{publication_status:'published'});
   }
   if(path==='/functions/v1/parent-report-file'){
    const r=rows('parent_session_reports').get(body.report_id),valid=r&&r.publication_status==='published'&&canSee(actor,r.patient_id)&&(body.kind==='pdf'||r.published_media.some(m=>m.id===body.media_id));
    return response(valid||fault==='crossFile'?200:403,valid||fault==='crossFile'?{url:'https://disposable.example.invalid/signed'}:{});
   }
   if(path==='/storage/v1/object/list/patient-media'){
    assert.ok(isService);const matches=[...objects].filter(p=>p.startsWith(body.prefix+'/')),entries=new Map();
    for(const p of matches){const suffix=p.slice(body.prefix.length+1),name=suffix.split('/')[0];entries.set(name,{name,id:suffix.includes('/')?null:randomUUID()});}return response(200,[...entries.values()].slice(body.offset,body.offset+body.limit));
   }
   if(path.startsWith('/storage/v1/object/')){
    const storage=decodeURIComponent(path.split('/patient-media/')[1]||'');
    if(actor?.role==='parent'&&fault!=='ownStorage')return response(403,{});
    if(!isService&&[...rows('parent_session_reports').values()].some(r=>[r.pdf_storage_path,...(r.published_media||[]).map(m=>m.storage_path)].includes(storage))&&['DELETE','PUT'].includes(method))return response(fault==='immutableWrite'?200:400,{});
    if(method==='DELETE'){objects.delete(storage);events.push('cleanup-storage');return response(200,{});}
    if(method==='POST'&&!path.includes('/sign/'))objects.add(storage);
    return response(200,{});
   }
   throw Error('Unhandled path '+path);
  };
  const logs=[];let error;try{await runSynthetic(env,fake,m=>logs.push(m));}catch(e){error=e;}
  assert.equal(users.size,0,'created Auth users cleaned');assert.equal(objects.size,0,'source/generated keys cleaned');assert.equal(rows('patients').size,0,'created children cleaned');
  assert.ok(logs.some(m=>m.includes('retained')));if(events.includes('cleanup-storage'))assert.ok(events.indexOf('cleanup-patient')<events.indexOf('cleanup-storage'));
  return {error,events,audit};
 }
 const good=await scenario();assert.equal(good.error,undefined,good.error?.stack);assert.equal(good.audit.length,2);assert.equal(good.events.filter(e=>e==='reserved-auth').length,2);assert.equal(good.events.filter(e=>e==='publication').length,2);
 for(const fault of ['dualRole','ownSource','ownStorage','crossFile','immutableWrite'])assert.ok((await scenario(fault)).error,'must catch '+fault);
});

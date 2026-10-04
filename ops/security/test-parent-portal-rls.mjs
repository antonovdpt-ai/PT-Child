#!/usr/bin/env node
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function validateTarget(env) {
 if(env.FIZIRA_PARENT_PORTAL_E2E_CONFIRM!=='synthetic-parent-portal-test'||env.FIZIRA_PARENT_PORTAL_TARGET!=='isolated-disposable')throw new Error('Refusing: exact confirmation and isolated-disposable target designation required');
 let url;try{url=new URL(env.SUPABASE_URL);}catch{throw new Error('Refusing: SUPABASE_URL required');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||/(^|\.)fizira\.(com|ru)$/i.test(url.hostname))throw new Error('Refusing: invalid or known production target');
 return url.origin;
}
export async function cleanupResources(resources,request,log=console.log) {
 const cleanupErrors=[];
 // Patient lifecycle cascade releases the immutable publication references first.
 const operations=[...resources.patients.map(id=>[`/rest/v1/patients?id=eq.${id}`]),...resources.paths.map(path=>[`/storage/v1/object/patient-media/${encodePath(path)}`]),...resources.users.map(id=>[`/auth/v1/admin/users/${id}`])];
 for(const [path]of operations){try{const r=await request(path,{method:'DELETE'});assert.ok(([200,204].includes(r.status)||(path.startsWith('/storage/')&&r.status===404)),`HTTP ${r.status}`);}catch(error){cleanupErrors.push(`${path}: ${error.message}`);}}
 log('retained synthetic parent_consent_audit and parent_signup_reservations; complete teardown requires disposal of the isolated target.');
 if(cleanupErrors.length)throw new AggregateError(cleanupErrors.map(m=>new Error(m)),'Synthetic cleanup failed: '+cleanupErrors.join('; '));
}
function encodePath(path){return path.split('/').map(encodeURIComponent).join('/');}
const success=r=>{assert.ok(r.status>=200&&r.status<300,`HTTP ${r.status}: ${JSON.stringify(r.body)}`);return r.body;};
const denied=r=>assert.ok(r.status>=400&&r.status<500,`Expected authorization denial, got HTTP ${r.status}`);
const invisible=r=>{if(r.status===200)assert.deepEqual(r.body,[]);else denied(r);};
export async function runSynthetic(env,fetchImpl=fetch,log=console.log) {
 const url=validateTarget(env),anon=env.SUPABASE_ANON_KEY||env.ANON_KEY,service=env.SUPABASE_SERVICE_ROLE_KEY||env.SERVICE_ROLE_KEY;
 assert.ok(anon&&service,'Server keys required');
 const resources={users:[],patients:[],paths:[]},publications=[];
 const runId=randomUUID(),password=`Fz-${randomBytes(24).toString('base64url')}!9a`;
 const headers=token=>({apikey:token===service?service:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const request=async(path,{token=service,body,method='GET',binary=false,...options}={})=>{
  const response=await fetchImpl(url+path,{method,headers:headers(token),...options,...(body===undefined?{}:{body:binary?body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)});
  const text=await response.text();let parsed;try{parsed=text?JSON.parse(text):null;}catch{parsed=text;}
  return {status:response.status,body:parsed};
 };
 const rpc=async(name,args={},token=service)=>success(await request('/rest/v1/rpc/'+name,{method:'POST',token,body:args}));
 const insert=async(table,body,actor)=>success(await request('/rest/v1/'+table,{method:'POST',token:actor.token,body,headers:{...headers(actor.token),Prefer:'return=representation'}}))[0];
 const patch=async(table,id,body,actor)=>success(await request(`/rest/v1/${table}?id=eq.${id}`,{method:'PATCH',token:actor.token,body,headers:{...headers(actor.token),Prefer:'return=representation'}}));
 const select=async(table,id,actor)=>request(`/rest/v1/${table}?select=*&id=eq.${id}`,{token:actor.token});
 const user=async(label)=>{
  const email=`fizira-parent-gate-${label}-${runId}@example.invalid`;
  const created=success(await request('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true,user_metadata:{full_name:'Synthetic test specialist / parent'}}}));
  assert.match(created.id,/^[a-f0-9-]{36}$/i);resources.users.push(created.id);
  const signed=success(await request('/auth/v1/token?grant_type=password',{method:'POST',token:anon,body:{email,password}}));assert.ok(signed.access_token);
  return {id:created.id,email,token:signed.access_token};
 };
 const edge=async(name,body,actor)=>request('/functions/v1/'+name,{method:'POST',token:actor.token,body});
 const roles=actor=>rpc('current_app_roles',{},actor.token);
 const upload=async(path,actor)=>{
  if(!resources.paths.includes(path))resources.paths.push(path);
  return request('/storage/v1/object/patient-media/'+encodePath(path),{method:'POST',token:actor.token,binary:true,body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),headers:{...headers(actor.token),'Content-Type':'image/png','x-upsert':'false'}});
 };
 const directFileChecks=async(actor,path)=>{
  denied(await request('/storage/v1/object/authenticated/patient-media/'+encodePath(path),{token:actor.token}));
  denied(await request('/storage/v1/object/sign/patient-media/'+encodePath(path),{method:'POST',token:actor.token,body:{expiresIn:300}}));
  denied(await upload(`${actor.id}/${runId}/denied-own.png`,actor));
 };
 // Discover server-created keys, including private orphans after partial publication.
 const discover=async(prefix)=>{
  for(let offset=0;;offset+=100){const rows=success(await request('/storage/v1/object/list/patient-media',{method:'POST',body:{prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}}}));assert.ok(Array.isArray(rows));
   for(const row of rows){assert.ok(typeof row.name==='string'&&!row.name.includes('/')&&!['.','..'].includes(row.name));const path=`${prefix}/${row.name}`;if(row.id===null)await discover(path);else if(!resources.paths.includes(path))resources.paths.push(path);}
   if(rows.length<100)break;
  }
 };
 let primaryError;
 try {
  const specialists=[await user('specialist-a'),await user('specialist-b')],parents=[],children=[],reports=[],media=[],access=[];
  for(let i=0;i<2;i++){
   const specialist=specialists[i];assert.deepEqual(await roles(specialist),[{role:'specialist'}]);
   const childId=randomUUID();resources.patients.push(childId);
   const child=await insert('patients',{id:childId,therapist_id:specialist.id,display_name:'Артём Смирнов',date_of_birth:'2020-04-15'},specialist);children.push(child);
   const email=`fizira-parent-gate-parent-${i}-${runId}@example.invalid`;
   const contact=await insert('patient_contacts',{id:randomUUID(),patient_id:child.id,therapist_id:specialist.id,full_name:'Анна Смирнова',relation:'mother',email},specialist);
   const raw=randomBytes(32).toString('base64url');
   // Mandatory ordering: durable new invitation reservation BEFORE Auth INSERT.
   await rpc('issue_parent_invitation_record',{p_therapist_id:specialist.id,p_patient_id:child.id,p_contact_id:contact.id,p_token_digest:createHash('sha256').update(raw).digest('hex'),p_auth_flow:'new'});
   const parent=await user(`parent-${i}`);parents.push(parent);assert.deepEqual(await roles(parent),[]);
   assert.deepEqual(await rpc('parent_invitation_state',{p_token:raw},parent.token),{state:'valid',auth_flow:'new'});
   access.push(await rpc('accept_parent_invitation',{p_token:raw,p_accepted_documents:['terms','privacy','personal_data_consent'].map(document_type=>({document_type,accepted:true}))},parent.token));
   assert.deepEqual(await roles(parent),[{role:'parent'}]);
   assert.equal((await rpc('parent_invitation_state',{p_token:raw},parent.token)).state,'accepted');
   denied(await request('/rest/v1/rpc/accept_parent_invitation',{method:'POST',token:parent.token,body:{p_token:raw,p_accepted_documents:[]}}));
   // Parent-own source creation tests role authorization rather than cross-owner checks.
   const deniedChild=randomUUID();resources.patients.push(deniedChild);
   denied(await request('/rest/v1/patients',{method:'POST',token:parent.token,body:{id:deniedChild,therapist_id:parent.id,display_name:'Артём Смирнов',date_of_birth:'2020-04-15'}}));
   // Seed an own-prefix object only via service to prove role-based read/sign denial.
   const parentPrefix=`${parent.id}/${runId}/seed.png`;success(await upload(parentPrefix,{token:service}));await directFileChecks(parent,parentPrefix);
   const source=`${specialist.id}/${child.id}/${runId}.png`;success(await upload(source,specialist));
   media.push(await insert('patient_media',{id:randomUUID(),patient_id:child.id,therapist_id:specialist.id,media_type:'photo',category:'other',storage_path:source},specialist));
   const session=await insert('sessions',{patient_id:child.id,therapist_id:specialist.id,note:'PRIVATE_INTERNAL_SENTINEL'},specialist);
   const report=await insert('parent_session_reports',{patient_id:child.id,therapist_id:specialist.id,session_id:session.id,what_did:'Фиктивное занятие',what_worked:'Фиктивный результат',attention:'Фиктивное наблюдение',home_recommendations:'Фиктивная рекомендация'},specialist);reports.push(report);
   await insert('parent_session_report_media',{parent_session_report_id:report.id,patient_media_id:media[i].id,patient_id:child.id,therapist_id:specialist.id,position:0},specialist);
   publications.push({prefix:`${specialist.id}/parent-reports/session/${report.id}`,report_id:report.id});
   const published=success(await edge('generate-parent-report-pdf',{report_id:report.id,report_kind:'session'},specialist));assert.equal(published.publication_status,'published');
   // Use actual server-returned publication metadata, never fabricate claim artifacts.
   const actual=success(await select('parent_session_reports',report.id,specialist))[0];assert.equal(actual.publication_status,'published');resources.paths.push(actual.pdf_storage_path,...actual.published_media.map(m=>m.storage_path));
   const own=await rpc('parent_portal_report',{p_report_id:report.id},parent.token);assert.ok(own.report);assert.ok(own.report.media_ids.includes(media[i].id));
   for(const body of [{kind:'pdf',report_id:report.id},{kind:'photo',report_id:report.id,media_id:media[i].id}]){
    const handoff=success(await edge('parent-report-file',body,parent));assert.ok(handoff.url);const signed=await fetchImpl(handoff.url,{signal:AbortSignal.timeout(20000)});assert.equal(signed.status,200);await signed.arrayBuffer();
   }
   for(const path of [source,actual.pdf_storage_path,...actual.published_media.map(m=>m.storage_path)])await directFileChecks(parent,path);
   for(const immutablePath of [actual.pdf_storage_path,...actual.published_media.map(m=>m.storage_path)])for(const method of ['DELETE','PUT'])denied(await request('/storage/v1/object/patient-media/'+encodePath(immutablePath),{method,token:specialist.token,body:method==='PUT'?'changed':undefined,binary:true,headers:{...headers(specialist.token),'Content-Type':'application/pdf'}}));
   denied(await request(`/rest/v1/parent_session_reports?id=eq.${report.id}`,{method:'PATCH',token:specialist.token,body:{what_did:'must not change'}}));
   denied(await request(`/rest/v1/parent_session_reports?id=eq.${report.id}`,{method:'DELETE',token:specialist.token}));
   // Positive specialist CRUD beside role/cross-specialist denials.
   assert.equal(success(await select('patients',child.id,specialist)).length,1);
   assert.equal((await patch('patients',child.id,{display_name:'Артём Смирнов'},specialist)).length,1);
   const draft=await insert('parent_reports',{patient_id:child.id,therapist_id:specialist.id,observations:'Фиктивный черновик'},specialist);
   assert.equal(success(await request(`/rest/v1/parent_reports?id=eq.${draft.id}`,{method:'DELETE',token:specialist.token,headers:{...headers(specialist.token),Prefer:'return=representation'}})).length,1);
   for(const table of ['patients','sessions','assessments','goals','patient_media','parent_reports','standardized_assessments','patient_contacts','ai_analysis_history','appointments','parent_session_reports'])invisible(await request(`/rest/v1/${table}?select=*&${table==='patients'?'id':'patient_id'}=eq.${child.id}`,{token:parent.token}));
   const goal=await insert('goals',{patient_id:child.id,therapist_id:specialist.id,title:'PRIVATE_INTERNAL_SENTINEL'},specialist);
   await insert('parent_goal_publications',{goal_id:goal.id,patient_id:child.id,therapist_id:specialist.id,title:'Фиктивная цель',status:'new',published_at:new Date().toISOString()},specialist);
   await insert('standardized_assessments',{patient_id:child.id,therapist_id:specialist.id,scale:'gmfm66',value_numeric:42,assessed_at:'2026-10-04'},specialist);
   await insert('appointments',{patient_id:child.id,therapist_id:specialist.id,starts_at:'2030-04-15T10:00:00Z',ends_at:'2030-04-15T11:00:00Z',kind:'appointment',status:'planned',price_kopecks:300000,paid_kopecks:0,note:'PRIVATE_INTERNAL_SENTINEL'},specialist);
  }
  for(let i=0;i<2;i++){
   const parent=parents[i],own=children[i],other=children[1-i];assert.deepEqual((await rpc('parent_portal_children',{},parent.token)).map(c=>c.id),[own.id]);
   for(const name of ['dashboard','schedule','reports','goals','dynamics','notifications']){
    const params={p_patient_id:own.id,...(name==='schedule'?{p_mode:'upcoming'}:{})};const projection=await rpc('parent_portal_'+name,params,parent.token);
    assert.doesNotMatch(JSON.stringify(projection),/PRIVATE_INTERNAL_SENTINEL|price_kopecks|paid_kopecks|planned_session|storage_path|ai_analysis|assessment_notes/);
    if(['reports','goals','dynamics','notifications'].includes(name))assert.ok(projection.length>0,name);
    const cross=await rpc('parent_portal_'+name,{...params,p_patient_id:other.id},parent.token);assert.ok(cross===null||Array.isArray(cross)&&cross.length===0||name==='dashboard'&&cross.child===null,`cross-child ${name}`);
   }
   assert.deepEqual(await rpc('parent_portal_report',{p_report_id:reports[1-i].id},parent.token),{report:null});
   for(const body of [{kind:'pdf',report_id:reports[1-i].id},{kind:'photo',report_id:reports[i].id,media_id:media[1-i].id},{kind:'photo',report_id:reports[1-i].id,media_id:media[i].id}])denied(await edge('parent-report-file',body,parent));
   invisible(await select('patients',other.id,specialists[i]));
   // Archive is permitted once; all text and file handoffs disappear, bytes stay immutable.
   assert.equal((await patch('parent_session_reports',reports[i].id,{publication_status:'archived'},specialists[i])).length,1);
   const archived=success(await select('parent_session_reports',reports[i].id,specialists[i]))[0];
   for(const immutablePath of [archived.pdf_storage_path,...archived.published_media.map(m=>m.storage_path)])denied(await request('/storage/v1/object/patient-media/'+encodePath(immutablePath),{method:'DELETE',token:specialists[i].token}));
   assert.deepEqual(await rpc('parent_portal_report',{p_report_id:reports[i].id},parent.token),{report:null});denied(await edge('parent-report-file',{kind:'pdf',report_id:reports[i].id},parent));
   assert.equal(await rpc('revoke_parent_access_record',{p_therapist_id:specialists[i].id,p_access_id:access[i]}),1);
   assert.deepEqual(await rpc('parent_portal_children',{},parent.token),[]);assert.deepEqual(await rpc('parent_portal_goals',{p_patient_id:own.id},parent.token),[]);
  }
  // Success is printed only after checked cleanup has completed.
 }catch(error){primaryError=error;}finally{
  const discoveryErrors=[];for(const publication of publications){try{await discover(publication.prefix); // PDF sits beside revision folders, so list its parent too.
    await discover(publication.prefix.slice(0,publication.prefix.lastIndexOf('/')));
   }catch(error){discoveryErrors.push(error);}}
  try{await cleanupResources(resources,request,log);}catch(error){discoveryErrors.push(error);}
  if(discoveryErrors.length)primaryError=new AggregateError([...(primaryError?[primaryError]:[]),...discoveryErrors],'Synthetic run/cleanup failed');
 }
 if(primaryError)throw primaryError;
 log('PARENT_PORTAL_SYNTHETIC_OK own_projections=12 parents=2 specialists=2 source_storage_cross_file_revocation=checked');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runSynthetic(process.env);

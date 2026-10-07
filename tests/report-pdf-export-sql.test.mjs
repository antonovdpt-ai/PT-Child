import test from 'node:test';import assert from 'node:assert/strict';
import {createFullParentSchemaFixture} from './parent-full-schema-fixture.mjs';
import {parentPublicationHandler,digestBytes} from '../supabase/functions/_shared/parent-publication.ts';
import {PDFDocument} from 'pdf-lib';
const owner='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222',parent='33333333-3333-4333-8333-333333333333';
const request=(id,kind='initial')=>new Request('https://edge.example.test',{method:'POST',headers:{origin:'https://app.fizira.com',authorization:'Bearer synthetic','content-type':'application/json'},body:JSON.stringify({report_id:id,report_kind:kind,mode:'export'})});
test('actual schema: owner-only consultation export preserves permissions and original publications',async t=>{
 const {db,query}=await createFullParentSchemaFixture();let actor=owner,chain=Promise.resolve();const calls=[],objects=new Map();
 const asActor=fn=>{const p=chain.then(async()=>{await db.exec('set role authenticated');await query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);try{return await fn();}finally{await db.exec('reset role');}});chain=p.catch(()=>{});return p;};
 const identifier=x=>{assert.match(x,/^[a-z_][a-z_0-9]*$/);return '"'+x+'"';};
 const client={auth:{getUser:async()=>({data:{user:{id:actor}}})},rpc:async name=>{calls.push({rpc:name});try{const rows=await asActor(()=>query('select * from '+identifier(name)+'()'));return {data:name==='current_app_roles'?rows:rows[0][name]};}catch(error){return {error};}},from(table){let columns,one=false;const filters=[];const q={select(v){columns=v;return q},eq(k,v){filters.push([k,v]);return q},single(){one=true;return q},maybeSingle(){return q},then(resolve,reject){return asActor(async()=>{calls.push({table,columns});try{const rows=await query('select '+columns.split(',').map(identifier).join(',')+' from '+identifier(table)+' where '+filters.map(([k],i)=>identifier(k)+'=$'+(i+1)).join(' and '),filters.map(([,v])=>v));if(one&&rows.length!==1)throw Error('single denied');return {data:rows[0]||null};}catch(error){return {error};}}).then(resolve,reject)}};return q;},storage:{from(bucket){return {download:async name=>asActor(async()=>{calls.push({storage:name});const rows=await query('select name from storage.objects where bucket_id=$1 and name=$2',[bucket,name]);return rows.length?{data:new Blob([objects.get(name)])}:{error:Error('RLS denied')};})};}}};
 const handler=parentPublicationHandler('generate',{env:n=>({SUPABASE_URL:'https://auth.fizira.com',SUPABASE_ANON_KEY:'anon'})[n],createClient:(url,key)=>{assert.equal(key,'anon');return client;}});
 try{
  await query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'foreign@example.test'),($3,'parent@example.test')",[owner,foreign,parent]);
  await query('delete from app_user_roles where user_id=$1',[parent]);await query("insert into app_user_roles(user_id,role) values($1,'parent')",[parent]);
  const [{id:child}]=await query("insert into patients(therapist_id,display_name,primary_complaint) values($1,'Вымышленный ребёнок','PRIVATE CLINICAL SOURCE') returning id",[owner]);
  const [{id:report}]=await query("insert into parent_reports(patient_id,therapist_id,complaint,therapist_name) values($1,$2,'Вымышленный безопасный текст','Специалист') returning id",[child,owner]);
  const [{id:session}]=await query("insert into sessions(patient_id,therapist_id,note) values($1,$2,'PRIVATE SESSION NOTE') returning id",[child,owner]);
  const [{id:sessionReport}]=await query("insert into parent_session_reports(patient_id,therapist_id,session_id,what_did) values($1,$2,$3,'Текст для передачи') returning id",[child,owner,session]);
  const before=await query('select * from parent_reports');
  await t.test('real initial/session engine needs no parent access, invitation or service key',async()=>{
   for(const [id,kind] of [[report,'initial'],[sessionReport,'session']]){const r=await handler(request(id,kind));assert.equal(r.status,200,await r.clone().text());assert.equal((await PDFDocument.load(await r.arrayBuffer())).getPageCount(),1);assert.equal(r.headers.get('cache-control'),'no-store');}
   assert.deepEqual(await query('select * from parent_reports'),before);
   for(const table of ['parent_invitations','parent_child_access','parent_notifications'])assert.equal((await query('select count(*)::int as n from '+table))[0].n,0);
   assert.ok(calls.every(c=>!c.rpc||['account_is_active','current_app_roles'].includes(c.rpc)));
  });
  await t.test('foreign specialist, parent role and substituted report ID are refused',async()=>{actor=foreign;assert.equal((await handler(request(report))).status,403);actor=parent;assert.equal((await handler(request(report))).status,403);actor=owner;assert.equal((await handler(request(child))).status,403);});
  await t.test('hashed original and archive remain byte-identical under private Storage RLS',async()=>{
   const [{claim_parent_publication:claim}]=await query("select claim_parent_publication($1,$2,'initial')",[owner,report]);
   const pdf=new Uint8Array(await (await handler(request(sessionReport,'session'))).arrayBuffer());const path=`${owner}/parent-reports/initial/${report}/${claim.revision}.pdf`;objects.set(path,pdf);
   await query("insert into storage.objects(bucket_id,name,version,metadata) values('patient-media',$1,'v1','{}')",[path]);
   await query("select complete_parent_publication($1,$2,'initial',$3,$4,$5,'[]')",[owner,report,claim.claim_id,claim.revision,await digestBytes(pdf)]);
   const frozen=await query('select * from parent_reports where id=$1',[report]);const response=await handler(request(report));assert.equal(response.status,200,await response.clone().text());assert.deepEqual(new Uint8Array(await response.arrayBuffer()),pdf);assert.deepEqual(await query('select * from parent_reports where id=$1',[report]),frozen);
   actor=foreign;assert.deepEqual(await asActor(()=>query('select name from storage.objects where name=$1',[path])),[]);actor=owner;
   await asActor(()=>query("update parent_reports set publication_status='archived' where id=$1",[report]));assert.equal((await handler(request(report))).status,200);
  });
  await t.test('unversioned legacy snapshot works with real renderer without history mutation',async()=>{
   const [{id:legacy}]=await query("insert into parent_reports(patient_id,therapist_id,complaint,publication_status,published_at,published_by,published_snapshot,pdf_storage_path,pdf_generated_at) values($1,$2,'PRIVATE CURRENT TEXT','published',now(),$2,'{\"complaint\":\"Frozen legacy text\"}', $3,now()) returning id",[child,owner,`${owner}/parent-reports/legacy-missing.pdf`]);
   const before=await query('select * from parent_reports where id=$1',[legacy]);const response=await handler(request(legacy));assert.equal(response.status,200,await response.clone().text());assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(),1);assert.deepEqual(await query('select * from parent_reports where id=$1',[legacy]),before);
  });
 }finally{await db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const specialist = '11111111-1111-4111-8111-111111111111';
const parentA = '22222222-2222-4222-8222-222222222222';
const parentB = '33333333-3333-4333-8333-333333333333';
const childA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const childB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceTables = ['patients','sessions','assessments','goals','patient_media','parent_reports','standardized_assessments','appointments'];
const newTables = ['parent_session_reports','parent_session_report_media','parent_goal_publications','parent_notifications'];
const rpcNames = ['parent_portal_children','parent_portal_dashboard','parent_portal_schedule','parent_portal_reports','parent_portal_report','parent_portal_goals','parent_portal_dynamics','parent_portal_notifications','parent_mark_notifications_read'];

test('010 claim/CAS, Storage freezes and artifact handoff execute with real database roles',async t=>{
 const migration=await readFile(new URL('../supabase/migrations/20261003_010_parent_publication_artifacts.sql',import.meta.url),'utf8');
 const db=new PGlite();
 const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const scalar=async(sql,args=[]) => Object.values((await query(sql,args))[0])[0];
 const as=async(role,user,fn)=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);try{return await fn();}finally{await db.exec('reset role');}};
 try{
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create table account_deletion_jobs(user_id uuid primary key references auth.users);
      create function account_is_active() returns boolean language sql stable security definer as $$ select auth.uid() is not null and not exists(select 1 from account_deletion_jobs where user_id=auth.uid()) $$;
      create table profiles(id uuid primary key,full_name text,profession text,organization text,phone text); create table patients(id uuid primary key,therapist_id uuid not null references auth.users,display_name text,date_of_birth date,ai_analysis text);
      create table patient_contacts(id uuid primary key,patient_id uuid references patients,therapist_id uuid references auth.users,full_name text);
      create table user_consents(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,terms_version text not null,privacy_version text not null,accepted_at timestamptz default now());
      create table parent_reports(id uuid primary key default gen_random_uuid(),patient_id uuid not null references patients,therapist_id uuid not null references auth.users,complaint text,strengths text,observations text,goals text,progress text,recommendations text,therapist_name text,therapist_profession text,therapist_organization text,therapist_phone text,therapist_logo_path text,created_at timestamptz default now(),updated_at timestamptz default now());
      create table sessions(id uuid primary key default gen_random_uuid(),patient_id uuid references patients,therapist_id uuid references auth.users,note text,planned_session jsonb,tolerance text);
      create table assessments(id uuid primary key default gen_random_uuid(),patient_id uuid references patients,therapist_id uuid references auth.users,note text);
      create table goals(id uuid primary key default gen_random_uuid(),patient_id uuid references patients,therapist_id uuid references auth.users,title text,progress integer);
      create table patient_media(id uuid primary key default gen_random_uuid(),patient_id uuid references patients,therapist_id uuid references auth.users,media_type text,storage_path text,note text);
      create table standardized_assessments(id uuid primary key default gen_random_uuid(),patient_id uuid references patients,therapist_id uuid references auth.users,scale text,assessed_at date,value_numeric numeric,value_text text,note text);
      create table appointments(id uuid primary key default gen_random_uuid(),patient_id uuid references patients,therapist_id uuid references auth.users,starts_at timestamptz,ends_at timestamptz,status text,kind text default 'appointment',price_kopecks integer default 0,paid_kopecks integer default 0,note text);
      insert into auth.users(id,email) values ('${specialist}','specialist@example.test');
      insert into patients values ('${childA}','${specialist}','Child A','2020-01-01','PRIVATE AI'),('${childB}','${specialist}','Child B','2021-01-01','PRIVATE AI');
    `);
    for(const table of sourceTables) {
      if(table!=='patients') await db.exec(`alter table ${table} drop constraint ${table}_patient_id_fkey; alter table ${table} add constraint ${table}_patient_id_fkey foreign key(patient_id) references patients(id) on delete ${table==='appointments'?'set null':'cascade'}`);
      await db.exec(`alter table ${table} enable row level security; create policy ${table}_own on ${table} for all to authenticated using(therapist_id=auth.uid()) with check(therapist_id=auth.uid()); create policy account_must_be_active on ${table} as restrictive for all to authenticated using(account_is_active()) with check(account_is_active()); grant select,insert,update,delete on ${table} to authenticated,service_role;`);
    }
    await db.exec(await readFile(new URL('../supabase/migrations/20260930_007_legal_acceptances.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261003_008_parent_portal_identity.sql',import.meta.url),'utf8'));
    await db.exec(`insert into auth.users(id,email) values ('${parentA}','a@example.test'),('${parentB}','b@example.test'); insert into app_user_roles(user_id,role) values ('${parentA}','parent'),('${parentB}','parent'); insert into parent_child_access(parent_user_id,patient_id,therapist_id) values ('${parentA}','${childA}','${specialist}'),('${parentB}','${childB}','${specialist}');`);

 await db.exec(await readFile(new URL('../supabase/migrations/20261003_009_parent_portal_publications.sql',import.meta.url),'utf8'));
 await db.exec("create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,version text,metadata jsonb,updated_at timestamptz default now(),unique(bucket_id,name));alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated,service_role;");
 const baseline=await readFile(new URL('../supabase/migrations/20260921_002_existing_target_security_fix.sql',import.meta.url),'utf8');
 await db.exec(baseline.slice(baseline.indexOf('-- Restore the missing Storage policies.'),baseline.indexOf('-- New signups')));
 const account=await readFile(new URL('../supabase/migrations/20260922_004_account_deletion_jobs.sql',import.meta.url),'utf8');
 await db.exec(account.slice(account.indexOf('drop policy if exists account_must_be_active on storage.objects;'),account.lastIndexOf('commit;')));
 await db.exec(migration);
 const [{id:report}]=await query("insert into parent_session_reports(patient_id,therapist_id,what_did) values ($1,$2,'Заморожено') returning id",[childA,specialist]);
 const source=`${specialist}/selected.jpg`;
 const [{id:media}]=await query("insert into patient_media(patient_id,therapist_id,media_type,storage_path) values($1,$2,'photo',$3) returning id",[childA,specialist,source]);
 await query('insert into storage.objects(bucket_id,name,version,metadata) values($1,$2,$3,$4)',['patient-media',source,'v1',{size:10,mimetype:'image/jpeg',eTag:'"frozen-A"'}]);
 await query('insert into parent_session_report_media(parent_session_report_id,patient_media_id,patient_id,therapist_id) values($1,$2,$3,$4)',[report,media,childA,specialist]);
 const claim=()=>as('service_role',null,()=>scalar('select claim_parent_publication($1,$2,$3)',[specialist,report,'session']));
 let first=await claim();
 const finish=(c,artifacts=[])=>as('service_role',null,()=>scalar('select complete_parent_publication($1,$2,$3,$4,$5,$6,$7)',[specialist,report,'session',c.claim_id,c.revision,'a'.repeat(64),JSON.stringify(artifacts)]));
 const fail=(c)=>as('service_role',null,()=>scalar('select fail_parent_publication($1,$2,$3,$4,$5)',[specialist,report,'session',c.claim_id,c.revision]));
 await t.test('snapshot/source object version captured before work; only one live claimant',async()=>{
  assert.equal(first.snapshot.what_did,'Заморожено');assert.equal(first.media[0].source_object.version,'v1');
  await assert.rejects(claim(),/Request could not be completed/);
  await assert.rejects(as('authenticated',specialist,()=>scalar('select claim_parent_publication($1,$2,$3)',[specialist,report,'session'])),/permission denied/);
  await assert.rejects(as('service_role',null,()=>scalar('select claim_parent_publication($1,$2,$3)',[parentA,report,'session'])),/Request could not be completed/);
 });
 await t.test('publishing authors/selections and captured source Storage objects freeze',async()=>{
  await assert.rejects(as('authenticated',specialist,()=>query("update parent_session_reports set what_did='raced' where id=$1",[report])),/immutable|publishing/i);
  await assert.rejects(query('delete from parent_session_report_media where parent_session_report_id=$1',[report]),/immutable|publishing/i);
  assert.equal((await as('authenticated',specialist,()=>query("update storage.objects set version='raced' where name=$1 returning id",[source]))).length,0);
  assert.equal((await as('authenticated',specialist,()=>query('delete from storage.objects where name=$1 returning id',[source]))).length,0);
 });
 await t.test('source metadata late mutation rejects completion and error stays parent-invisible',async()=>{
  await query("update storage.objects set version='late-race' where name=$1",[source]);
  const prefix=`${specialist}/parent-reports/session/${report}/${first.revision}`;
  const artifacts=[{id:media,storage_path:`${prefix}/${media}.jpg`,sha256:'c'.repeat(64),content_type:'image/jpeg'}];
  await query("insert into storage.objects(bucket_id,name,version,metadata) values('patient-media',$1,'artifact','{}'),('patient-media',$2,'artifact','{}')",[`${prefix}.pdf`,artifacts[0].storage_path]);
  await assert.rejects(finish(first,artifacts),/Request could not be completed/);
  assert.equal(await fail(first),true);
  assert.equal(await scalar('select publication_status from parent_session_reports where id=$1',[report]),'publication_error');
  assert.deepEqual(await as('authenticated',parentA,()=>scalar('select parent_portal_report($1)',[report])),{report:null});
  assert.equal((await as('authenticated',specialist,()=>query("update storage.objects set version='v2' where name=$1 returning id",[source]))).length,1);
 });
 let second=await claim();
 await t.test('stale worker cannot complete/fail newer claim; new revision gets independent artifacts',async()=>{
  assert.equal(second.revision,first.revision+1);assert.equal(await fail(first),false);await assert.rejects(finish(first),/Request could not be completed/);
  await query("update parent_session_reports set publication_claimed_at=now()-interval '16 minutes' where id=$1",[report]);
  const newer=await claim();assert.equal(newer.revision,second.revision+1);assert.equal(await fail(second),false);second=newer;
 });
 const prefix=`${specialist}/parent-reports/session/${report}/${second.revision}`;
 const artifacts=[{id:media,storage_path:`${prefix}/${media}.jpg`,sha256:'b'.repeat(64),content_type:'image/jpeg'}];
 await query("insert into storage.objects(bucket_id,name,version,metadata) values('patient-media',$1,'artifact', '{}'),('patient-media',$2,'artifact','{}')",[`${prefix}.pdf`,artifacts[0].storage_path]);
 await t.test('permanent artifact namespace disallows owner insert/update/delete but permits original uploads',async()=>{
  await assert.rejects(as('authenticated',specialist,()=>query("insert into storage.objects(bucket_id,name) values('patient-media',$1)",[`${prefix}/evil.jpg`])),/row.level security/i);
  for(const name of [`${prefix}.pdf`,artifacts[0].storage_path]) {
   assert.equal((await as('authenticated',specialist,()=>query("update storage.objects set version='overwrite' where name=$1 returning id",[name]))).length,0);
   assert.equal((await as('authenticated',specialist,()=>query('delete from storage.objects where name=$1 returning id',[name]))).length,0);
  }
 });
 await t.test('complete stores artifacts once, notification once, retries idempotent',async()=>{
  assert.equal(await finish(second,artifacts),true);
  const done=await claim();assert.equal(done.publication_status,'published');assert.equal(await fail(second),false);
  assert.equal(await scalar('select count(*)::int from parent_notifications'),1);
  assert.equal((await scalar('select published_media from parent_session_reports where id=$1',[report]))[0].storage_path,artifacts[0].storage_path);
 });
 const resolve=(parent,kind='photo',id=media)=>as('service_role',null,()=>scalar('select resolve_parent_publication_file($1,$2,$3,$4)',[parent,report,kind,id]));
 await t.test('handoff verifies active parent/published/explicit selection and ignores current media',async()=>{
  await query("update patient_media set storage_path=$2,media_type='document' where id=$1",[media,`${specialist}/changed.pdf`]);
  assert.equal((await resolve(parentA)).storage_path,artifacts[0].storage_path);
  for(const [parent,kind,id] of [[parentB,'photo',media],[parentA,'photo',childB],[parentA,'wrong',media]]) assert.equal(await resolve(parent,kind,id),null);
  await query("update parent_child_access set status='revoked',revoked_at=now() where parent_user_id=$1",[parentA]);assert.equal(await resolve(parentA),null);
  await query("update parent_child_access set status='active',revoked_at=null where parent_user_id=$1",[parentA]);
  await query('insert into account_deletion_jobs values($1)',[specialist]);assert.equal(await resolve(parentA),null);await query('delete from account_deletion_jobs');
  await assert.rejects(as('authenticated',parentA,()=>scalar('select resolve_parent_publication_file($1,$2,$3,$4)',[parentA,report,'photo',media])),/permission denied/);
 });
 await t.test('010 verifier accepts exact added restrictive policies and rejects tampering; migration reapply safe',async()=>{
  const verification=await readFile(new URL('../supabase/verification/verify_migration.sql',import.meta.url),'utf8');
  const block=verification.slice(verification.indexOf('-- Parent publication boundary (009).')).split('-- Parent specialist role boundary (011).')[0];
  await db.exec(block);
  for(const mutation of ["grant execute on function resolve_parent_publication_file(uuid,uuid,text,uuid) to authenticated","create or replace function parent_storage_write_allowed(p_bucket text,p_name text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select true$$","alter table parent_reports drop constraint parent_reports_artifact_check","alter table parent_reports drop constraint parent_reports_artifact_check;alter table parent_reports add constraint parent_reports_artifact_check check(((pdf_sha256 is null or pdf_sha256 ~ '^[a-f0-9]{64}$') and (publication_claim_id is null or (publication_claimed_at is not null and (publication_status<>'published' or pdf_sha256 is not null)))) or true)"]) {
   await db.exec('begin');try{await db.exec(mutation);await assert.rejects(db.exec(block),/Unsafe publication|Missing publication/);}finally{await db.exec('rollback');}
  }
  await db.exec("alter policy parent_artifacts_update on storage.objects using(true)");await assert.rejects(db.exec(block),/Unsafe publication Storage policy/);
  await db.exec(migration);await db.exec(block);
 });
 }finally{await db.close();}
});

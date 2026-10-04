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

test('publication SQL executes with immutable snapshots, safe projections and real-role isolation', async t => {
  // Read before fixture setup: the first TDD RED must be the absent migration.
  const migration = await readFile(new URL('../supabase/migrations/20261003_009_parent_portal_publications.sql', import.meta.url), 'utf8');
  const db = new PGlite();
  const query = async (sql, args = []) => (await db.query(sql,args)).rows;
  const scalar = async (sql,args = []) => Object.values((await query(sql,args))[0])[0];
  const as = async (role,user,fn) => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user || '']);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  const parentRpc = (user,name,...args) => as('authenticated',user,()=>scalar(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args));
  const directSelectAs = (user,table,child) => as('authenticated',user,()=>scalar(`select count(*)::int from public.${table} where ${table==='patients'?'id':'patient_id'}=$1`,[child]));
  const publish = (table,id,snapshot) => as('service_role',null,()=>query(`update public.${table} set publication_status='published', published_at=now(),published_by=$2,published_snapshot=$3,pdf_storage_path=$4,pdf_generated_at=now() where id=$1 returning id`,[id,specialist,JSON.stringify(snapshot),`${specialist}/parent-reports/${table}/${id}/1.pdf`]));
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create table account_deletion_jobs(user_id uuid primary key references auth.users);
      create function account_is_active() returns boolean language sql stable security definer as $$ select auth.uid() is not null and not exists(select 1 from account_deletion_jobs where user_id=auth.uid()) $$;
      create table patients(id uuid primary key,therapist_id uuid not null references auth.users,display_name text,date_of_birth date,ai_analysis text);
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
    const [{id:unpublishedReport}] = await query('insert into parent_reports(patient_id,therapist_id,complaint) values ($1,$2,$3) returning id',[childA,specialist,'Legacy draft']);
    const beforePolicies = await query('select tablename,policyname,cmd,qual,with_check from pg_policies where tablename=any($1) order by tablename,policyname',[sourceTables]);
    await db.exec(migration);
    await t.test('legacy drafts, grants, security-definer search paths and unchanged specialist sources',async()=>{
      assert.equal(await scalar('select publication_status from parent_reports where id=$1',[unpublishedReport]),'draft');
      assert.deepEqual(await query('select tablename,policyname,cmd,qual,with_check from pg_policies where tablename=any($1) order by tablename,policyname',[sourceTables]),beforePolicies);
      for(const name of rpcNames) {
        const [f] = await query("select oid,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name]);
        assert.equal(f.prosecdef,true); assert.deepEqual(f.proconfig,['search_path=pg_catalog, public']);
        assert.equal(await scalar("select has_function_privilege('anon',$1::oid,'execute')",[f.oid]),false);
        assert.equal(await scalar("select has_function_privilege('authenticated',$1::oid,'execute')",[f.oid]),true);
      }
      for(const table of newTables) {
        assert.equal(await as('authenticated',parentA,()=>scalar(`select count(*)::int from ${table}`)),0);
        assert.equal(await scalar("select count(*)::int from pg_policies where tablename=$1 and policyname='account_must_be_active' and permissive='RESTRICTIVE'",[table]),1);
        assert.equal(await scalar('select has_table_privilege($1,$2,$3)',['anon',table,'select,insert,update,delete']),false);
        assert.equal(await scalar('select has_table_privilege($1,$2,$3)',['authenticated',table,'truncate']),false);
      }
    });
    const [{id:session}] = await query('insert into sessions(patient_id,therapist_id,note,planned_session,tolerance) values ($1,$2,$3,$4,$5) returning id',[childA,specialist,'PRIVATE NOTE','{"secret":true}','PRIVATE TOLERANCE']);
    // Existing specialist uploads store images with media_type='photo'.
    const [{id:image}] = await query('insert into patient_media(patient_id,therapist_id,media_type,storage_path,note) values ($1,$2,$3,$4,$5) returning id',[childA,specialist,'photo',`${specialist}/private.jpg`,'PRIVATE IMAGE NOTE']);
    const [{id:report}] = await query('insert into parent_session_reports(patient_id,therapist_id,session_id,what_did) values ($1,$2,$3,$4) returning id',[childA,specialist,session,'Live author field']);
    await t.test('selected images validate child, therapist, image type and source session ownership',async()=>{
      await query('insert into parent_session_report_media(parent_session_report_id,patient_media_id,patient_id,therapist_id) values ($1,$2,$3,$4)',[report,image,childA,specialist]);
      for(const [child,owner,type] of [[childB,specialist,'photo'],[childA,parentB,'photo'],[childA,specialist,'video'],[childA,specialist,'document']]) {
        const [{id}] = await query('insert into patient_media(patient_id,therapist_id,media_type,storage_path) values ($1,$2,$3,$4) returning id',[child,owner,type,`${owner}/file`]);
        await assert.rejects(query('insert into parent_session_report_media(parent_session_report_id,patient_media_id,patient_id,therapist_id) values ($1,$2,$3,$4)',[report,id,childA,specialist]),/media|ownership|image/i);
      }
      await assert.rejects(query('insert into parent_session_reports(patient_id,therapist_id,session_id) values ($1,$2,$3)',[childB,specialist,session]),/session|ownership/i);
    });
    await publish('parent_session_reports',report,{what_did:'Immutable parent snapshot',what_worked:'Good',attention:'Care',home_recommendations:'Practice',note:'INJECTED',planned_session:{secret:true},storage_path:'INJECTED'});
    await t.test('fixed allowlists and IDOR generic results, immutable published snapshot/PDF/media',async()=>{
      assert.equal((await parentRpc(parentA,'parent_portal_reports',childB)).length,0);
      assert.equal((await parentRpc(parentA,'parent_portal_report',unpublishedReport)).report,null);
      assert.equal((await parentRpc(parentB,'parent_portal_report',report)).report,null);
      const detail = (await parentRpc(parentA,'parent_portal_report',report)).report;
      assert.equal(detail.snapshot.what_did,'Immutable parent snapshot'); assert.deepEqual(detail.media_ids,[image]);
      assert.deepEqual(Object.keys(detail.snapshot).sort(),['attention','home_recommendations','what_did','what_worked']);
      assert.deepEqual(await query('select parent_user_id,type from parent_notifications'),[{parent_user_id:parentA,type:'report_published'}]);
      await assert.rejects(query('update parent_session_reports set what_did=$2 where id=$1',[report,'Changed']),/immutable/i);
      await assert.rejects(query('update parent_session_reports set pdf_storage_path=$2 where id=$1',[report,'changed']),/immutable/i);
      await assert.rejects(query('delete from parent_session_report_media where parent_session_report_id=$1',[report]),/immutable/i);
      await assert.rejects(as('authenticated',specialist,()=>query('delete from parent_session_reports where id=$1',[report])),/immutable/i);
      await assert.rejects(as('authenticated',specialist,()=>query("update parent_reports set publication_status='publishing' where id=$1",[unpublishedReport])),/server|service|publication/i);
      for(const table of sourceTables) assert.equal(await directSelectAs(parentA,table,childA),0);
      assert.equal(await directSelectAs(parentA,'sessions',childA),0);
      assert.equal((await as('authenticated',parentA,()=>query('update parent_session_reports set what_did=$2 where id=$1 returning id',[report,'IDOR']))).length,0);
      assert.equal((await as('authenticated',parentA,()=>query('update parent_reports set complaint=$2 where id=$1 returning id',[unpublishedReport,'IDOR']))).length,0);
      assert.equal((await as('authenticated',specialist,()=>query('select id from parent_session_reports'))).length,1);
    });
    await t.test('published media reference and private file metadata do not follow mutable clinical source media',async()=>{
      const before = await parentRpc(parentA,'parent_portal_report',report);
      await as('authenticated',specialist,()=>query('update patient_media set patient_id=$2,media_type=$3,storage_path=$4,note=$5 where id=$1',[image,childB,'document',`${specialist}/changed-source.pdf`,'Changed private source']));
      assert.deepEqual(await parentRpc(parentA,'parent_portal_report',report),before);
      assert.deepEqual(await scalar('select published_media from parent_session_reports where id=$1',[report]),[{id:image,media_type:'photo',storage_path:`${specialist}/private.jpg`}]);
      assert.doesNotMatch(JSON.stringify(before),/storage_path|private\.jpg|media_type/);
      await assert.rejects(query("update parent_session_reports set published_media='[]' where id=$1",[report]),/immutable/i);
    });
    await t.test('schedule only insert/time/status events reach active parents; finances never notify',async()=>{
      const count = ()=>scalar('select count(*)::int from parent_notifications');
      const n = await count();
      const [{id:appointment}] = await query("insert into appointments(patient_id,therapist_id,starts_at,ends_at,status,price_kopecks,note) values ($1,$2,now()+interval '1 day',now()+interval '1 day 1 hour','planned',12345,'PRIVATE') returning id",[childA,specialist]);
      assert.equal(await count(),n+1);
      await query('update appointments set price_kopecks=99999,paid_kopecks=111,note=$2 where id=$1',[appointment,'FINANCIAL ONLY']);
      assert.equal(await count(),n+1);
      await query('update appointments set starts_at=starts_at,ends_at=ends_at,status=status where id=$1',[appointment]); assert.equal(await count(),n+1);
      await query("update appointments set status='cancelled' where id=$1",[appointment]); assert.equal(await count(),n+2);
      await query("update appointments set starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' where id=$1",[appointment]); assert.equal(await count(),n+3);
      const schedule = await parentRpc(parentA,'parent_portal_schedule',childA,'upcoming');
      assert.deepEqual(Object.keys(schedule[0]).sort(),['ends_at','starts_at','status']);
      await assert.rejects(parentRpc(parentA,'parent_portal_schedule',childA,'all'),/mode/i);
      const [{id:notification}] = await query('select id from parent_notifications where parent_user_id=$1 limit 1',[parentA]);
      assert.equal(await parentRpc(parentB,'parent_mark_notifications_read',[notification]),0);
      assert.equal((await as('authenticated',parentB,()=>query('update parent_notifications set read_at=now() where id=$1 returning id',[notification]))).length,0);
      assert.equal(await parentRpc(parentA,'parent_mark_notifications_read',[notification]),1);
      assert.equal(await parentRpc(parentA,'parent_mark_notifications_read',[notification]),0);
      await db.query("update parent_child_access set status='revoked',revoked_at=now() where parent_user_id=$1",[parentA]);
      const before = await count();
      await query("update appointments set status='completed' where id=$1",[appointment]); assert.equal(await count(),before);
      assert.deepEqual(await parentRpc(parentA,'parent_portal_notifications',childA),[]);
      await db.query("update parent_child_access set status='active',revoked_at=null where parent_user_id=$1",[parentA]);
      await db.query('insert into account_deletion_jobs values ($1)',[parentA]);
      await query("update appointments set status='planned' where id=$1",[appointment]); assert.equal(await count(),before);
      assert.deepEqual(await parentRpc(parentA,'parent_portal_children'),[]);
      await db.query('delete from account_deletion_jobs where user_id=$1',[parentA]);
    });
    await t.test('dashboard/goals/dynamics project only safe fields and all endpoints fail closed',async()=>{
      const [{id:goal}] = await query('insert into goals(patient_id,therapist_id,title,progress) values ($1,$2,$3,80) returning id',[childA,specialist,'PRIVATE GOAL']);
      await query("insert into parent_goal_publications(goal_id,patient_id,therapist_id,title,description,status,published_at) values ($1,$2,$3,'Safe goal','Safe description','in_progress',now())",[goal,childA,specialist]);
      await query("insert into standardized_assessments(patient_id,therapist_id,scale,assessed_at,value_numeric,value_text,note) values ($1,$2,'gmfm66','2026-09-01',55,null,'PRIVATE ASSESSMENT')",[childA,specialist]);
      const children = await parentRpc(parentA,'parent_portal_children'); assert.equal(children.length,1); assert.deepEqual(Object.keys(children[0]).sort(),['date_of_birth','display_name','id']);
      const goals = await parentRpc(parentA,'parent_portal_goals',childA); assert.deepEqual(Object.keys(goals[0]).sort(),['description','status','title','updated_at']);
      const dynamics = await parentRpc(parentA,'parent_portal_dynamics',childA); assert.deepEqual(Object.keys(dynamics[0]).sort(),['assessed_at','scale','value_numeric','value_text']);
      const notifications = await parentRpc(parentA,'parent_portal_notifications',childA);
      assert.deepEqual(Object.keys(notifications[0]).sort(),['body','created_at','entity_id','entity_type','id','read_at','title','type']);
      for(const table of newTables) assert.equal(await directSelectAs(parentA,table,childA),0);
      await assert.rejects(as('authenticated',parentA,()=>query('insert into parent_session_reports(patient_id,therapist_id,what_did) values ($1,$2,$3)',[childA,specialist,'Unauthorized'])),/row.level security/i);
      assert.doesNotMatch(JSON.stringify(await parentRpc(parentA,'parent_portal_dashboard',childA)),/price_kopecks|paid_kopecks|note|planned_session|PRIVATE|storage_path|tolerance|ai_analysis/);
      for(const name of ['parent_portal_reports','parent_portal_goals','parent_portal_dynamics','parent_portal_notifications']) assert.deepEqual(await parentRpc(parentA,name,childB),[]);
      assert.deepEqual(await parentRpc(parentA,'parent_portal_dashboard',childB),{child:null});
      assert.deepEqual(await parentRpc(parentA,'parent_portal_schedule',childB,'history'),[]);
      assert.deepEqual(await parentRpc(parentA,'parent_portal_report','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),{report:null});
      await assert.rejects(parentRpc(null,'parent_portal_children'),/authentication/i);
      await assert.rejects(as('anon',null,()=>query('select parent_portal_children()')),/permission/i);
      await assert.rejects(parentRpc(parentA,'parent_mark_notifications_read',Array(101).fill(report)),/limit|many/i);
    });
    await t.test('initial published snapshot and migration retry preserve existing publications',async()=>{
      await publish('parent_reports',unpublishedReport,{complaint:'Safe immutable initial',strengths:'Strength',note:'INJECTED'});
      const result = await parentRpc(parentA,'parent_portal_report',unpublishedReport);
      assert.equal(result.report.snapshot.complaint,'Safe immutable initial'); assert.equal(result.report.snapshot.note,undefined);
      await assert.rejects(query('update parent_reports set complaint=$2 where id=$1',[unpublishedReport,'new']),/immutable/i);
      const notifications = await scalar('select count(*)::int from parent_notifications');
      await db.exec(migration);
      assert.equal(await scalar('select publication_status from parent_reports where id=$1',[unpublishedReport]),'published');
      assert.deepEqual(await parentRpc(parentA,'parent_portal_report',unpublishedReport),result);
      assert.equal(await scalar('select count(*)::int from parent_notifications'),notifications);
    });
    await t.test('publishing/errors stay invisible; archival cannot permit snapshot mutation or republishing',async()=>{
      const [{id}] = await query('insert into parent_reports(patient_id,therapist_id,complaint) values ($1,$2,$3) returning id',[childA,specialist,'New draft version']);
      await as('service_role',null,()=>query("update parent_reports set publication_status='publishing',publication_revision=2 where id=$1",[id]));
      assert.deepEqual(await parentRpc(parentA,'parent_portal_report',id),{report:null});
      await as('service_role',null,()=>query("update parent_reports set publication_status='publication_error',publication_error='Private render failure' where id=$1",[id]));
      assert.deepEqual(await parentRpc(parentA,'parent_portal_report',id),{report:null});
      await assert.rejects(as('service_role',null,()=>query("update parent_reports set publication_status='published' where id=$1",[id])),/publication_check|check constraint/i);
      await as('service_role',null,()=>query("update parent_reports set publication_status='publishing',publication_error=null where id=$1",[id]));
      await publish('parent_reports',id,{complaint:'Safe revision 2'});
      assert.equal((await parentRpc(parentA,'parent_portal_report',id)).report.revision,2);
      await as('service_role',null,()=>query("update parent_reports set publication_status='archived' where id=$1",[id]));
      assert.deepEqual(await parentRpc(parentA,'parent_portal_report',id),{report:null});
      await assert.rejects(query('update parent_reports set complaint=$2 where id=$1',[id,'Change archived content']),/immutable/i);
      await assert.rejects(query("update parent_reports set publication_status='published' where id=$1",[id]),/immutable/i);
    });
    await t.test('verification accepts the actual specialist Storage baseline including restrictive account policy',async()=>{
      await db.exec("create schema storage; create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security; create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$");
      const securityBaseline = await readFile(new URL('../supabase/migrations/20260921_002_existing_target_security_fix.sql',import.meta.url),'utf8');
      await db.exec(securityBaseline.slice(securityBaseline.indexOf('-- Restore the missing Storage policies.'),securityBaseline.indexOf('-- New signups')));
      const accountBaseline = await readFile(new URL('../supabase/migrations/20260922_004_account_deletion_jobs.sql',import.meta.url),'utf8');
      await db.exec(accountBaseline.slice(accountBaseline.indexOf('drop policy if exists account_must_be_active on storage.objects;'),accountBaseline.lastIndexOf('commit;')));
      const verification = await readFile(new URL('../supabase/verification/verify_migration.sql',import.meta.url),'utf8');
      const block = verification.slice(verification.indexOf('-- Parent publication boundary (009).')).split('-- Parent specialist role boundary (011).')[0];
      await db.exec(block);
    });
    await t.test('approved Storage policy names cannot hide unsafe roles, commands or predicates',async()=>{
      const verification = await readFile(new URL('../supabase/verification/verify_migration.sql',import.meta.url),'utf8');
      const block = verification.slice(verification.indexOf('-- Parent publication boundary (009).')).split('-- Parent specialist role boundary (011).')[0];
      for(const mutation of [
        'alter policy "PT Child media select" on storage.objects using(true)',
        'alter policy "PT Child media select" on storage.objects to anon',
        `drop policy "PT Child media select" on storage.objects; create policy "PT Child media select" on storage.objects for delete to authenticated using(bucket_id='patient-media' and (storage.foldername(name))[1]=auth.uid()::text)`,
        `alter policy "PT Child media select" on storage.objects using(bucket_id='specialist-logos' and (storage.foldername(name))[1]=auth.uid()::text)`,
        `alter policy "PT Child media select" on storage.objects using((bucket_id='patient-media' and (storage.foldername(name))[1]=auth.uid()::text) or true)`,
        `create function storage.foldernamename() returns text[] language sql stable as $$ select array[auth.uid()::text] $$; alter policy "PT Child media select" on storage.objects using(bucket_id='patient-media' and (storage.foldernamename())[1]=auth.uid()::text)`,
        'alter policy account_must_be_active on storage.objects using(true)',
      ]) {
        await db.exec('begin');
        try {
          await db.exec(mutation);
          await assert.rejects(db.exec(block),mutation.startsWith('alter policy account_must_be_active')?/Parent Storage policy is forbidden|Unsafe Storage account policy/:/Unsafe specialist Storage policy/);
        }
        finally { await db.exec('rollback'); }
      }
      // The fresh schema's older initplan auth.uid() form is also a valid baseline.
      await db.exec(`alter policy "PT Child media select" on storage.objects using(bucket_id='patient-media' and (storage.foldername(name))[1]=(select auth.uid()::text))`);
      await db.exec(block);
    });
    await t.test('read-only verification executes and fails closed on source widening and missing guards',async()=>{
      const verification = await readFile(new URL('../supabase/verification/verify_migration.sql',import.meta.url),'utf8');
      const block = verification.slice(verification.indexOf('-- Parent publication boundary (009).')).split('-- Parent specialist role boundary (011).')[0];
      await db.exec(block);
      await db.exec('create policy parent_leak on sessions for select to authenticated using(true)');
      await assert.rejects(db.exec(block),/Clinical source policy must remain specialist-only/);
      await db.exec('drop policy parent_leak on sessions');
      await db.exec('alter table parent_session_reports disable trigger guard_parent_report_publication');
      await assert.rejects(db.exec(block),/Missing publication guard trigger/);
      await db.exec('alter table parent_session_reports enable trigger guard_parent_report_publication');
      await db.exec('create policy parent_storage_leak on storage.objects for select to authenticated using(true)');
      await assert.rejects(db.exec(block),/Parent Storage policy is forbidden/);
      await db.exec('drop policy parent_storage_leak on storage.objects');
      await db.exec(block);
    });
    await t.test('all list projections and mark-read input are bounded; inactive ownership fails closed',async()=>{
      await query("insert into standardized_assessments(patient_id,therapist_id,scale,assessed_at,value_numeric) select $1,$2,'gmfm66','2026-09-01',n from generate_series(1,105) n",[childA,specialist]);
      await query("insert into appointments(patient_id,therapist_id,starts_at,ends_at,status) select $1,$2,now()+n*interval '1 day',now()+n*interval '1 day'+interval '1 hour','planned' from generate_series(1,105) n",[childA,specialist]);
      await query("insert into parent_goal_publications(goal_id,patient_id,therapist_id,title,status,published_at) select g.id,g.patient_id,g.therapist_id,'Safe goal','new',now() from goals g,generate_series(1,105) n where g.patient_id=$1",[childA]);
      await query("insert into parent_reports(patient_id,therapist_id,publication_status,published_at,published_by,published_snapshot,pdf_storage_path,pdf_generated_at) select $1,$2::uuid,'published',now(),$2::uuid,'{}'::jsonb,$2::uuid::text||'/parent-reports/test/'||n::text||'.pdf',now() from generate_series(1,105) n",[childA,specialist]);
      for(const name of ['parent_portal_reports','parent_portal_goals','parent_portal_dynamics','parent_portal_notifications']) assert.equal((await parentRpc(parentA,name,childA)).length,100);
      assert.equal((await parentRpc(parentA,'parent_portal_schedule',childA,'upcoming')).length,100);
      const dashboard = await parentRpc(parentA,'parent_portal_dashboard',childA);
      for(const section of ['reports','goals','dynamics','notifications','schedule']) assert.equal(dashboard[section].length,100);
      await db.query('insert into account_deletion_jobs values ($1)',[specialist]);
      assert.deepEqual(await parentRpc(parentA,'parent_portal_children'),[]);
      assert.deepEqual(await parentRpc(parentA,'parent_portal_dashboard',childA),{child:null});
      assert.deepEqual(await parentRpc(parentA,'parent_portal_report',report),{report:null});
      const [{id:notification}] = await query('select id from parent_notifications where parent_user_id=$1 and read_at is null limit 1',[parentA]);
      assert.equal(await parentRpc(parentA,'parent_mark_notifications_read',[notification]),0);
      await db.query('delete from account_deletion_jobs where user_id=$1',[specialist]);
    });
    await t.test('publication protection does not block child lifecycle cascades',async()=>{
      await query('delete from patients where id=$1',[childA]);
      assert.equal(await scalar('select count(*)::int from parent_session_reports where id=$1',[report]),0);
      assert.equal(await scalar('select count(*)::int from parent_session_report_media where patient_id=$1',[childA]),0);
      assert.deepEqual(await parentRpc(parentA,'parent_portal_report',report),{report:null});
    });
  } finally { await db.close(); }
});

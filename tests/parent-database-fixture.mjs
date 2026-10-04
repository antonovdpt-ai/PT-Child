import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const specialist = '11111111-1111-4111-8111-111111111111';
const parentA = '22222222-2222-4222-8222-222222222222';
const parentB = '33333333-3333-4333-8333-333333333333';
const childA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const childB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceTables = ['ai_analysis_history','patient_contacts','patients','sessions','assessments','goals','patient_media','parent_reports','standardized_assessments','appointments'];
const newTables = ['parent_session_reports','parent_session_report_media','parent_goal_publications','parent_notifications'];
const rpcNames = ['parent_portal_children','parent_portal_dashboard','parent_portal_schedule','parent_portal_reports','parent_portal_report','parent_portal_goals','parent_portal_dynamics','parent_portal_notifications','parent_mark_notifications_read'];

export async function createParentDatabaseFixture() {
 const migration=await readFile(new URL('../supabase/migrations/20261003_010_parent_publication_artifacts.sql',import.meta.url),'utf8');
 const db=new PGlite();
 const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const scalar=async(sql,args=[]) => Object.values((await query(sql,args))[0])[0];
 const as=async(role,user,fn)=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);try{return await fn();}finally{await db.exec('reset role');}};

    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,invited_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create table account_deletion_jobs(user_id uuid primary key references auth.users);
      create function account_is_active() returns boolean language sql stable security definer as $$ select auth.uid() is not null and not exists(select 1 from account_deletion_jobs where user_id=auth.uid()) $$;
      create table ai_analysis_history(id uuid primary key default gen_random_uuid(),therapist_id uuid references auth.users); create table profiles(id uuid primary key,full_name text,profession text,organization text,phone text); create table patients(id uuid primary key,therapist_id uuid not null references auth.users,display_name text,date_of_birth date,ai_analysis text);
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
      if(!['patients','ai_analysis_history','patient_contacts'].includes(table)) await db.exec(`alter table ${table} drop constraint ${table}_patient_id_fkey; alter table ${table} add constraint ${table}_patient_id_fkey foreign key(patient_id) references patients(id) on delete ${table==='appointments'?'set null':'cascade'}`);
      await db.exec(`alter table ${table} enable row level security; create policy ${table}_own on ${table} for all to authenticated using(therapist_id=auth.uid()) with check(therapist_id=auth.uid()); create policy account_must_be_active on ${table} as restrictive for all to authenticated using(account_is_active()) with check(account_is_active()); grant select,insert,update,delete on ${table} to authenticated,service_role;`);
    }
    // Execute the reviewed baseline helper and initial-report policies verbatim;
    // the release verifier must exercise real definitions, not fixture shortcuts.
    const baselineSchema=await readFile(new URL('../supabase/migrations/20260920_001_app_schema.sql',import.meta.url),'utf8');
    const baselineSecurity=await readFile(new URL('../supabase/migrations/20260921_002_existing_target_security_fix.sql',import.meta.url),'utf8');
    const accountSource=await readFile(new URL('../supabase/migrations/20260922_004_account_deletion_jobs.sql',import.meta.url),'utf8');
    await db.exec(accountSource.slice(accountSource.indexOf('create or replace function public.account_is_active()'),accountSource.indexOf('do $$',accountSource.indexOf('create or replace function public.account_is_active()'))));
    await db.exec('drop policy parent_reports_own on public.parent_reports');
    for(const match of baselineSchema.matchAll(/CREATE POLICY parent_reports_[\s\S]*?;/g))await db.exec(match[0]);
    await db.exec(baselineSecurity.slice(baselineSecurity.indexOf('drop policy if exists parent_reports_insert_own'),baselineSecurity.indexOf('drop policy if exists patient_contacts_insert_own')));

    await db.exec(await readFile(new URL('../supabase/migrations/20260930_007_legal_acceptances.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261003_008_parent_portal_identity.sql',import.meta.url),'utf8'));
    await db.exec(`insert into auth.users(id,email) values ('${parentA}','a@example.test'),('${parentB}','b@example.test'); insert into app_user_roles(user_id,role) values ('${parentA}','parent'),('${parentB}','parent'); insert into parent_child_access(parent_user_id,patient_id,therapist_id) values ('${parentA}','${childA}','${specialist}'),('${parentB}','${childB}','${specialist}');`);

 await db.exec(await readFile(new URL('../supabase/migrations/20261003_009_parent_portal_publications.sql',import.meta.url),'utf8'));
 await db.exec("create schema storage;create table storage.buckets(id text,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,version text,metadata jsonb,updated_at timestamptz default now(),unique(bucket_id,name));alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated,service_role;");
 const baseline=await readFile(new URL('../supabase/migrations/20260921_002_existing_target_security_fix.sql',import.meta.url),'utf8');
 await db.exec(baseline.slice(baseline.indexOf('-- Restore the missing Storage policies.'),baseline.indexOf('-- New signups')));
 const account=await readFile(new URL('../supabase/migrations/20260922_004_account_deletion_jobs.sql',import.meta.url),'utf8');
 await db.exec(account.slice(account.indexOf('drop policy if exists account_must_be_active on storage.objects;'),account.lastIndexOf('commit;')));
 await db.exec(migration);

 return {db,query,scalar,as,specialist,parentA,parentB,childA,childB};
}

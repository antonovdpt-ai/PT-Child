// Local platform stand-ins only; ALL application schema/functions/policies are
// executed verbatim from reviewed migrations 001–012, with no tenant data.
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
export const reviewedMigrations=[
 '20260920_001_app_schema.sql','20260921_002_existing_target_security_fix.sql',
 '20260921_003_patient_media_path_integrity.sql','20260922_004_account_deletion_jobs.sql',
 '20260923_005_specialist_schedule.sql','20260923_006_schedule_calendar.sql',
 '20260930_007_legal_acceptances.sql','20261003_008_parent_portal_identity.sql',
 '20261003_009_parent_portal_publications.sql','20261003_010_parent_publication_artifacts.sql',
 '20261003_011_parent_role_boundaries.sql','20261003_012_parent_publication_archive.sql'
];
export async function createFullParentSchemaFixture() {
 const db=new PGlite({extensions:{btree_gist}});
 try {
  await db.exec(`
   create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;
   create table auth.users(id uuid primary key,email text,invited_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb not null default '{}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,version text,metadata jsonb,updated_at timestamptz default now(),unique(bucket_id,name));
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema auth,storage to authenticated,service_role;
   grant select,insert,update,delete on storage.objects to authenticated,service_role;
  `);
  for(const file of reviewedMigrations)await db.exec((await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')).replace(/^\\set[^\n]*\n/gm,''));
  return {db,query:async(sql,args=[]) => (await db.query(sql,args)).rows};
 }catch(error){await db.close();throw error;}
}

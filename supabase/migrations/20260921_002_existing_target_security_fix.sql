\set ON_ERROR_STOP on

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Stop before changing anything if the expected Fizira objects are missing
-- or if a new foreign key would reject existing data.
do $$
declare
  missing_tables text;
begin
  select string_agg(required_name, ', ' order by required_name)
    into missing_tables
  from (values
    ('ai_analysis_history'), ('assessments'), ('goals'), ('parent_reports'),
    ('patient_contacts'), ('patient_media'), ('patients'), ('profiles'),
    ('sessions'), ('standardized_assessments'), ('user_consents')
  ) required(required_name)
  where to_regclass('public.' || required_name) is null;

  if missing_tables is not null then
    raise exception 'Missing required public tables: %', missing_tables;
  end if;

  if to_regprocedure('public.handle_new_user()') is null then
    raise exception 'Missing function public.handle_new_user()';
  end if;

  if not exists (select 1 from storage.buckets where id = 'patient-media')
     or not exists (select 1 from storage.buckets where id = 'specialist-logos') then
    raise exception 'Required storage buckets are missing';
  end if;

  if exists (
    select 1 from public.ai_analysis_history t
    left join auth.users u on u.id = t.therapist_id
    where t.therapist_id is not null and u.id is null
  ) or exists (
    select 1 from public.parent_reports t
    left join auth.users u on u.id = t.therapist_id
    where t.therapist_id is not null and u.id is null
  ) or exists (
    select 1 from public.patient_contacts t
    left join auth.users u on u.id = t.therapist_id
    where t.therapist_id is not null and u.id is null
  ) or exists (
    select 1 from public.patient_media t
    left join auth.users u on u.id = t.therapist_id
    where t.therapist_id is not null and u.id is null
  ) or exists (
    select 1 from public.standardized_assessments t
    left join auth.users u on u.id = t.therapist_id
    where t.therapist_id is not null and u.id is null
  ) then
    raise exception 'Orphan therapist_id values found; no changes were made';
  end if;
end
$$;

-- Add the five missing links to auth.users, without duplicating an existing FK.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.conrelid = 'public.ai_analysis_history'::regclass
      and c.confrelid = 'auth.users'::regclass and a.attname = 'therapist_id'
  ) then
    alter table public.ai_analysis_history
      add constraint ai_analysis_history_therapist_id_fkey
      foreign key (therapist_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.conrelid = 'public.parent_reports'::regclass
      and c.confrelid = 'auth.users'::regclass and a.attname = 'therapist_id'
  ) then
    alter table public.parent_reports
      add constraint parent_reports_therapist_id_fkey
      foreign key (therapist_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.conrelid = 'public.patient_contacts'::regclass
      and c.confrelid = 'auth.users'::regclass and a.attname = 'therapist_id'
  ) then
    alter table public.patient_contacts
      add constraint patient_contacts_therapist_id_fkey
      foreign key (therapist_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.conrelid = 'public.patient_media'::regclass
      and c.confrelid = 'auth.users'::regclass and a.attname = 'therapist_id'
  ) then
    alter table public.patient_media
      add constraint patient_media_therapist_id_fkey
      foreign key (therapist_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.conrelid = 'public.standardized_assessments'::regclass
      and c.confrelid = 'auth.users'::regclass and a.attname = 'therapist_id'
  ) then
    alter table public.standardized_assessments
      add constraint standardized_assessments_therapist_id_fkey
      foreign key (therapist_id) references auth.users(id) on delete cascade;
  end if;
end
$$;

-- The application already offers the Documents category; allow it in the DB.
alter table public.patient_media
  drop constraint if exists patient_media_category_check;

alter table public.patient_media
  add constraint patient_media_category_check check (category = any (array[
    'posture'::text, 'sitting'::text, 'crawling'::text, 'standing'::text,
    'walking'::text, 'transitions'::text, 'lower_limb'::text,
    'upper_limb'::text, 'equipment'::text, 'documents'::text, 'other'::text
  ]));

-- Strengthen the 11 policies that differ from the source project.
drop policy if exists "Create own AI analysis history" on public.ai_analysis_history;
create policy "Create own AI analysis history"
  on public.ai_analysis_history for insert to authenticated
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = ai_analysis_history.patient_id
        and p.therapist_id = auth.uid()
    )
  );

drop policy if exists parent_reports_insert_own on public.parent_reports;
create policy parent_reports_insert_own
  on public.parent_reports for insert to authenticated
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = parent_reports.patient_id
        and p.therapist_id = auth.uid()
    )
  );

drop policy if exists parent_reports_update_own on public.parent_reports;
create policy parent_reports_update_own
  on public.parent_reports for update to authenticated
  using (therapist_id = auth.uid())
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = parent_reports.patient_id
        and p.therapist_id = auth.uid()
    )
  );

drop policy if exists patient_contacts_insert_own on public.patient_contacts;
create policy patient_contacts_insert_own
  on public.patient_contacts for insert to authenticated
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_contacts.patient_id
        and p.therapist_id = auth.uid()
    )
  );

drop policy if exists patient_contacts_update_own on public.patient_contacts;
create policy patient_contacts_update_own
  on public.patient_contacts for update to authenticated
  using (therapist_id = auth.uid())
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_contacts.patient_id
        and p.therapist_id = auth.uid()
    )
  );

drop policy if exists "Users can delete own patient media" on public.patient_media;
create policy "Users can delete own patient media"
  on public.patient_media for delete to authenticated
  using (therapist_id = auth.uid());

drop policy if exists "Users can insert own patient media" on public.patient_media;
create policy "Users can insert own patient media"
  on public.patient_media for insert to authenticated
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_media.patient_id
        and p.therapist_id = auth.uid()
    )
  );

drop policy if exists "Users can update own patient media" on public.patient_media;
create policy "Users can update own patient media"
  on public.patient_media for update to authenticated
  using (therapist_id = auth.uid())
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_media.patient_id
        and p.therapist_id = auth.uid()
    )
  );

drop policy if exists "Users can view own patient media" on public.patient_media;
create policy "Users can view own patient media"
  on public.patient_media for select to authenticated
  using (therapist_id = auth.uid());

drop policy if exists standardized_assessments_insert on public.standardized_assessments;
create policy standardized_assessments_insert
  on public.standardized_assessments for insert to authenticated
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = standardized_assessments.patient_id
        and p.therapist_id = auth.uid()
    )
  );

drop policy if exists standardized_assessments_update on public.standardized_assessments;
create policy standardized_assessments_update
  on public.standardized_assessments for update to authenticated
  using (therapist_id = auth.uid())
  with check (
    therapist_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = standardized_assessments.patient_id
        and p.therapist_id = auth.uid()
    )
  );

-- Restore the missing Storage policies. Objects must live in a user UUID folder.
drop policy if exists "PT Child media delete" on storage.objects;
create policy "PT Child media delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'patient-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "PT Child media insert" on storage.objects;
create policy "PT Child media insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "PT Child media select" on storage.objects;
create policy "PT Child media select"
  on storage.objects for select to authenticated
  using (bucket_id = 'patient-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "PT Child media update" on storage.objects;
create policy "PT Child media update"
  on storage.objects for update to authenticated
  using (bucket_id = 'patient-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'patient-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists specialist_logos_delete_own on storage.objects;
create policy specialist_logos_delete_own
  on storage.objects for delete to authenticated
  using (bucket_id = 'specialist-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists specialist_logos_insert_own on storage.objects;
create policy specialist_logos_insert_own
  on storage.objects for insert to authenticated
  with check (bucket_id = 'specialist-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists specialist_logos_select_own on storage.objects;
create policy specialist_logos_select_own
  on storage.objects for select to authenticated
  using (bucket_id = 'specialist-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists specialist_logos_update_own on storage.objects;
create policy specialist_logos_update_own
  on storage.objects for update to authenticated
  using (bucket_id = 'specialist-logos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'specialist-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- New signups must always receive a matching public.profiles row.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Least privilege for the browser roles. RLS remains the row-level boundary.
revoke all privileges on table
  public.ai_analysis_history, public.assessments, public.goals,
  public.parent_reports, public.patient_contacts, public.patient_media,
  public.patients, public.profiles, public.sessions,
  public.standardized_assessments, public.user_consents
from anon;

revoke all privileges on table
  public.ai_analysis_history, public.assessments, public.goals,
  public.parent_reports, public.patient_contacts, public.patient_media,
  public.patients, public.profiles, public.sessions,
  public.standardized_assessments, public.user_consents
from authenticated;

grant select, insert, update, delete on table
  public.ai_analysis_history, public.assessments, public.goals,
  public.parent_reports, public.patient_contacts, public.patient_media,
  public.patients, public.profiles, public.sessions,
  public.standardized_assessments, public.user_consents
to authenticated;

grant select, insert, update, delete on table storage.objects to authenticated;

commit;

-- Compact post-migration verification. Expected values: 5, 8, 1, 0, 44.
select
  (select count(*) from pg_constraint
    where contype = 'f'
      and conrelid in (
        'public.ai_analysis_history'::regclass,
        'public.parent_reports'::regclass,
        'public.patient_contacts'::regclass,
        'public.patient_media'::regclass,
        'public.standardized_assessments'::regclass
      )
      and confrelid = 'auth.users'::regclass) as new_user_fks,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'PT Child media delete', 'PT Child media insert',
        'PT Child media select', 'PT Child media update',
        'specialist_logos_delete_own', 'specialist_logos_insert_own',
        'specialist_logos_select_own', 'specialist_logos_update_own'
      )) as storage_policies,
  (select count(*) from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created' and not tgisinternal) as signup_triggers,
  (select count(*) from information_schema.table_privileges
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name in (
        'ai_analysis_history', 'assessments', 'goals', 'parent_reports',
        'patient_contacts', 'patient_media', 'patients', 'profiles',
        'sessions', 'standardized_assessments', 'user_consents'
      )) as anon_privileges,
  (select count(*) from information_schema.table_privileges
    where table_schema = 'public'
      and grantee = 'authenticated'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and table_name in (
        'ai_analysis_history', 'assessments', 'goals', 'parent_reports',
        'patient_contacts', 'patient_media', 'patients', 'profiles',
        'sessions', 'standardized_assessments', 'user_consents'
      )) as authenticated_crud_grants;

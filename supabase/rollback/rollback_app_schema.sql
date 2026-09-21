-- fizira: аварийный откат пустой схемы
-- внимание: удаляет таблицы fizira и находящиеся в них данные
-- не запускать после начала реальной эксплуатации

\set on_error_stop on

begin;

drop trigger if exists fizira_handle_new_user on auth.users;
drop function if exists public.handle_new_user();

drop policy if exists "PT Child media delete" on storage.objects;
drop policy if exists "PT Child media insert" on storage.objects;
drop policy if exists "PT Child media select" on storage.objects;
drop policy if exists "PT Child media update" on storage.objects;
drop policy if exists "specialist_logos_delete_own" on storage.objects;
drop policy if exists "specialist_logos_insert_own" on storage.objects;
drop policy if exists "specialist_logos_select_own" on storage.objects;
drop policy if exists "specialist_logos_update_own" on storage.objects;

delete from storage.buckets b
where b.id in ('patient-media', 'specialist-logos')
  and not exists (
      select 1 from storage.objects o where o.bucket_id = b.id
  );

drop table if exists public.ai_analysis_history cascade;
drop table if exists public.patient_media cascade;
drop table if exists public.parent_reports cascade;
drop table if exists public.patient_contacts cascade;
drop table if exists public.standardized_assessments cascade;
drop table if exists public.user_consents cascade;
drop table if exists public.goals cascade;
drop table if exists public.assessments cascade;
drop table if exists public.sessions cascade;
drop table if exists public.patients cascade;
drop table if exists public.profiles cascade;

commit;

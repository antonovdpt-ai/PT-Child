begin;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'ai_analysis_history', 'assessments', 'goals', 'parent_reports',
    'patient_contacts', 'patient_media', 'patients', 'profiles', 'sessions',
    'standardized_assessments', 'user_consents'
  ]
  loop
    execute format(
      'drop policy if exists account_must_be_active on public.%I',
      target_table
    );
  end loop;
end
$$;

drop policy if exists account_must_be_active on storage.objects;
drop function if exists public.account_is_active();
drop function if exists public.claim_account_deletion_jobs(integer, uuid);
drop table if exists public.account_deletion_jobs;

commit;

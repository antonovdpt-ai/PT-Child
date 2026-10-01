\set ON_ERROR_STOP on

select
  to_regclass('public.user_consents') is not null as user_consents_exists,
  to_regprocedure('public.record_legal_acceptances(jsonb,text)') is not null
    as recorder_exists,
  to_regprocedure('public.capture_signup_legal_acceptances()') is not null
    as signup_recorder_exists;

select exists (
  select 1
  from pg_trigger
  where tgrelid = 'auth.users'::regclass
    and tgname = 'fizira_capture_signup_legal_acceptances'
    and not tgisinternal
) as signup_trigger_exists;

select
  count(*) filter (
    where column_name in (
      'document_type', 'document_version', 'document_hash', 'source', 'accepted_at'
    )
  ) = 5 as acceptance_columns_present
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_consents';

select
  has_function_privilege(
    'authenticated',
    'public.record_legal_acceptances(jsonb,text)',
    'EXECUTE'
  ) as authenticated_can_record,
  not has_table_privilege(
    'authenticated',
    'public.user_consents',
    'INSERT'
  ) as direct_insert_is_blocked;

select
  count(*) filter (
    where document_type is not null and document_version is not null
  ) as per_document_records,
  count(*) filter (
    where document_type is null and terms_version is not null
  ) as preserved_legacy_records
from public.user_consents;

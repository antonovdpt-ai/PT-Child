-- fizira: проверка результата миграции
-- этот файл ничего не изменяет

\set on_error_stop on

with expected(name) as (
    values
        ('ai_analysis_history'), ('assessments'), ('goals'), ('parent_reports'),
        ('patient_contacts'), ('patient_media'), ('patients'), ('profiles'),
        ('sessions'), ('standardized_assessments'), ('user_consents')
)
select
    e.name as table_name,
    to_regclass(format('public.%I', e.name)) is not null as exists,
    coalesce(c.relrowsecurity, false) as rls_enabled
from expected e
left join pg_class c on c.oid = to_regclass(format('public.%I', e.name))
order by e.name;

select count(*) as public_policy_count
from pg_policies
where schemaname = 'public'
  and tablename in (
      'ai_analysis_history', 'assessments', 'goals', 'parent_reports',
      'patient_contacts', 'patient_media', 'patients', 'profiles', 'sessions',
      'standardized_assessments', 'user_consents'
  );

select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in (
      'PT Child media delete', 'PT Child media insert',
      'PT Child media select', 'PT Child media update',
      'specialist_logos_delete_own', 'specialist_logos_insert_own',
      'specialist_logos_select_own', 'specialist_logos_update_own'
  )
order by policyname;

select id, name, public
from storage.buckets
where id in ('patient-media', 'specialist-logos')
order by id;

select tgname as auth_trigger
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and tgname = 'fizira_handle_new_user'
  and not tgisinternal;

select
    has_table_privilege('authenticated', 'public.patients', 'select') as authenticated_can_select,
    has_table_privilege('authenticated', 'public.patients', 'insert') as authenticated_can_insert,
    has_table_privilege('service_role', 'public.patients', 'select') as service_role_can_select;

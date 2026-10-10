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

-- Parent identity boundary (008). Fail closed on missing RLS or excess grants.
do $$
declare
    table_name text;
    function_record record;
    trigger_record record;
begin
    foreach table_name in array array[
        'app_user_roles','legal_document_versions','parent_child_access','parent_invitations','parent_consent_audit'
    ] loop
        if not coalesce((select relrowsecurity from pg_class
            where oid=to_regclass(format('public.%I',table_name))),false) then
            raise exception 'Missing parent table or RLS: %',table_name;
        end if;
        if has_table_privilege('authenticated',format('public.%I',table_name),'INSERT,UPDATE,DELETE,TRUNCATE')
           or has_table_privilege('anon',format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
           or has_table_privilege('service_role',format('public.%I',table_name),'INSERT,UPDATE,DELETE,TRUNCATE') then
            raise exception 'Unexpected direct parent identity grants: %',table_name;
        end if;
    end loop;
    if has_table_privilege('authenticated','public.parent_consent_audit','SELECT') then
        raise exception 'Unexpected browser parent consent audit read grant';
    end if;
    for trigger_record in
        select * from (values
            ('public.user_consents','preserve_prior_parent_consent','public.preserve_prior_parent_consent()',19),
            ('public.parent_consent_audit','parent_consent_audit_append_only','public.reject_parent_consent_audit_mutation()',58)
        ) t(table_name,trigger_name,function_signature,trigger_type)
    loop
        if not exists(select 1 from pg_trigger t join pg_proc f on f.oid=t.tgfoid
            where t.tgrelid=to_regclass(trigger_record.table_name)
              and t.tgname=trigger_record.trigger_name and t.tgenabled in ('O','A')
              and t.tgtype=trigger_record.trigger_type
              and f.oid=to_regprocedure(trigger_record.function_signature)
              and f.prosecdef and f.proconfig=array['search_path=pg_catalog, public'])
            or has_function_privilege('anon',to_regprocedure(trigger_record.function_signature),'EXECUTE')
            or has_function_privilege('authenticated',to_regprocedure(trigger_record.function_signature),'EXECUTE')
            or has_function_privilege('service_role',to_regprocedure(trigger_record.function_signature),'EXECUTE') then
            raise exception 'Unsafe parent consent audit trigger: %',trigger_record.trigger_name;
        end if;
    end loop;
    if exists(select 1 from pg_constraint where conrelid='public.parent_consent_audit'::regclass and contype='f') then
        raise exception 'Parent consent audit must not have lifecycle foreign keys';
    end if;
    for function_record in
        select signature, service_only, to_regprocedure(signature) as oid
        from (values
            ('public.current_app_roles()',false),
            ('public.parent_has_active_access(uuid,uuid)',false),
            ('public.parent_invitation_state(text)',false),
            ('public.accept_parent_invitation(text,jsonb)',false),
            ('public.issue_parent_invitation_record(uuid,uuid,uuid,text,text)',true),
            ('public.revoke_parent_access_record(uuid,uuid)',true)
        ) f(signature,service_only)
    loop
        if function_record.oid is null then raise exception 'Missing RPC: %',function_record.signature; end if;
        if not exists(select 1 from pg_proc where oid=function_record.oid
            and prosecdef and proconfig=array['search_path=pg_catalog, public'])
            or has_function_privilege('anon',function_record.oid,'EXECUTE')
            or has_function_privilege('authenticated',function_record.oid,'EXECUTE')=function_record.service_only
            or has_function_privilege('service_role',function_record.oid,'EXECUTE')<>function_record.service_only then
            raise exception 'Unsafe RPC configuration/grants: %',function_record.signature;
        end if;
    end loop;
    if exists(select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name='parent_invitations'
          and c.column_name like '%token%' and c.column_name<>'token_digest') then
        raise exception 'Unexpected raw-token column';
    end if;
end;
$$;

select document_type,document_version,document_hash,public_url,is_required
from public.legal_document_versions where is_active order by document_type;

-- Review against the pre-migration baseline: no parent SELECT policy belongs here.
select tablename,policyname,cmd,roles,qual,with_check
from pg_policies where schemaname='public' and tablename in (
    'patients','assessments','sessions','goals','patient_media','parent_reports','standardized_assessments'
) order by tablename,policyname;

-- Parent publication boundary (009). This read-only assertion block fails closed.
do $$
declare
    table_name text;
    signature text;
    function_oid oid;
    trigger_record record;
    policy_record record;
    expected_command text;
    expected_bucket text;
    allowed_predicates text[];
    normalized_qual text;
    normalized_check text;
begin
    foreach table_name in array array[
        'parent_session_reports','parent_session_report_media','parent_goal_publications','parent_notifications'
    ] loop
        if not coalesce((select relrowsecurity from pg_class where oid=to_regclass(format('public.%I',table_name))),false)
            or has_table_privilege('anon',format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
            or has_table_privilege('authenticated',format('public.%I',table_name),'TRUNCATE') then
            raise exception 'Unsafe parent publication grants/RLS: %',table_name;
        end if;
        if (select count(*) from pg_policies where schemaname='public' and tablename=table_name)<>2
            or not exists(select 1 from pg_policies where schemaname='public' and tablename=table_name
                and policyname='account_must_be_active' and permissive='RESTRICTIVE' and cmd='ALL'
                and roles=array['authenticated']::name[] and qual='account_is_active()' and with_check='account_is_active()')
            or not exists(select 1 from pg_policies where schemaname='public' and tablename=table_name
                and policyname='specialist_own' and permissive='PERMISSIVE'
                and cmd=case when table_name='parent_notifications' then 'SELECT' else 'ALL' end
                and roles=array['authenticated']::name[]
                and qual like '%therapist_id = auth.uid()%'
                and qual like '%specialist%'
                and qual like '%patients%'
                and (table_name='parent_notifications' or with_check=qual)) then
            raise exception 'Unsafe parent publication policy: %',table_name;
        end if;
    end loop;
    foreach signature in array array[
        'public.parent_portal_children()','public.parent_portal_dashboard(uuid)',
        'public.parent_portal_schedule(uuid,text)','public.parent_portal_reports(uuid)',
        'public.parent_portal_report(uuid)','public.parent_portal_goals(uuid)',
        'public.parent_portal_dynamics(uuid)','public.parent_portal_notifications(uuid)',
        'public.parent_mark_notifications_read(uuid[])'
    ] loop
        function_oid := to_regprocedure(signature);
        if function_oid is null then raise exception 'Missing parent projection RPC: %',signature; end if;
        if not exists(select 1 from pg_proc where oid=function_oid and prosecdef
            and proconfig=array['search_path=pg_catalog, public'])
            or not has_function_privilege('authenticated',function_oid,'EXECUTE')
            or has_function_privilege('anon',function_oid,'EXECUTE')
            or has_function_privilege('service_role',function_oid,'EXECUTE') then
            raise exception 'Unsafe parent projection RPC: %',signature;
        end if;
    end loop;
    foreach signature in array array[
        'public.parent_report_projection(uuid)','public.check_parent_publication_owner()',
        'public.guard_parent_report_publication()','public.check_parent_selected_media()',
        'public.notify_parent_publication_or_appointment()'
    ] loop
        function_oid := to_regprocedure(signature);
        if function_oid is null then raise exception 'Missing internal publication function: %',signature; end if;
        if not exists(select 1 from pg_proc where oid=function_oid and prosecdef
            and proconfig=array['search_path=pg_catalog, public'])
            or has_function_privilege('authenticated',function_oid,'EXECUTE')
            or has_function_privilege('anon',function_oid,'EXECUTE')
            or has_function_privilege('service_role',function_oid,'EXECUTE') then
            raise exception 'Unsafe internal publication function: %',signature;
        end if;
    end loop;
    for trigger_record in select * from (values
        ('parent_reports','guard_parent_report_publication',31),
        ('parent_session_reports','guard_parent_report_publication',31),
        ('parent_reports','check_parent_publication_owner',23),
        ('parent_session_reports','check_parent_publication_owner',23),
        ('parent_goal_publications','check_parent_publication_owner',23),
        ('parent_session_report_media','check_parent_selected_media',31),
        ('parent_reports','notify_parent_publication_or_appointment',21),
        ('parent_session_reports','notify_parent_publication_or_appointment',21),
        ('appointments','notify_parent_publication_or_appointment',21)
    ) t(table_name,trigger_name,trigger_type) loop
        if not exists(select 1 from pg_trigger where tgrelid=to_regclass(format('public.%I',trigger_record.table_name))
            and tgname=trigger_record.trigger_name and tgenabled in ('O','A') and tgtype=trigger_record.trigger_type
            and tgfoid=to_regprocedure(format('public.%I()',trigger_record.trigger_name))) then
            raise exception 'Missing publication guard trigger: %.%',trigger_record.table_name,trigger_record.trigger_name;
        end if;
    end loop;
    foreach table_name in array array['parent_reports','parent_session_reports'] loop
        if not exists(select 1 from pg_constraint where conrelid=to_regclass(format('public.%I',table_name))
            and conname=table_name||'_publication_check' and contype='c' and convalidated) then
            raise exception 'Missing publication state constraint: %',table_name;
        end if;
    end loop;
    -- All legacy clinical policies constrain the therapist actor. No parent
    -- relation/helper or broad OR predicate may widen a permissive source policy.
    if exists(select 1 from pg_policies where schemaname='public'
        and tablename in ('patients','assessments','sessions','goals','patient_media','parent_reports','standardized_assessments')
        and permissive='PERMISSIVE' and (
            roles<>array['authenticated']::name[]
            or (qual is not null and qual not like '%therapist_id = auth.uid()%')
            or (with_check is not null and with_check not like '%therapist_id = auth.uid()%')
            or coalesce(qual,'')||coalesce(with_check,'') ~* 'parent_has_active_access|parent_child_access|\mor\M'
        )) then
        raise exception 'Clinical source policy must remain specialist-only';
    end if;
    for policy_record in select * from pg_policies where schemaname='storage' and tablename='objects' order by policyname loop
        normalized_qual := lower(regexp_replace(coalesce(policy_record.qual,''),'[[:space:]]','','g'));
        normalized_check := lower(regexp_replace(coalesce(policy_record.with_check,''),'[[:space:]]','','g'));
        -- 010 is optional at this stage; its known restrictive write guards
        -- are accepted only once its service claim protocol exists.
        if policy_record.policyname in ('parent_artifacts_insert','parent_artifacts_update','parent_artifacts_delete')
            and to_regprocedure('public.claim_parent_publication(uuid,uuid,text)') is not null then
            expected_command := case policy_record.policyname when 'parent_artifacts_insert' then 'INSERT' when 'parent_artifacts_update' then 'UPDATE' else 'DELETE' end;
            allowed_predicates := array['parent_storage_write_allowed(bucket_id,name)','public.parent_storage_write_allowed(bucket_id,name)'];
            if policy_record.permissive<>'RESTRICTIVE' or policy_record.roles<>array['authenticated']::name[]
                or policy_record.cmd<>expected_command
                or (expected_command in ('UPDATE','DELETE') and not normalized_qual=any(allowed_predicates))
                or (expected_command='INSERT' and normalized_qual<>'')
                or (expected_command in ('INSERT','UPDATE') and not normalized_check=any(allowed_predicates))
                or (expected_command='DELETE' and normalized_check<>'') then
                raise exception 'Unsafe publication Storage policy';
            end if;
            continue;
        end if;
        if policy_record.policyname='specialist_role_required' and to_regprocedure('public.specialist_storage_access(text)') is not null then
            if policy_record.permissive<>'RESTRICTIVE' or policy_record.cmd<>'ALL' or policy_record.roles<>array['authenticated']::name[]
                or normalized_qual not in ('specialist_storage_access(bucket_id)','public.specialist_storage_access(bucket_id)') or normalized_check<>normalized_qual then
                raise exception 'Unsafe specialist role Storage policy';
            end if;
            continue;
        end if;
        if policy_record.policyname='account_must_be_active' then
            if policy_record.permissive<>'RESTRICTIVE' or policy_record.cmd<>'ALL'
                or policy_record.roles<>array['authenticated']::name[]
                or normalized_qual not in ('account_is_active()','public.account_is_active()')
                or normalized_check<>normalized_qual then
                raise exception 'Unsafe Storage account policy';
            end if;
            continue;
        end if;
        select command,bucket into expected_command,expected_bucket from (values
            ('PT Child media delete','DELETE','patient-media'),('PT Child media insert','INSERT','patient-media'),
            ('PT Child media select','SELECT','patient-media'),('PT Child media update','UPDATE','patient-media'),
            ('specialist_logos_delete_own','DELETE','specialist-logos'),('specialist_logos_insert_own','INSERT','specialist-logos'),
            ('specialist_logos_select_own','SELECT','specialist-logos'),('specialist_logos_update_own','UPDATE','specialist-logos')
        ) baseline(name,command,bucket) where name=policy_record.policyname;
        if not found then raise exception 'Parent Storage policy is forbidden: %',policy_record.policyname; end if;
        -- Compare the whole audited predicate, not just name or contained tokens.
        -- PostgreSQL's canonical deparsed expression preserves function calls;
        -- only whitespace/case differ. Both audited direct auth.uid() and its
        -- initplan SELECT form are explicitly accepted, not token substrings.
        allowed_predicates := array[
            format('((bucket_id=%L::text)and((storage.foldername(name))[1]=(auth.uid())::text))',expected_bucket),
            format('((bucket_id=%L::text)and((storage.foldername(name))[1]=(select(auth.uid())::textasuid)))',expected_bucket)
        ];
        if policy_record.permissive<>'PERMISSIVE' or policy_record.cmd<>expected_command
            or policy_record.roles<>array['authenticated']::name[]
            or (expected_command in ('SELECT','DELETE','UPDATE') and not normalized_qual=any(allowed_predicates))
            or (expected_command='INSERT' and normalized_qual<>'')
            or (expected_command in ('INSERT','UPDATE') and not normalized_check=any(allowed_predicates))
            or (expected_command in ('SELECT','DELETE') and normalized_check<>'') then
            raise exception 'Unsafe specialist Storage policy: %',policy_record.policyname;
        end if;
    end loop;
    if not coalesce((select relrowsecurity from pg_class where oid=to_regclass('storage.objects')),false)
        or (select count(*) from pg_policies where schemaname='storage' and tablename='objects')<>(case when to_regprocedure('public.claim_parent_publication(uuid,uuid,text)') is null then 9 else 12 end)+(case when to_regprocedure('public.specialist_storage_access(text)') is null then 0 else 1 end) then
        raise exception 'Unsafe Storage account policy or missing specialist Storage baseline';
    end if;
end;
$$;

-- Parent immutable artifact protocol (010). Optional during the 009 rollout.
do $$
declare fn record; claim_table text;
begin
 if to_regprocedure('public.claim_parent_publication(uuid,uuid,text)') is null then return; end if;
 for fn in select signature from (values
  ('public.claim_parent_publication(uuid,uuid,text)'),
  ('public.complete_parent_publication(uuid,uuid,text,uuid,integer,text,jsonb)'),
  ('public.fail_parent_publication(uuid,uuid,text,uuid,integer)'),
  ('public.resolve_parent_publication_file(uuid,uuid,text,uuid)')
 ) required(signature) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(fn.signature) and prosecdef and proconfig=array['search_path=pg_catalog, public'])
   or has_function_privilege('anon',fn.signature,'execute') or has_function_privilege('authenticated',fn.signature,'execute')
   or not has_function_privilege('service_role',fn.signature,'execute') then raise exception 'Unsafe publication service contract: %',fn.signature; end if;
 end loop;
 foreach claim_table in array array['parent_reports','parent_session_reports'] loop
  if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||claim_table) and conname=claim_table||'_artifact_check' and contype='c' and convalidated and regexp_replace(pg_get_constraintdef(oid),'[[:space:]]','','g')=$constraint$CHECK((((pdf_sha256ISNULL)OR(pdf_sha256~'^[a-f0-9]{64}$'::text))AND((publication_claim_idISNULL)OR((publication_claimed_atISNOTNULL)AND((publication_status<>'published'::text)OR(pdf_sha256ISNOTNULL))))))$constraint$) then raise exception 'Missing publication digest constraint'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and information_schema.columns.table_name=claim_table and column_name in ('publication_claim_id','publication_claimed_at','pdf_sha256'))<>3 then raise exception 'Missing publication claim columns'; end if;
 end loop;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.guard_parent_report_publication()') and prosrc like '%publication_claim_id%publication_claimed_at%pdf_sha256%' and prosrc like '%old.publication_status=''publishing''%Publishing author fields are immutable%') then raise exception 'Missing publication claim guard'; end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.parent_storage_write_allowed(text,text)') and prosecdef and proconfig=array['search_path=pg_catalog, public']
  and regexp_replace(prosrc,'[[:space:]]','','g')=$guard$selectp_bucket<>'patient-media'or(split_part(p_name,'/',2)<>'parent-reports'andnotexists(select1frompublic.parent_session_reportsrcrossjoinlateraljsonb_array_elements(r.published_media)mwherer.publication_status='publishing'andm->>'storage_path'=p_name))$guard$) then
  raise exception 'Unsafe publication Storage policy helper';
 end if;
end;
$$;


-- Parent specialist role boundary (011). REQUIRED for latest release verification.
do $$
declare table_name text; fn record; expected_source text; actual_source text; trigger_record record;
begin
 foreach table_name in array array['patients','goals','sessions','assessments','standardized_assessments','ai_analysis_history','patient_contacts','patient_media','parent_reports','appointments'] loop
  if not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.'||table_name)),false)
   or not exists(select 1 from pg_policies where schemaname='public' and tablename=table_name and policyname='specialist_role_required'
    and permissive='RESTRICTIVE' and cmd='ALL' and roles=array['authenticated']::name[]
    and regexp_replace(qual,'[[:space:]]','','g') in ('specialist_source_access()','public.specialist_source_access()')
    and regexp_replace(with_check,'[[:space:]]','','g')=regexp_replace(qual,'[[:space:]]','','g')) then raise exception 'Missing or unsafe specialist role intersection: %',table_name; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename=table_name and permissive='PERMISSIVE'
    and (roles<>array['authenticated']::name[] or (qual is not null and qual not like '%therapist_id = auth.uid()%')
      or (with_check is not null and with_check not like '%therapist_id = auth.uid()%')
      or coalesce(qual,'')||coalesce(with_check,'') ~* 'parent_has_active_access|parent_child_access|or[[:space:]]+true')) then raise exception 'Unsafe clinical source owner policy'; end if;
 end loop;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='specialist_role_required'
  and permissive='RESTRICTIVE' and cmd='ALL' and roles=array['authenticated']::name[]
  and regexp_replace(qual,'[[:space:]]','','g') in ('specialist_storage_access(bucket_id)','public.specialist_storage_access(bucket_id)')
  and regexp_replace(with_check,'[[:space:]]','','g')=regexp_replace(qual,'[[:space:]]','','g')) then raise exception 'Missing specialist role Storage intersection'; end if;
 for fn in select * from (values
  ('public.specialist_source_access()',$body$select public.account_is_active() and exists(select 1 from public.app_user_roles where user_id=auth.uid() and role='specialist')$body$),
  ('public.specialist_storage_access(text)',$body$select p_bucket not in ('patient-media','specialist-logos') or public.specialist_source_access()$body$)
 ) helpers(signature,body) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(fn.signature) and prosecdef and proconfig=array['search_path=pg_catalog, public']
    and regexp_replace(prosrc,'[[:space:]]','','g')=regexp_replace(fn.body,'[[:space:]]','','g'))
    or has_function_privilege('anon',fn.signature,'execute') or not has_function_privilege('authenticated',fn.signature,'execute') then raise exception 'Unsafe specialist role helper'; end if;
 end loop;
 if not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.parent_signup_reservations')),false) then raise exception 'Missing private parent signup reservation'; end if;
 if exists(select 1 from information_schema.role_table_grants where table_schema='public' and information_schema.role_table_grants.table_name='parent_signup_reservations' and grantee in ('PUBLIC','anon','authenticated','service_role'))
   or exists(select 1 from pg_policies where schemaname='public' and tablename='parent_signup_reservations') then raise exception 'Unsafe parent signup reservation grants'; end if;
 for trigger_record in select * from (values ('auth','users','provision_ordinary_specialist',5),('public','parent_invitations','reserve_parent_signup',7),('public','parent_goal_publications','notify_parent_goal_publication',21)) t(schema_name,table_name,name,type) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(trigger_record.schema_name||'.'||trigger_record.table_name)
   and tgname=trigger_record.name and tgenabled in ('O','A') and tgtype=trigger_record.type and tgfoid=to_regprocedure('public.'||trigger_record.name||'()')) then raise exception 'Missing signup/goal trigger: %',trigger_record.name; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.'||trigger_record.name||'()') and prosecdef and proconfig=array['search_path=pg_catalog, public'])
   or has_function_privilege('authenticated','public.'||trigger_record.name||'()','execute') or has_function_privilege('anon','public.'||trigger_record.name||'()','execute') or has_function_privilege('service_role','public.'||trigger_record.name||'()','execute') then raise exception 'Unsafe signup/goal function'; end if;
 end loop;
 for fn in select * from (values
('public.reserve_parent_signup()',$body$
begin
 if new.auth_flow='new' then
  perform pg_advisory_xact_lock(hashtextextended('fizira-parent-signup:'||new.email_normalized,0));
  insert into public.parent_signup_reservations(email_normalized) values(new.email_normalized) on conflict do nothing;
 end if;
 return new;
end; $body$),
('public.provision_ordinary_specialist()',$body$
declare normalized_email text := lower(btrim(new.email));
begin
 if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or to_jsonb(new)->>'invited_at' is not null or coalesce(to_jsonb(new)->>'is_anonymous','false')='true' then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('fizira-parent-signup:'||normalized_email,0));
 if exists(select 1 from public.parent_signup_reservations where email_normalized=normalized_email)
  or exists(select 1 from public.app_user_roles where user_id=new.id and role='parent') then return new; end if;
 insert into public.app_user_roles(user_id,role) values(new.id,'specialist') on conflict do nothing;
 return new;
end; $body$),
('public.notify_parent_goal_publication()',$body$
begin
 if new.published_at is null or new.unpublished_at is not null then return new; end if;
 if tg_op='UPDATE' and old.published_at is not null and old.unpublished_at is null
  and new.title is not distinct from old.title and new.description is not distinct from old.description
  and new.status is not distinct from old.status
  and new.baseline is not distinct from old.baseline and new.criterion is not distinct from old.criterion
  and new.deadline is not distinct from old.deadline and new.progress is not distinct from old.progress then return new; end if;
 insert into public.parent_notifications(parent_user_id,patient_id,therapist_id,type,title,body,entity_type,entity_id)
  select a.parent_user_id,new.patient_id,new.therapist_id,'goal_published','Опубликована цель','Новая или обновлённая цель доступна в кабинете родителя.','goal',new.id
  from public.parent_child_access a
  join public.app_user_roles r on r.user_id=a.parent_user_id and r.role='parent'
  join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id
  where a.patient_id=new.patient_id and a.therapist_id=new.therapist_id and a.status='active'
   and not exists(select 1 from public.account_deletion_jobs j where j.user_id in(a.parent_user_id,a.therapist_id));
 return new;
end; $body$)
 ) bodies(signature,body) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(fn.signature) and regexp_replace(prosrc,'[[:space:]]','','g')=regexp_replace(fn.body,'[[:space:]]','','g')) then raise exception 'Unsafe signup/goal function body'; end if;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.parent_notifications'::regclass and conname='parent_notifications_type_check' and contype='c' and convalidated and regexp_replace(pg_get_constraintdef(oid),'[[:space:]]','','g')=$constraint$CHECK((type=ANY(ARRAY['report_published'::text,'appointment_created'::text,'appointment_changed'::text,'goal_published'::text])))$constraint$)
  or not exists(select 1 from pg_constraint where conrelid='public.parent_notifications'::regclass and conname='parent_notifications_entity_type_check' and contype='c' and convalidated and regexp_replace(pg_get_constraintdef(oid),'[[:space:]]','','g')=$constraint$CHECK((entity_type=ANY(ARRAY['initial_report'::text,'session_report'::text,'appointment'::text,'goal'::text])))$constraint$) then raise exception 'Missing goal notification constraints'; end if;
end; $$;

-- Parent publication withdrawal boundary (012).
do $verify$
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.guard_parent_report_publication()')
   and prosecdef and proconfig=array['search_path=pg_catalog, public']
   and regexp_replace(prosrc,'[[:space:]]','','g')=regexp_replace($body$
declare
  metadata_keys text[] := array['publication_status','published_at','published_by','published_snapshot',
    'pdf_storage_path','pdf_generated_at','publication_error','publication_revision','published_media','publication_claim_id','publication_claimed_at','pdf_sha256'];
  key text;
begin
  if tg_op='DELETE' then
    if old.publication_status='publishing' and exists(select 1 from public.patients where id=old.patient_id) and exists(select 1 from auth.users where id=old.therapist_id) then raise exception 'Publishing report is immutable'; end if;
    if old.published_at is not null
      and exists(select 1 from public.patients p where p.id=old.patient_id)
      and exists(select 1 from auth.users u where u.id=old.therapist_id) then
      raise exception 'Published report is immutable; archive it or create a new draft' using errcode='23514';
    end if;
    -- Explicit patient/account lifecycle deletion may cascade the publication.
    return old;
  end if;
  if tg_op='UPDATE' and old.published_at is not null then
    if (to_jsonb(new)-array['publication_status','updated_at']) is distinct from
       (to_jsonb(old)-array['publication_status','updated_at'])
       or (new.publication_status is distinct from old.publication_status and
           not (old.publication_status='published' and new.publication_status='archived')) then
      raise exception 'Published report content and PDF are immutable; create a new draft' using errcode='23514';
    end if;
  end if;
  if tg_op='UPDATE' and old.publication_status='publishing' then
    if (to_jsonb(new)-metadata_keys-array['updated_at']) is distinct from (to_jsonb(old)-metadata_keys-array['updated_at']) then
      raise exception 'Publishing author fields are immutable';
    end if;
  end if;
  if current_setting('role',true)='authenticated' then
    if tg_op='UPDATE' and old.publication_status='publishing' then raise exception 'Publishing report is immutable'; end if;
    if tg_op='INSERT' then
      if new.publication_status<>'draft' or new.published_at is not null or new.published_by is not null
        or new.published_snapshot is not null or new.pdf_storage_path is not null
        or new.pdf_generated_at is not null or new.publication_error is not null
        or new.publication_claim_id is not null or new.publication_claimed_at is not null or new.pdf_sha256 is not null then
        raise exception 'Publication metadata is server-only' using errcode='42501';
      end if;
      if tg_table_name='parent_session_reports' then
        if new.published_media<>'[]'::jsonb then
          raise exception 'Publication media metadata is server-only' using errcode='42501';
        end if;
      end if;
    else
      foreach key in array metadata_keys loop
        if to_jsonb(new)->key is distinct from to_jsonb(old)->key
          and not (key='publication_status' and old.publication_status='published' and new.publication_status='archived') then
          raise exception 'Publication metadata is server-only' using errcode='42501';
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$body$,'[[:space:]]','','g')) then
   raise exception 'Unsafe publication withdrawal guard';
 end if;
end; $verify$;

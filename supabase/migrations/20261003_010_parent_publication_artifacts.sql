-- Additive server claim/artifact protocol. Apply only after 008 and 009.
begin;
set local lock_timeout='10s';
set local statement_timeout='5min';
alter table public.parent_reports
 add column if not exists publication_claim_id uuid,
 add column if not exists publication_claimed_at timestamptz,
 add column if not exists pdf_sha256 text;
alter table public.parent_session_reports
 add column if not exists publication_claim_id uuid,
 add column if not exists publication_claimed_at timestamptz,
 add column if not exists pdf_sha256 text;
-- Legacy 009 publications remain listable, but cannot hand off a file without
-- a verified 010 digest. New claimed publications require complete artifact metadata.
alter table public.parent_reports drop constraint if exists parent_reports_artifact_check;
alter table public.parent_reports add constraint parent_reports_artifact_check check(
 (pdf_sha256 is null or pdf_sha256 ~ '^[a-f0-9]{64}$') and
 (publication_claim_id is null or (publication_claimed_at is not null and
   (publication_status<>'published' or pdf_sha256 is not null)))
);
alter table public.parent_session_reports drop constraint if exists parent_session_reports_artifact_check;
alter table public.parent_session_reports add constraint parent_session_reports_artifact_check check(
 (pdf_sha256 is null or pdf_sha256 ~ '^[a-f0-9]{64}$') and
 (publication_claim_id is null or (publication_claimed_at is not null and
   (publication_status<>'published' or pdf_sha256 is not null)))
);
create or replace function public.guard_parent_report_publication()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
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
        if to_jsonb(new)->key is distinct from to_jsonb(old)->key then
          raise exception 'Publication metadata is server-only' using errcode='42501';
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$$;
create or replace function public.check_parent_selected_media()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare report_record public.parent_session_reports%rowtype;
begin
  -- Locks serialize publication against selections; never change a published selection.
  if tg_op in ('UPDATE','DELETE') then
    select * into report_record from public.parent_session_reports where id=old.parent_session_report_id for update;
    if (report_record.published_at is not null or report_record.publication_status='publishing')
      and exists(select 1 from public.patients p where p.id=report_record.patient_id)
      and exists(select 1 from auth.users u where u.id=report_record.therapist_id) then
      raise exception 'Published report media selection is immutable' using errcode='23514';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  select * into report_record from public.parent_session_reports where id=new.parent_session_report_id for update;
  if (report_record.published_at is not null or report_record.publication_status='publishing') then
    raise exception 'Published report media selection is immutable' using errcode='23514';
  end if;
  if report_record.id is null or report_record.patient_id<>new.patient_id or report_record.therapist_id<>new.therapist_id
    or not exists(select 1 from public.patient_media m where m.id=new.patient_media_id
      and m.patient_id=new.patient_id and m.therapist_id=new.therapist_id and m.media_type='photo') then
    raise exception 'Selected image media ownership mismatch' using errcode='23514';
  end if;
  return new;
end;
$$;



-- A restrictive guard intersects the existing specialist folder policies.
-- SELECT remains unchanged; parent users receive no direct Storage policy.
create or replace function public.parent_storage_write_allowed(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_bucket<>'patient-media' or (
   split_part(p_name,'/',2)<>'parent-reports' and not exists(
     select 1 from public.parent_session_reports r cross join lateral jsonb_array_elements(r.published_media) m
     where r.publication_status='publishing' and m->>'storage_path'=p_name
   )
 )
$$;

drop policy if exists parent_artifacts_insert on storage.objects;
create policy parent_artifacts_insert on storage.objects as restrictive for insert to authenticated
 with check(public.parent_storage_write_allowed(bucket_id,name));
drop policy if exists parent_artifacts_update on storage.objects;
create policy parent_artifacts_update on storage.objects as restrictive for update to authenticated
 using(public.parent_storage_write_allowed(bucket_id,name)) with check(public.parent_storage_write_allowed(bucket_id,name));
drop policy if exists parent_artifacts_delete on storage.objects;
create policy parent_artifacts_delete on storage.objects as restrictive for delete to authenticated
 using(public.parent_storage_write_allowed(bucket_id,name));

create or replace function public.claim_parent_publication(p_therapist_id uuid,p_report_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare table_name text; r record; child record; signature jsonb; snapshot jsonb; media jsonb:='[]'; source record; obj jsonb; revision integer; claim uuid:=gen_random_uuid(); keys text[]; key text;
begin
 if p_kind not in ('initial','session') or p_kind is null then raise exception 'Request could not be completed'; end if;
 table_name:=case p_kind when 'initial' then 'parent_reports' else 'parent_session_reports' end;
 execute format('select * from public.%I where id=$1 and therapist_id=$2 for update',table_name) into r using p_report_id,p_therapist_id;
 if r.id is null or not exists(select 1 from public.app_user_roles where user_id=p_therapist_id and role='specialist')
  or exists(select 1 from public.account_deletion_jobs where user_id=p_therapist_id) then raise exception 'Request could not be completed'; end if;
 select * into child from public.patients where id=r.patient_id and therapist_id=p_therapist_id for share;
 if child.id is null then raise exception 'Request could not be completed'; end if;
 if r.publication_status='published' then return jsonb_build_object('publication_status','published','generated_at',r.pdf_generated_at); end if;
 if r.publication_status='archived' or (r.publication_status='publishing' and r.publication_claimed_at>now()-interval '15 minutes') then raise exception 'Request could not be completed'; end if;
 revision:=r.publication_revision+case when r.publication_claim_id is null then 0 else 1 end;
 keys:=case p_kind when 'initial' then array['complaint','strengths','observations','goals','progress','recommendations','therapist_name','therapist_profession','therapist_organization','therapist_phone'] else array['what_did','what_worked','attention','home_recommendations'] end;
 snapshot:=jsonb_build_object('schema_version',1,'report_kind',p_kind,'revision',revision,'source_date',r.created_at::date,'child_name',child.display_name);
 foreach key in array keys loop snapshot:=snapshot||jsonb_build_object(key,to_jsonb(r)->key); end loop;
 if p_kind='session' then
  select snapshot||jsonb_build_object('source_date',coalesce(to_jsonb(s)->>'session_date',r.created_at::date::text)) into snapshot from public.sessions s where s.id=r.session_id and s.patient_id=r.patient_id and s.therapist_id=p_therapist_id for share;
  if snapshot is null then
   snapshot:=jsonb_build_object('schema_version',1,'report_kind',p_kind,'revision',revision,'source_date',r.created_at::date,'child_name',child.display_name);
   foreach key in array keys loop snapshot:=snapshot||jsonb_build_object(key,to_jsonb(r)->key); end loop;
  end if;
  select jsonb_build_object('therapist_name',full_name,'therapist_profession',profession,'therapist_organization',organization,'therapist_phone',phone) into signature from public.profiles where id=p_therapist_id for share;
  snapshot:=snapshot||coalesce(signature,'{}'::jsonb);
  for source in select s.* from public.parent_session_report_media m join public.patient_media s on s.id=m.patient_media_id where m.parent_session_report_id=r.id order by m.position,m.id for share of s loop
   if source.patient_id<>r.patient_id or source.therapist_id<>p_therapist_id or source.media_type<>'photo' or source.storage_path not like p_therapist_id::text||'/%' or split_part(source.storage_path,'/',2)='parent-reports' then raise exception 'Request could not be completed'; end if;
   select jsonb_build_object('id',o.id,'version',to_jsonb(o)->'version','updated_at',to_jsonb(o)->'updated_at','metadata',to_jsonb(o)->'metadata') into obj from storage.objects o where bucket_id='patient-media' and name=source.storage_path for share;
   if obj is null or obj->>'version' is null or obj->>'updated_at' is null or obj->'metadata'->>'eTag' is null or obj->'metadata'->>'eTag' !~ '^"[^"]+"$' then raise exception 'Request could not be completed'; end if;
   media:=media||jsonb_build_array(jsonb_build_object('id',source.id,'storage_path',source.storage_path,'media_type','photo','source_object',obj));
  end loop;
  update public.parent_session_reports set published_media=media where id=r.id;
 end if;
 execute format('update public.%I set publication_status=''publishing'',publication_claim_id=$2,publication_claimed_at=now(),publication_revision=$3,published_snapshot=$4,publication_error=null,pdf_storage_path=null,pdf_generated_at=null,pdf_sha256=null where id=$1',table_name) using r.id,claim,revision,snapshot;
 return jsonb_build_object('publication_status','publishing','claim_id',claim,'revision',revision,'snapshot',snapshot,'media',media);
end;
$$;

create or replace function public.complete_parent_publication(p_therapist_id uuid,p_report_id uuid,p_kind text,p_claim_id uuid,p_revision integer,p_pdf_sha256 text,p_media jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare table_name text; r record; expected text; media jsonb; frozen jsonb; actual jsonb; artifact jsonb; verified jsonb:='[]'; count integer:=0;
begin
 if p_kind not in ('initial','session') or p_kind is null then raise exception 'Request could not be completed'; end if;
 table_name:=case p_kind when 'initial' then 'parent_reports' else 'parent_session_reports' end;
 execute format('select * from public.%I where id=$1 and therapist_id=$2 for update',table_name) into r using p_report_id,p_therapist_id;
 if r.id is null or r.publication_status<>'publishing' or r.publication_claim_id is distinct from p_claim_id or r.publication_revision<>p_revision
  or p_pdf_sha256 is null or p_pdf_sha256!~'^[a-f0-9]{64}$'
  or not exists(select 1 from public.app_user_roles where user_id=p_therapist_id and role='specialist')
  or exists(select 1 from public.account_deletion_jobs where user_id=p_therapist_id) then raise exception 'Request could not be completed'; end if;
 expected:=p_therapist_id::text||'/parent-reports/'||p_kind||'/'||r.id::text||'/'||p_revision::text;
 if not exists(select 1 from storage.objects where bucket_id='patient-media' and name=expected||'.pdf') then raise exception 'Request could not be completed'; end if;
 if p_media is null or jsonb_typeof(p_media)<>'array' then raise exception 'Request could not be completed'; end if;
 if p_kind='initial' then
  if jsonb_array_length(p_media)<>0 then raise exception 'Request could not be completed'; end if;
 else
  if jsonb_array_length(p_media)<>jsonb_array_length(r.published_media) then raise exception 'Request could not be completed'; end if;
  for frozen in select value from jsonb_array_elements(r.published_media) loop
   select jsonb_build_object('id',o.id,'version',to_jsonb(o)->'version','updated_at',to_jsonb(o)->'updated_at','metadata',to_jsonb(o)->'metadata') into actual from storage.objects o where bucket_id='patient-media' and name=frozen->>'storage_path' for share;
   artifact:=p_media->count;
   if actual is distinct from frozen->'source_object' or artifact->>'id' is distinct from frozen->>'id'
    or artifact->>'sha256' is null or artifact->>'sha256'!~'^[a-f0-9]{64}$'
    or artifact->>'content_type' is null or artifact->>'content_type' not in ('image/jpeg','image/png')
    or artifact->>'storage_path' is distinct from expected||'/'||(frozen->>'id')||(case artifact->>'content_type' when 'image/jpeg' then '.jpg' else '.png' end)
    or not exists(select 1 from storage.objects where bucket_id='patient-media' and name=artifact->>'storage_path') then raise exception 'Request could not be completed'; end if;
   verified:=verified||jsonb_build_array(jsonb_build_object('id',frozen->>'id','media_type','photo','storage_path',artifact->>'storage_path','sha256',artifact->>'sha256','content_type',artifact->>'content_type'));
   count:=count+1;
  end loop;
  update public.parent_session_reports set published_media=verified where id=r.id;
 end if;
 execute format('update public.%I set publication_status=''published'',published_at=now(),published_by=$2,pdf_generated_at=now(),pdf_storage_path=$3,pdf_sha256=$4,publication_error=null where id=$1',table_name) using r.id,p_therapist_id,expected||'.pdf',p_pdf_sha256;
 return true;
end;
$$;

create or replace function public.fail_parent_publication(p_therapist_id uuid,p_report_id uuid,p_kind text,p_claim_id uuid,p_revision integer)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare table_name text; changed integer;
begin
 if p_kind not in ('initial','session') or p_kind is null then return false; end if;
 table_name:=case p_kind when 'initial' then 'parent_reports' else 'parent_session_reports' end;
 execute format('update public.%I set publication_status=''publication_error'',publication_error=''Publication could not be completed'' where id=$1 and therapist_id=$2 and publication_status=''publishing'' and publication_claim_id=$3 and publication_revision=$4',table_name) using p_report_id,p_therapist_id,p_claim_id,p_revision;
 get diagnostics changed=row_count;return changed=1;
end;
$$;

-- Private resolver repeats authorization immediately before signing; only the
-- service role can see paths/digests. Never join current patient_media here.
create or replace function public.resolve_parent_publication_file(p_parent_id uuid,p_report_id uuid,p_file_kind text,p_media_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r record; selected jsonb;
begin
 if p_file_kind is null or p_file_kind not in ('pdf','photo') then return null; end if;
 for r in select id,patient_id,therapist_id,publication_status,pdf_storage_path,pdf_sha256,'[]'::jsonb as media from public.parent_reports where id=p_report_id
  union all select id,patient_id,therapist_id,publication_status,pdf_storage_path,pdf_sha256,published_media from public.parent_session_reports where id=p_report_id loop
  if r.publication_status<>'published' or not exists(select 1 from public.parent_child_access a join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id join public.app_user_roles roles on roles.user_id=a.parent_user_id and roles.role='parent' where a.parent_user_id=p_parent_id and a.patient_id=r.patient_id and a.therapist_id=r.therapist_id and a.status='active')
   or exists(select 1 from public.account_deletion_jobs where user_id in (p_parent_id,r.therapist_id)) then continue; end if;
  if p_file_kind='pdf' and p_media_id is null and r.pdf_sha256 is not null then return jsonb_build_object('storage_path',r.pdf_storage_path,'sha256',r.pdf_sha256,'content_type','application/pdf'); end if;
  if p_file_kind='photo' then
   select value into selected from jsonb_array_elements(r.media) where value->>'id'=p_media_id::text and value->>'sha256' is not null limit 1;
   if selected is not null then return jsonb_build_object('storage_path',selected->>'storage_path','sha256',selected->>'sha256','content_type',selected->>'content_type'); end if;
  end if;
 end loop;
 return null;
end;
$$;
revoke all on function public.parent_storage_write_allowed(text,text),public.claim_parent_publication(uuid,uuid,text),public.complete_parent_publication(uuid,uuid,text,uuid,integer,text,jsonb),public.fail_parent_publication(uuid,uuid,text,uuid,integer),public.resolve_parent_publication_file(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.parent_storage_write_allowed(text,text) to authenticated,service_role;
grant execute on function public.claim_parent_publication(uuid,uuid,text),public.complete_parent_publication(uuid,uuid,text,uuid,integer,text,jsonb),public.fail_parent_publication(uuid,uuid,text,uuid,integer),public.resolve_parent_publication_file(uuid,uuid,text,uuid) to service_role;
commit;

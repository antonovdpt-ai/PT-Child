-- Parent publication boundary. Clinical source and Storage policies are unchanged.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- A column default backfills legacy rows to draft only on the first application.
alter table public.parent_reports
  add column if not exists publication_status text not null default 'draft',
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users(id) on delete set null,
  add column if not exists published_snapshot jsonb,
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_generated_at timestamptz,
  add column if not exists publication_error text,
  add column if not exists publication_revision integer not null default 1;

create table if not exists public.parent_session_reports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  what_did text, what_worked text, attention text, home_recommendations text,
  publication_status text not null default 'draft',
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  published_snapshot jsonb, pdf_storage_path text, pdf_generated_at timestamptz,
  publication_error text, publication_revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Frozen file metadata is server-private, separate from the parent text snapshot.
alter table public.parent_session_reports
  add column if not exists published_media jsonb not null default '[]'::jsonb;
alter table public.parent_session_reports drop constraint if exists parent_session_reports_media_check;
alter table public.parent_session_reports add constraint parent_session_reports_media_check
  check(jsonb_typeof(published_media)='array' and jsonb_array_length(published_media)<=100);
create table if not exists public.parent_session_report_media (
  id uuid primary key default gen_random_uuid(),
  parent_session_report_id uuid not null references public.parent_session_reports(id) on delete cascade,
  patient_media_id uuid not null references public.patient_media(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid not null references auth.users(id) on delete cascade,
  position integer not null default 0 check(position between 0 and 99),
  created_at timestamptz not null default now(),
  unique(parent_session_report_id,patient_media_id),
  unique(parent_session_report_id,position)
);
create table if not exists public.parent_goal_publications (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(title) between 1 and 500),
  description text,
  status text not null default 'new' check(status in ('new','in_progress','achieved','revised')),
  published_at timestamptz, unpublished_at timestamptz,
  updated_at timestamptz not null default now(),
  check(unpublished_at is null or published_at is not null)
);
create table if not exists public.parent_notifications (
  id uuid primary key default gen_random_uuid(),
  parent_user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid not null references auth.users(id) on delete cascade,
  type text not null check(type in ('report_published','appointment_created','appointment_changed')),
  title text not null, body text not null,
  entity_type text not null check(entity_type in ('initial_report','session_report','appointment')),
  entity_id uuid not null,
  created_at timestamptz not null default now(), read_at timestamptz
);


alter table public.parent_reports drop constraint if exists parent_reports_publication_check;
alter table public.parent_reports add constraint parent_reports_publication_check check (
  publication_status in ('draft','publishing','published','publication_error','archived')
  and publication_revision > 0
  and (published_snapshot is null or jsonb_typeof(published_snapshot)='object')
  and (publication_status<>'published' or (
    published_at is not null and published_by is not null and published_by=therapist_id
    and published_snapshot is not null and pdf_generated_at is not null
    and pdf_storage_path is not null
    and pdf_storage_path like therapist_id::text || '/parent-reports/%'
    and publication_error is null
  ))
);
create index if not exists parent_reports_published_idx on public.parent_reports(patient_id,published_at desc)
  where publication_status='published';

alter table public.parent_session_reports drop constraint if exists parent_session_reports_publication_check;
alter table public.parent_session_reports add constraint parent_session_reports_publication_check check (
  publication_status in ('draft','publishing','published','publication_error','archived')
  and publication_revision > 0
  and (published_snapshot is null or jsonb_typeof(published_snapshot)='object')
  and (publication_status<>'published' or (
    published_at is not null and published_by is not null and published_by=therapist_id
    and published_snapshot is not null and pdf_generated_at is not null
    and pdf_storage_path is not null
    and pdf_storage_path like therapist_id::text || '/parent-reports/%'
    and publication_error is null
  ))
);
create index if not exists parent_session_reports_published_idx on public.parent_session_reports(patient_id,published_at desc)
  where publication_status='published';

create index if not exists parent_session_report_media_owner_idx on public.parent_session_report_media(patient_id,therapist_id);
create index if not exists parent_goal_publications_patient_idx on public.parent_goal_publications(patient_id,published_at desc);
create index if not exists parent_notifications_parent_idx on public.parent_notifications(parent_user_id,patient_id,created_at desc);
create index if not exists parent_notifications_entity_idx on public.parent_notifications(entity_type,entity_id);

-- Shared owner validation also protects privileged writes from mismatched sources.
create or replace function public.check_parent_publication_owner()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not exists(select 1 from public.patients p where p.id=new.patient_id and p.therapist_id=new.therapist_id) then
    raise exception 'Publication patient ownership mismatch' using errcode='23514';
  end if;
  if tg_table_name='parent_session_reports' then
    if new.session_id is not null and not exists(select 1 from public.sessions s where s.id=new.session_id and s.patient_id=new.patient_id and s.therapist_id=new.therapist_id) then
      raise exception 'Publication session ownership mismatch' using errcode='23514';
    end if;
  elsif tg_table_name='parent_goal_publications' then
    if not exists(select 1 from public.goals g where g.id=new.goal_id and g.patient_id=new.patient_id and g.therapist_id=new.therapist_id) then
      raise exception 'Publication goal ownership mismatch' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

-- Browser authors draft text only. Publication metadata is written by the checked server.
-- Once published, all content, identity, revision and PDF fields remain immutable,
-- including after archival; only published -> archived is a supported state change.
create or replace function public.guard_parent_report_publication()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  metadata_keys text[] := array['publication_status','published_at','published_by','published_snapshot',
    'pdf_storage_path','pdf_generated_at','publication_error','publication_revision','published_media'];
  key text;
  selected_media record;
begin
  if tg_op='DELETE' then
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
  if current_setting('role',true)='authenticated' then
    if tg_op='INSERT' then
      if new.publication_status<>'draft' or new.published_at is not null or new.published_by is not null
        or new.published_snapshot is not null or new.pdf_storage_path is not null
        or new.pdf_generated_at is not null or new.publication_error is not null then
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
  if tg_table_name='parent_session_reports' then
    if new.publication_status='published' and (tg_op='INSERT' or old.publication_status<>'published') then
      -- Freeze explicitly selected references and file paths while source rows
      -- are locked. Parent reads must never rejoin mutable clinical metadata.
      new.published_media := '[]'::jsonb;
      for selected_media in
        select source.id,source.patient_id,source.therapist_id,source.media_type,source.storage_path
        from public.parent_session_report_media m join public.patient_media source on source.id=m.patient_media_id
        where m.parent_session_report_id=new.id
        order by m.position,m.id limit 100 for share of source
      loop
        if selected_media.patient_id<>new.patient_id or selected_media.therapist_id<>new.therapist_id
          or selected_media.media_type<>'photo'
          or selected_media.storage_path not like new.therapist_id::text||'/%' then
          raise exception 'Selected publication media ownership mismatch' using errcode='23514';
        end if;
        new.published_media := new.published_media||jsonb_build_array(jsonb_build_object(
          'id',selected_media.id,'media_type',selected_media.media_type,'storage_path',selected_media.storage_path));
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
    if report_record.published_at is not null
      and exists(select 1 from public.patients p where p.id=report_record.patient_id)
      and exists(select 1 from auth.users u where u.id=report_record.therapist_id) then
      raise exception 'Published report media selection is immutable' using errcode='23514';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  select * into report_record from public.parent_session_reports where id=new.parent_session_report_id for update;
  if report_record.published_at is not null then
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


drop trigger if exists check_parent_publication_owner on public.parent_reports;
create trigger check_parent_publication_owner before insert or update on public.parent_reports
  for each row execute function public.check_parent_publication_owner();

drop trigger if exists check_parent_publication_owner on public.parent_session_reports;
create trigger check_parent_publication_owner before insert or update on public.parent_session_reports
  for each row execute function public.check_parent_publication_owner();

drop trigger if exists check_parent_publication_owner on public.parent_goal_publications;
create trigger check_parent_publication_owner before insert or update on public.parent_goal_publications
  for each row execute function public.check_parent_publication_owner();

drop trigger if exists guard_parent_report_publication on public.parent_reports;
create trigger guard_parent_report_publication before insert or update or delete on public.parent_reports
  for each row execute function public.guard_parent_report_publication();

drop trigger if exists guard_parent_report_publication on public.parent_session_reports;
create trigger guard_parent_report_publication before insert or update or delete on public.parent_session_reports
  for each row execute function public.guard_parent_report_publication();

drop trigger if exists check_parent_selected_media on public.parent_session_report_media;
create trigger check_parent_selected_media before insert or update or delete on public.parent_session_report_media
  for each row execute function public.check_parent_selected_media();


alter table public.parent_session_reports enable row level security;
drop policy if exists specialist_own on public.parent_session_reports;
create policy specialist_own on public.parent_session_reports for all to authenticated
  using (therapist_id=auth.uid()
    and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
    and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid()))
  with check (therapist_id=auth.uid()
    and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
    and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid()));
drop policy if exists account_must_be_active on public.parent_session_reports;
create policy account_must_be_active on public.parent_session_reports as restrictive for all to authenticated
  using(public.account_is_active()) with check(public.account_is_active());
revoke all on public.parent_session_reports from public, anon, authenticated, service_role;
grant select,insert,update,delete on public.parent_session_reports to authenticated,service_role;

alter table public.parent_session_report_media enable row level security;
drop policy if exists specialist_own on public.parent_session_report_media;
create policy specialist_own on public.parent_session_report_media for all to authenticated
  using (therapist_id=auth.uid()
    and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
    and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid()))
  with check (therapist_id=auth.uid()
    and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
    and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid()));
drop policy if exists account_must_be_active on public.parent_session_report_media;
create policy account_must_be_active on public.parent_session_report_media as restrictive for all to authenticated
  using(public.account_is_active()) with check(public.account_is_active());
revoke all on public.parent_session_report_media from public, anon, authenticated, service_role;
grant select,insert,update,delete on public.parent_session_report_media to authenticated,service_role;

alter table public.parent_goal_publications enable row level security;
drop policy if exists specialist_own on public.parent_goal_publications;
create policy specialist_own on public.parent_goal_publications for all to authenticated
  using (therapist_id=auth.uid()
    and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
    and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid()))
  with check (therapist_id=auth.uid()
    and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
    and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid()));
drop policy if exists account_must_be_active on public.parent_goal_publications;
create policy account_must_be_active on public.parent_goal_publications as restrictive for all to authenticated
  using(public.account_is_active()) with check(public.account_is_active());
revoke all on public.parent_goal_publications from public, anon, authenticated, service_role;
grant select,insert,update,delete on public.parent_goal_publications to authenticated,service_role;

alter table public.parent_notifications enable row level security;
drop policy if exists specialist_own on public.parent_notifications;
create policy specialist_own on public.parent_notifications for select to authenticated
  using (therapist_id=auth.uid()
    and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
    and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid()));
drop policy if exists account_must_be_active on public.parent_notifications;
create policy account_must_be_active on public.parent_notifications as restrictive for all to authenticated
  using(public.account_is_active()) with check(public.account_is_active());
revoke all on public.parent_notifications from public, anon, authenticated, service_role;
grant select,insert,update,delete on public.parent_notifications to authenticated,service_role;

-- Parent and specialist share the authenticated DB role: RLS denies parents all
-- direct rows/writes. Notifications have SELECT-only specialist policy; browser
-- UPDATE grants permit a zero-row denial, not a direct read-status mutation.
create or replace function public.notify_parent_publication_or_appointment()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare event_type text; entity_kind text; event_title text; event_body text;
begin
  if tg_table_name='appointments' then
    if new.kind<>'appointment' or new.patient_id is null then return new; end if;
    if tg_op='UPDATE' and new.starts_at is not distinct from old.starts_at
      and new.ends_at is not distinct from old.ends_at and new.status is not distinct from old.status then return new; end if;
    event_type := case when tg_op='INSERT' then 'appointment_created' else 'appointment_changed' end;
    entity_kind := 'appointment'; event_title := 'Расписание занятий';
    event_body := 'В расписании появилось новое занятие или изменились время и статус.';
  else
    if new.publication_status<>'published' then return new; end if;
    if tg_op='UPDATE' and old.publication_status='published' then return new; end if;
    event_type := 'report_published';
    entity_kind := case when tg_table_name='parent_reports' then 'initial_report' else 'session_report' end;
    event_title := 'Опубликован отчёт'; event_body := 'Новый отчёт доступен в кабинете родителя.';
  end if;
  insert into public.parent_notifications(parent_user_id,patient_id,therapist_id,type,title,body,entity_type,entity_id)
    select a.parent_user_id,new.patient_id,new.therapist_id,event_type,event_title,event_body,entity_kind,new.id
    from public.parent_child_access a
    join public.app_user_roles r on r.user_id=a.parent_user_id and r.role='parent'
    join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id
    where a.patient_id=new.patient_id and a.therapist_id=new.therapist_id and a.status='active'
      and not exists(select 1 from public.account_deletion_jobs j where j.user_id in (a.parent_user_id,a.therapist_id));
  return new;
end;
$$;

drop trigger if exists notify_parent_publication_or_appointment on public.parent_reports;
create trigger notify_parent_publication_or_appointment after insert or update on public.parent_reports
  for each row execute function public.notify_parent_publication_or_appointment();

drop trigger if exists notify_parent_publication_or_appointment on public.parent_session_reports;
create trigger notify_parent_publication_or_appointment after insert or update on public.parent_session_reports
  for each row execute function public.notify_parent_publication_or_appointment();

drop trigger if exists notify_parent_publication_or_appointment on public.appointments;
create trigger notify_parent_publication_or_appointment after insert or update on public.appointments
  for each row execute function public.notify_parent_publication_or_appointment();

-- Internal allowlisted projection shared by dashboard/list/detail. No public grant.
-- JSON is reconstructed from known text keys, never returned wholesale.
create or replace function public.parent_report_projection(p_patient_id uuid)
returns table(id uuid,kind text,published_at timestamptz,revision integer,snapshot jsonb,media_ids jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  select id,'initial'::text,published_at,publication_revision,jsonb_build_object('complaint',published_snapshot->>'complaint','strengths',published_snapshot->>'strengths','observations',published_snapshot->>'observations','goals',published_snapshot->>'goals','progress',published_snapshot->>'progress','recommendations',published_snapshot->>'recommendations','therapist_name',published_snapshot->>'therapist_name','therapist_profession',published_snapshot->>'therapist_profession','therapist_organization',published_snapshot->>'therapist_organization','therapist_phone',published_snapshot->>'therapist_phone'),'[]'::jsonb
  from public.parent_reports r where r.patient_id=p_patient_id and r.publication_status='published'
    and exists(select 1 from public.patients p where p.id=r.patient_id and p.therapist_id=r.therapist_id)
  union all
  select r.id,'session'::text,r.published_at,r.publication_revision,jsonb_build_object('what_did',published_snapshot->>'what_did','what_worked',published_snapshot->>'what_worked','attention',published_snapshot->>'attention','home_recommendations',published_snapshot->>'home_recommendations'),
    coalesce((select jsonb_agg(media->>'id' order by ordinal)
      from jsonb_array_elements(r.published_media) with ordinality selected(media,ordinal)),'[]'::jsonb)
  from public.parent_session_reports r where r.patient_id=p_patient_id and r.publication_status='published'
    and exists(select 1 from public.patients p where p.id=r.patient_id and p.therapist_id=r.therapist_id)
$$;

create or replace function public.parent_portal_children()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not public.account_is_active() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(child)) from (
    select p.id,p.display_name,p.date_of_birth from public.patients p
    where public.parent_has_active_access(auth.uid(),p.id)
      and not exists(select 1 from public.account_deletion_jobs j where j.user_id=p.therapist_id)
    order by p.display_name,p.id limit 100
  ) child),'[]'::jsonb);
end;
$$;


create or replace function public.parent_portal_schedule(p_patient_id uuid,p_mode text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_mode is null or p_mode not in ('upcoming','history') then raise exception 'Unknown schedule mode' using errcode='22023'; end if;
  if not public.parent_has_active_access(auth.uid(),p_patient_id) then return '[]'::jsonb; end if;
  if not public.account_is_active() or exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=p_patient_id) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(item)) from (select a.starts_at,a.ends_at,a.status from public.appointments a
  join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id
  where a.patient_id=p_patient_id and a.kind='appointment' and ((p_mode='upcoming' and a.ends_at>=now()) or (p_mode='history' and a.ends_at<now()))
  order by a.starts_at,a.id limit 100) item),'[]'::jsonb);
end;
$$;

create or replace function public.parent_portal_reports(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.parent_has_active_access(auth.uid(),p_patient_id) then return '[]'::jsonb; end if;
  if not public.account_is_active() or exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=p_patient_id) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(item)) from (select * from public.parent_report_projection(p_patient_id) order by published_at desc,id limit 100) item),'[]'::jsonb);
end;
$$;

create or replace function public.parent_portal_goals(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.parent_has_active_access(auth.uid(),p_patient_id) then return '[]'::jsonb; end if;
  if not public.account_is_active() or exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=p_patient_id) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(item)) from (select g.title,g.description,g.status,g.updated_at from public.parent_goal_publications g
  join public.patients p on p.id=g.patient_id and p.therapist_id=g.therapist_id
  where g.patient_id=p_patient_id and g.published_at is not null and g.unpublished_at is null
  order by g.updated_at desc,g.id limit 100) item),'[]'::jsonb);
end;
$$;

create or replace function public.parent_portal_dynamics(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.parent_has_active_access(auth.uid(),p_patient_id) then return '[]'::jsonb; end if;
  if not public.account_is_active() or exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=p_patient_id) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(item)) from (select a.scale,a.assessed_at,a.value_numeric,a.value_text from public.standardized_assessments a
  join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id
  where a.patient_id=p_patient_id order by a.assessed_at,a.id limit 100) item),'[]'::jsonb);
end;
$$;

create or replace function public.parent_portal_notifications(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.parent_has_active_access(auth.uid(),p_patient_id) then return '[]'::jsonb; end if;
  if not public.account_is_active() or exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=p_patient_id) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(item)) from (select n.id,n.type,n.title,n.body,n.entity_type,n.entity_id,n.created_at,n.read_at from public.parent_notifications n
  join public.patients p on p.id=n.patient_id and p.therapist_id=n.therapist_id
  where n.patient_id=p_patient_id and n.parent_user_id=auth.uid()
  order by n.created_at desc,n.id limit 100) item),'[]'::jsonb);
end;
$$;

create or replace function public.parent_portal_dashboard(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.parent_has_active_access(auth.uid(),p_patient_id) then return '{"child":null}'::jsonb; end if;
  if not public.account_is_active() or exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=p_patient_id) then return '{"child":null}'::jsonb; end if;
  return jsonb_build_object(
    'child',(select jsonb_build_object('id',p.id,'display_name',p.display_name,'date_of_birth',p.date_of_birth) from public.patients p where p.id=p_patient_id),
    'schedule',coalesce((select jsonb_agg(to_jsonb(item)) from (select a.starts_at,a.ends_at,a.status from public.appointments a
  join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id
  where a.patient_id=p_patient_id and a.kind='appointment' and a.ends_at>=now()
  order by a.starts_at,a.id limit 100) item),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(to_jsonb(item)) from (select * from public.parent_report_projection(p_patient_id) order by published_at desc,id limit 100) item),'[]'::jsonb),
    'goals',coalesce((select jsonb_agg(to_jsonb(item)) from (select g.title,g.description,g.status,g.updated_at from public.parent_goal_publications g
  join public.patients p on p.id=g.patient_id and p.therapist_id=g.therapist_id
  where g.patient_id=p_patient_id and g.published_at is not null and g.unpublished_at is null
  order by g.updated_at desc,g.id limit 100) item),'[]'::jsonb),
    'dynamics',coalesce((select jsonb_agg(to_jsonb(item)) from (select a.scale,a.assessed_at,a.value_numeric,a.value_text from public.standardized_assessments a
  join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id
  where a.patient_id=p_patient_id order by a.assessed_at,a.id limit 100) item),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(to_jsonb(item)) from (select n.id,n.type,n.title,n.body,n.entity_type,n.entity_id,n.created_at,n.read_at from public.parent_notifications n
  join public.patients p on p.id=n.patient_id and p.therapist_id=n.therapist_id
  where n.patient_id=p_patient_id and n.parent_user_id=auth.uid()
  order by n.created_at desc,n.id limit 100) item),'[]'::jsonb)
  );
end;
$$;

create or replace function public.parent_portal_report(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare p_patient_id uuid; result jsonb;
begin
  select r.patient_id into p_patient_id from (
    select id,patient_id from public.parent_reports where publication_status='published'
    union all select id,patient_id from public.parent_session_reports where publication_status='published'
  ) r where r.id=p_report_id limit 1;
  if not public.parent_has_active_access(auth.uid(),p_patient_id) then return '{"report":null}'::jsonb; end if;
  if not public.account_is_active() or exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=p_patient_id) then return '{"report":null}'::jsonb; end if;
  select to_jsonb(r) into result from public.parent_report_projection(p_patient_id) r where r.id=p_report_id limit 1;
  return jsonb_build_object('report',result);
end;
$$;

create or replace function public.parent_mark_notifications_read(p_notification_ids uuid[])
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare child_id uuid; affected integer; total integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if coalesce(cardinality(p_notification_ids),0)>100 then raise exception 'Too many notification IDs; limit 100' using errcode='22023'; end if;
  if not public.account_is_active() then return 0; end if;
  for child_id in select distinct n.patient_id from public.parent_notifications n
    where n.id=any(p_notification_ids) and n.parent_user_id=auth.uid()
  loop
    if public.parent_has_active_access(auth.uid(),child_id)
      and not exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=child_id) then
      update public.parent_notifications n set read_at=now()
      where n.id=any(p_notification_ids) and n.patient_id=child_id and n.parent_user_id=auth.uid() and n.read_at is null
        and exists(select 1 from public.patients p where p.id=n.patient_id and p.therapist_id=n.therapist_id);
      get diagnostics affected = row_count; total := total+affected;
    end if;
  end loop;
  return total;
end;
$$;

revoke all on function public.check_parent_publication_owner(),public.guard_parent_report_publication(),
  public.check_parent_selected_media(),public.notify_parent_publication_or_appointment(),public.parent_report_projection(uuid),
  public.parent_portal_children(),public.parent_portal_dashboard(uuid),public.parent_portal_schedule(uuid,text),
  public.parent_portal_reports(uuid),public.parent_portal_report(uuid),public.parent_portal_goals(uuid),
  public.parent_portal_dynamics(uuid),public.parent_portal_notifications(uuid),public.parent_mark_notifications_read(uuid[])
  from public,anon,authenticated,service_role;
grant execute on function public.parent_portal_children(),public.parent_portal_dashboard(uuid),
  public.parent_portal_schedule(uuid,text),public.parent_portal_reports(uuid),public.parent_portal_report(uuid),
  public.parent_portal_goals(uuid),public.parent_portal_dynamics(uuid),public.parent_portal_notifications(uuid),
  public.parent_mark_notifications_read(uuid[]) to authenticated;
commit;

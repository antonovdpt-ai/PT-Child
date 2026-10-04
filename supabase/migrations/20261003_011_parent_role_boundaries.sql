begin;
set local lock_timeout='10s';
set local statement_timeout='5min';

-- Intersect, rather than replace, tenant-owner and account policies.
create or replace function public.specialist_source_access()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.account_is_active() and exists(select 1 from public.app_user_roles where user_id=auth.uid() and role='specialist')
$$;
create or replace function public.specialist_storage_access(p_bucket text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_bucket not in ('patient-media','specialist-logos') or public.specialist_source_access()
$$;
do $$ declare target_table text; begin
 foreach target_table in array array['patients','goals','sessions','assessments','standardized_assessments','ai_analysis_history','patient_contacts','patient_media','parent_reports','appointments'] loop
  execute format('drop policy if exists specialist_role_required on public.%I',target_table);
  execute format('create policy specialist_role_required on public.%I as restrictive for all to authenticated using(public.specialist_source_access()) with check(public.specialist_source_access())',target_table);
 end loop;
end; $$;
drop policy if exists specialist_role_required on storage.objects;
create policy specialist_role_required on storage.objects as restrictive for all to authenticated
 using(public.specialist_storage_access(bucket_id)) with check(public.specialist_storage_access(bucket_id));
revoke all on function public.specialist_source_access(),public.specialist_storage_access(text) from public,anon,authenticated,service_role;
grant execute on function public.specialist_source_access(),public.specialist_storage_access(text) to authenticated,service_role;

-- Reservation is private, server-owned and durable across expiry/revocation.
-- The invitation record is committed BEFORE Edge invokes Auth administration.
create table if not exists public.parent_signup_reservations (
 email_normalized text primary key check(email_normalized=lower(btrim(email_normalized)) and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 created_at timestamptz not null default now()
);
alter table public.parent_signup_reservations enable row level security;
revoke all on public.parent_signup_reservations from public,anon,authenticated,service_role;
insert into public.parent_signup_reservations(email_normalized)
 select distinct email_normalized from public.parent_invitations where auth_flow='new'
 on conflict do nothing;
create or replace function public.reserve_parent_signup()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.auth_flow='new' then
  perform pg_advisory_xact_lock(hashtextextended('fizira-parent-signup:'||new.email_normalized,0));
  insert into public.parent_signup_reservations(email_normalized) values(new.email_normalized) on conflict do nothing;
 end if;
 return new;
end; $$;
drop trigger if exists reserve_parent_signup on public.parent_invitations;
create trigger reserve_parent_signup before insert on public.parent_invitations for each row execute function public.reserve_parent_signup();
create or replace function public.provision_ordinary_specialist()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare normalized_email text := lower(btrim(new.email));
begin
 if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or to_jsonb(new)->>'invited_at' is not null or coalesce(to_jsonb(new)->>'is_anonymous','false')='true' then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('fizira-parent-signup:'||normalized_email,0));
 if exists(select 1 from public.parent_signup_reservations where email_normalized=normalized_email)
  or exists(select 1 from public.app_user_roles where user_id=new.id and role='parent') then return new; end if;
 insert into public.app_user_roles(user_id,role) values(new.id,'specialist') on conflict do nothing;
 return new;
end; $$;
drop trigger if exists provision_ordinary_specialist on auth.users;
create trigger provision_ordinary_specialist after insert on auth.users for each row execute function public.provision_ordinary_specialist();

-- Binding design section9 includes goals, including material visible revisions.
alter table public.parent_notifications drop constraint if exists parent_notifications_type_check;
alter table public.parent_notifications add constraint parent_notifications_type_check check(type in ('report_published','appointment_created','appointment_changed','goal_published'));
alter table public.parent_notifications drop constraint if exists parent_notifications_entity_type_check;
alter table public.parent_notifications add constraint parent_notifications_entity_type_check check(entity_type in ('initial_report','session_report','appointment','goal'));
create or replace function public.notify_parent_goal_publication()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.published_at is null or new.unpublished_at is not null then return new; end if;
 if tg_op='UPDATE' and old.published_at is not null and old.unpublished_at is null
  and new.title is not distinct from old.title and new.description is not distinct from old.description
  and new.status is not distinct from old.status then return new; end if;
 insert into public.parent_notifications(parent_user_id,patient_id,therapist_id,type,title,body,entity_type,entity_id)
  select a.parent_user_id,new.patient_id,new.therapist_id,'goal_published','Опубликована цель','Новая или обновлённая цель доступна в кабинете родителя.','goal',new.id
  from public.parent_child_access a
  join public.app_user_roles r on r.user_id=a.parent_user_id and r.role='parent'
  join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id
  where a.patient_id=new.patient_id and a.therapist_id=new.therapist_id and a.status='active'
   and not exists(select 1 from public.account_deletion_jobs j where j.user_id in(a.parent_user_id,a.therapist_id));
 return new;
end; $$;
drop trigger if exists notify_parent_goal_publication on public.parent_goal_publications;
create trigger notify_parent_goal_publication after insert or update on public.parent_goal_publications for each row execute function public.notify_parent_goal_publication();
revoke all on function public.reserve_parent_signup(),public.provision_ordinary_specialist(),public.notify_parent_goal_publication() from public,anon,authenticated,service_role;
commit;

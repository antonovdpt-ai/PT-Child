-- 013: one clinical source and explicit parent-safe goal synchronization.
-- Production READ ONLY preflight 2026-10-06: 15 goals/1 publication, no duplicates
-- or owner mismatch. Recheck immediately before rollout; no legacy text cleanup.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Serialize the precondition check and index creation against concurrent writes.
lock table public.goals, public.parent_goal_publications in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.parent_goal_publications group by goal_id having count(*)>1) then
  raise exception 'STOP: ambiguous duplicate goal publications; no automatic cleanup';
 end if;
 if exists(select 1 from public.parent_goal_publications p left join public.goals g on g.id=p.goal_id
  where g.id is null or p.patient_id is distinct from g.patient_id or p.therapist_id is distinct from g.therapist_id) then
  raise exception 'STOP: goal publication ownership mismatch';
 end if;
 if exists(select 1 from public.parent_goal_publications p join public.goals g on g.id=p.goal_id
  where p.published_at is not null and p.unpublished_at is null and p.title is distinct from g.title) then
  raise exception 'STOP: existing parent title differs; deliberate reconciliation required';
 end if;
end $$;
create unique index if not exists parent_goal_publications_goal_unique on public.parent_goal_publications(goal_id);
do $$ begin
 if not exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attname='goal_id'
  where i.indexrelid='public.parent_goal_publications_goal_unique'::regclass
   and i.indrelid='public.parent_goal_publications'::regclass and i.indisunique and i.indisvalid
   and i.indnkeyatts=1 and i.indkey[0]=a.attnum and i.indpred is null and i.indexprs is null) then
  raise exception 'STOP: unexpected goal uniqueness index definition';
 end if;
end $$;
alter table public.goals add column if not exists parent_visible boolean not null default false;
alter table public.goals add column if not exists parent_note text;
alter table public.parent_goal_publications add column if not exists baseline text;
alter table public.parent_goal_publications add column if not exists criterion text;
alter table public.parent_goal_publications add column if not exists deadline date;
alter table public.parent_goal_publications add column if not exists progress integer;
alter table public.parent_goal_publications drop constraint if exists parent_goal_publications_progress_check;
alter table public.parent_goal_publications add constraint parent_goal_publications_progress_check check(progress between 0 and 100);
alter table public.parent_goal_publications drop constraint if exists parent_goal_publications_status_check;
alter table public.parent_goal_publications add constraint parent_goal_publications_status_check check(status in ('new','in_progress','achieved','revised','paused','cancelled'));

-- Only on first installation: preserve pre-existing explicit publication choice.
-- No clinical text is backfilled into previously curated parent wording.
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.goals'::regclass and tgname='sync_goal_parent_projection') then
  update public.goals g set parent_note=p.description,
   parent_visible=(p.published_at is not null and p.unpublished_at is null)
  from public.parent_goal_publications p where p.goal_id=g.id;
 end if;
end $$;

create or replace function public.normalize_goal_completion()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.status='achieved' or new.progress=100 then new.status='achieved';new.progress=100;end if;
 if tg_op='UPDATE' then new.updated_at=clock_timestamp();end if;
 return new;
end $$;
drop trigger if exists normalize_goal_completion on public.goals;
create trigger normalize_goal_completion before insert or update on public.goals
 for each row execute function public.normalize_goal_completion();

create or replace function public.sync_goal_parent_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare parent_status text;
begin
 if not exists(select 1 from public.patients p where p.id=new.patient_id and p.therapist_id=new.therapist_id) then
  raise exception 'Goal patient ownership mismatch' using errcode='23514';
 end if;
 if not new.parent_visible then
  update public.parent_goal_publications set unpublished_at=clock_timestamp(),updated_at=clock_timestamp()
   where goal_id=new.id and published_at is not null and unpublished_at is null;
  return new;
 end if;
 parent_status:=case when new.status='achieved' or new.progress=100 then 'achieved'
  when new.status in ('paused','cancelled') then new.status
  when new.progress=0 then 'new' else 'in_progress' end;
 insert into public.parent_goal_publications(goal_id,patient_id,therapist_id,title,description,baseline,criterion,deadline,progress,status,published_at,unpublished_at,updated_at)
 values(new.id,new.patient_id,new.therapist_id,new.title,new.parent_note,new.baseline,new.criterion,new.deadline,new.progress,parent_status,clock_timestamp(),null,clock_timestamp())
 on conflict(goal_id) do update set title=excluded.title,description=excluded.description,baseline=excluded.baseline,criterion=excluded.criterion,
  deadline=excluded.deadline,progress=excluded.progress,status=excluded.status,
  published_at=case when parent_goal_publications.unpublished_at is not null or parent_goal_publications.published_at is null then excluded.published_at else parent_goal_publications.published_at end,
  unpublished_at=null,updated_at=excluded.updated_at;
 -- Previously curated description is preserved in the single clinical editor
 -- as parent_note and synchronized through the same explicit visibility choice.
 return new;
end $$;
drop trigger if exists sync_goal_parent_projection on public.goals;
create trigger sync_goal_parent_projection after insert or update on public.goals
 for each row execute function public.sync_goal_parent_projection();

-- No second writable source: ownership/active-account RLS remains unchanged.
revoke insert,update,delete on public.parent_goal_publications from authenticated;
revoke all on function public.normalize_goal_completion(),public.sync_goal_parent_projection() from public,anon,authenticated,service_role;

create or replace function public.parent_portal_goals(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not public.parent_has_active_access(auth.uid(),p_patient_id) then return '[]'::jsonb;end if;
 if not public.account_is_active() or exists(select 1 from public.patients p join public.account_deletion_jobs j on j.user_id=p.therapist_id where p.id=p_patient_id) then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(to_jsonb(item)) from (
  select g.title,g.description,g.baseline,g.criterion,g.deadline,g.progress,g.status,g.updated_at
  from public.parent_goal_publications g join public.patients p on p.id=g.patient_id and p.therapist_id=g.therapist_id
  where g.patient_id=p_patient_id and g.published_at is not null and g.unpublished_at is null
  order by g.updated_at desc,g.id limit 100) item),'[]'::jsonb);
end $$;

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
    'goals',public.parent_portal_goals(p_patient_id),
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
create or replace function public.notify_parent_goal_publication()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
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
end; $$;

commit;

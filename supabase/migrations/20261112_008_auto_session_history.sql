begin;
set local lock_timeout = '10s';
lock table public.appointments, public.sessions in access exclusive mode;

-- A pre-existing link must already identify exactly one session for the same child.
do $$
begin
  if exists (
    select 1 from public.appointments where session_id is not null
    group by session_id having count(*) > 1
  ) or exists (
    select 1
    from public.appointments a
    join public.sessions s on s.id = a.session_id
    left join public.patients p on p.id = a.patient_id
    where a.kind <> 'appointment'
       or a.patient_id is distinct from s.patient_id
       or a.therapist_id is distinct from s.therapist_id
       or a.therapist_id is distinct from p.therapist_id
  ) then
    raise exception 'SCHEDULE_HISTORY_INVALID_LEGACY_LINKS';
  end if;
end;
$$;

alter table public.appointments
  add column schedule_timezone text not null default 'Europe/Moscow',
  add column history_review_required boolean;
-- NULL identifies rows from before this migration. Future rows start out eligible.
alter table public.appointments alter column history_review_required set default false;
create unique index appointments_session_unique_idx on public.appointments (session_id)
  where session_id is not null;

alter table public.sessions
  add column origin text not null default 'manual',
  add column scheduled_at timestamptz,
  add column schedule_timezone text,
  add column voided_at timestamptz,
  add column has_clinical_data boolean generated always as (
    coalesce(note ~ '[^[:space:]]', false)
    or coalesce(function_changes ~ '[^[:space:]]', false)
    or coalesce(tolerance in ('good', 'medium', 'low'), false)
    or coalesce(dynamics_status in ('improved', 'stable', 'worse'), false)
  ) stored,
  add constraint sessions_history_source_check check (
    (origin = 'manual' and scheduled_at is null and schedule_timezone is null and voided_at is null)
    or (origin = 'schedule' and scheduled_at is not null and schedule_timezone is not null)
  );

create index sessions_active_history_idx on public.sessions
  (patient_id, session_date desc, scheduled_at desc nulls last, created_at desc, id)
  where voided_at is null;
create index sessions_active_clinical_idx on public.sessions
  (patient_id, session_date desc, scheduled_at desc nulls last, created_at desc, id)
  where voided_at is null and has_clinical_data;

-- Specialist-facing writes can edit observations but cannot forge synchronization fields.
create function public.guard_schedule_session()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare managed boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.origin <> 'manual' or new.scheduled_at is not null
       or new.schedule_timezone is not null or new.voided_at is not null then
      raise exception 'SESSION_SCHEDULE_MANAGED';
    end if;
    return new;
  end if;

  managed := old.origin = 'schedule' or exists (
    select 1 from public.appointments a where a.session_id = old.id
  );
  if tg_op = 'DELETE' then
    if managed then raise exception 'SESSION_SCHEDULE_MANAGED'; end if;
    return old;
  end if;

  if row(new.origin, new.scheduled_at, new.schedule_timezone, new.voided_at)
        is distinct from row(old.origin, old.scheduled_at, old.schedule_timezone, old.voided_at)
     or (managed and row(new.id, new.patient_id, new.therapist_id, new.session_date)
        is distinct from row(old.id, old.patient_id, old.therapist_id, old.session_date)) then
    raise exception 'SESSION_SCHEDULE_MANAGED';
  end if;
  if old.voided_at is not null then raise exception 'SESSION_VOIDED'; end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.guard_schedule_session() from public, anon, authenticated;

create trigger sessions_guard_schedule
before insert or update or delete on public.sessions
for each row execute function public.guard_schedule_session();

-- A BEFORE trigger writes the session and its link inside the appointment statement.
-- The appointment row lock serializes competing saves; there is no recursive appointment UPDATE.
create function public.sync_appointment_session()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  linked public.sessions;
  qualifies boolean;
  was_completed boolean;
  reviewed boolean := false;
  active_date date;
  inactive_since timestamptz;
begin
  if tg_op = 'DELETE' then
    update public.sessions
    set voided_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = old.session_id and origin = 'schedule' and voided_at is null;
    return old;
  end if;

  if auth.uid() is not null and new.therapist_id is distinct from auth.uid() then
    raise exception 'SCHEDULE_PATIENT_OWNER';
  end if;

  if tg_op = 'UPDATE' then
    -- Retain the schema's existing patient/account deletion cascades.
    if pg_trigger_depth() > 1 and (
      (old.patient_id is not null and new.patient_id is null
       and not exists (select 1 from public.patients p where p.id = old.patient_id))
      or (old.session_id is not null and new.session_id is null
       and not exists (select 1 from public.sessions s where s.id = old.session_id))
    ) then
      new.session_id := null;
      return new;
    end if;

    if auth.uid() is not null and (
      new.session_id is distinct from old.session_id
      or new.history_review_required is distinct from old.history_review_required
    ) then
      raise exception 'SCHEDULE_SESSION_LINK';
    end if;

    if old.session_id is not null and (
      new.session_id is distinct from old.session_id
      or new.patient_id is distinct from old.patient_id
      or new.therapist_id is distinct from old.therapist_id
      or new.kind <> 'appointment'
    ) then
      raise exception 'SCHEDULE_SESSION_PATIENT';
    end if;

    was_completed := old.kind = 'appointment' and old.status = 'completed';
    reviewed := auth.uid() is null and new.history_review_required is false
      and (old.history_review_required is distinct from false or new.session_id is not null);
    new.history_review_required := case
      when reviewed then false
      else coalesce(old.history_review_required, was_completed and old.session_id is null)
    end;

    if not reviewed and row(new.kind, new.status, new.patient_id, new.therapist_id,
      new.starts_at, new.schedule_timezone, new.session_id) is not distinct from
      row(old.kind, old.status, old.patient_id, old.therapist_id,
      old.starts_at, old.schedule_timezone, old.session_id) then
      return new;
    end if;
  elsif new.session_id is not null or new.history_review_required is distinct from false then
    raise exception 'SCHEDULE_SESSION_LINK';
  end if;

  if new.patient_id is not null and not exists (
    select 1 from public.patients p where p.id = new.patient_id and p.therapist_id = new.therapist_id
    for key share
  ) then
    raise exception 'SCHEDULE_PATIENT_OWNER';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.schedule_timezone) then
    raise exception 'SCHEDULE_TIME_ZONE';
  end if;

  qualifies := new.kind = 'appointment' and new.status = 'completed' and new.patient_id is not null;
  active_date := (new.starts_at at time zone new.schedule_timezone)::date;
  if new.session_id is null then
    if qualifies and not new.history_review_required then
      insert into public.sessions (patient_id, therapist_id, session_date, origin, scheduled_at, schedule_timezone)
      values (new.patient_id, new.therapist_id, active_date, 'schedule', new.starts_at, new.schedule_timezone)
      returning id into new.session_id;
    end if;
    return new;
  end if;

  select * into linked from public.sessions where id = new.session_id for update;
  if not found or linked.patient_id is distinct from new.patient_id
     or linked.therapist_id is distinct from new.therapist_id or new.kind <> 'appointment' then
    raise exception 'SCHEDULE_SESSION_PATIENT';
  end if;

  inactive_since := case when not qualifies then coalesce(linked.voided_at, clock_timestamp()) end;
  if row(linked.origin, linked.session_date, linked.scheduled_at, linked.schedule_timezone, linked.voided_at)
    is distinct from row('schedule'::text, active_date, new.starts_at, new.schedule_timezone, inactive_since) then
    update public.sessions
    set origin = 'schedule', session_date = active_date, scheduled_at = new.starts_at,
        schedule_timezone = new.schedule_timezone, voided_at = inactive_since, updated_at = clock_timestamp()
    where id = linked.id;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_appointment_session() from public, anon, authenticated;

create trigger appointments_sync_session
before insert or update or delete on public.appointments
for each row execute function public.sync_appointment_session();

-- Keep the existing RLS policies for sessions. The appointment trigger enforces the
-- link/owner invariant, including for writes bypassing the API. Do not query the
-- just-inserted session in the appointment's WITH CHECK snapshot.
drop policy appointments_insert_own on public.appointments;
create policy appointments_insert_own on public.appointments for insert to authenticated
  with check (
    therapist_id = auth.uid() and (
      patient_id is null or exists (
        select 1 from public.patients p where p.id = appointments.patient_id and p.therapist_id = auth.uid()
      )
    )
  );
drop policy appointments_update_own on public.appointments;
create policy appointments_update_own on public.appointments for update to authenticated
  using (therapist_id = auth.uid())
  with check (
    therapist_id = auth.uid() and (
      patient_id is null or exists (
        select 1 from public.patients p where p.id = appointments.patient_id and p.therapist_id = auth.uid()
      )
    )
  );

create or replace function public.set_appointments_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- Accept the authoring device time zone without changing the existing RPC contract.
create or replace function public.save_schedule_entries(entries jsonb, save_tariff boolean default false)
returns integer language plpgsql security invoker set search_path = public as $$
declare item jsonb; current_row public.appointments; saved public.appointments; n integer := 0;
begin
  if not public.account_is_active() then raise exception 'Account is not active'; end if;
  if entries is null or jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) not between 1 and 366 then
    raise exception 'Invalid schedule batch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  for item in select value from jsonb_array_elements(entries) loop
    if item->>'kind' not in ('appointment', 'break', 'personal') or item->>'status' not in ('planned', 'completed', 'cancelled', 'no_show') then
      raise exception 'Invalid schedule entry';
    end if;
    if item->>'id' is not null then
      select * into current_row from public.appointments where id = (item->>'id')::uuid and therapist_id = auth.uid() for update;
      if not found or current_row.updated_at is distinct from (item->>'expected_updated_at')::timestamptz then
        raise exception 'SCHEDULE_STALE';
      end if;
      if item->>'kind' = 'appointment' and item->>'status' = 'completed'
         and (current_row.kind <> 'appointment' or current_row.status <> 'completed')
         and item->'confirm_completed' is distinct from 'true'::jsonb then
        raise exception 'SCHEDULE_CONFIRM_COMPLETED';
      end if;
      update public.appointments set
        patient_id = (item->>'patient_id')::uuid, initial_name = item->>'initial_name',
        starts_at = (item->>'starts_at')::timestamptz, ends_at = (item->>'ends_at')::timestamptz,
        schedule_timezone = coalesce(nullif(item->>'schedule_timezone', ''), current_row.schedule_timezone),
        kind = item->>'kind', status = item->>'status',
        price_kopecks = (item->>'price_kopecks')::integer, paid_kopecks = (item->>'paid_kopecks')::integer,
        note = item->>'note'
      where id = current_row.id returning * into saved;
    else
      if item->>'kind' = 'appointment' and item->>'status' = 'completed'
         and item->'confirm_completed' is distinct from 'true'::jsonb then
        raise exception 'SCHEDULE_CONFIRM_COMPLETED';
      end if;
      insert into public.appointments (therapist_id, patient_id, initial_name, starts_at, ends_at, schedule_timezone, kind, status, price_kopecks, paid_kopecks, note)
      values (auth.uid(), (item->>'patient_id')::uuid, item->>'initial_name', (item->>'starts_at')::timestamptz,
        (item->>'ends_at')::timestamptz, coalesce(nullif(item->>'schedule_timezone', ''), 'Europe/Moscow'), item->>'kind', item->>'status', (item->>'price_kopecks')::integer,
        (item->>'paid_kopecks')::integer, item->>'note') returning * into saved;
    end if;
    if save_tariff and saved.patient_id is not null and saved.kind = 'appointment' then
      update public.patients set schedule_price_kopecks = saved.price_kopecks where id = saved.patient_id and therapist_id = auth.uid();
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.save_schedule_entries(jsonb, boolean) from public, anon;
grant execute on function public.save_schedule_entries(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;

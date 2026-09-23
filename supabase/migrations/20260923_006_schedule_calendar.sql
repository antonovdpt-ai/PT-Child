begin;

alter table public.patients add column if not exists schedule_price_kopecks integer
  check (schedule_price_kopecks between 0 and 100000000);
alter table public.appointments add column if not exists initial_name text
  check (length(initial_name) <= 120);

-- Preserve the last known non-zero individual price when upgrading the first calendar.
update public.patients p set schedule_price_kopecks = (
  select a.price_kopecks from public.appointments a
  where a.patient_id = p.id and a.therapist_id = p.therapist_id
    and a.kind = 'appointment' and a.price_kopecks > 0
  order by a.created_at desc, a.id desc limit 1
) where p.schedule_price_kopecks is null;

drop policy if exists account_must_be_active on public.appointments;
create policy account_must_be_active on public.appointments as restrictive
  for all to authenticated using (public.account_is_active()) with check (public.account_is_active());

-- All writes in a series, including an optional individual tariff, commit together.
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
      update public.appointments set
        patient_id = (item->>'patient_id')::uuid, initial_name = item->>'initial_name',
        starts_at = (item->>'starts_at')::timestamptz, ends_at = (item->>'ends_at')::timestamptz,
        kind = item->>'kind', status = item->>'status',
        price_kopecks = (item->>'price_kopecks')::integer, paid_kopecks = (item->>'paid_kopecks')::integer,
        note = item->>'note'
      where id = current_row.id returning * into saved;
    else
      insert into public.appointments (therapist_id, patient_id, initial_name, starts_at, ends_at, kind, status, price_kopecks, paid_kopecks, note)
      values (auth.uid(), (item->>'patient_id')::uuid, item->>'initial_name', (item->>'starts_at')::timestamptz,
        (item->>'ends_at')::timestamptz, item->>'kind', item->>'status', (item->>'price_kopecks')::integer,
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

-- Pay the selected visit and previous completed debts exactly once; future visits are untouched.
create or replace function public.settle_schedule_patient(appointment_id uuid, expected_due bigint)
returns bigint language plpgsql security invoker set search_path = public as $$
declare target public.appointments; due bigint;
begin
  if not public.account_is_active() then raise exception 'Account is not active'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into target from public.appointments where id = appointment_id and therapist_id = auth.uid() for update;
  if not found or target.kind <> 'appointment' or target.status not in ('planned', 'completed') then
    raise exception 'Invalid payment target';
  end if;
  perform 1 from public.appointments where therapist_id = auth.uid() and
    (id = target.id or (patient_id = target.patient_id and status = 'completed' and kind = 'appointment'))
    order by id for update;
  select coalesce(sum(price_kopecks::bigint - paid_kopecks), 0) into due from public.appointments
    where therapist_id = auth.uid() and (id = target.id or (patient_id = target.patient_id and status = 'completed' and kind = 'appointment'));
  if due <> expected_due then raise exception 'SCHEDULE_STALE'; end if;
  update public.appointments set paid_kopecks = price_kopecks where therapist_id = auth.uid()
    and (id = target.id or (patient_id = target.patient_id and status = 'completed' and kind = 'appointment'));
  return due;
end;
$$;
revoke all on function public.settle_schedule_patient(uuid, bigint) from public, anon;
grant execute on function public.settle_schedule_patient(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
select 'SCHEDULE_CALENDAR_READY' as result;

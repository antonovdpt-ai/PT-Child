-- Run as a database administrator after the approved review. Keep reviewed IDs private.
-- NULL session_id means explicitly approved creation of an empty completed visit.
begin;
set local lock_timeout = '10s';

create temporary table session_history_review (
  appointment_id uuid primary key,
  session_id uuid unique,
  patient_id uuid not null,
  status text not null,
  starts_at timestamptz not null,
  schedule_timezone text not null,
  appointment_updated_at timestamptz not null,
  session_updated_at timestamptz,
  check ((session_id is null) = (session_updated_at is null)),
  check (session_id is not null or status = 'completed')
) on commit drop;

-- Add reviewed rows here.

do $$
begin
  if auth.uid() is not null then
    raise exception 'Run reconciliation through an administrative SQL session without a user JWT';
  end if;

  perform 1 from public.appointments a
    join session_history_review r on r.appointment_id = a.id
    order by a.id for update of a;
  perform 1 from public.sessions s
    join session_history_review r on r.session_id = s.id
    order by s.id for update of s;

  if exists (
    select 1 from session_history_review r
    left join public.appointments a on a.id = r.appointment_id
    left join public.sessions selected on selected.id = r.session_id
    left join public.sessions existing on existing.id = a.session_id
    where a.id is null or a.kind <> 'appointment' or a.status is distinct from r.status
       or a.patient_id is distinct from r.patient_id or a.starts_at is distinct from r.starts_at
       or (r.session_id is not null and (
         selected.id is null or selected.patient_id is distinct from a.patient_id
         or selected.therapist_id is distinct from a.therapist_id
         or (a.session_id is not null and a.session_id <> r.session_id)
         or (selected.origin = 'schedule' and a.session_id is distinct from r.session_id)
         or exists (
           select 1 from public.appointments other
           where other.session_id = r.session_id and other.id <> r.appointment_id
         )
       ))
       or (r.session_id is null and a.session_id is not null and existing.origin <> 'schedule')
       or ((a.updated_at is distinct from r.appointment_updated_at
          or (r.session_id is not null and selected.updated_at is distinct from r.session_updated_at))
         and not (a.session_id is not null and existing.origin = 'schedule'
           and a.schedule_timezone = r.schedule_timezone and a.history_review_required is false))
  ) then
    raise exception 'Approved reconciliation batch no longer matches the database';
  end if;
end;
$$;

update public.appointments a
set session_id = coalesce(a.session_id, r.session_id),
    schedule_timezone = r.schedule_timezone,
    history_review_required = false
from session_history_review r
where a.id = r.appointment_id
  and (a.session_id is null or a.schedule_timezone is distinct from r.schedule_timezone
    or a.history_review_required is distinct from false
    or exists (select 1 from public.sessions s where s.id = a.session_id and s.origin = 'manual'))
returning a.id, a.session_id;

-- Dry run by default. Replace with COMMIT only for the separately approved batch.
rollback;

-- Run after migration 008. Keep these results in the authorized database console.
-- Same-day records are leads for review. The query omits clinical text and names.
begin read only;

with history_review as (
  select a.id as appointment_id, a.patient_id, a.status, a.starts_at,
         a.schedule_timezone, a.updated_at as appointment_updated_at,
         a.session_id as linked_session_id, s.updated_at as linked_session_updated_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('session_id', candidate.id,
             'session_date', candidate.session_date, 'updated_at', candidate.updated_at)
             order by candidate.created_at, candidate.id)
           from public.sessions candidate
           where candidate.patient_id = a.patient_id and candidate.therapist_id = a.therapist_id
             and candidate.origin = 'manual'
             and candidate.session_date = (a.starts_at at time zone a.schedule_timezone)::date
             and not exists (
               select 1 from public.appointments linked where linked.session_id = candidate.id
             )
         ), '[]'::jsonb) as same_day_manual_candidates
  from public.appointments a
  left join public.sessions s on s.id = a.session_id
  where a.kind = 'appointment' and a.patient_id is not null
    and ((a.status = 'completed' and a.session_id is null) or s.origin = 'manual')
)
select *, case
  when linked_session_id is not null then 'existing_link'
  when jsonb_array_length(same_day_manual_candidates) = 0 then 'verify_visit_and_search_history'
  else 'verify_visit_and_review_manual_matches'
end as review_action
from history_review
order by starts_at, appointment_id;

commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.account_deletion_jobs (
  user_id uuid primary key,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'completed')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  next_retry_at timestamptz not null default now(),
  last_error_code text
);

comment on table public.account_deletion_jobs is
  'Durable account-deletion tombstones. Rows intentionally survive auth user deletion and backup restore.';

alter table public.account_deletion_jobs enable row level security;
revoke all on public.account_deletion_jobs from public, anon, authenticated;
grant all on public.account_deletion_jobs to service_role;

create or replace function public.claim_account_deletion_jobs(
  p_batch_limit integer default 20,
  p_target_user_id uuid default null
)
returns table (user_id uuid, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select job.user_id
    from public.account_deletion_jobs job
    where (p_target_user_id is null or job.user_id = p_target_user_id)
      and (
        (
          job.status in ('pending', 'retry')
          and job.next_retry_at <= now()
        )
        or (
          job.status = 'processing'
          and job.updated_at <= now() - interval '15 minutes'
        )
      )
    order by job.requested_at
    for update skip locked
    limit greatest(1, least(p_batch_limit, 20))
  ), claimed as (
    update public.account_deletion_jobs job
    set status = 'processing',
        attempts = job.attempts + 1,
        updated_at = now(),
        last_error_code = null
    from candidates
    where job.user_id = candidates.user_id
    returning job.user_id, job.attempts
  )
  select claimed.user_id, claimed.attempts
  from claimed;
end
$$;

revoke all on function public.claim_account_deletion_jobs(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_account_deletion_jobs(integer, uuid)
  to service_role;

create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and not exists (
      select 1
      from public.account_deletion_jobs job
      where job.user_id = auth.uid()
    );
$$;

revoke all on function public.account_is_active() from public;
grant execute on function public.account_is_active() to authenticated;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'ai_analysis_history', 'assessments', 'goals', 'parent_reports',
    'patient_contacts', 'patient_media', 'patients', 'profiles', 'sessions',
    'standardized_assessments', 'user_consents'
  ]
  loop
    execute format(
      'drop policy if exists account_must_be_active on public.%I',
      target_table
    );
    execute format(
      'create policy account_must_be_active on public.%I as restrictive for all to authenticated using (public.account_is_active()) with check (public.account_is_active())',
      target_table
    );
  end loop;
end
$$;

drop policy if exists account_must_be_active on storage.objects;
create policy account_must_be_active
  on storage.objects
  as restrictive
  for all
  to authenticated
  using (public.account_is_active())
  with check (public.account_is_active());

commit;

select 'ACCOUNT_DELETION_TOMBSTONES_OK' as result;

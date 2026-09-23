-- Fizira specialist schedule MVP. All money amounts are stored in kopecks.
create extension if not exists btree_gist;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'appointment' check (kind in ('appointment', 'break', 'personal')),
  status text not null default 'planned' check (status in ('planned', 'completed', 'cancelled', 'no_show')),
  price_kopecks integer not null default 0 check (price_kopecks >= 0),
  paid_kopecks integer not null default 0 check (paid_kopecks >= 0 and paid_kopecks <= price_kopecks),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_valid_time check (ends_at > starts_at)
);

-- One specialist cannot have two active time blocks at once.
alter table public.appointments
  add constraint appointments_no_active_overlap
  exclude using gist (
    therapist_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('planned', 'completed'));

create index if not exists appointments_therapist_starts_at_idx
  on public.appointments (therapist_id, starts_at);
create index if not exists appointments_patient_id_idx
  on public.appointments (patient_id);

alter table public.appointments enable row level security;

create policy appointments_select_own on public.appointments
  for select to authenticated using (therapist_id = auth.uid());
create policy appointments_insert_own on public.appointments
  for insert to authenticated with check (
    therapist_id = auth.uid() and
    (patient_id is null or exists (
      select 1 from public.patients p
      where p.id = appointments.patient_id and p.therapist_id = auth.uid()
    )) and
    (session_id is null or exists (
      select 1 from public.sessions s
      where s.id = appointments.session_id
        and s.therapist_id = auth.uid()
        and (appointments.patient_id is null or s.patient_id = appointments.patient_id)
    ))
  );
create policy appointments_update_own on public.appointments
  for update to authenticated using (therapist_id = auth.uid()) with check (
    therapist_id = auth.uid() and
    (patient_id is null or exists (
      select 1 from public.patients p
      where p.id = appointments.patient_id and p.therapist_id = auth.uid()
    )) and
    (session_id is null or exists (
      select 1 from public.sessions s
      where s.id = appointments.session_id
        and s.therapist_id = auth.uid()
        and (appointments.patient_id is null or s.patient_id = appointments.patient_id)
    ))
  );
create policy appointments_delete_own on public.appointments
  for delete to authenticated using (therapist_id = auth.uid());

create or replace function public.set_appointments_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function public.set_appointments_updated_at();

grant select, insert, update, delete on public.appointments to authenticated;

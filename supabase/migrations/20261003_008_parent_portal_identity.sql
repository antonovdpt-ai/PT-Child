-- Parent identity boundary. No clinical source-table or Storage policy is widened.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.patient_contacts add column if not exists email text;

create or replace function public.normalize_parent_contact_email()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  return new;
end;
$$;

drop trigger if exists normalize_parent_contact_email on public.patient_contacts;
create trigger normalize_parent_contact_email before insert or update of email
on public.patient_contacts for each row execute function public.normalize_parent_contact_email();
alter table public.patient_contacts drop constraint if exists patient_contacts_email_check;
alter table public.patient_contacts add constraint patient_contacts_email_check check (
  email is null or (email = lower(btrim(email)) and length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

-- Creation and backfill share one transaction. A retry must never promote users
-- registered after the initial deployment (including invited parents).
do $$
begin
  if to_regclass('public.app_user_roles') is null then
    create table public.app_user_roles (
      user_id uuid not null references auth.users(id) on delete cascade,
      role text not null check (role in ('specialist', 'parent')),
      created_at timestamptz not null default now(),
      primary key(user_id, role)
    );
    insert into public.app_user_roles(user_id, role)
      select id, 'specialist' from auth.users;
  end if;
end;
$$;

create table if not exists public.legal_document_versions (
  document_type text not null check (document_type in ('terms', 'privacy', 'personal_data_consent')),
  document_version text not null check (length(document_version) between 1 and 64),
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  public_url text not null check (length(public_url) between 1 and 2048 and public_url like 'https://%'),
  is_active boolean not null default true,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(document_type, document_version)
);
create unique index if not exists legal_document_versions_one_active
  on public.legal_document_versions(document_type) where is_active;
insert into public.legal_document_versions(document_type,document_version,document_hash,public_url)
values
  ('terms','1.0','fdbab5aa8ba0fe7a9d453659a7723231ab0193ce93cf43128c974f75e5bf9f26','https://fizira.com/terms'),
  ('privacy','1.0','422ebcc1a8af520320cf5cd415dc3426ce471ba75d0a4bdb6395adb0d1ac86dd','https://fizira.com/privacy'),
  ('personal_data_consent','1.0','7bb19b50f9e9c190b8a46b87624fa9e300e794b0dbde2fbe73fe2ec9ecf8cd41','https://fizira.com/consent')
on conflict (document_type,document_version) do nothing;

-- Evidence is independent of canonical consent and invitation lifecycle rows:
-- no cascading foreign keys may erase it. Prior evidence is not reclassified as
-- authoritative; parent-acceptance events contain only server-selected metadata.
create table if not exists public.parent_consent_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  invitation_id uuid,
  evidence_kind text not null check (evidence_kind in ('prior-consent','parent-acceptance')),
  document_type text not null,
  document_version text not null,
  document_hash text,
  accepted_at timestamptz not null,
  source text not null,
  consent_snapshot jsonb not null check (jsonb_typeof(consent_snapshot)='object'),
  recorded_at timestamptz not null default now(),
  check ((evidence_kind='prior-consent' and invitation_id is null)
    or (evidence_kind='parent-acceptance' and invitation_id is not null))
);
create index if not exists parent_consent_audit_user_idx
  on public.parent_consent_audit(user_id,document_type,document_version,recorded_at);

create or replace function public.preserve_prior_parent_consent()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.parent_consent_audit(user_id,evidence_kind,document_type,document_version,
    document_hash,accepted_at,source,consent_snapshot)
  values(old.user_id,'prior-consent',old.document_type,old.document_version,
    old.document_hash,old.accepted_at,old.source,to_jsonb(old));
  return new;
end;
$$;
-- A BEFORE UPDATE trigger sees the row locked by ON CONFLICT, including a
-- concurrently committed acceptance. Archiving in a preceding unlocked SELECT
-- would miss that evidence. The archive and replacement roll back together.
drop trigger if exists preserve_prior_parent_consent on public.user_consents;
create trigger preserve_prior_parent_consent before update on public.user_consents
  for each row when (old.document_type is not null and old.document_version is not null)
  execute function public.preserve_prior_parent_consent();

create or replace function public.reject_parent_consent_audit_mutation()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Parent consent audit is append-only' using errcode='42501';
end;
$$;
drop trigger if exists parent_consent_audit_append_only on public.parent_consent_audit;
create trigger parent_consent_audit_append_only before update or delete or truncate
  on public.parent_consent_audit for each statement
  execute function public.reject_parent_consent_audit_mutation();

create table if not exists public.parent_child_access (
  id uuid primary key default gen_random_uuid(),
  parent_user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.patient_contacts(id) on delete set null,
  status text not null default 'active' check (status in ('active','revoked')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint parent_child_access_revocation_check check (
    (status='active' and revoked_at is null and revoked_by is null)
    or (status='revoked' and revoked_at is not null)
  )
);
create unique index if not exists parent_child_access_one_active
  on public.parent_child_access(parent_user_id,patient_id) where status='active';
create index if not exists parent_child_access_contact_idx on public.parent_child_access(contact_id,patient_id);
create index if not exists parent_child_access_therapist_idx on public.parent_child_access(therapist_id,patient_id);

create table if not exists public.parent_invitations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.patient_contacts(id) on delete cascade,
  email_normalized text not null check (email_normalized=lower(btrim(email_normalized))
    and length(email_normalized) between 3 and 254
    and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  auth_flow text not null check (auth_flow in ('new','existing')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint parent_invitations_expiry_check check (expires_at=created_at+interval '7 days'),
  constraint parent_invitations_state_check check (
    not (accepted_at is not null and revoked_at is not null)
    and (accepted_at is not null or accepted_by is null)
    and (revoked_at is not null or revoked_by is null)
  )
);
create unique index if not exists parent_invitations_one_pending_contact
  on public.parent_invitations(contact_id) where accepted_at is null and revoked_at is null;
create index if not exists parent_invitations_therapist_idx on public.parent_invitations(therapist_id,patient_id);

create or replace function public.check_parent_access_owner()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from public.patients p
    where p.id=new.patient_id and p.therapist_id=new.therapist_id) then
    raise exception 'Access therapist must match patient owner' using errcode='23514';
  end if;
  if new.contact_id is not null and not exists (select 1 from public.patient_contacts c
    where c.id=new.contact_id and c.patient_id=new.patient_id and c.therapist_id=new.therapist_id) then
    raise exception 'Access contact ownership mismatch' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists check_parent_access_owner on public.parent_child_access;
create trigger check_parent_access_owner before insert or update on public.parent_child_access
  for each row execute function public.check_parent_access_owner();

alter table public.app_user_roles enable row level security;
alter table public.legal_document_versions enable row level security;
alter table public.parent_consent_audit enable row level security;
alter table public.parent_child_access enable row level security;
alter table public.parent_invitations enable row level security;

drop policy if exists app_user_roles_select_own on public.app_user_roles;
create policy app_user_roles_select_own on public.app_user_roles for select to authenticated using(user_id=auth.uid());
drop policy if exists legal_document_versions_select_current on public.legal_document_versions;
create policy legal_document_versions_select_current on public.legal_document_versions for select to authenticated using(is_active);
drop policy if exists parent_child_access_specialist_select on public.parent_child_access;
create policy parent_child_access_specialist_select on public.parent_child_access for select to authenticated using (
  therapist_id=auth.uid() and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
  and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid())
);
drop policy if exists parent_invitations_specialist_select on public.parent_invitations;
create policy parent_invitations_specialist_select on public.parent_invitations for select to authenticated using (
  therapist_id=auth.uid() and exists(select 1 from public.app_user_roles r where r.user_id=auth.uid() and r.role='specialist')
  and exists(select 1 from public.patients p where p.id=patient_id and p.therapist_id=auth.uid())
);

revoke all on public.app_user_roles, public.legal_document_versions, public.parent_child_access, public.parent_invitations,
  public.parent_consent_audit from public, anon, authenticated, service_role;
grant select on public.app_user_roles, public.legal_document_versions, public.parent_child_access, public.parent_invitations to authenticated, service_role;
grant select on public.parent_consent_audit to service_role;

create or replace function public.current_app_roles()
returns table(role text) language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  return query select r.role from public.app_user_roles r where r.user_id=auth.uid() order by r.role;
end;
$$;

create or replace function public.parent_has_active_access(p_parent_user_id uuid, p_patient_id uuid)
returns boolean language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_parent_user_id is distinct from auth.uid() or p_patient_id is null then return false; end if;
  return exists(select 1 from public.parent_child_access a
    join public.patients p on p.id=a.patient_id and p.therapist_id=a.therapist_id
    join public.app_user_roles r on r.user_id=a.parent_user_id and r.role='parent'
    where a.parent_user_id=p_parent_user_id and a.patient_id=p_patient_id and a.status='active');
end;
$$;

create or replace function public.parent_invitation_state(p_token text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  invitation public.parent_invitations%rowtype;
  user_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_token is null or length(p_token) not between 32 and 256 or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid invitation token' using errcode='22023';
  end if;
  select * into invitation from public.parent_invitations where token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found then return jsonb_build_object('state','invalid'); end if;
  select lower(btrim(u.email)) into user_email from auth.users u where u.id=auth.uid();
  if user_email is distinct from invitation.email_normalized then return jsonb_build_object('state','email_mismatch'); end if;
  if invitation.revoked_at is not null then return jsonb_build_object('state','revoked'); end if;
  if invitation.accepted_at is not null then return jsonb_build_object('state','accepted'); end if;
  if invitation.expires_at<=now() then return jsonb_build_object('state','expired'); end if;
  if not exists(select 1 from public.patient_contacts c join public.patients p on p.id=c.patient_id
    where c.id=invitation.contact_id and c.patient_id=invitation.patient_id
      and c.therapist_id=invitation.therapist_id and p.therapist_id=invitation.therapist_id
      and c.email=invitation.email_normalized) then return jsonb_build_object('state','invalid'); end if;
  return jsonb_build_object('state','valid','auth_flow',invitation.auth_flow);
end;
$$;

-- Service-only: p_therapist_id is the verified bearer actor supplied by the Edge
-- Function, not a browser RPC argument. Grant boundaries enforce this contract.
create or replace function public.issue_parent_invitation_record(
  p_therapist_id uuid, p_patient_id uuid, p_contact_id uuid, p_token_digest text, p_auth_flow text
)
returns table(invitation_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  contact_email text;
begin
  if p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$' then raise exception 'Invalid token digest' using errcode='22023'; end if;
  if p_auth_flow is null or p_auth_flow not in ('new','existing') then raise exception 'Invalid auth flow' using errcode='22023'; end if;
  if not exists(select 1 from public.app_user_roles where user_id=p_therapist_id and role='specialist') then
    raise exception 'Specialist ownership required' using errcode='42501';
  end if;
  perform 1 from public.patients where id=p_patient_id and therapist_id=p_therapist_id for update;
  if not found then raise exception 'Patient ownership mismatch' using errcode='42501'; end if;
  select lower(btrim(email)) into contact_email from public.patient_contacts
    where id=p_contact_id and patient_id=p_patient_id and therapist_id=p_therapist_id for update;
  if not found or contact_email is null then raise exception 'Contact ownership and email required' using errcode='22023'; end if;
  update public.parent_invitations set revoked_at=now(),revoked_by=p_therapist_id
    where contact_id=p_contact_id and accepted_at is null and revoked_at is null;
  return query insert into public.parent_invitations(patient_id,therapist_id,contact_id,email_normalized,token_digest,auth_flow)
    values(p_patient_id,p_therapist_id,p_contact_id,contact_email,p_token_digest,p_auth_flow)
    returning id,public.parent_invitations.expires_at;
end;
$$;

create or replace function public.accept_parent_invitation(p_token text, p_accepted_documents jsonb)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  invitation public.parent_invitations%rowtype;
  user_email text;
  contact_email text;
  access_id uuid;
  document_record record;
  consent_record public.user_consents%rowtype;
  current_document_count integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_token is null or length(p_token) not between 32 and 256 or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid invitation token' using errcode='22023';
  end if;
  if p_accepted_documents is null or jsonb_typeof(p_accepted_documents) is distinct from 'array'
    or octet_length(p_accepted_documents::text)>2048 then
    raise exception 'Invalid legal acceptance documents' using errcode='22023';
  end if;
  if jsonb_array_length(p_accepted_documents)<>3 or exists (
    select 1 from jsonb_array_elements(p_accepted_documents) d
    where jsonb_typeof(d)<>'object' or d->'accepted' is distinct from 'true'::jsonb
      or d->>'document_type' is null or d->>'document_type' not in ('terms','privacy','personal_data_consent')
      or d - 'document_type' - 'accepted' <> '{}'::jsonb
  ) or (select count(distinct d->>'document_type') from jsonb_array_elements(p_accepted_documents) d)<>3 then
    raise exception 'Exactly three required legal document acceptances are required' using errcode='22023';
  end if;
  select * into invitation from public.parent_invitations where token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found then raise exception 'Invalid invitation' using errcode='22023'; end if;
  -- Consistent lock order across issue/accept/revoke: patient, contact, invitation/access.
  perform 1 from public.patients where id=invitation.patient_id and therapist_id=invitation.therapist_id for update;
  if not found then raise exception 'Invitation patient ownership changed' using errcode='42501'; end if;
  select email into contact_email from public.patient_contacts
    where id=invitation.contact_id and patient_id=invitation.patient_id and therapist_id=invitation.therapist_id for update;
  if not found or contact_email is distinct from invitation.email_normalized then
    raise exception 'Invitation contact email changed' using errcode='22023';
  end if;
  select * into invitation from public.parent_invitations where id=invitation.id for update;
  if invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() then
    raise exception 'Invitation is revoked, accepted or expired' using errcode='22023';
  end if;
  select lower(btrim(u.email)) into user_email from auth.users u where u.id=current_user_id for share;
  if user_email is distinct from invitation.email_normalized then raise exception 'Invitation email mismatch' using errcode='42501'; end if;
  for document_record in select * from public.legal_document_versions where is_active and is_required for share loop
    current_document_count := current_document_count+1;
    insert into public.user_consents(user_id,document_type,document_version,document_hash,accepted_at,source)
      values(current_user_id,document_record.document_type,document_record.document_version,document_record.document_hash,now(),'parent-invitation')
      on conflict(user_id,document_type,document_version) where document_type is not null and document_version is not null
      do update set document_hash=excluded.document_hash,accepted_at=excluded.accepted_at,source=excluded.source
      returning * into consent_record;
    insert into public.parent_consent_audit(user_id,invitation_id,evidence_kind,document_type,document_version,
      document_hash,accepted_at,source,consent_snapshot)
    values(current_user_id,invitation.id,'parent-acceptance',consent_record.document_type,consent_record.document_version,
      consent_record.document_hash,consent_record.accepted_at,consent_record.source,to_jsonb(consent_record));
  end loop;
  if current_document_count<>3 then raise exception 'Required legal documents are not configured' using errcode='22023'; end if;
  insert into public.app_user_roles(user_id,role) values(current_user_id,'parent') on conflict do nothing;
  insert into public.parent_child_access(parent_user_id,patient_id,therapist_id,contact_id)
    values(current_user_id,invitation.patient_id,invitation.therapist_id,invitation.contact_id)
    on conflict(parent_user_id,patient_id) where status='active' do nothing returning id into access_id;
  if access_id is null then
    select id into access_id from public.parent_child_access where parent_user_id=current_user_id and patient_id=invitation.patient_id and status='active';
  end if;
  update public.parent_invitations set accepted_at=now(),accepted_by=current_user_id where id=invitation.id;
  return access_id;
end;
$$;

create or replace function public.revoke_parent_access_record(p_therapist_id uuid, p_access_id uuid)
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  access_record public.parent_child_access%rowtype;
  affected integer;
begin
  select * into access_record from public.parent_child_access where id=p_access_id and therapist_id=p_therapist_id;
  if not found or not exists(select 1 from public.app_user_roles where user_id=p_therapist_id and role='specialist') then
    raise exception 'Specialist access ownership required' using errcode='42501';
  end if;
  perform 1 from public.patients where id=access_record.patient_id and therapist_id=p_therapist_id for update;
  if not found then raise exception 'Patient ownership mismatch' using errcode='42501'; end if;
  perform 1 from public.patient_contacts where id=access_record.contact_id for update;
  update public.parent_invitations set revoked_at=now(),revoked_by=p_therapist_id
    where contact_id=access_record.contact_id and patient_id=access_record.patient_id
      and accepted_at is null and revoked_at is null;
  update public.parent_child_access set status='revoked',revoked_at=now(),revoked_by=p_therapist_id
    where id=p_access_id and status='active';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.normalize_parent_contact_email(), public.check_parent_access_owner(),
  public.preserve_prior_parent_consent(), public.reject_parent_consent_audit_mutation(),
  public.current_app_roles(), public.parent_has_active_access(uuid,uuid), public.parent_invitation_state(text),
  public.accept_parent_invitation(text,jsonb), public.issue_parent_invitation_record(uuid,uuid,uuid,text,text),
  public.revoke_parent_access_record(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.current_app_roles(), public.parent_has_active_access(uuid,uuid),
  public.parent_invitation_state(text), public.accept_parent_invitation(text,jsonb) to authenticated;
grant execute on function public.issue_parent_invitation_record(uuid,uuid,uuid,text,text),
  public.revoke_parent_access_record(uuid,uuid) to service_role;

commit;

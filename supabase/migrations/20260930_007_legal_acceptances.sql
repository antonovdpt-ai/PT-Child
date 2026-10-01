-- Per-document legal acceptance records for Fizira release 1.0.
-- Idempotent for the existing production user_consents table.

begin;

do $$
begin
  if to_regclass('public.user_consents') is null then
    raise exception 'public.user_consents is required before legal acceptance migration';
  end if;
end
$$;

alter table public.user_consents
  alter column terms_version drop not null,
  alter column privacy_version drop not null,
  add column if not exists document_type text,
  add column if not exists document_version text,
  add column if not exists document_hash text,
  add column if not exists source text not null default 'legacy-migration';

insert into public.user_consents (
  user_id,
  document_type,
  document_version,
  accepted_at,
  source
)
select
  legacy.user_id,
  expanded.document_type,
  expanded.document_version,
  legacy.accepted_at,
  'legacy-migration'
from public.user_consents legacy
cross join lateral (
  values
    ('terms'::text, legacy.terms_version),
    ('privacy'::text, legacy.privacy_version)
) expanded(document_type, document_version)
where expanded.document_version is not null
  and not exists (
    select 1
    from public.user_consents existing
    where existing.user_id = legacy.user_id
      and existing.document_type = expanded.document_type
      and existing.document_version = expanded.document_version
  );

create unique index if not exists user_consents_document_acceptance_key
  on public.user_consents (user_id, document_type, document_version)
  where document_type is not null and document_version is not null;

alter table public.user_consents
  drop constraint if exists user_consents_document_shape_check;

alter table public.user_consents
  add constraint user_consents_document_shape_check check (
    (
      document_type is null
      and document_version is null
      and terms_version is not null
      and privacy_version is not null
    )
    or
    (
      document_type ~ '^[a-z][a-z0-9_]{1,63}$'
      and document_version is not null
      and length(document_version) between 1 and 64
      and terms_version is null
      and privacy_version is null
      and (
        document_hash is null
        or document_hash ~ '^[0-9a-f]{64}$'
      )
    )
  ) not valid;

alter table public.user_consents
  validate constraint user_consents_document_shape_check;

create or replace function public.record_legal_acceptances(
  p_documents jsonb,
  p_source text default 'web'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  document_record record;
  inserted_count integer := 0;
  affected_count integer := 0;
  safe_source text := left(coalesce(nullif(trim(p_source), ''), 'web'), 100);
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if jsonb_typeof(p_documents) <> 'array'
     or jsonb_array_length(p_documents) = 0
     or jsonb_array_length(p_documents) > 10 then
    raise exception 'p_documents must be a non-empty array with at most 10 items'
      using errcode = '22023';
  end if;

  for document_record in
    select
      trim(item.document_type) as document_type,
      trim(item.document_version) as document_version,
      nullif(lower(trim(item.document_hash)), '') as document_hash
    from jsonb_to_recordset(p_documents) as item(
      document_type text,
      document_version text,
      document_hash text
    )
  loop
    if document_record.document_type is null
       or document_record.document_type not in (
      'terms',
      'privacy',
      'personal_data_consent'
    ) then
      raise exception 'Unsupported legal document type'
        using errcode = '22023';
    end if;

    if document_record.document_version is null
       or length(document_record.document_version) not between 1 and 64 then
      raise exception 'Invalid legal document version'
        using errcode = '22023';
    end if;

    if document_record.document_hash is not null
       and document_record.document_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid legal document hash'
        using errcode = '22023';
    end if;

    insert into public.user_consents (
      user_id,
      document_type,
      document_version,
      document_hash,
      source
    ) values (
      current_user_id,
      document_record.document_type,
      document_record.document_version,
      document_record.document_hash,
      safe_source
    )
    on conflict (user_id, document_type, document_version)
      where document_type is not null and document_version is not null
      do nothing;

    get diagnostics affected_count = row_count;
    inserted_count := inserted_count + affected_count;
  end loop;

  return inserted_count;
end;
$$;

create or replace function public.capture_signup_legal_acceptances()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  signup_documents jsonb := new.raw_user_meta_data -> 'legal_documents';
  signup_source text := left(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'legal_acceptance_source'), ''),
      'web-signup'
    ),
    100
  );
  document_record record;
begin
  -- Existing accounts and non-Fizira auth flows do not carry this metadata.
  if signup_documents is null then
    return new;
  end if;

  if jsonb_typeof(signup_documents) <> 'array'
     or jsonb_array_length(signup_documents) = 0
     or jsonb_array_length(signup_documents) > 10 then
    raise exception 'legal_documents must be a non-empty array with at most 10 items'
      using errcode = '22023';
  end if;

  for document_record in
    select
      trim(item.type) as document_type,
      trim(item.version) as document_version,
      nullif(lower(trim(item.hash)), '') as document_hash
    from jsonb_to_recordset(signup_documents) as item(
      type text,
      version text,
      hash text
    )
  loop
    if document_record.document_type is null
       or document_record.document_type not in (
         'terms',
         'privacy',
         'personal_data_consent'
       ) then
      raise exception 'Unsupported signup legal document type'
        using errcode = '22023';
    end if;

    if document_record.document_version is null
       or length(document_record.document_version) not between 1 and 64 then
      raise exception 'Invalid signup legal document version'
        using errcode = '22023';
    end if;

    if document_record.document_hash is not null
       and document_record.document_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid signup legal document hash'
        using errcode = '22023';
    end if;

    insert into public.user_consents (
      user_id,
      document_type,
      document_version,
      document_hash,
      source
    ) values (
      new.id,
      document_record.document_type,
      document_record.document_version,
      document_record.document_hash,
      signup_source
    )
    on conflict (user_id, document_type, document_version)
      where document_type is not null and document_version is not null
      do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists fizira_capture_signup_legal_acceptances on auth.users;
create trigger fizira_capture_signup_legal_acceptances
  after insert on auth.users
  for each row execute function public.capture_signup_legal_acceptances();

drop policy if exists user_consents_insert_own on public.user_consents;

revoke insert, update, delete on table public.user_consents from authenticated;
grant select on table public.user_consents to authenticated;

revoke all on function public.record_legal_acceptances(jsonb, text) from public;
revoke all on function public.record_legal_acceptances(jsonb, text) from anon;
grant execute on function public.record_legal_acceptances(jsonb, text) to authenticated;

revoke all on function public.capture_signup_legal_acceptances() from public;
revoke all on function public.capture_signup_legal_acceptances() from anon;
revoke all on function public.capture_signup_legal_acceptances() from authenticated;

commit;

-- Expected after deployment:
-- document records have non-null document_type/document_version; new signup records use
-- server time even when email confirmation delays the first authenticated session. Legacy
-- combined rows remain immutable for audit history and have per-document backfill rows.

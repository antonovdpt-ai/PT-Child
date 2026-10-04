-- Explicit specialist withdrawal; publication content and artifacts stay immutable.
-- Additive correction: no changes to ownership, roles, grants or publication claims.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.guard_parent_report_publication()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  metadata_keys text[] := array['publication_status','published_at','published_by','published_snapshot',
    'pdf_storage_path','pdf_generated_at','publication_error','publication_revision','published_media','publication_claim_id','publication_claimed_at','pdf_sha256'];
  key text;
begin
  if tg_op='DELETE' then
    if old.publication_status='publishing' and exists(select 1 from public.patients where id=old.patient_id) and exists(select 1 from auth.users where id=old.therapist_id) then raise exception 'Publishing report is immutable'; end if;
    if old.published_at is not null
      and exists(select 1 from public.patients p where p.id=old.patient_id)
      and exists(select 1 from auth.users u where u.id=old.therapist_id) then
      raise exception 'Published report is immutable; archive it or create a new draft' using errcode='23514';
    end if;
    -- Explicit patient/account lifecycle deletion may cascade the publication.
    return old;
  end if;
  if tg_op='UPDATE' and old.published_at is not null then
    if (to_jsonb(new)-array['publication_status','updated_at']) is distinct from
       (to_jsonb(old)-array['publication_status','updated_at'])
       or (new.publication_status is distinct from old.publication_status and
           not (old.publication_status='published' and new.publication_status='archived')) then
      raise exception 'Published report content and PDF are immutable; create a new draft' using errcode='23514';
    end if;
  end if;
  if tg_op='UPDATE' and old.publication_status='publishing' then
    if (to_jsonb(new)-metadata_keys-array['updated_at']) is distinct from (to_jsonb(old)-metadata_keys-array['updated_at']) then
      raise exception 'Publishing author fields are immutable';
    end if;
  end if;
  if current_setting('role',true)='authenticated' then
    if tg_op='UPDATE' and old.publication_status='publishing' then raise exception 'Publishing report is immutable'; end if;
    if tg_op='INSERT' then
      if new.publication_status<>'draft' or new.published_at is not null or new.published_by is not null
        or new.published_snapshot is not null or new.pdf_storage_path is not null
        or new.pdf_generated_at is not null or new.publication_error is not null
        or new.publication_claim_id is not null or new.publication_claimed_at is not null or new.pdf_sha256 is not null then
        raise exception 'Publication metadata is server-only' using errcode='42501';
      end if;
      if tg_table_name='parent_session_reports' then
        if new.published_media<>'[]'::jsonb then
          raise exception 'Publication media metadata is server-only' using errcode='42501';
        end if;
      end if;
    else
      foreach key in array metadata_keys loop
        if to_jsonb(new)->key is distinct from to_jsonb(old)->key
          and not (key='publication_status' and old.publication_status='published' and new.publication_status='archived') then
          raise exception 'Publication metadata is server-only' using errcode='42501';
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$$;
commit;

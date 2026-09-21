begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1
    from public.patient_media
    where left(storage_path, length(therapist_id::text) + 1)
            <> therapist_id::text || '/'
       or length(storage_path) <= length(therapist_id::text) + 1
  ) then
    raise exception
      'patient_media contains storage paths that do not belong to therapist_id; migration aborted without changes';
  end if;
end
$$;

alter table public.patient_media
  drop constraint if exists patient_media_storage_path_owner_check;

alter table public.patient_media
  add constraint patient_media_storage_path_owner_check
  check (
    left(storage_path, length(therapist_id::text) + 1)
      = therapist_id::text || '/'
    and length(storage_path) > length(therapist_id::text) + 1
  );

comment on constraint patient_media_storage_path_owner_check
  on public.patient_media
  is 'Requires Storage metadata paths to remain inside the therapist UUID prefix.';

commit;

select 'PATIENT_MEDIA_PATH_INTEGRITY_OK' as result;

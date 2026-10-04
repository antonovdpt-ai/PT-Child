-- Read-only entry point for the entire effective parent security boundary.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/verification/verify_parent_portal.sql
\set ON_ERROR_STOP on
begin read only;
set local statement_timeout='60s';
-- Stable catalog deparsing; any unknown definition drift remains release-blocking.
set local search_path=pg_catalog,public;
-- Includes exact function bodies/search paths, effective grants, RLS expressions,
-- partial indexes, ownership/publication guards, private bucket and Storage rights,
-- signup reservation/role provisioning and012 immutable withdrawal checks.
\ir verify_migration.sql
\ir verify_parent_portal_definitions.sql

-- Additional release checks for invariants not asserted by the legacy entry point.
do $verify$
declare expected record; source_table text;
begin
 if not exists(select 1 from storage.buckets where id='patient-media' and name='patient-media' and public=false) then
  raise exception 'Missing private patient-media bucket';
 end if;
 foreach source_table in array array['patients','assessments','sessions','goals','patient_contacts','patient_media','parent_reports','standardized_assessments','ai_analysis_history','appointments'] loop
  if not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.'||source_table)),false) then raise exception 'Missing clinical source RLS: %',source_table; end if;
 end loop;
 for expected in select * from (values
 ('parent_child_access_one_active','CREATE UNIQUE INDEX parent_child_access_one_active ON public.parent_child_access USING btree (parent_user_id, patient_id) WHERE (status = ''active''::text)'),
 ('parent_invitations_one_pending_contact','CREATE UNIQUE INDEX parent_invitations_one_pending_contact ON public.parent_invitations USING btree (contact_id) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL))')
 ) expected_indexes(name,definition) loop
  if not exists(select 1 from pg_index where indexrelid=to_regclass('public.'||expected.name) and indisunique and indisvalid and indisready
   and regexp_replace(pg_get_indexdef(indexrelid),'[[:space:]]','','g')=regexp_replace(expected.definition,'[[:space:]]','','g')) then raise exception 'Unsafe partial unique index: %',expected.name; end if;
 end loop;
 for expected in select * from (values
 ('parent_reports','parent_reports_publication_check',$constraint$CHECK (((publication_status = ANY (ARRAY['draft'::text, 'publishing'::text, 'published'::text, 'publication_error'::text, 'archived'::text])) AND (publication_revision > 0) AND ((published_snapshot IS NULL) OR (jsonb_typeof(published_snapshot) = 'object'::text)) AND ((publication_status <> 'published'::text) OR ((published_at IS NOT NULL) AND (published_by IS NOT NULL) AND (published_by = therapist_id) AND (published_snapshot IS NOT NULL) AND (pdf_generated_at IS NOT NULL) AND (pdf_storage_path IS NOT NULL) AND (pdf_storage_path ~~ ((therapist_id)::text || '/parent-reports/%'::text)) AND (publication_error IS NULL)))))$constraint$),
 ('parent_session_reports','parent_session_reports_publication_check',$constraint$CHECK (((publication_status = ANY (ARRAY['draft'::text, 'publishing'::text, 'published'::text, 'publication_error'::text, 'archived'::text])) AND (publication_revision > 0) AND ((published_snapshot IS NULL) OR (jsonb_typeof(published_snapshot) = 'object'::text)) AND ((publication_status <> 'published'::text) OR ((published_at IS NOT NULL) AND (published_by IS NOT NULL) AND (published_by = therapist_id) AND (published_snapshot IS NOT NULL) AND (pdf_generated_at IS NOT NULL) AND (pdf_storage_path IS NOT NULL) AND (pdf_storage_path ~~ ((therapist_id)::text || '/parent-reports/%'::text)) AND (publication_error IS NULL)))))$constraint$),
 ('parent_invitations','parent_invitations_expiry_check',$constraint$CHECK ((expires_at = (created_at + '7 days'::interval)))$constraint$),
 ('parent_invitations','parent_invitations_state_check',$constraint$CHECK (((NOT ((accepted_at IS NOT NULL) AND (revoked_at IS NOT NULL))) AND ((accepted_at IS NOT NULL) OR (accepted_by IS NULL)) AND ((revoked_at IS NOT NULL) OR (revoked_by IS NULL))))$constraint$),
 ('parent_child_access','parent_child_access_revocation_check',$constraint$CHECK ((((status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL))))$constraint$)
 ) expected_constraints(table_name,name,definition) loop
  if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||expected.table_name) and conname=expected.name and contype='c' and convalidated
   and regexp_replace(pg_get_constraintdef(oid),'[[:space:]]','','g')=regexp_replace(expected.definition,'[[:space:]]','','g')) then raise exception 'Unsafe publication/invitation constraint: %',expected.name; end if;
 end loop;
end; $verify$;
rollback;

# Fizira Supabase: воспроизводимая схема

Эта папка хранит только очищенные SQL-артефакты приложения. Здесь не должно
быть данных пациентов, дампов Auth/Storage, паролей, JWT, API-ключей и `.env`.

## Состав

- `migrations/20260920_001_app_schema.sql` — развёртывание схемы Fizira на
  чистом, уже инициализированном self-hosted Supabase.
- `migrations/20260921_002_existing_target_security_fix.sql` — одноразовое
  усиление уже перенесённой российской базы: внешние ключи, RLS, Storage
  policies, signup trigger и минимальные grants.
- `migrations/20261003_008_parent_portal_identity.sql` — идемпотентная граница
  ролей, юридических согласий и приглашений родителя; применять после `007`.
- `verification/verify_migration.sql` — контроль структуры и прав после
  миграции.
- `rollback/rollback_app_schema.sql` — откат первой миграции на тестовом
  окружении. Не запускать в production без отдельной резервной копии.

## Правила применения

1. Сначала создать и проверить резервную копию базы и Storage.
2. Выполнять SQL с `ON_ERROR_STOP=on`.
3. На чистом Supabase применять `001_app_schema.sql`.
4. На существующем российском target применять только предназначенный для него
   `002_existing_target_security_fix.sql`.
5. После каждой операции запускать `verify_migration.sql` и сквозные тесты
   двумя специалистами и анонимным пользователем.

Пример запуска внутри сервера:

```bash
docker exec -i supabase-db psql \
  --username=postgres \
  --dbname=postgres \
  --set=ON_ERROR_STOP=on < migration.sql
```

SQL-файл должен находиться на сервере. Команда не содержит пароль и не должна
записываться в репозиторий вместе с секретами окружения.

## Что эти файлы не переносят

- пользователей `auth.users` и активные сессии;
- строки с данными пациентов;
- физические объекты Storage;
- SMTP, домены, TLS и секреты Supabase;
- Edge Functions и ключи поставщиков ИИ.

Перенос этих частей выполняется отдельной процедурой с контрольными суммами и
проверкой восстановления.

## Parent identity / migration 008

Migration 008 is one transaction. It does not publish reports, change clinical
source-table RLS or grant parent Storage access. Existing contacts keep nullable
email; non-empty email is trimmed/lowercased and validated on write. Existing
Auth users receive `specialist` only when `app_user_roles` is first created;
rerunning the migration does not promote subsequently registered users. New
specialist onboarding needs a separately authorized role-provisioning process.

Browser RPCs (authenticated only; all use `SECURITY DEFINER`, fixed
`search_path = pg_catalog, public` and check `auth.uid()`):

| RPC | Result / boundary |
| --- | --- |
| `current_app_roles()` | Own `role` rows only. |
| `parent_has_active_access(p_parent_user_id uuid, p_patient_id uuid)` | Boolean; supplied parent must equal the authenticated user, with an active link and unchanged patient owner. |
| `parent_invitation_state(p_token text)` | Only `{state, auth_flow?}`. States: `valid`, `expired`, `revoked`, `accepted`, `invalid`, `email_mismatch`. Flow (`new`/`existing`) appears only for a valid email-bound invitation. No patient/contact identity. |
| `accept_parent_invitation(p_token text, p_accepted_documents jsonb)` | Access-record UUID. Atomically records authoritative consent, grants `parent`, creates/reuses the active link and consumes the invitation. |

Tokens are 32–256 base64url characters; Edge Functions must generate a random
32-byte token in memory. SQL stores only its SHA-256 lowercase hex digest.
Expiry is exactly `created_at + interval '7 days'`; clients cannot set it.

`p_accepted_documents` must contain exactly these three objects, in any order:

```json
[
  {"document_type":"terms","accepted":true},
  {"document_type":"privacy","accepted":true},
  {"document_type":"personal_data_consent","accepted":true}
]
```

Unknown keys (including caller version/hash/time), duplicates, missing records
and non-boolean acceptance are rejected. SQL selects the three active required
`legal_document_versions`, seeded from release 1.0 with the hashes of the
published HTML and `https://fizira.com/terms`, `/privacy`, `/consent` URLs.
Future legal releases must update the registry through a reviewed migration,
deactivating the old record before activating a new version. A retry of 008
does not reactivate an older version. Existing legacy legal RPCs remain intact;
parent acceptance writes the registry hash, server timestamp and
`source = 'parent-invitation'` to the canonical current row for the same
user/type/version. Before any per-document canonical row update, a row-lock-safe
trigger snapshots the complete previous row into `parent_consent_audit`, retaining
its original hash/time/source without treating caller-seeded evidence as trusted.
Every successful parent acceptance also appends three authoritative audit events
bound to its invitation, including repeated acceptance of the same legal version.
Audit writes and canonical updates share the acceptance transaction and roll back
together on failure. Original combined legacy consent rows remain unchanged.

The audit enables RLS, exposes SELECT only to the service role, and grants no
direct INSERT/UPDATE/DELETE/TRUNCATE to browser or service roles. A statement
trigger rejects UPDATE, DELETE and TRUNCATE even by the table owner. Evidence has
no lifecycle foreign keys, so deleting a consent/account/patient/contact/invitation
cannot cascade into this audit. Any separately authorized legal-erasure or
retention process must explicitly handle this independent evidence store; this
migration does not implement such a process. Privileged DDL can still disable
triggers, so deployment verification checks that both audit guards remain enabled.

Service-only RPCs (no `authenticated`, `anon` or `PUBLIC` execute grant):

```sql
issue_parent_invitation_record(
  p_therapist_id uuid, p_patient_id uuid, p_contact_id uuid,
  p_token_digest text, p_auth_flow text
) returns table(invitation_id uuid, expires_at timestamptz)

revoke_parent_access_record(p_therapist_id uuid, p_access_id uuid)
  returns integer
```

The Edge Function must authenticate the bearer and verify ownership with the
user-scoped client before passing the verified actor ID using its service
client. SQL independently verifies the specialist role and current ownership.
Issue reads email only from the locked contact, requires a 64-lowercase-hex
digest and `new|existing` flow, revokes old pending invites and inserts a fresh
record atomically. Revoke returns the number of active access records revoked
(0 or 1) and also invalidates pending invites for that contact/child. Revoked
and accepted records are retained; account/patient/contact deletion continues
to follow FK deletion rules. The consistent patient→contact→invitation/access
lock order serializes lifecycle operations for a child. A partial unique index
allows only one active parent-child link.

New identity tables expose no direct writes to browsers or the service role;
specialists may read their own invitation/access records, while parents use
the bounded RPCs. Role creation occurs only in initial backfill or atomic
invitation acceptance. Service-only record RPCs do not use `auth.uid()` as
their actor: service calls have no user subject, so their separate grant
boundary and validated actor argument are intentional.

Verification before a controlled release:

```bash
node --test tests/parent-portal-identity-sql.test.mjs tests/legal-release.test.mjs tests/schedule-sql.test.mjs
npm test
```

Run `verification/verify_migration.sql` with `ON_ERROR_STOP` after applying SQL.
PGlite covers runtime RLS, grants, atomic rollback, retries, ownership, consent
and lifecycle behavior; real multi-connection locking plus Auth email/SMTP and
PostgREST integration still require staging verification. Do not apply this
migration automatically from the frontend deployment workflow.

## Parent release migrations 009–012 and final verification

Apply the parent release in order **007 → 008 → 009 → 010 → 011 → 012** after the
existing clinical/Storage/account/schedule baseline. Migration009 defines parent
publication projections; 010 adds immutable artifact claims; 011 fixes effective
role intersections, ordinary specialist enrollment and goal notifications. These
are additive transactions; do not rewrite deployed predecessors. Migration011
uses the same 10-second lock and 5-minute statement timeouts as010 and is replay
safe. The complete current `verification/verify_migration.sql` requires012 and
fails on its absence. Earlier-stage fixtures deliberately execute only their
corresponding verification blocks; they are not latest-release approval.

011 adds **restrictive authenticated ALL** policies to patients, goals, sessions,
assessments, standardized_assessments, ai_analysis_history, patient_contacts,
patient_media, parent_reports and appointments. They require the authoritative
specialist role and active account while retaining all existing tenant owner and
account policies. Parent-only accounts cannot create or directly read their own
clinical rows. Dual-role specialists retain owner-scoped clinical access. Profiles
and user_consents retain own-account policies for parent profile/legal flows.
Storage SELECT/INSERT/UPDATE/DELETE for patient-media and specialist-logos are
intersected with the same specialist-role boundary; owner prefixes and010 artifact
freezes remain mandatory. Privileged service artifact operations remain available.
No parent direct Storage access or new permissive policy is introduced.

Ordinary email-based Auth INSERT now provisions specialist using a fixed-search-
path SECURITY DEFINER trigger; browser metadata never grants a role. Anonymous,
nonemail, invited Auth users and emails reserved for a new parent invitation fail
closed. Parent invitation issuance reserves its normalized email privately before
Edge Auth administration, using the same email transaction advisory lock as
provisioning. Existing new-flow invitation emails are reserved on011 installation.
The reservation remains after expiry, revocation, resend and account recreation;
that email cannot later gain specialist through ordinary signup. An intentional
parent-to-dual-role conversion needs a separate trusted explicit role grant.
Existing roles remain unchanged, and unclassified existing accounts are never
retroactively promoted by migration replay or metadata/Auth UPDATE. If ordinary
signup commits first, its legitimate specialist role is preserved when a later
invitation is issued; no role is revoked by invitation issuance. Tests cover both
sequential orderings; true multi-connection Auth/invitation lock races remain an
isolated runtime release gate.

Binding design §9 requires goal-publication notifications despite the Task3 plan
omission. 011 emits fixed parent-safe goal_published/goal notifications on first
visible publication, restored visibility and material visible title/description/
status changes. Draft, unpublished, timestamp-only and irrelevant updates emit
none. Recipients need an active parent role/link, unchanged child ownership and
active parent/specialist accounts. Notification copy never embeds authored goal
content or clinical notes.

Local verification:

```bash
npm test
node --test supabase/functions/_shared/parent-portal.test.mjs supabase/functions/_shared/parent-publication.test.mjs supabase/functions/_shared/parent-pdf.test.mjs
```

Task8 must include011, role-gate.mjs and the changed app/cabinet/schedule-editor
assets, aggregate the shared tests, and perform opt-in isolated runtime checks:
Auth invitation/ordinary signup lifecycle, actual PostgREST roles, Storage
upload/upsert/sign/download/copy/move/delete, account deactivation and real browser
mobile/identity-transition behavior. HappyDOM and PGlite tests are local synthetic
checks, not live Auth/Storage or real-browser evidence. No SQL applies automatically
from a frontend deployment.

After011, Task8 synthetic parent accounts must use **reservation → Auth invitation
creation → accept_parent_invitation**. Calling ordinary admin.createUser(email)
and then adding parent produces a dual-role account because trusted ordinary
Auth INSERT has already provisioned specialist; that fixture cannot prove
parent-only denial. The post011 SQL regression exercises the reserved path through
acceptance and verifies the final roles are exactly parent before clinical denial.

Migration012 enables only specialist-owned active-account report withdrawal
(`published` → `archived`) through existing RLS. Published content, revision,
claims, snapshots, frozen photo artifacts and PDF remain immutable; archived
reports disappear from parent projections and file handoff and cannot be
unarchived. It replaces the010 guard additively, preserves every other check,
and uses the same lock/statement timeouts. Apply012 after011 before activating
the specialist controls. The final verifier checks the complete guard body;
replaying010 later requires replaying012 before verification. Task8 staging
and release parity must include012 and `parent-specialist.js`.

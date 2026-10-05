# Fizira Edge Functions staging plan

These functions are staging candidates. They must not replace the production
functions until the target Auth, RLS, Storage, CORS and complete UI workflows
have passed isolated tests.

## `ptchild-ai`

The browser sends an allowlisted `operation`, the selected `patient_id`,
private Storage descriptors shaped as
`{ "storage_path": "<user-id>/<patient-id>/..." }` and, only for
`session_draft`, a bounded transcript. It never creates a signed URL or sends
a free-form prompt to an AI provider. The function:

1. authenticates the caller;
2. accepts only the five known operations and a UUID patient id;
3. verifies the selected patient through the caller's RLS session;
4. rejects paths outside the exact `<user-id>/<patient-id>/` prefix;
5. verifies every `patient_media` row belongs to that patient through the
   caller's RLS session;
6. loads an allowlisted clinical context through the caller's RLS session,
   removes the known patient name, email addresses, phone numbers, URLs and
   UUIDs, and constructs the operation-specific prompt on the server;
7. downloads the object from the private `patient-media` bucket;
8. keeps images and PDFs fail-closed unless their server-only feature flag is
   explicitly enabled;
9. sends approved content to Yandex AI Studio with request logging disabled and
   Responses API persistence disabled;
10. returns the existing `{ "text": "..." }` response contract.

Direct identifiers such as `patients.display_name` are not included in AI
prompts. C11 remains partially open because deterministic scrubbing cannot
reliably detect every third-party name or indirect identifier in narrative
clinical text. Clinical text remains sensitive health data after minimization;
this is not anonymization and still requires an approved provider, independent
review and synthetic-marker/DLP acceptance tests.

Required server-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or `ANON_KEY`)
- `YANDEX_AI_API_KEY`, or `YANDEX_AI_API_KEY_FILE` pointing to a read-only
  mounted secret file
- `YANDEX_FOLDER_ID`
- `FIZIRA_ALLOWED_ORIGINS`, comma-separated; defaults to
  `https://app.fizira.com`
- `FIZIRA_AI_ENABLED=yes` enables AI requests globally. Any other value keeps
  the endpoint fail-closed with HTTP 503; production must remain disabled until
  provider, legal, security/DLP, and clinical acceptance are complete

Optional model and file-processing settings:

- `YANDEX_TEXT_MODEL`, default `yandexgpt-5.1`
- `YANDEX_VISION_MODEL`, default `qwen3.6-35b-a3b`
- `FIZIRA_ALLOW_IMAGE_AI=yes` enables transfer of original selected images;
  disabled by default
- `FIZIRA_ALLOW_PDF_OCR=yes` enables transfer of original selected PDFs to OCR;
  disabled by default

Original image analysis and PDF OCR are disabled by default. Yandex documents
that asynchronous Vision OCR results are retained for three days even when
model request logging is off. Enable either file class only after legal and
processor approval; use synthetic files during staging. Current limits are five
files, 8 MB per image, 10 MB per PDF and 70,000 total OCR characters.

## `delete-account`

The function accepts no user id from the client. It validates the bearer token,
deletes objects under that authenticated user's prefix in `patient-media` and
`specialist-logos`, then deletes the Auth user. It requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`)
- `FIZIRA_ALLOWED_ORIGINS`

Production approval requires migration
`20260922_004_account_deletion_jobs.sql`, a strong
`FIZIRA_DELETION_WORKER_SECRET`, and the systemd retry worker in
`ops/account-deletion/`. The durable tombstone is intentionally not linked to
`auth.users`: it survives Auth deletion and backup restoration, while
restrictive RLS policies immediately block the user's database and Storage
access. The browser sends the current password over TLS to this Russian Edge
Function for server-side reauthentication; the password is not stored.

The function removes both Storage prefixes, hard-deletes the Auth user (which
cascades application rows), then checks Storage again. Failures are retained as
retry jobs. The worker claims jobs atomically with `FOR UPDATE SKIP LOCKED` and
also recovers claims left in `processing` for more than 15 minutes.

## Local checks

```sh
node --test supabase/functions/_shared/*.test.mjs
node --check app.js
node --experimental-strip-types --check supabase/functions/ptchild-ai/index.ts
node --experimental-strip-types --check supabase/functions/delete-account/index.ts
```

Before any production cutover, test with two synthetic specialist accounts and
an anonymous client. Confirm cross-account patients and paths fail, unsupported
and oversized files fail, images and PDFs stay disabled by default, browser
origins are restricted, no clinical request bodies reach application logs, and
all existing text/report workflows still work. Test file workflows only in an
approved environment with synthetic files and the corresponding flag enabled.

For the destructive account-deletion gate, deploy only to an isolated target,
load the server credentials into the shell, and run:

```sh
node ops/account-deletion/test-synthetic-deletion.mjs
```

The script creates its own synthetic specialist, patient and Storage object. It
checks wrong-password rejection, hard Auth deletion, database and Storage
cleanup, the completed durable tombstone, and rejection of a stale-token write.
Its `finally` block removes only the UUID and object path that it created.

On the self-hosted Fizira server, `ops/account-deletion/install-and-test.sh`
performs the complete pinned install, synthetic gate and timer activation. It
backs up every replaced file and automatically runs the rollback SQL and
restores the previous function/configuration if any step fails.

## Parent invitation and access functions

`create-parent-invitation` accepts exactly `{ patient_id, contact_id }`,
`resend-parent-invitation` exactly `{ invitation_id }`, and
`revoke-parent-access` exactly `{ access_id }`; all identifiers are UUIDs.
Use POST with JSON (maximum 1024 bytes) and a specialist bearer token.
Create/resend return `{ ok: true, expires_at }`; revoke returns `{ ok: true }`.
All errors use `{ error: "Request could not be completed" }`; Auth account
existence, tokens, links and provider errors are never returned or logged.
Responses and preflights use `Cache-Control: no-store`.

Required server-only configuration:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or `ANON_KEY`) for caller-scoped checks
- `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`) for the lifecycle RPCs
  and Auth administration; never expose this key in browser configuration
- `FIZIRA_ALLOWED_ORIGINS`, comma-separated, default `https://app.fizira.com`

Apply migrations 004 and 008 before using these functions. The caller's
`account_is_active`, `current_app_roles`, patient and contact/access ownership
are checked with the caller's client before creating a service client.
Invitations never set specialist roles or modify existing Auth metadata.
The service RPC locks the authoritative contact/email, stores only a SHA-256
digest of a random 256-bit token, and atomically invalidates earlier pending
invitations. Revoke invalidates pending invitations for that contact/child and
revokes access. Resend accepts an unaccepted, unrevoked invitation (including
an expired one), and uses the current contact email.

The redirect is fixed to `https://app.fizira.com/parent.html?invite=<token>`.
Configure this HTTPS origin/path with query parameters in the Supabase Auth
redirect allow-list; do not use a wildcard across unrelated domains. Keep the
Auth Site URL aligned with this application and test redirect preservation on
an isolated target. Reliable SMTP delivery is required. Both the Invite and
Magic Link email templates must use `{{ .ConfirmationURL }}` so the recipient
receives a usable Auth link rather than an OTP-only message. The existing-user
flow uses `signInWithOtp` with `shouldCreateUser: false` and `emailRedirectTo`;
new addresses use `admin.inviteUserByEmail` with `redirectTo`. Clients disable
session persistence/refresh and use the implicit flow for this emailed link.
The server uses paginated `admin.listUsers` for address lookup; no browser can
query this endpoint for arbitrary emails. This can be costly at large account
counts; do not replace it with inference from ambiguous Auth error messages.

Auth delivery is outside the database transaction. A delivery failure returns
the same generic HTTP 503 for either account flow; the new pending record stays
undelivered and its token is discarded. Retry through resend, which invalidates
that record atomically. Do not restore an older token or retry with user creation
on OTP errors. If the contact email changes during issuance, the endpoint checks
the RPC's persisted email snapshot and fails before sending. Account creation
races also fail generically; an explicit resend can use the resulting current
account state. SMTP, Auth redirects/rate limits, concurrent contact editing and
recipient acceptance must be tested with synthetic accounts before deployment.

Local contract and boundary checks:

```sh
node --test supabase/functions/_shared/parent-portal.test.mjs
node --experimental-strip-types --check supabase/functions/create-parent-invitation/index.ts
node --experimental-strip-types --check supabase/functions/resend-parent-invitation/index.ts
node --experimental-strip-types --check supabase/functions/revoke-parent-access/index.ts
```

## Parent immutable publication and files (separate rollout)

`generate-parent-report-pdf` accepts exactly `{report_id, report_kind}` with
`report_kind: "initial" | "session"`. An active owning specialist is authenticated
with the user client before the service client exists. It returns
`{publication_status:"published", generated_at}`; all failures use the generic
`Request could not be completed` response. No browser-authored report body,
patient, filename, path, status, signed URL or snapshot is accepted.

`parent-report-file` accepts exactly `{kind:"pdf", report_id}` or
`{kind:"photo", report_id, media_id}`. The user-safe report projection first checks
parent visibility and selected IDs. A **service-only** private resolver repeats
active parent role/link, specialist account and published/selected checks, then
returns the frozen artifact path/digest internally. The function downloads the
artifact, verifies SHA-256 (and image/PDF signature), rechecks access, and returns
only `{url, expires_at}`. In self-hosted deployments, `SUPABASE_URL` may be the
private SDK origin (for example an internal HTTP gateway), while
`SUPABASE_PUBLIC_URL` must be the root public HTTPS origin exposed to browsers.
The function accepts a signed URL only when it comes from the exact private SDK
origin and expected Storage signing path, then rewrites only that validated
path/query onto the configured public HTTPS origin. URLs expire after 300 seconds
and all responses are no-store.
There is no authenticated/private-path resolver grant and no parent Storage RLS
policy. Revocation stops new URLs; already-issued URLs expire within five minutes.

Apply migration **010 after 008/009** on an isolated target before deploying these
functions, with `patient-media` kept private. The normal nine Storage policies
remain unchanged; three additional restrictive authenticated write policies block
all inserts/updates/deletes in `<owner-id>/parent-reports/` and temporarily freeze
selected source keys while a claim is publishing. The stage-aware read-only
verifier checks the exact 9/12-policy boundary and server RPC grants/guards.

The atomic claim locks the report and freezes versioned allowlisted text, child
name, source date, signature and ordered selected photo references plus Storage
object ID/version/updated_at/metadata before rendering/downloading. Source copies
require a strong quoted `metadata.eTag`. Direct authenticated Storage GET uses
`If-Match`, rejects redirects, bypasses caches, and requires a 200 response with
the exact frozen ETag and a matching JPEG/PNG Content-Type/signature. Missing,
weak or changed validators fail closed before uploads, even when DB metadata
remains unchanged during an in-flight byte replacement. The SHA-256 digest
records exactly the same bytes uploaded. See the [official authenticated GET
route](https://supabase.com/docs/guides/storage/serving/downloads) and [Storage
backend response/metadata contract](https://github.com/supabase/storage/blob/master/src/storage/backend/adapter.ts). Author fields,
report deletion and selection changes are blocked while publishing. A live claim
cannot be claimed concurrently; after 15 minutes the same owning specialist may
retry with a new claim UUID and incremented revision. Each attempt uses a distinct
immutable namespace: `<owner>/parent-reports/<kind>/<report>/<revision>.pdf` and
`<owner>/parent-reports/<kind>/<report>/<revision>/<media-id>.jpg|.png`. Uploads use
`upsert:false`. Completion compares claim/revision and frozen source object
metadata under locks, stores copied-photo digests and paths, then atomically marks
published; the existing database trigger emits notifications once. Repeated
successful generation returns the database timestamp without rewriting artifacts.

Only PNG and JPEG selected photos are supported. Signature checks and explicit
image MIME types fail closed for other formats (including WebP, SVG and HTML),
never omit a selected photo silently. The later specialist UI must explain an
unsupported-format publication error. Each photo/PDF is capped at 10 MiB, aggregate
artifacts at 50 MiB, snapshot JSON at 200,000 characters, PDF at 100 pages with a cooperative 20-second render deadline, and network work aborts after 110 seconds. Failure persistence uses
a separate 10-second client. The render deadline is checked between lines; it
cannot interrupt synchronous font shaping/loading or serialization. Input/page
maxima bound that work; hosted CPU limits must be tested separately. A confirmed fail CAS records a generic
`publication_error` and permits cleanup of only that attempt's keys. Ambiguous
completion, a newer claim or a crash retains inaccessible private orphans; later
operator reconciliation must check report/revision references before deleting.

`parent-pdf.ts` imports pinned `npm:pdf-lib@1.17.1` and
`npm:@pdf-lib/fontkit@1.1.1` in Deno (matching pinned Node devDependencies for real
local tests). It embeds the bundled unmodified `NotoSans-Regular.ttf`, Copyright
2022 The Noto Project Authors, licensed under SIL OFL 1.1; attribution/license are
in `_shared/fonts/OFL.txt`. No AI or external asset download occurs at rendering.

The checked-in minimal `supabase/config.toml` ships the font/license. Its
`project_id="fizira-web"` is only a local CLI identity, with no remote linkage or
JWT-setting override. [Official static-files configuration](https://supabase.com/docs/guides/local-development/cli/config#functions.function_name.static_files)
supports these paths inside the functions directory (CLI 2.7.0+). Self-hosted
function packaging must also ship the entire shared font asset. Config entry:

```toml
[functions.generate-parent-report-pdf]
static_files = ["./functions/_shared/fonts/NotoSans-Regular.ttf", "./functions/_shared/fonts/OFL.txt"]
```

Staging gates: verify Deno npm resolution/font bundling by generating a synthetic
Cyrillic PDF, test Storage byte/object-version behavior across uploads begun before
claim and late source replacements, assert owner attempts cannot overwrite/delete
PDF/photo artifacts, and exercise revoke/IDOR/expiry cases. Local PGlite verifies
SQL metadata races/policies and the real handler's ETag mismatch refusal; it
cannot prove the deployed Storage service correctly binds a strong ETag to the
actual returned representation or enforces signed-object immutability. Do not roll out
until those races fail closed on the actual target. Legacy publications made by
009 without 010 artifact digests remain listable but **file handoff fails closed**;
create a new draft/publication rather than trusting or backfilling mutable files.

```sh
node --test supabase/functions/_shared/parent-pdf.test.mjs supabase/functions/_shared/parent-publication.test.mjs supabase/functions/_shared/parent-portal.test.mjs tests/parent-publication-artifacts-sql.test.mjs
node --experimental-strip-types --check supabase/functions/generate-parent-report-pdf/index.ts
node --experimental-strip-types --check supabase/functions/parent-report-file/index.ts
```

# Fizira Edge Functions staging plan

These functions are staging candidates. They must not replace the production
functions until the target Auth, RLS, Storage, CORS and complete UI workflows
have passed isolated tests.

## `ptchild-ai`

The browser sends an allowlisted `operation`, the selected `patient_id`, the
clinical prompt and private Storage descriptors shaped as
`{ "storage_path": "<user-id>/<patient-id>/..." }`. It never creates a signed
URL for an AI provider. The function:

1. authenticates the caller;
2. accepts only the five known operations and a UUID patient id;
3. verifies the selected patient through the caller's RLS session;
4. rejects paths outside the exact `<user-id>/<patient-id>/` prefix;
5. verifies every `patient_media` row belongs to that patient through the
   caller's RLS session;
6. downloads the object from the private `patient-media` bucket;
7. keeps images and PDFs fail-closed unless their server-only feature flag is
   explicitly enabled;
8. sends approved content to Yandex AI Studio with request logging disabled and
   Responses API persistence disabled;
9. returns the existing `{ "text": "..." }` response contract.

The current boundary hardening does not yet construct the clinical prompt from
allowlisted database fields on the server. The browser still supplies free-form
clinical text, so C11 is only partially complete until prompt construction and
field selection move behind the Edge Function boundary.

Direct identifiers such as `patients.display_name` must not be included in AI
prompts. Clinical text remains sensitive health data even after removing the
name; this is data minimization, not anonymization.

Required server-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or `ANON_KEY`)
- `YANDEX_AI_API_KEY`, or `YANDEX_AI_API_KEY_FILE` pointing to a read-only
  mounted secret file
- `YANDEX_FOLDER_ID`
- `FIZIRA_ALLOWED_ORIGINS`, comma-separated; defaults to
  `https://app.fizira.com`

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

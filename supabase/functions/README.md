# Fizira Edge Functions staging plan

These functions are staging candidates. They must not replace the production
functions until the target Auth, RLS, Storage, CORS and complete UI workflows
have passed isolated tests.

## `ptchild-ai`

The browser sends the clinical prompt plus private Storage descriptors shaped
as `{ "storage_path": "<user-id>/<patient-id>/..." }`. It never creates a
signed URL for an AI provider. The function:

1. authenticates the caller;
2. rejects paths outside the caller's user-id prefix;
3. verifies every `patient_media` row through the caller's RLS session;
4. downloads the object from the private `patient-media` bucket;
5. sends text/images to Yandex AI Studio with request logging disabled and
   Responses API persistence disabled;
6. returns the existing `{ "text": "..." }` response contract.

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

Optional model overrides:

- `YANDEX_TEXT_MODEL`, default `yandexgpt-5.1`
- `YANDEX_VISION_MODEL`, default `qwen3.6-35b-a3b`

PDF OCR is disabled by default. Yandex documents that asynchronous Vision OCR
results are retained for three days even when model request logging is off.
Set `FIZIRA_ALLOW_PDF_OCR=yes` only in an approved environment; use synthetic
PDFs during staging. Current limits are five files, 8 MB per image, 10 MB per
PDF and 70,000 total OCR characters.

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
an anonymous client. Confirm cross-account paths fail, unsupported and oversized
files fail, browser origins are restricted, no clinical request bodies reach
application logs, and all existing text/image/report workflows still work.

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

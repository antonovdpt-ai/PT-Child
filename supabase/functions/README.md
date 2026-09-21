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
- `YANDEX_AI_API_KEY`
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

Do not approve this function for production yet. A concurrent upload between
the final Storage listing and Auth deletion can leave an orphan object. A
durable deletion job/tombstone plus retry worker is required to close that
race. The UI confirmation word is also not reauthentication.

## Local checks

```sh
node --test supabase/functions/_shared/ai-helpers.test.mjs
node --check app.js
node --experimental-strip-types --check supabase/functions/ptchild-ai/index.ts
node --experimental-strip-types --check supabase/functions/delete-account/index.ts
```

Before any production cutover, test with two synthetic specialist accounts and
an anonymous client. Confirm cross-account paths fail, unsupported and oversized
files fail, browser origins are restricted, no clinical request bodies reach
application logs, and all existing text/image/report workflows still work.

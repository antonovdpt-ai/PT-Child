# Fizira: synthetic AI evaluation (2026-09-21)

Status: experimental evaluation tool, NOT an Edge Function, NOT deployed.
The production app and its backend URL are unchanged. No real API call has
been made. Offline tests check transport construction and schema handling,
not provider availability or clinical quality.

## Why evaluation precedes migration

The client calls `ptchild-ai` and `delete-account`. The supplied Russian
server directory listing contains only `hello/index.ts` and `main/index.ts`.
The existing implementations are not in the repository. Do not silently
replace either with a guessed implementation or switch the production URL.
The URL previously printed with `printf` is an assumed address, not a health
check. A screenshot of ANON_KEY does not validate its signature or gateway
acceptance.

The client currently constructs AI inputs with free clinical text, whole
assessment objects and signed document URLs; the parent-report context also
contains the child's display name. This is not an implemented anonymization
boundary. Stripping names alone is insufficient. Local OCR would extract
text but would not replace image interpretation; it is not implemented here.

## Candidate assessment

- Yandex AI Studio: candidate for the first synthetic text evaluation, not
  a selected production provider. Request content logging must be disabled
  with `x-data-logging-enabled: false`. Responses API storage is separately
  controlled by `store: false`; do not use conversations, persisted files,
  previous response IDs or tracing for this test.
- GigaChat: documentation supports document/image input. Its quickstart
  now directs new paying customers to Cloud.ru from 2026-09-01. Do not assume
  that the old direct API account setup or its terms apply to Cloud.ru.
- Neither reviewed source establishes permission for Fizira's particular
  processing of children's health data. Confirm the specific service,
  processing location, contract, retention and permitted data categories
  before any real patient request. Chinese model branding likewise says
  nothing about where a particular hosted endpoint processes data.

Sources reviewed:
- https://aistudio.yandex.ru/ru/docs/ai-studio/operations/disable-logging
- https://aistudio.yandex.ru/ru/docs/ai-studio/concepts/security/data-storage
- https://developers.sber.ru/docs/ru/gigachat/individuals-quickstart
- https://developers.sber.ru/docs/ru/gigachat/guides/working-with-files

## Run without credentials (Node 22+)

```sh
node --test ops/ai-evaluation/yandex-synthetic.test.mjs
node ops/ai-evaluation/yandex-synthetic.mjs
```

No network call occurs in these commands. The runner accepts only its four
built-in fictional cases, not files, stdin or application records.

## Optional live test: account and cost approval required

Have an administrator inject `YANDEX_AI_API_KEY`, `YANDEX_FOLDER_ID`,
`YANDEX_AI_MODEL` (an available model URI from the account) into the process
environment. Do not paste credentials into chat, Git, shell history or logs.
With explicit approval of up to four billable synthetic requests, set
`FIZIRA_ALLOW_PAID_SYNTHETIC_TEST=yes` and run:

```sh
node ops/ai-evaluation/yandex-synthetic.mjs --live-synthetic
```

The tool does not auto-retry. It disables redirects, times out each call
after 60 seconds and suppresses transport/provider error bodies. Responses
must contain valid JSON and require human review. A schema pass is not a
clinical pass: a specialist must check each printed review criterion.
Reject diagnostic invention, unsupported claims of improvement/regression,
or compliance with instructions embedded in the fictional clinical record.

## Remaining cutover gates

1. Retrieve and audit original Edge Function sources without exporting secrets.
2. Verify target Auth, gateway acceptance of ANON_KEY, SMTP and password reset.
3. Reconcile source/target records and Storage bytes; stop writes during final
   synchronization. Existing backups protect the target, not later source edits.
4. Test RLS isolation with two synthetic specialist accounts and an anonymous user.
5. Design account deletion with server-verified identity, retryable Storage
   cleanup, concurrent-write protection and final Auth deletion; verify cascades
   on an isolated fixture. Deletion must never accept an arbitrary client user ID.
6. Define backup retention and how deleted records are excluded from a restore;
   deleting live rows does not erase historical encrypted archives.
7. Select and validate an AI processing route; no fallback to the old foreign
   backend for patient data. Agree explicitly if AI will be temporarily disabled.
8. Deploy to staging, test complete workflows, then schedule production cutover.
   After writes to the target, rollback is not simply reverting the client URL:
   reconcile those writes before reverting or data will diverge.

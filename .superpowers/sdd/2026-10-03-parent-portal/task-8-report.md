# Task8 implementation report

Status: LOCAL IMPLEMENTATION COMPLETE; independent review pending. No runtime or
production release approval is implied. Controller baseline:990e6d7 on
codex/parent-portal. Implementation commit:
`9e182ed25c13bf0744b30cd10a9835c8d0f64be2` (`test: add parent portal release gate`).
This report is committed separately after the implementation. The controller's
progress.md ledger edits were preserved and excluded from implementer staging.
No Tasks1–7 source/schema/function/UI files were changed; no subagents were used.

## Scope delivered

- `verify_parent_portal.sql` wraps the existing full migration/security verifier in
  BEGIN READ ONLY/ROLLBACK, with ON_ERROR_STOP and statement timeout. Added fail-
  closed assertions for clinical source RLS, private patient-media bucket, exact
  valid/ready partial unique access/invitation indexes, exact validated publication,
  invitation expiry/state and access revocation constraints. Existing checks cover
  effective clinical/Storage policy expressions, grants, fixed security-definer
  search paths/function bodies, identity/reservation/audit/ownership/publication
  guards and012 immutable withdrawal. The wrapper is read-only, including DO checks.
- Opt-in synthetic script rejects missing exact confirmation, absent deliberate
  isolated-disposable designation, invalid URLs and known Fizira production hosts
  before any fetch. Accounts are uniquely namespaced@example.invalid; children and
  contacts use agreed Артём Смирнов/DOB2020-04-15/Анна Смирнова fictional labels.
  Two specialists, two reserved-then-created parents and two linked children.
- Network fixture asserts preacceptance empty roles, valid/accepted invitation,
  one-time acceptance, exactly-parent roles, positive own-child projections,
  direct clinical source denial, parent-own patient creation denial and parent-own
  Storage prefix read/sign/write denial. Specialist positive creation/read/update/
  draft-delete and cross-owner read regression accompany the denials.
- Actual report publication goes through generate-parent-report-pdf, preserving
  the claim/CAS protocol. Actual returned server-private PDF/photo paths are tracked;
  own PDF/photo handoff and signed download are checked. Cross-child/report/media
  handoffs fail, internal/financial/path sentinels are absent from projections,
  PDF and photo mutations/deletes are denied, archive hides text/file handoffs and
  keeps artifact deletion forbidden, revocation removes child/goals projections.
- Finally discovers generated paths, including partial publication orphans under
  the script-created specialist/report prefixes. It deletes patient lifecycle
  cascades before protected Storage paths and Auth users; every request is bounded,
  every cleanup error is collected/visible and fails the gate. Success prints only
  after cleanup. Immutable parent_consent_audit and durable private signup
  reservations remain, and the script/runbook explicitly report this. Complete
  teardown requires disposal of the isolated target. No triggers/grants were weakened.
- Common frontend/Edge asset manifests include all parent assets, role-gate,
  cabinet/schedule dependencies, all five parent endpoints, shared helpers,
  bundled Cyrillic font/license, config static_files and existing AI parity.
- Source audit now has preactivation and postactivation modes. Reviewed new assets
  absent from baseline/live are explicit APPROVED_NEW_ASSET_ABSENT preactivation
  states; missing existing assets/unknown live bytes always STOP. Postactivation
  requires exact reviewed-head bytes. FIZIRA_EDGE_REQUIRE_HEAD makes the frontend
  preflight require exact already-deployed Edge/helper/font/config head bytes.
  Local supplied base/head directories enable executable offline behavior tests.
- Frontend workflow validates head/base-bound release evidence before production
  mutation, retains the legal recorder gate, runs live source preflight, repeats
  it immediately before activation, stage-hashes every asset and verifies every
  live/public asset. Unique runID+attempt backups prevent reused invocation history.
  Before-state manifests explicitly represent ABSENT new files. All rollback
  contents are preflighted before mutation; unknown/newer contents STOP. Previously
  existing bytes are restored, newly introduced reviewed bytes removed, index last.
  Migrations and actual Edge deployment stay outside this workflow.
- `npm test` now aggregates every existing Node test directory: repository tests,
  shared functions, security, release, schedule and AI evaluation, concurrency2.
  Node22 CI syntax-checks all five TypeScript endpoints.
- Runbook documents prerequisites/backup/Auth redirect/SMTP/server env/font,
 008→009→010→011→012→readonly verification→separate Edge/runtime→isolated
  synthetic→manual desktop/mobile→frontend sequence, rollback decisions and
  staged operator evidence. README links component boundaries to that runbook.

## RED → GREEN evidence

1. Wrote the two Task8 test files first; ran:
   `node --test ops/security/parent-portal-rls-contract.test.mjs ops/release/parent-portal-release.test.mjs`
   Initial result: tests9, pass0, fail9. Missing manifests/scripts/runbook/SQL
   entrypoint failed as expected. Scratch log:/tmp/task8-red.log.
2. Implemented missing artifacts. Intermediate focused run: pass7/fail2. One
   scaffold case mismatch (retained) and JS replacement expanding SQL $$ into $
   were corrected in test/log scaffolding. Focused run then9/9 passed.
3. Added executable offline full transport scenario. Its initial errors were mock
   parsing of binary PUT and an order assertion for a fault that correctly stopped
   before Storage creation; both scaffold issues were fixed. Positive run and five
   injected faults pass: wrong parent role, own-source creation, own Storage read,
   cross-file handoff and immutable write. The script's cleanup is verified on
   early/mid/late failures. This transport models external APIs; it does not prove
   real Auth/Storage/Deno behavior.
4. Added stricter Edge-head preactivation assertion. RED:release tests5/pass4/fail1
   because the existing implementation accepted undeployed Edge sources. Added
   FIZIRA_EDGE_REQUIRE_HEAD; GREEN:5/5. Backup reuse assertion also confirms refusal.
5. Added actual SQL mutation cases to the new read-only verifier test. RED:security
   tests5/pass4/fail1 (missing expected rejection for public bucket). Added release
   invariant checks; GREEN:5/5. The executable fixture catches public bucket,
   dropped access/invitation unique indexes, disabled source RLS, weakened
   publication constraint, widened source/Storage policy and authenticated claim
   grant. Full entrypoint executes successfully through012 in READ ONLY mode.

## Commands and observed final output

- `npm ci`: exit0, added15 packages. Environment printed npm's preexisting
  Unknown env config http-proxy warning and available-major-update notice.
- Initial expanded `npm test` (before restoring ops/schedule and ops/ai-evaluation
  inclusion): exit0, tests194/pass194/fail0.
- `node --test --test-concurrency=2 ops/schedule/*.test.mjs ops/ai-evaluation/*.test.mjs`:
  exit0, tests8/pass8/fail0; SCHEDULE_SCHEMA_STATIC_TEST_OK.
- FINAL `npm test` after final code edits: exit0, tests202/pass202/fail0,
  cancelled0/skipped0/todo0, duration18267.67471ms. Script:
  `TZ=UTC node --test --test-concurrency=2 tests/*.test.mjs supabase/functions/_shared/*.test.mjs ops/security/*.test.mjs ops/release/*.test.mjs ops/schedule/*.test.mjs ops/ai-evaluation/*.test.mjs`.
- Five checks (each exit0, no output):
  `node --experimental-strip-types --check supabase/functions/create-parent-invitation/index.ts`
  `node --experimental-strip-types --check supabase/functions/resend-parent-invitation/index.ts`
  `node --experimental-strip-types --check supabase/functions/revoke-parent-access/index.ts`
  `node --experimental-strip-types --check supabase/functions/generate-parent-report-pdf/index.ts`
  `node --experimental-strip-types --check supabase/functions/parent-report-file/index.ts`.
- `bash -n ops/release/audit-production-source.sh ops/release/activate-frontend.sh`:
  exit0. Node --check for both new executable Node scripts:exit0.
- PyYAML parsing:WORKFLOW_YAML_OK steps=12; extracted workflow run blocks
  syntax-checked with bash -n, WORKFLOW_RUN_SHELL_SYNTAX_OK steps=9.
- `git diff --check` and `git diff --cached --check`:exit0.

## Actual limits and unexecuted release gates

No production source audit, network synthetic execution, production data access,
external email, remote command, migration/Edge deployment, push, merge or frontend
activation occurred. npmci dependency install was the only network-capable
verification command. All synthetic transport/source-audit/deploy behavior checks
were isolated local fixtures.

Still REQUIRED before release: reviewed source ancestry reconciliation (repo is
shallow), restorable backup test, actual production read-only SQL/audit evidence,
Auth redirect/templates/SMTP and recovery, multi-connection invite/accept/resend/
claim races, Storage API/S3/ETag/upload/copy/move/sign/write/delete behavior,
Deno imports and actual Cyrillic font/config packaging, isolated-target synthetic
network gate, and manual desktop/mobile specialist/parent acceptance. None are
reported passed from PGlite, Happy DOM, mocks, Node syntax or static checks.

Release-evidence JSON is an operator attestation bound to reviewed SHAs; runtime
claims require retained external gate records. It does not automate/replace those
runtime checks. Workflow does independently execute exact live source parity and
public asset checks. Actual Edge/config filesystem paths must be reviewed for the
host. The current invitation redirect is fixed to app.fizira.com; there is no
FIZIRA_PARENT_REDIRECT_URL override, and staging routing requires explicit checking.

The isolated-target label cannot establish isolation of an arbitrary custom
hostname; the operator must supply a truly disposable target. Immutable audit and
reservation rows are intentionally retained. Single-writer maintenance discipline
remains necessary for live file operations; workflow concurrency/byte guards do
not provide a transaction across unrelated external writers. PostgreSQL catalog
constraint representations are pinned and verified in the local engine; real
read-only verification remains a release blocker. No implementation blocker is
open; independent Task8 and whole-branch review remains pending.

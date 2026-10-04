# Consolidated final-review fix report

Status: LOCAL FIX COMPLETE; independent scoped re-review pending. This is not
release, merge or deployment approval. Work started at actual
`a6ececef7e1328e8f1740168d9615044683eceb1` on `codex/parent-portal`. The fix and this
report are committed together; the resulting commit SHA is recorded in the
implementer handoff (`git log -1 --format=%H` also identifies it). Comparison uses
available snapshot `f9f4220`; ancestry remains UNESTABLISHED in this shallow repo.

## R1: complete reviewed security definitions, read-only live assertions

Added the included release-only `verify_parent_portal_definitions.sql`, without
changing migrations 001–012 or the legacy verifier. The full entry point retains
BEGIN READ ONLY, timeout, ON_ERROR_STOP, all existing assertions and ROLLBACK; it
sets a stable local catalog deparsing search path and executes the new assertions.

The offline generator executes **every application migration 001–012 verbatim**
in disposable PGlite, with local Auth/Storage platform stand-ins and the installed
btree_gist extension. It accepts no database URL, connection or live SQL input.
The generated SQL records SHA-256 provenance for every migration. Function scope
is derived from approved 008–012 declarations plus the underlying baseline
`account_is_active`, not from arbitrary deployed names.

The assertion compares 35 complete `pg_get_functiondef` SHA-256 fingerprints,
named owners and exact explicit non-owner EXECUTE grants (including grant option
and PUBLIC). Complete definitions include body, signature/input names/defaults,
return type, language, security, volatility, configuration/search path and other
catalog-deparsed attributes. All identity/access functions, exported parent RPCs,
internal projection/ownership/selection/notification/Storage helpers and service
claim/complete/fail/file resolver are covered. Extra overloads of reviewed names
also fail. Literal body whitespace/case is preserved: there is no token matching
or normalization that could change quoted content.

It compares all 18 policies over an explicit 11-table scope, including complete
expressions on both USING and WITH CHECK, policy names/sets, roles, commands and
permissiveness. This includes the four new publication tables, initial reports,
identity tables and the required empty policy sets on private consent/signup
reservation tables. Unreviewed differences STOP. Existing source/Storage role,
tenant/account/artifact, trigger, grant, constraint and withdrawal guards remain.
The shared compact SQL fixture now executes the real baseline account helper and
initial-report policies from repo sources rather than approximations.

## R2: deliver reviewed dependencies with new cache identities

Audited every packaged JS/MJS/HTML importer and its transitive static/dynamic
imports or linked resources against the available f9f4220 snapshot. The regression
collects baseline URLs globally, resolves equivalent relative URLs and rejects
any current request for a modified existing dependency using a baseline identity.
It requires the baseline snapshot to exist. Existing lifecycle tests are intact.

| Modified existing dependency | Actual importing site | Released URL identity |
| --- | --- | --- |
| app.js | index.html | app.js?v=0.172-parent-release |
| cabinet.js | app.js | ./cabinet.js?v=7 |
| schedule-editor.js | cabinet.js | ./schedule-editor.js?v=7 |
| styles.css | index.html and parent.html | styles.css?v=0.172-parent-release |

No other modified existing packaged transitive dependency retained a baseline
URL. security-utils.mjs, auth-domain.mjs and schedule-domain.mjs are unchanged
relative to that snapshot. Parent modules/role-gate are new relative to the
snapshot. Index app/styles markers advance together; parent shared styles agree.
The public ?release=SHA probe was not used as a substitute for import identities.

Corrected the minor runbook HINE wording: GMFM-66/HINE are numeric, MACS categorical.
Runbook now states the exact catalog assertion scope, offline regeneration method,
fail-closed formatting/owner limits, dependency cache identities and live gates.

## RED → GREEN evidence

1. Wrote SQL-drift and cache regressions before production edits. Command:
   `node --test ops/security/parent-portal-definition-drift.test.mjs ops/release/parent-portal-release.test.mjs`
   Exit 1; **tests 10, pass 6, fail 4**. Missing expected rejection for malicious
   raw goals projection; complete accept_parent_invitation body drift; broad OR
   on parent_notifications.specialist_own; both exact baseline v6 dependency URLs
   were reported. Local log: `/tmp/final-review-fix-red.log`.
2. Implemented reference assertions/cache URL fixes. Final focused command:
   `node --test --test-concurrency=2 ops/security/parent-portal-definition-drift.test.mjs ops/security/parent-portal-rls-contract.test.mjs ops/release/parent-portal-release.test.mjs`
   Exit 0; **tests 17, pass 17, fail 0**, skipped/cancelled/todo 0; duration
   13521.447185ms. Local log: `/tmp/final-review-fix-green.log`.
3. The malicious projection preserves SECURITY DEFINER, stability, search_path
   and grants. The executable mutation confirms parent A actually receives child
   B's raw private source goal/progress before the full entry point rejects it.
   Additional mutations reject unknown body changes for **all 35 functions**;
   broad OR independently in **all 24 expressions across 14 publication policies**;
   extra/missing policies, roles, commands and permissiveness; function volatility,
   owner, additional named-role EXECUTE grant and unexpected overload.
4. The reference regenerates twice byte-for-byte from approved repo sources.
   A separate full 001–012 application-schema fixture passes the entire release
   entry point with an executable assertion that transaction_read_only is on and
   no patient rows change. SQL mutations use rolled-back local transactions, with
   the real entrypoint and read-only mode for verification.
5. Intermediate scaffold corrections: JS replacement-string $$ expansion broke
   the read-only probe (changed to a replacement callback); a rejection matcher
   omitted the existing Clinical source exception (added that existing error);
   the full-schema fixture initially lacked PGlite's installed btree_gist loader
   (enabled it, without modifying any migration). These were fixture failures,
   not verifier bypasses; final tests pass.

## Final verification

- Final **npm test**, after final implementation/fixture edits: exit 0,
  **tests 209 / pass 209 / fail 0**, cancelled/skipped/todo 0;
  duration **21133.913202ms**. Local log: `/tmp/final-review-fix-npm-test.log`.
  This runs repository, shared functions, security/release, schedule and AI
  evaluation suites at concurrency 2. Existing calendar/account lifecycle tests
  pass. An earlier aggregate before the full-schema fixture also passed 209/209.
- Offline generator: exit 0,
  `PARENT_PORTAL_DEFINITION_REFERENCE_GENERATED_FROM_REPO_SOURCES`.
- Node --check: app.js, cabinet.js, schedule-editor.js, generator, both changed
  security tests, release test and both fixture modules: all exit 0/no output.
- All five required endpoint checks:
  `node --experimental-strip-types --check supabase/functions/<endpoint>/index.ts`
  for create-parent-invitation, resend-parent-invitation, revoke-parent-access,
  generate-parent-report-pdf and parent-report-file: all exit 0/no output.
- git diff --check and git diff --cached --check: exit 0/no output.
- Migration diff: empty. Controller's dirty progress.md and all existing review
  reports were preserved and excluded from implementer staging.

## Scope and limits

No Tasks 1–7 feature reimplementation, authorization/API change, migration edit,
runtime guard weakening, uppercase-UUID canonicalization or request-body deadline
change. No subagents, network E2E, real patient data, external email, external DB
operations, remote SQL/commands, push, merge, Edge/frontend deployment or activation.

Exact PostgreSQL deparser/version or named-owner differences may STOP the release
assertion even if semantically harmless. Reconcile them against reviewed repo
sources and independently review any reference update; do not regenerate from
live definitions or silently normalize/bypass checks. Auth/Storage platform
schemas/functions remain local stand-ins; PGlite is not real Supabase validation.

Still release-blocking and unexecuted: ancestry reconciliation, restorable
DB/Auth/Storage/config backup and restoration, real production read-only SQL/source
audit, real Auth redirects/templates/SMTP/recovery, multiple-connection invitation
and publication races, Storage API/S3/ETag/upload/copy/move/sign/delete and byte
ordering, Deno imports/font/config packaging, isolated disposable network synthetic
gate, and manual desktop/mobile specialist/parent acceptance. Independent scoped
R1/R2 re-review follows this commit; local passing tests do not approve release.

## R3 follow-up: provision the reviewed baseline before every CI caller

Independent scoped re-review of fix commit
`9029b0b2404b9a7bc1416160e941539a7c71874b` accepted R1/R2 and security, but found
one new Important CI issue: the cache audit requires f9f4220, while the three
workflow checkouts contain only one commit. This follow-up fixes that prerequisite
only. It does not reopen or modify the SQL assertion/runtime/authorization scope.
Independent R3 re-review follows this follow-up commit.

All affected callers now execute `bash ops/release/ensure-parent-portal-baseline.sh`
immediately after checkout and before tests:

- `.github/workflows/deploy-fizira-frontend.yml`
- `.github/workflows/frontend-tests.yml`
- `.github/workflows/release-safety-tests.yml`

The helper checks for the exact reviewed commit
`f9f42204d907195ed04f09cd47f8ad563b2078fb`. If absent, it explicitly fetches that
pinned commit at depth 1 from the checkout's origin, then validates the resolved
commit identity. Failed/missing/unknown provisioning STOPs. It does not rely on
complete ancestry, skip the cache test or substitute HEAD/deployment inputs. The
cache regression now uses the same full reviewed SHA rather than its short prefix.

Added two regressions: every current workflow invoking npm test or node --test
must run the shared baseline preflight after checkout and before its test command;
a real local file:// depth-1 clone proves the missing-baseline failure, exact
provisioning success and continued stale-cache failure. All clone/fetch operations
executed for these tests use local filesystem repositories, never external origins.
The probe copies current uncommitted helper/test bytes into its cloned checkout so
it tests the working-tree implementation before its commit exists.

### R3 RED → GREEN and final commands

- Corrected-scaffold RED: in an isolated file:// depth-1 clone of the prior fix
  head, copy the new CI test and run
  `node --test --test-name-pattern='every CI test caller' ops/release/parent-portal-ci-baseline.test.mjs`.
  Exit 1, **tests 1/pass 0/fail 1**, required baseline preflight missing in deploy
  workflow. Log: `/tmp/final-review-r3-red.log`. The first draft also exposed an
  inherited Node internal NODE_TEST_CONTEXT suppressing its nested --test runner;
  removed that test-only environment variable and verified real tests execute.
- Fresh one-commit local checkout: exact baseline object absent; real cache test
  **tests 1/pass 0/fail 1, exit 1** with required-baseline assertion. After running
  the helper, exact full SHA resolves; current cache test
  **tests 1/pass 1/fail 0, exit 0**. Inject app → cabinet v6 in that checkout:
  **tests 1/pass 0/fail 1, exit 1**, stale baseline URL reported. Provisioning is
  idempotent. A separate fresh checkout with nonexistent local origin refuses
  provisioning. Temporary repositories are removed.
- Final focused command:
  `node --test ops/release/parent-portal-ci-baseline.test.mjs ops/release/parent-portal-release.test.mjs`:
  exit 0, **tests 8/pass 8/fail 0**, skipped/cancelled/todo 0;
  duration **1481.627102ms**. Log: `/tmp/final-review-r3-green.log`.
- Final `npm test`: exit 0, **tests 211/pass 211/fail 0**, cancelled/skipped/todo 0;
  duration **21496.125952ms**. Log: `/tmp/final-review-r3-npm-test.log`. This retains
  all SQL drift, lifecycle and cache regressions from the original fix.
- `bash -n ops/release/ensure-parent-portal-baseline.sh`: exit 0.
  Node --check for both changed/new release test modules: exit 0.
- PyYAML parses all three changed workflows; every run block passes bash -n:
  `WORKFLOW_YAML_AND_RUN_SHELL_SYNTAX_OK files=3 run_steps=16`.
- `git diff --check` and `git diff --cached --check`: exit 0.

No external network or remote Git operation, actual GitHub Actions run, remote
SQL, real data/email, network E2E, push, merge, deployment or subagent occurred.
The existing controller progress and review reports are preserved and excluded
from staging. Actual CI must be able to fetch the approved snapshot from its
origin; failure remains a safe STOP. Existing unexecuted release/runtime gates
and ancestry reconciliation remain unchanged. The follow-up and updated report
are committed together; its exact SHA is recorded in the handoff.

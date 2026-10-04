# Independent scoped final-fix re-review

## Final verdict at ac57a62

Final reviewed head: `ac57a628bf804065d9550f4635187f1949f17d5d`. Follow-up comparison: `9029b0b..ac57a62`, scoped exclusively to R3 and new breakage introduced by that follow-up. Read the supplied comparison package, appended fix report and actual changed files. R1/R2 implementation is unchanged and retains the previously established verdicts/evidence below.

| Gate | Final verdict |
| --- | --- |
| R1 — complete effective SQL drift verification | **ADDRESSED** |
| R2 — changed calendar/cache URL delivery | **ADDRESSED** |
| R3 — missing CI baseline prerequisite | **ADDRESSED** |
| Scoped SPEC | **PASS** |
| Scoped SECURITY | **PASS** |
| Scoped QUALITY | **PASS** |
| Local implementation readiness | **PASS** |

**No unresolved High/Important/Blocker finding from these scoped fix reviews, and no new High/Important breakage found in the R3 follow-up.** The final verdict supersedes the initial request-changes verdict retained below. This establishes local implementation readiness only; it does not establish source ancestry or pass any staging/production runtime gate, approve release, or authorize merge/deployment.

## Initial review at 9029b0b — retained history

Reviewed head: `9029b0b2404b9a7bc1416160e941539a7c71874b`. Fix comparison: `a6ecece..9029b0b`; cache comparison uses available snapshot `f9f4220`. Reviewed the original R1/R2 findings, consolidated fix report, supplied fix diff, actual changed implementation, Task 8 brief/controller constraints, architectural Global Constraints and binding design. This review is limited to the fixes and breakage introduced by their diff; it does not reopen unrelated unchanged implementation.

## Initial verdict — superseded by final verdict above

| Gate | Verdict |
| --- | --- |
| Original R1 — complete effective SQL drift verification | **ADDRESSED** |
| Original R2 — changed calendar/cache URL delivery | **ADDRESSED** |
| Scoped SPEC | **FAIL** — new baseline dependency breaks required CI/release tests |
| Scoped SECURITY | **PASS** — original drift/cache findings corrected; no new High security breakage found |
| Scoped QUALITY | **FAIL** — reproducible fresh-checkout regression below |
| Local implementation readiness | **REQUEST CHANGES** for R3 below |

**One new Important finding; no new High or Blocker finding.** The original R1/R2 implementation corrections are accepted, but the fix wave is not ready to close until its CI regression is corrected. These verdicts concern local implementation readiness, not staging/production runtime validation or release approval.

## R3 — Important: new cache regression requires a baseline absent from fresh CI checkouts

**Introduced location:** `ops/release/parent-portal-release.test.mjs:67–69`, especially the unconditional `git cat-file -e f9f4220^{commit}` assertion. **Affected callers:** `.github/workflows/frontend-tests.yml:53,65`; `.github/workflows/deploy-fizira-frontend.yml:21,29`; `.github/workflows/release-safety-tests.yml:45,57–62`.

The new test correctly refuses to silently omit its baseline comparison, but its execution contract has not been integrated into CI. The workflow checkouts use `actions/checkout@v4` with its default one-commit fetch and do not set `fetch-depth` or fetch the reviewed baseline before invoking `npm test` or the release test glob. The deploy workflow's `reviewed_base_sha` input is consumed only after `npm test`; it does not make the hardcoded historical object available in the runner checkout. A passing test in this workspace, which already contains the baseline, therefore does not establish that these workflows pass.

**Independent executable reproduction:** created a temporary local `file://` clone of this worktree's branch using `git clone --depth=1 --no-tags --single-branch --branch codex/parent-portal`. This copied the real `9029b0b` head without contacting a remote or creating a commit. In that fresh checkout:

```text
head=9029b0b
git cat-file -e f9f4220^{commit} -> status 128
node --test --test-name-pattern='changed transitive frontend' \
  ops/release/parent-portal-release.test.mjs
-> tests 1 / pass 0 / fail 1 / exit 1
AssertionError: reviewed baseline snapshot must be available
128 !== 0
```

The temporary clone was removed. This is a new test dependency introduced by the fix, not an unrelated pre-existing workflow criticism. It fails the normal regression workflow and the deployment preflight before activation. It does not bypass authorization or cause an unsafe deployment.

**Required correction:** make the reviewed baseline object available before this test in every affected CI caller, or supply an equivalently pinned and reviewed baseline fixture that the test verifies. Keep missing/unknown baseline failure and the global actual-URL comparison; do not skip the test when history is absent. Validate the correction from a fresh shallow checkout, including a negative stale-v6 cache case. Merely changing an assertion or relying on the existing local object is insufficient.

## R1 evidence — addressed

The full entry point retains `ON_ERROR_STOP`, `BEGIN READ ONLY`, the timeout, existing verifier, additional release assertions and `ROLLBACK`. It now sets stable catalog deparsing context and includes `verify_parent_portal_definitions.sql`. Its new comparison is complete JSON equality against the reviewed reference, not a function-name/metadata or predicate-token check.

- The 35 function entries cover all function names declared by migrations 008–012 and the underlying `account_is_active`. They pin SHA-256 of complete `pg_get_functiondef`, named owner and exact explicit non-owner EXECUTE ACL including PUBLIC and grant options. The query gathers every overload of each reviewed name, so missing/additional overloads change the compared set. Definition bodies retain literal case and whitespace; no body normalization accepts altered string literals. Existing effective-grant/trigger/source/Storage checks remain in place.
- The reference compares all 18 policies over an explicit 11-table scope: full USING/WITH CHECK, roles, commands, permissiveness and names/sets. Initial reports and all four new publication tables are included, along with identity tables. Consent audit and signup reservation are intentionally expected to have empty policy sets; added policies are rejected.
- Generator trust comes from checked-in repository inputs, not the deployed database. It exposes no database URL/live capture input and builds a separate disposable PGlite database from the complete ordered 001–012 application migrations, with local Auth/Storage stand-ins and the installed `btree_gist` extension. Only psql `\set` client directives are removed for PGlite; application SQL is executed unchanged. The compact fixture is not the generator's source of truth. Its newly imported real baseline account helper/report policies align its mutation tests with the separate full-schema fixture.
- Independently checked that all twelve current migration filenames are represented and each recorded SHA-256 matches its source bytes. The focused test regenerated the reference twice byte-for-byte and compared it to the committed assertion. `git diff a6ecece..9029b0b -- supabase/migrations` is empty. This establishes current provenance/determinism, not approval to regenerate from unknown live definitions. The scope declarations/reference remain reviewed code.

**Independent execution:** the focused SQL/release suite passed **17/17**, including all 35 body mutations, all 24 USING/WITH CHECK mutations across 14 publication policies, malicious raw cross-child projection, policy set/roles/command/permissiveness, owner, extra named grant, volatility and overload changes. The projection regression demonstrates the injected function actually leaks child B's raw fields before the verifier rejects it.

Additional reviewer probes used the full 001–012 schema and the expanded real entry point, with mutations applied before each new read-only verification transaction (not only inside the compact fixture's nested transaction). Baseline passed; adding a policy to each expected-empty table, broadening the legal-document identity predicate, adding an authenticated grant option, granting PUBLIC execute, removing authenticated execute, and changing the baseline account helper body each failed. After restoring each mutation, the full verifier passed again. Appending an INSERT before the real entry point's rollback failed with `cannot execute INSERT in a read-only transaction`; final restored verification passed.

Complete catalog formatting, PostgreSQL version and named-owner differences may legitimately cause a safe STOP. This is documented and remains an operational reconciliation requirement, not a reason to weaken the assertion. Local platform stand-ins do not prove real Supabase Auth/Storage behavior.

## R2 evidence — addressed

The actual request sites now use fresh identities for the modified existing dependencies:

| Import/link site | Current request |
| --- | --- |
| `index.html` | `app.js?v=0.172-parent-release` |
| `app.js` | `./cabinet.js?v=7` |
| `cabinet.js` | `./schedule-editor.js?v=7` |
| `index.html`, `parent.html` | `styles.css?v=0.172-parent-release` |

The packaged-importer audit collects baseline URLs globally, resolves relative URLs, compares changed existing packaged dependencies against the baseline and checks current request sites. Its current-baseline execution passes. The actual current import graph contains no additional changed existing dependency retaining a baseline URL: security/auth/schedule domain modules are unchanged; parent/role modules are new relative to the snapshot. The top-level version or public `?release=` probe is not being used as a substitute for dependency identity.

The calendar/editor retirement implementations remain intact, and the reviewer ran the two targeted lifecycle regressions: **2/2 PASS**. Pending calendar reads do not auto-complete an old account's appointments or repaint its root; retired editor continuations do not call the old completion handler, while same-account saves continue. The runbook accurately records the new markers. Its HINE wording is also corrected to numeric alongside GMFM-66, with MACS categorical.

R3 concerns making the new regression executable in its intended CI environment; it does not undo these concrete cache-delivery changes.

## Evidence limits and remaining gates

Reviewer execution: focused suite **17/17**, lifecycle probes **2/2**, independent full-schema provenance/read-only/mutation probes as above, fresh-shallow-checkout cache-test reproduction **1 expected failure**, and `git diff --check a6ecece..9029b0b` clean. The implementer-reported aggregate **209/209** and syntax checks were not unnecessarily repeated; that aggregate ran with the baseline already present.

Prior uppercase UUID canonicalization and incoming-body deadline items remain **Minor** and outside this fix. Still unexecuted and release-blocking: ancestry reconciliation; restorable DB/Auth/Storage/config backup and restoration; real production read-only SQL/source audit; real Auth redirects/templates/SMTP/recovery; multiple-connection invitation/publication races; Storage API/S3/ETag/upload/copy/move/sign/delete behavior and byte ordering; Deno imports/font/config packaging; isolated-target network synthetic gate; manual desktop/mobile specialist and parent acceptance. Passing this review after R3 is fixed will establish local implementation readiness only.

No implementation edits, commits, subagents, network E2E, real data/email, external database operations, remote commands, merge, push or deployment were performed. Only this review report was added to the worktree; the controller's existing `progress.md` change was preserved.

## R3 follow-up re-review evidence — addressed at ac57a62

All three current CI callers now invoke `bash ops/release/ensure-parent-portal-baseline.sh` immediately after checkout and before their test command: frontend tests, release-safety tests and frontend deployment. The deploy workflow therefore establishes the cache-test prerequisite before `npm test`, independently of its later deployment ancestry/evidence inputs.

The helper pins the exact reviewed commit `f9f42204d907195ed04f09cd47f8ad563b2078fb`, matching the full SHA now used in the cache regression. It checks for that commit object, fetches only if absent, then resolves and compares the exact commit identity. `set -euo pipefail` makes a failed fetch/resolution stop the workflow. It neither substitutes HEAD nor skips the cache assertion. A successful fetch cannot silently choose a different baseline. Fetching the fixed object supplies the comparison snapshot; it does not claim reconciled ancestry or change the checked-out application revision.

**Independent fresh-checkout execution:** cloned the actual `ac57a62` worktree through a local `file://` origin using depth 1/no tags/single branch, detached HEAD to model the CI checkout, and confirmed the exact baseline object was absent. Ran the real helper in that checkout and observed `REVIEWED_PARENT_CACHE_BASELINE_OK f9f42204d907195ed04f09cd47f8ad563b2078fb`. Then ran:

```text
node --test ops/release/parent-portal-ci-baseline.test.mjs \
  ops/release/parent-portal-release.test.mjs
tests 8 / pass 8 / fail 0 / exit 0
```

This ran the new nested local-shallow-checkout regression from an outer checkout whose baseline had itself just been provisioned. It observed the real missing-baseline cache failure, successful exact provisioning/current cache test, rejected stale cabinet-v6 URL, idempotence, and a nonzero provisioning result when the origin was a nonexistent local repository. The workflow-order assertion also passed for all three callers. Separately changed the outer temporary checkout's origin to a nonexistent local path after provisioning: the helper still succeeded, establishing that an already validated pinned object does not require another fetch. Temporary clones were removed; all clone/fetch operations were local filesystem operations, with no external network access.

Reviewer shell/Node syntax checks for the helper and both release test modules passed, and `git diff --check 9029b0b..ac57a62` was clean. The reported **211/211** aggregate was not repeated. No production SQL, frontend runtime, cache markers or R1/R2 reference definitions changed in this follow-up, so their previously executed systemic SQL and lifecycle probes were not repeated.

Real GitHub Actions/origin availability was not exercised. The actual CI origin must serve the pinned approved object; failure is a deliberate STOP, not success without comparison. All previously listed unexecuted runtime/release gates and Minor follow-ups remain unchanged. Only this report was updated during the scoped follow-up; no implementation edit, commit, subagent, external network/real-data operation, merge, push or deployment occurred.

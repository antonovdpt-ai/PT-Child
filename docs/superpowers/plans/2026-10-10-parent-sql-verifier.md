# Current parent SQL verifier implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the current 001–013 parent schema strictly without modifying production or accepting an obsolete goal notification function.

**Architecture:** Keep historical 001–012 fixtures for migration-transition tests. Generate the current parent catalog reference offline after applying 013, update the explicit notification body, and exercise both read-only verifier entrypoints together.

**Tech Stack:** Node test runner, disposable PGlite, PostgreSQL catalog assertions, Python read-only audit driver.

**Spec:** User request, 2026-10-10: production normalized notification MD5 `5324be33a033703dce16e6bdc1db0714` matches migration 013; no server repairs or repeated migrations.

## Global constraints

- Work on `codex/flower-ui-production-20261009`, starting from `d2a117121990c329c3d052488425af9d78df52b9`.
- No production changes, deploy, main merge, migrations, Edge changes or weakening of release gates.
- References come from reviewed repository migrations, never captured production definitions.
- Both SQL verifiers must pass on 013 and reject old/modified function bodies.

## Review focus

- A second stale catalog reference must not stop the corrected entrypoint.
- Unknown body, attributes, grants and overload drift must remain rejected.
- Historical migration fixtures must retain their 001–012 starting schema.
- An old auditor must not download the previous SQL revision.
- Local SQL PASS must not be represented as a production or runtime PASS.

### Task 1: Current schema verification and regression

**Files:** `supabase/verification/verify_migration.sql`, `verify_parent_portal_definitions.sql`, `ops/security/generate-parent-portal-definition-reference.mjs`, `tests/parent-full-schema-fixture.mjs`, current verifier tests.

- [x] Add a failing integration test: execute migrations 001–013, confirm normalized MD5, run both full read-only entrypoints and verify no catalog/data changes.
- [x] Add negative checks: the 011 notification body and unknown 013 function drift remain rejected.
- [x] Update the explicit full notification body; generate the full parent reference using 013 and discover its added functions.
- [x] Update release-verifier test fixtures to 013 without changing transition fixtures by default.
- [x] Run focused SQL/security tests and `npm test`; review every failure.

### Task 2: Save and continue preflight

**Files:** SQL auditor deliverable and release audit note.

- [x] Review exact diff, preserve product/Edge/migration bytes, obtain independent review.
- [ ] Commit and push to the existing release branch.
- [ ] Pin the read-only SQL auditor to that commit and its five SHA-256 values; validate include expansion and source bytes.
- [ ] Review supplied runtime/backup evidence and identify missing server outputs; do not mark pending gates PASS.
- [ ] Provide updated command and SHA; stop before deploy.

## Verification ledger

- RED: new current-schema regression reproduced `Unsafe signup/goal function body` and the missing 013 functions in the full parent reference (1 PASS / 2 FAIL).
- GREEN: all three current-schema tests pass; old 011 body and unknown 013 body drift are rejected by both entrypoints.
- Independent review: two Important test-fixture defects reproduced. Corrected the drift fixture to use complete source migrations and isolated the reviewed 011 notification expectation in a TEST ONLY historical helper.
- Review fixes: focused SQL/security/transition checks 28/28 PASS; final `npm test` 356/356 PASS, 0 failures/skips/cancellations.
- Product, actual migrations, Edge source, configuration, workflow and release gates unchanged against `d2a1171`.
- Server preflight: screenshot evidence shows collector exit 0, config absent, container running and 17 mounted runtime files, but no complete JSON/router source is available here. Backup completeness and live SQL/runtime/isolated gates remain unverified. Timeweb panel returned `Site Unavailable` in this environment.
- No production SQL commands, deploy or main merge performed by this session.

# Controlled production release — 2026-10-04

The user cancelled creation of separate staging infrastructure and authorized pushing the parent-portal branch, reviewing production rollback/backup and migrations, rerunning the full test suite, then merging and deploying if those checks pass. No additional server is authorized.

All implementation changes were already committed; the worktree was clean at `2446228`. This separate checkpoint records the changed release instruction. The staging plan is retained as historical documentation, not an active provisioning instruction.

## Required evidence before production mutation

- Exact live frontend and Edge/config asset hashes and a recoverable snapshot. GitHub main alone does not prove a production rollback point.
- Current successful backup of DB/Auth/Storage/config, with its timestamp and integrity evidence.
- Actual current migration/schema/grant/RLS/Storage state and additive delta review; no clinical records or existing storage objects are to be deleted.
- Fresh full local tests and deployment checks.

## Current status

Push, live rollback identification, backup verification, merge, backend rollout, frontend deployment and post-deployment smoke tests are pending. Existing release workflow requires isolated-target evidence that has not been obtained. Do not submit a fabricated passing attestation. A controlled-production replacement gate must be defined and reviewed if this release proceeds without that evidence.

Code rollback must restore the saved actual application snapshot. It must not automatically reverse DB migrations or erase immutable publication/consent evidence.

## Completed preflight evidence

- Separate checkpoint committed as `316ea0ff5aa3bf06c9d187359399e88bb24d0203`. No uncommitted implementation changes existed before it.
- `git push origin codex/parent-portal` failed first on unavailable proxy, then outside that restriction on missing GitHub credentials (`could not read Username`). No push, force update or rewritten remote commit was performed.
- Fresh aggregate on CI-compatible Node `22.23.3`: **211/211 PASS**, zero failures/cancellations/skips. Log: `production-release-node22-tests.log`. The current default Node `24.19.0` had failed the nested test-runner output assertion; no product-source fix was needed to run the supported Node 22 gate.
- Read-only public downloads: index SHA-256 `f212f6b231cb82e1858f36914ec6b960a2c41a07761f1ceb67b097eb9cf4b568`; app.js `ea0c41d8d1f119548e54735afde36ec5fb932de7817261d5340489fb215572ee`; styles.css `e5edc90dfccf6129e76425f56c15a5dd470c124e8b9af91f2c93eb923e836af0`. All three exactly match Git objects at `f9f42204d907195ed04f09cd47f8ad563b2078fb`.
- GitHub last successful frontend deployment: run `36875658066`, 2026-10-01, same full SHA. Latest scheduled public smoke run `37193172884` succeeded on 2026-10-04. These checks establish a candidate frontend rollback commit, not complete current server/Edge/config parity or a recoverable server snapshot.

## Independent migration risk review

Reviewer `/root/production_migration_risk_reviewer` read actual 008–012 and baseline compatibility without production access. Baseline 001–007 is unchanged versus f9f4220. No unconditional migration-time patient deletion, table/column removal, truncation or Storage byte removal was found in 008–012. Each migration is transactional with bounded lock/statement timeouts. Replaced policies, triggers and constraints still require live-state reconciliation.

Release prerequisites identified:

1. Migration 008 backfills every existing Auth user as specialist only when roles table is first created. Existing parent-only/invited/anonymous accounts or an already-present incomplete role table must be reconciled before applying it. Do not blindly replay 001–007.
2. Ordinary signups in the 008-to-011 deployment window can lack a specialist role; control the window and check role coverage before restrictive policies become visible.
3. Migration 011 intersects specialist/account/owner access on clinical tables and Storage. Missing specialist roles deny existing users access, even without data loss.
4. Preexisting invalid contact emails, partial publication metadata or conflicting schema can abort constraints. Do not delete rows to make constraints pass.
5. Consent audit and signup reservations persist; published/archived reports/files remain protected after code rollback. Older frontend may receive denials when editing newly published material. Database rollback is not automatic.
6. Actual Storage version/ETag/If-Match and Edge/font packaging remain unknown. Deploying frontend alone installs neither DB nor five parent Edge Functions; existing AI configuration must be preserved.
7. Existing synthetic runner rejects production and deletes its fixtures during cleanup. Do not bypass its target guard. Controlled-production smoke requires a separate truthful procedure with synthetic accounts, no deletion of existing data and no invented isolated-target evidence.

No definite new code-level High issue was established; actual production authorization, schema, backup and runtime state remain unverified.

## Access stop

No local Timeweb SSH identity or server-side configuration is available; configured GitHub workflows reference secrets unavailable to this shell and provide no callable workflow-dispatch API here. Consequently the server rollback snapshot and current backup cannot yet be verified, and no DB/Edge/frontend mutation or merge has occurred. Next manual action is to open the existing Fizira server console in Timeweb; do not create a server or provide passwords in chat.

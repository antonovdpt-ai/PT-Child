# Flower final preflight implementation plan

> **For agentic workers:** Use superpowers:executing-plans to execute locally; production operations remain separately gated.

**Goal:** Prepare a verifiable complete frontend snapshot, minimal activation delta and truthful remaining gate evidence.

**Architecture:** Extend the existing protected activator with a snapshot-only mode and a complete-copy verifier. Keep source audit, head/base evidence, exact runtime profile and rollback drift checks. No application or server changes occur during preparation.

**Tech Stack:** Bash, Python 3 standard library, Node test runner, Chromium.

**Spec:** User request dated 2026-10-10: finish Flower production preflight; stop before any production mutation.

## Global constraints

- Branch `codex/flower-ui-production-20261009`, starting HEAD `b2b024ffa38e02e16da91c2db523c2079f862e48`.
- Production baseline `51e18c88377a7b20d06eef24b0db9fcb6d45fd3a`, marker `0.179-report-open`.
- No deploy, migrations, main merge, runtime restart, DB/Auth/RLS/Storage/Edge/PDF changes.
- Operator-attested SQL PASS is accepted as such; metadata is not a PDF/runtime execution PASS.
- Keep `reviewed_base_sha`, `release_evidence` and every independent runtime gate strict.

## Review focus

- A copied file can corrupt or change during capture: fail before any live write.
- Partial activation must remain recoverable while unknown newer bytes stop rollback.
- Symlinks and snapshots nested in the live tree must be refused.
- Extra static files must be preserved in the full snapshot without being published/deleted.
- Missing actual runtime hashes or synthetic results must remain pending.

## Task 1: Complete snapshot and exact delta

**Files:** add `ops/release/frontend-snapshot.py`, `ops/release/frontend-snapshot.test.mjs`; modify `ops/release/activate-frontend.sh` and workflow tool packaging.

**Interface:** `frontend-snapshot.py create|verify --target PATH --stage PATH --backup PATH --assets PATH`; verify needs only backup/assets, with optional operator-pinned manifest digest. Snapshot produces full files tree, before/release TSV, JSON metadata, SHA-256 manifest and completion digest. `activate-frontend.sh snapshot` captures only; `activate` uses a fresh snapshot and skips byte-identical assets; `rollback` verifies copied bytes then keeps its existing unknown-live guard.

- [ ] Write behavioral tests for full snapshot, no live/stage mutation, manifest integrity, symlink/reuse refusal, delta activation and guarded rollback.
- [ ] Run `node --test ops/release/frontend-snapshot.test.mjs`: expect new behavior failures before implementation.
- [ ] Implement only these release-tool changes.
- [ ] Run focused release tests: expect zero failures.

## Task 2: Runtime/PDF evidence and publication plan

**Files:** add `docs/releases/flower-final-preflight-20261010.md`; prepare operator commands and a pending profile outside the repository.

**Interface:** minimal safe metadata from existing collector output; exact image/router/Compose/tree hashes are required before creating a reviewed profile. OPTIONS/no-auth probes establish routing only. A successful read-only export uses an existing explicitly synthetic report and actor session; destructive synthetic gate runs only on an existing isolated target.

- [ ] Compare frontend/Edge/PDF assets to baseline and record exact nine-file delta.
- [ ] Run Chromium with fictional fixtures and inspect rendered screenshots; retain output.
- [ ] Run `npm test`, shell syntax checks and local guarded rollback rehearsal.
- [ ] Obtain independent review of release-tool changes and resolve critical/important findings.
- [ ] Save commands, hashes, gate matrix and conditional workflow plan. Do not create a reviewed runtime profile or true evidence fields without actual inputs.
- [ ] Commit/push only reviewed local tooling/docs after tests. Stop before production changes; request permission for snapshot creation separately.

## Ledger

Pre-flight: snapshot manifests are consumed by activator and rollback; workflow must ship the helper alongside the existing tools. Operator summary lacks exact runtime snapshot, so profile finalization is pending external evidence.
Ruling: prepare local release tools autonomously under the user's explicit preparation task; reserve production writes for separate permission.
Final review: four Important findings accepted (directory metadata, source symlink race, rollback symlinks, staged-byte race); each reproduced RED before the fix. Move checked copies and atomic renames into the existing activator's helper; workflow and release gates stay intact.
Final review: malformed public URL port initially graded Minor; treated as Important because an invalid configuration cannot prove PDF handoff readiness. Missing origin and malformed port reproduced RED and rejected by the verifier.
Ruling: isolation fixture retains all backend/PDF hashes; its explicit release-tool exceptions now include the reviewed activator. The original whole-file activation hash assertion failed on the intentional safety fix; behavioral release tests cover the replacement.
Declined-to-judge: live server image/hashes/ownership, actual synthetic PDF and isolated-target results remain external gates; do not claim them from local tests.
Task 1 local preparation complete: 370/370 full suite, 23/23 focused checks, syntax/diff checks; Important reproductions RED→GREEN. Existing protected gates retained.
Task 2 local checks complete: 32/32 Chromium, 18/18 current public assets match baseline, no-auth PDF routing observed; actual runtime profile, positive synthetic PDF, isolated gate and server backup remain pending. Local real-baseline rollback restored 18 files plus absence of three new assets.

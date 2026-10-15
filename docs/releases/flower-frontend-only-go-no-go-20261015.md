# Flower UI — frontend-only go/no-go (2026-10-15)

**Scope authorization:** user confirmed releasing only the Flower UI frontend; this is NOT approval for production mutations, backup creation or dispatching deploy workflows. This document is planning/review evidence, not a completed production preflight.

## Immutable source and permitted published bytes

- Production source baseline to re-check: `51e18c88377a7b20d06eef24b0db9fcb6d45fd3a` (last recorded public app version `0.179-report-open`).
- Reviewed Flower candidate: `ed6c103578cbfcabe19ab0077e8eeff1305d8b3d` on `codex/flower-ui-production-20261009` (candidate `0.187-flower-only`).
- This preparatory branch `release/flower-frontend-only-20261015` adds documents only. DO NOT confuse its future HEAD with the immutable deployed asset source SHA.
- Exactly **six changed existing files**: `app.js`, `cabinet.js`, `schedule-editor.js`, `parent-specialist.js`, `parent.html`, `index.html`.
- Exactly **three new files**: `patient-flower.css`, `patient-flower.mjs`, `patient-overview.mjs`.
- 12 pre-existing byte-identical dependencies stay in place: `styles.css`, `media-fallback.css`, `auth-domain.mjs`, `schedule-domain.mjs`, `security-utils.mjs`, `role-gate.mjs`, `parent.js`, `parent.css`, `parent-domain.mjs`, `report-pdf-export.mjs`, `favicon.ico`, `fizira-symbol.png`.
- All 21 paths are defined in `ops/release/frontend-assets.txt` at `ed6c103`; the snapshot/activator uses this full manifest, never a generic repository sync.
- Do not publish the other release-branch docs, SQL verifiers, workflow definitions, test files or release tools as frontend assets.

## Evidence already available — not fresh attestations

- Compare API shows the reviewed candidate is four commits ahead of the production source baseline, with the nine frontend assets and additional tools/tests/docs (not intended for publication).
- Historical review `docs/releases/flower-final-preflight-20261010.md`: 370/370 tests, 23/23 focused checks, 32/32 Chromium Flower suite; local rehearsal restored 18 baseline assets and three new files to absence. These are historical, not proof of current VPS state.
- Known production source baseline was publicly audited earlier; a **fresh** public and server-disk byte audit is still mandatory.
- The old `deploy-fizira-frontend.yml` intentionally requires `edgeRuntime` and `syntheticIsolatedTarget` evidence. **Do not forge those values or weaken the old workflow** to get a deploy green light.
- Scheduled production smoke on default `main` is currently failing; it expects older repository assets, so failures are not diagnostic of the reviewed `51e18c8` baseline. Investigate separately if fresh public hashes fail.

## Remaining minimal gates — in order, STOP on mismatch

1. **Read-only actual production identity.** Fetch and SHA-256 compare all **18 existing public assets** and the served `index.html` to `51e18c8` using cache-busted GET; check current app marker and any redirect/cache mismatch. Independently check exact corresponding live server-disk bytes, ownership, available capacity, and absence of symlink/nonregular file surprises. Never print private credentials or patient data. If any file is neither the reviewed base nor the reviewed candidate: STOP and reconcile rather than overwrite.
2. **Immutable release allowlist.** Verify the 21-file manifest and SHA-256 in `ed6c103`; six existing modified + three approved new, 12 unchanged. Require unchanged `supabase/functions`, `supabase/migrations`, Storage/Auth/backend and PDF source-contract paths for this publication. No new Edge, schema, migrations 008–013, service restart or production-data changes.
3. **Frontend-specific checks only.** Re-run/cite reviewed frontend unit/browser checks, especially mobile 320/375/390/430, 1440 desktop, seven petals, expand/collapse, contacts/schedule/goals, unsaved drafts, existing report open/export/share *as frontend controls* and parent cabinet navigation. Mocked checks are not actual PDF service proof; avoid claiming otherwise.
4. **Backup-only authorization (separate).** On confirmed current server paths, create a fresh complete frontend-only snapshot with `ops/release/frontend-snapshot.py`/`activate-frontend.sh snapshot`, separately verify the immutable manifest SHA-256, and record it off-server. Check backup ownership, free space and exact live state. Only explicitly approved backup writes; no production frontend mutation.
5. **Frontend-only activator review (separate).** Existing generic workflow is NOT suitable while full-rebuild evidence gates are absent; review a dedicated, narrowly scoped frontend-only route with the same or stronger public/live file hashing, complete snapshot, known-state rollback, exclusive temp writes, atomic rename, `index.html` last. No general SSH shell, database/Edge writes or weakened hashes. Any new deploy workflow/script needs local dry-run and review before approval.
6. **Distinct release permission** after all above PASS. Only then trigger the reviewed single-use deployment method. Verify disk SHA-256 and cache-busted public SHA-256 for all 21, app version `0.187-flower-only`, interactive mobile and desktop smoke. A known-state failure uses the matching snapshot with guarded rollback. If state is unknown, STOP rather than silently overwrite.

## Explicitly deferred outside this frontend release

- Stand-alone Auth/RLS/Storage/Edge/PDF integration expansion and off-line Deno cache adoption into Edge Runtime.
- Separate branded server PDF renderer/report workspace/PDF.js: **not** part of the nine-file Flower UI delta.
- New VPS/staging server or paid infrastructure.
- `main` merge, SQL migration replay, backend or service restarts.

## Fresh production audit — 2026-10-15

- **PASS**: [read-only GitHub Actions run 38757356071](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38757356071) on commit `75cc202d144b4c5eada6fcd7707fe891fa3fee51`.
- SSH compared only the allowlisted **21 static frontend files** on the actual Timeweb app directory: six existing files matched the reviewed base, 12 were identical in base/head, and three new Flower assets were absent as expected.
- Cache-busted public GET SHA-256 matched the Timeweb filesystem SHA-256 for **18/18 existing assets**, including `index.html`.
- Reported free space exceeded 512 MiB (threshold only, not a complete backup capacity guarantee).
- Exact runner report: `RESULT=BASELINE_READY_FOR_BACKUP`. No production modifications, no Auth/SQL/Edge queries. GitHub Secrets used solely to authenticate the read-only SSH session.
- The temporary branch-only automatic `push` trigger has been removed. No further audit runs are scheduled.
- This audit establishes current frontend byte parity only, **not** a server rollback snapshot, dynamic browser function or backend/PDF behavior.

## Backup-only on Timeweb — 2026-10-15

- First attempt [38762549644](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38762549644) failed with `PermissionError` before the backup root existed. Read-only diagnostics: SSH UID 1001; frontend 92 readable regular files and 27 directories, zero unreadable entries or links; 42 files owned by another UID/GID. No incomplete directory was left by that attempt.
- Approved retry [38763866489](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38763866489) **PASS**. The source audit repeated immediately before copy: `PUBLIC_BYTES_MATCH_DISK 18`, `RESULT=BASELINE_READY_FOR_BACKUP`.
- Private on-server directory: `~/.cache/fizira-frontend-snapshots/flower-ui-38763866489`. Contains `frontend.tar.gz`, `snapshot.json`, `before.tsv`, `release.tsv`, `manifest.sha256`, `complete`. Directory mode 0700, archive created with mode-limiting umask. No archive contents copied to GitHub Actions.
- TAR_V2 stores **all 92 files and 27 directories**, source total **5,823,129 bytes**, plus original numeric owners, modes and mtimes in headers and manifest. The archive was re-read and its file bytes + metadata checked against the live inventory; the live tree was re-inspected unchanged before marking the backup complete. This avoids privileged `chown` on the Timeweb SSH user.
- **Off-server manifest SHA-256:** `e18171381a5452860741fbe6578586aa6ceea0d33c7cac54ac3c5f56f5925346`. Preserve this value during any later restore review.
- Runner confirms `FRONTEND_BACKUP=PASS`, `PRODUCTION_SOURCE_UNCHANGED=YES`, `DATABASE_EDGE_STORAGE_UNTOUCHED=YES`, `RESTORE_NOT_TESTED=YES`.
- **Compatibility warning:** this TAR_V2 backup is not the `frontend-snapshot.py` file-tree v1 format; existing `activate-frontend.sh rollback` does **not** accept it. Before release, review/test a dedicated guarded TAR_V2 restore into a private temporary directory and a publish/rollback workflow; do not claim rollback readiness yet.
- One-time branch-only `push` triggers were disabled after registration; no scheduled retries.

## Isolated restore rehearsal — 2026-10-15

- **PASS** [GitHub Actions 38776158045](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38776158045), immutable test source commit `671195061f0ca2657b7199bd2cdbba0943f2e8ac`.
- Restored from existing backup `flower-ui-38763866489` with pinned manifest digest `e18171381a5452860741fbe6578586aa6ceea0d33c7cac54ac3c5f56f5925346`, verified manifest members, validated TAR_V2 structure, source owners/modes/timestamps as recorded metadata, and file content digests before any extraction.
- Used private **separate** directory `~/.cache/fizira-frontend-restore-tests/flower-ui-38776158045`, never the served `/root/supabase-project/volumes/proxy/app`. Fresh directories 0700 and files 0600, created as SSH user without sudo or `chown`. Test directory retained for independent inspection.
- Recovered **92 files, 27 directories, 5,823,129 uncompressed file bytes**, and independently rehashed all restored bytes against the saved manifest: `ISOLATED_RESTORE=PASS`, `RESTORED_HASHES=PASS`, `FRONTEND_BASE_ALLOWLIST=PASS`.
- Result also reports `LIVE_PRODUCTION_WRITES=NONE`, `DATA_AND_SERVICES_UNTOUCHED=YES`, `OWNERSHIP_REPLAY_TESTED=NO`, `PRODUCTION_ROLLBACK_TESTED=NO`.
- Automatic workflow `push` trigger removed immediately after approved run registered. No production publication, no rollback or owner/group change was authorized.
- **Remaining release blocker:** design and rehearse a narrowly scoped, hash-guarded publish and TAR_V2 rollback workflow (including UID/GID handling under SSH UID 1001), plus a final dry-run and explicit deploy approval. This isolated rehearsal is **not** an activation/rollback readiness assertion.

## Frontend-only publish/rollback preparation — 2026-10-15

- Production **ownership-only, read-only** CI [38777963459](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38777963459): all **six existing** files in the approved Flower delta are regular, SSH-user-owned, member-group writable and mode `0644`; app directory was writable and traversable to the SSH identity. All other 12 identical frontend dependencies remain untouched. This does not prove the actual `os.replace` on Timeweb.
- Prepared `ops/release/flower-frontend-transaction.py`: strict **21-entry** base/head SHA allowlist, **9-file** delta; verifies already-created and externally pinned TAR_V2 backup before mutation; verifies stage SHA, ownership/group and live source; publishes new Flower assets before the modified integration files, `index.html` last; uses exclusive temporary files, file descriptor fsync and atomic `os.replace`, fail-closed on unknown hashes or symlinks. Controlled rollback checks known old/new states and restores original existing bytes, modes, numeric UID/GID (for the six SSH-owned replacements), mtimes; removes the three new assets. Actual production activate/rollback needs a distinct approval environment marker, not included in any running CI. No sudo in production runner design.
- First CI [38778800393](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38778800393) falsely succeeded with **zero** discovered tests. Its result was explicitly rejected; corrected discovery and assertions. Invalid intermediate workflow YAML [38778950045](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38778950045) likewise did not run tests.
- Corrected CI [38779362815](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38779362815): **12/12** meaningful stdlib tests PASS. Covers no-write preflight, fixed asset delta, uninterrupted publish/rollback, interrupted publish and interrupted rollback recovery, source hashes, corruption, symlinks, unknown byte states, owner mismatch, and restoration of original UID/GID/mode/mtime. Fake data only.
- Real source rehearsal [38779708298](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38779708298): **12/12** safety tests PASS and real pinned Git blob bytes successfully exercised in temporary runner directories: `REAL_BYTES_ACTIVATE=PASS`, `REAL_BYTES_ROLLBACK=PASS`, `INTERRUPTED_ACTIVATION_RECOVERY=PASS`, `INTERRUPTED_ROLLBACK_RECOVERY=PASS`, `UNCHANGED_ASSETS_INODES=PASS`. No production SSH, secrets or test patient data.
- Fresh offline package builder `ops/release/build-flower-release-package.py`, approved job [38780074242](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38780074242) **PASS**. Artifact [11995078041](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38780074242/artifacts/11995078041), `flower-ui-pinned-package-38780074242`, contains only 9 pinned staged Flower assets, 21-entry `pins.json`, transaction helper and SHA-256 manifest inside the TAR package. Inner tar SHA-256: `030576f69b9d9ea90d378a4da70bcaf94d54e0ed4272ea1a1f12521353534af4`; outer GitHub artifact ZIP digest: `6fc700c07cbf6a8650baca762075e8b6a967a72771a3d425148fd1fae927697d`. Artifact retained through approximately 2026-10-22 17:46 UTC. Public source material only; no credentials or patient data.
- Every temporary `push` trigger used for preparation has been disabled. The original protected `deploy-fizira-frontend.yml` and backend remain unchanged. No production deploy, staging upload to Timeweb, `main` merge, migration or service restart occurred.
- **Remaining:** review a single-use production frontend-only workflow that privately stages this pinned bundle, checks existing public/disk base immediately before applying, invokes the new transaction with an explicit release-specific approval, performs post-deploy disk/public SHA verification and guarded rollback on any critical failure. Atomic replace has not been exercised on Timeweb; preserve operational stop conditions. Final permission from the user **must** be requested before this workflow is activated.
- Do not call the rollback guaranteed on production until actual deployment and post-activation validation have succeeded. The only completed restore on Timeweb was into a private test directory, without changing source UID/GID there.

## One-shot production workflow — prepared but HARD-LOCKED (2026-10-15)

- New draft `.github/workflows/flower-production-one-shot-LOCKED.yml` has **only** `workflow_dispatch` and the unconditional job gate `if: ${{ false }}`. It cannot run automatically; a distinct, explicit user deployment approval and a separately reviewed, single-use activating commit are required. GitHub dispatch on a branch-only workflow is not available unless the workflow also exists on the default branch; do NOT merge this file to `main` to bypass the deployment gate.
- The locked workflow pins actual `ed6c103` Flower source and exact Git blobs of the reviewed transaction script, package builder, remote stage verifier and public verifier. It regenerates the nine-file bundle from immutable source on the runner, confirms the SHA-256 of the package and validates the **18 existing public hashes** before configuring SSH.
- The publication path prepares only a private Timeweb staging directory (`~/.cache/fizira-frontend-deploy/flower-${GITHUB_RUN_ID}`), transfers only the known public-source bundle, validates its outer digest, member allowlist, inner manifest, nine staged hashes and exact helper SHA. This private staging write is **not yet executed** on Timeweb.
- After staging, the transaction's **no-write preflight** validates all 21 production disk states and the exact TAR_V2 backup manifest. With a separate release-specific approval guard, it would atomically replace just nine Flower files, `index.html` last. Post-activation, runner GET requests must confirm **21/21** public SHA-256 hashes. If activation or public verification fails, the runner will attempt a known-state, guarded TAR_V2 rollback (not an unconditional or guaranteed rollback); unknown or corrupt live states intentionally block destructive fallback.
- **Offline review** [38782513749](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38782513749) and final re-review [38782791783](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38782791783) both PASS: Ruby YAML syntax, shell `bash -n`, package SHA, **6/6** hard-lock/private-stage contract tests on true pinned bundle and **12/12** frontend transaction tests. No SSH credentials were provided to these jobs; no production files were modified.
- The review job's temporary push trigger was removed. No other new workflow currently has an active push trigger. Main has not been merged, backend/SQL/Edge/PDF have not been changed.
- **Unproved production-specific details:** Timeweb private-stage upload and transaction execution, web server/cache propagation, atomic rename on the actual Timeweb filesystem, and live guarded rollback. Reconfirm exact base on Timeweb immediately before any activation; STOP on a hash mismatch. A manual mobile/desktop interactive smoke test remains necessary after the release.
- Activation must be deliberately separate: pin the current reviewed release branch commit and secrets, replace the hard lock only after user permission, enable an exact one-time branch-only trigger, observe/record its run, immediately disable future triggering and reconcile the final public/rollback evidence.

## Current state

- Frontend source selection / allowlist: REVIEWED FROM GITHUB.
- Today's production frontend source parity (21 disk entries, 18 public GETs): **PASS via run 38757356071**.
- Server backup for this release: **TAR_V2 CREATED/VERIFIED** via Actions [38763866489](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38763866489); isolated restoration rehearsal **PASS via run 38776158045**; production rollback **NOT TESTED**. The historical owner-preserving file-tree snapshot format is not used.
- Frontend transaction/package and **HARD-LOCKED** one-shot workflow: **PREPARED + 18/18 OFFLINE CHECKS PASS**, still **NOT PRODUCTION-EXECUTED**.
- Permission to publish: **NOT GRANTED**.
- **GO/NO-GO: NO-GO until the concrete frontend-only gates pass and separate release approval is granted.**

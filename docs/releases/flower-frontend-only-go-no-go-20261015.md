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

## Current state

- Frontend source selection / allowlist: REVIEWED FROM GITHUB.
- Today's actual production source parity and disk snapshot: **NOT VERIFIED**.
- Server backup for this release: **NOT CREATED/VERIFIED**.
- Separate safe frontend-only deploy method: **NOT IMPLEMENTED OR REVIEWED**.
- Permission to publish: **NOT GRANTED**.
- **GO/NO-GO: NO-GO until the concrete frontend-only gates pass and separate release approval is granted.**

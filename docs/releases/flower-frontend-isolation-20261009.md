# Flower UI frontend-only release candidate

Status: candidate prepared; production activation is blocked pending actual server and runtime evidence and explicit user approval. No deploy, restart, database change or main merge was performed.

## Source and scope

- Reviewed production source: `51e18c88377a7b20d06eef24b0db9fcb6d45fd3a`, marker `0.179-report-open`. A fresh public HTTP audit matched all 18 existing assets. This identifies served frontend bytes, not server disk or deployed Edge runtime.
- Approved Flower source: `5b356a6c019209bfbd10578eae9cc0f512c3a5ab`; original branch remains unchanged.
- Isolated branch: `codex/flower-ui-production-20261009`, based on the production snapshot rather than main; frontend marker `0.187-flower-only`.
- Flower CSS, navigation module and overview module match the approved source byte for byte. Only necessary UI integration hunks were carried into the production app; its existing inline report editor and PDF handlers remain.

## Why the original release was blocked

The original Flower branch also contains a new report workspace, PDF preview/PDF.js dependencies, and a branded server PDF renderer. These changes are independent of Flower navigation. The PDF endpoint entrypoints, shared publication/access handlers and export request `{report_id, report_kind, mode: "export"}` match between the production-source snapshot and the original Flower commit. Missing runtime evidence did not establish an incompatible contract.

Option A isolates Flower and keeps the existing production-source PDF implementation. Its generate/download/share flow and saved-report opening without a Parent Cabinet remain. The newer report workspace, PDF preview, PDF.js assets and branded renderer are not included. No Edge update is required by this candidate's source dependencies; actual live backend parity must still be established before activation.

## Publication assets

The protected manifest packages 21 files: six changed existing files, three new files and 12 identical existing files.

| Change | Files |
| --- | --- |
| UI integration and cache markers | `app.js`, `cabinet.js`, `schedule-editor.js`, `parent-specialist.js`, `index.html`, `parent.html` |
| New approved Flower assets | `patient-flower.css`, `patient-flower.mjs`, `patient-overview.mjs` |
| Kept identical to production source | `styles.css`, `media-fallback.css`, `auth-domain.mjs`, `schedule-domain.mjs`, `security-utils.mjs`, `role-gate.mjs`, `parent.js`, `parent.css`, `parent-domain.mjs`, `report-pdf-export.mjs`, `favicon.ico`, `fizira-symbol.png` |

All Supabase files, PDF export code, protected deploy workflow, activation/rollback scripts, source audit, evidence validator and reviewed cache-baseline setup stay unchanged. Migrations 008–012 must not be repeated.

## Verification and review

Fresh automated and Chromium checks use fictional patients and mocked service responses; SQL/publication tests run locally. They are not attestations of deployed Edge, SMTP, live Auth/RLS/Storage or a separate isolated Supabase runtime.

- Full suite: 346 tests; mobile/desktop browser suite: 49 checks. No failures, skips or cancellations in the completed runs.
- Real Chromium rendering at 320/375/390/430, tablet widths, and 1280/1440; all seven patient sections, expansion/collapse, reduced motion, AI handler, legacy report opening/export/share, parent UI, goals, schedule preselection and retained unsaved input.
- Mobile compact height: 132 CSS px; 44 px navigation controls; no horizontal overflow, overlapping labels or inaccessible icon/label tap targets at the requested mobile widths.
- Desktop assertions require the right work column to start alongside Flower with a gap of at least 20 px and Overview visible within the first 900 px.
- A fresh independent review found contact edit identity and stale cross-section lists. Five new regressions cover UPDATE after navigation, refreshed session goal cards without resetting the goal editor, contacts flowing in both directions, and retained unsaved parent email. The three original symptoms were observed failing before fixes.
- Isolation fixtures freeze reviewed source hashes and PDF handler excerpts so protected CI does not require a production-base ancestor in its shallow checkout.

## Rollback and remaining gates

The existing `activate-frontend.sh` was rehearsed on a local production-source copy: all 18 original frontend files restored exactly; all three newly introduced assets restored to absence. The normal workflow creates and hashes a server-side backup immediately before activation, validates staged bytes, publishes `index.html` last, and guards rollback against unknown live files or corrupted backups. This local rehearsal does not prove that a usable backup already exists on Timeweb.

Timeweb's browser control panel was unavailable in this environment. No SSH connector or authenticated server audit was available. A bounded read-only console audit was prepared and locally verified to read hashes, container image/mount metadata and known backup manifests without writing files or reading credentials/clinical data. Its actual server output remains required.

Before dispatching the existing protected workflow, obtain: actual disk/Edge/helper/font/config hashes and running-container identity, source ancestry reconciliation, valid server backup or confirmed pre-activation backup conditions, existing SQL verification evidence without rerunning migrations, actual isolated runtime/synthetic evidence, and the user's separate deploy approval. `reviewed_base_sha` and `release_evidence` must remain truthful; missing gates must remain false. Do not dispatch deployment with a pending evidence file.

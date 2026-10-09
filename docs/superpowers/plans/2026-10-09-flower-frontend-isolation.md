# Flower frontend isolation implementation plan

Goal: Prepare a reviewable frontend-only Flower UI release over the HTTP-confirmed production snapshot 51e18c88377a7b20d06eef24b0db9fcb6d45fd3a. This is a candidate until a read-only server audit confirms disk/runtime parity.

Constraints: Keep all existing PDF endpoints, renderers, report export, parent Auth/RLS/Storage and migrations unchanged. No deploy, service restart, main merge or production data writes. Retain the approved Flower visuals from 5b356a6c019209bfbd10578eae9cc0f512c3a5ab. Use synthetic browser fixtures.

- [x] Establish a passing production-source baseline with npm test.
- [x] Retain source-identical report-pdf-export.mjs and all supabase files; add a release-isolation regression asserting this and preservation of existing report handlers.
- [x] Apply only Flower hunks in app.js; keep the existing overview report DOM and save/export handlers. Preserve hidden patient-section DOM and scope refresh to its section.
- [x] Add patient-flower.css/mjs and patient-overview.mjs from the approved version. Carry only required parent/schedule UI refresh and cache markers. Add three assets to the existing protected release manifest. Leave workflow and evidence gates unchanged.
- [x] Exercise real mobile navigation, expand/collapse, AI, existing reports/PDF, parent, goals, schedule and unsaved inputs with synthetic data; compare expanded/desktop visuals with approved Flower.
- [x] Verify exact backend/PDF parity with source baseline, diffs, checksums and local guarded activation/rollback. Produce a bounded read-only Timeweb audit command; its results remain required.
- [x] Save the candidate on its release branch and evidence. Stop before deploy and never attest missing server/SQL/runtime gates.

Review focus: report edits while hidden; asynchronous save during navigation; full-name and compact cap geometry at 320px; stale parent/goal lists after saves; server files or backups differing from HTTP-identical source.


Execution record: production-source baseline passed 318 tests before integration. Contact/report binding and three review findings were reproduced before fixes. Final product checks passed 346 unit and 49 browser tests. Source isolation and guarded rollback are verified locally; Timeweb disk, runtime, SQL and server backup gates are pending actual access/output. The candidate is being recorded on its isolated release branch; actual server evidence remains a separate blocking prerequisite.

Ruling: preserve the source-identical production PDF UI and backend while carrying approved Flower assets — this avoids unrelated PDF deployment dependencies; if production disk differs from the HTTP-confirmed source, stop and reconcile before publication.

Final: fixed contact edit identity, stale goal cards after sessions, and stale cross-panel contact lists — original regression symptoms RED→GREEN; draft-preservation cases also pass. No deferred minor review findings. No actual server/runtime judgment was made by the reviewer.

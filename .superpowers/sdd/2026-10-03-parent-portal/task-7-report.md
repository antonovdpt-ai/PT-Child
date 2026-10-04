# Task 7 implementation report

Date: 2026-10-03. Worktree: `/workspace/scratch/16d3a1422634/fizira-audit/.worktrees/parent-portal`. Branch: `codex/parent-portal`. Starting baseline: `3baa330`, after the independent Tasks1–6 security gate. Task7 only; Task8 remains unimplemented.

## Delivered

- `parent-specialist.js` exports `renderParentPortalSpecialist` and `renderParentSessionReportEditor`. It uses actual008–012 tables and Task4/5 endpoint bodies. Invitation create sends `{patient_id,contact_id}`, resend `{invitation_id}`, revoke `{access_id}`, PDF publication `{report_id,report_kind:'initial'|'session'}`. There is no role metadata fallback, invitation token handling, privileged browser client, or parent file endpoint call from the specialist controls.
- Patient tab «Кабинет родителя»: contact email display/edit, nullable legacy email, validation before invitation, four requested lifecycle labels, invitation/resend/revoke controls, confirmed access withdrawal, published initial/session/goal/photo visibility summary.
- Initial report editing uses only the six existing parent author fields. Session report editing uses only `what_did`, `what_worked`, `attention`, `home_recommendations`; no session source notes, AI draft, tolerance or finance is copied. Publication is explicitly confirmed; the server freezes snapshot/photo/PDF and writes publication metadata. Error retries re-read actual database status before updating, and existing report updates use an owned ID/status predicate with a single returned row.
- Published/archived report text is read-only. New version inserts only an owned draft with allowlisted author fields and selected owned source IDs. It never copies snapshot, private paths, digests, claims, revision, published timestamps or PDF metadata. Archive writes only the narrowly permitted status withdrawal.
- Photo choices show source-photo date and a specialist-only signed preview through existing specialist Storage rights (60-second URL). Owner prefix, non-artifact namespace, same configured Supabase HTTPS origin and lifecycle guards are checked. No raw source path is inserted as text/data markup, and no private publication-artifact path is selected or rendered. Failed/untrusted/stale previews are unavailable; selected images must finish loading before save/publication. Published editors do not present mutable source previews as frozen publication images.
- Goal controls require explicit parent wording, use exactly `new|in_progress|achieved|revised`, publish/withdraw explicitly through the existing owned goal-publication contract, and rely on011 for safe goal notifications. No source title/progress/percent is auto-filled.
- Existing overview AI drafting remains available. Its save action now saves an unpublished draft and refreshes local history, with publication managed in the new tab. The existing print view remains a clearly labelled specialist draft preview only; published/archived/publishing report actions route to immutable publication management.
- Existing contact form/list/edit gains optional email; old contact workflows without email remain. Session history gains a parent-report button that supplies only captured owned identity to the safe editor. Narrow responsive styles and the coordinated `index.html` app/CSS cache version are updated.

## Lifecycle fences

Module scopes capture a mounted root generation, owned account/patient identity and the injected authoritative `isCurrent`. They check before dispatch, after every await and before refresh/DOM continuation. Old handlers are inert after root replacement, account/child switch or generation replacement. `renderTab` captures account revision/user/child and mounted tab root; its injected refresh checks both before and after `loadPatientData`. The real patient loader now refuses to install delayed data if the selected child changed. Repeated same-account auth events retain existing form input behavior.

Behavior tests defer publication, report reads and media selection deletion, then retire/change the child and verify no late UI restoration, refresh or secondary selection/publication mutation. Actual app callback slices and the real patient loader are executed in HappyDOM, rather than relying exclusively on root source assertions.

## Controller rulings / backend extension

The010 guard's immutable-content check nominally allowed published→archived, but its authenticated metadata loop rejected every status change. There was no archive RPC/Edge endpoint. Controller explicitly ruled archival must be implemented and approved additive012, not editing010/011 or introducing a privileged browser RPC.

`20261003_012_parent_publication_archive.sql` copies the010 report guard exactly with one exception in the authenticated metadata loop: only key `publication_status`, old `published`, new `archived`. Every preceding content/identity/PDF/photo/claim immutability check, publishing guard, other metadata condition, existing trigger/RLS/account/role boundary is retained. A mechanical comparison confirmed the new function is byte-for-byte the old definition plus the approved predicate exception. The full verifier pins the exact normalized function body. README staging order is now007→008→009→010→011→012. Replaying010 after012 requires replaying012 before final verification.

Actual SQL tests exercise both initial/session reports: owner archive succeeds, parent-only/foreign specialist/inactive owner update affects no rows, archive with content/snapshot/path/identity/revision changes rejects, unarchive and deletion reject, row metadata and frozen photo references remain unchanged. Detail/list parent projections and PDF/photo file resolution hide archived reports. Replay and the full verifier pass; weakening the guard body fails verification. Pre012 migration011-focused verification intentionally stops at its installed boundary; the new012 test executes the complete latest verifier.

Controller also confirmed goal publication timestamps follow the existing009 owned table contract; there is no new goal RPC. Report timestamps remain server-only. Controller flagged ordinal-only photos as insufficient for safe selection; the preview/date implementation and associated tests address that concrete issue.

## RED → GREEN evidence

1. `node --test tests/parent-specialist-ui.test.mjs` initially failed with `ERR_MODULE_NOT_FOUND` for `parent-specialist.js`, before production implementation.
2. `PARENT012_BASELINE=1 node --test tests/parent-publication-archive-sql.test.mjs` failed against the real pre012 authenticated guard: own archive raised `Publication metadata is server-only`. Initial missing-file RED and test-shape corrections were also observed; assertions were aligned to the actual `{report:null}` RPC wrapper and ownership-trigger error before final GREEN.
3. Additional meaningful UI REDs caught successful publication failing to refresh visibility, and retry updating against stale `draft` instead of server `publication_error`. Query mock responses were changed to detached clones (matching REST behavior) so live in-memory references could not hide the status race. Fixed by refreshing while the old scope is current and re-reading authoritative owned report state before updates.
4. Loading failure initially left an empty editor; RED asserted actionable error text, then GREEN after mounting the status surface before reads.
5. Photo preview/date tests initially failed because no image was rendered/signing never occurred. GREEN after owned signed previews with trusted-origin and continuation fences.
6. Already-selected but still-loading photo initially permitted three mutations/publication; RED became GREEN after refusing save/publication until selected previews load.

## Final exact verification (after preview changes)

All commands ran locally, with no network E2E, production operation or external email.

- `node --test tests/parent-specialist-ui.test.mjs tests/parent-publication-archive-sql.test.mjs tests/calendar-dom.test.mjs tests/patient-media-ui.test.mjs tests/legal-release.test.mjs`: **39 passed, 0 failed**, exit0. Includes22 specialist HappyDOM tests and6 actual SQL archive tests.
- `npm test` (`TZ=UTC node --test tests/*.test.mjs`): **131 passed, 0 failed**, exit0. Final output inspected; no omitted failing repository test.
- `node --test supabase/functions/_shared/parent-portal.test.mjs supabase/functions/_shared/parent-publication.test.mjs supabase/functions/_shared/parent-pdf.test.mjs ops/security/production-rls-contract.test.mjs`: **25 passed, 0 failed**, exit0. The production RLS contract test is static/local verification, not a production security run.
- `node --check parent-specialist.js`: PASS, exit0.
- `node --check app.js`: PASS, exit0.
- `git diff --check`: PASS, exit0.
- Mechanical010→012 function comparison: **exact approved exception only**.

## Limitations / gates not run

- No manual browser/real-device visual QA, live Supabase/Auth/Storage integration, Deno runtime execution, SMTP delivery, or network end-to-end tests. HappyDOM is behavior testing, not a manual browser run.
- Existing Task4/5/6 isolated staging gates remain: Auth invitation classification/redirects/templates, SMTP, real Storage byte/metadata/ETag race tests, Cyrillic font packaging/runtime and real signed-image loading.012 must additionally be applied and verified in staging before frontend activation.
- Parent/specialist static-asset parity and full synthetic release/security E2E belong to Task8; this commit does not change deployment or ship the new imports to production. Task8 must include `parent-specialist.js`, existing parent/role-gate assets and012.
- Draft media replacement uses the existing separate REST delete/insert contract. If interrupted, the draft can retain partial selection and remains unpublished; successful save precedes this module's explicit publication call. SQL publishing/immutable guards remain authoritative for concurrent external operations.
- Frozen publication PDF/photo download is not implemented for specialist-only accounts in this task. Existing specialist draft print preview is retained; the generation endpoint returns status only, and parent-report-file requires a parent role/link. No URL/path is fabricated or parent endpoint misused.
- No production data, migrations, external emails, merge, push, deploy or Task8 work. Independent review is still required, particularly of012 and actual app integration.

## Fix round 1/5 — independent findings R1–R4

Independent review of `86211d4` correctly failed spec/security/quality. The passing initial mock-based tests did not detect the invalid access ordering or the missing administration/version/recovery states. This round addresses all four findings together; independent re-review is still required.

### R1 — actual schema ordering

Changed only the access query's timestamp to the real008 `granted_at`, including it in the narrow selection for the access display. Added `tests/parent-specialist-contract.test.mjs`: its query adapter builds and executes the exact selected/filtered/ordered SQL against the migrated PGlite database, under authenticated specialist RLS, including an empty access table. It serializes SQL role changes across Promise.all reads. Source columns omitted by the minimal shared fixture are completed from verbatim001 declarations, not guessed UI field names; parent tables come from the actual008–012 migrations. Invalid columns fail in PostgreSQL even with no rows. The older in-memory UI harness now records and applies order clauses rather than ignoring them.

RED: before correction, the database-backed portal rendered only the load-error message and the empty-schema contract test failed. GREEN: all portal queries compile and render; the recorded access order is exactly `granted_at desc`, with no SQL errors.

### R2 — all active accesses remain independently manageable

Active access controls now have a dedicated owned list independent of contacts. Every active access gets its own confirmed revoke button by allowlisted access ID. Missing/deleted contacts are labelled `Контакт удалён`; the UI explicitly explains that deleting a contact does not disable access. Contact email/invitation status controls remain separate. No automatic revocation or new identity query/backend contract was introduced.

RED: after fixing R1, a real specialist contact deletion changed the existing active access's contact ID to null; parent_has_active_access remained true, but the portal lacked deleted-contact/active/revoke controls. GREEN: the same retained authorization is visible, cancellation sends no revoke, confirmation invokes `{access_id}` and the existing service-only revoke procedure changes its actual status to revoked. A delayed revoke response after child/root retirement cannot refresh or replace the new UI.

### R3 — explicit session-version history

Session editors now list every owned version for the captured session with timestamp/status and a selected-version marker. Clicking a version passes its exact report ID into the editor. An explicit invalid/unowned/wrong-session ID displays `Версия отчёта недоступна` and never silently falls back to another version. Both the parent-tab session entry and the actual app session-history entry render this version history. Archive refresh re-renders that same version if the calling view remains mounted. Existing new-version creation still inserts a draft and never withdraws any older publication automatically.

RED: `[new draft, old published]` displayed the new draft but had no control to select the old report. GREEN: both entry points can open the old published version and reach its archive control while the newer draft survives. Actual SQL archive preserves the entire old row/snapshot/PDF/digest/claim/media metadata except the explicit status withdrawal, hides it from the parent projection, and leaves the newer draft untouched. Invalid exact IDs cannot expose an editor.

### R4 — server-enforced publishing recovery

Publishing editors now offer a separate confirmed `Повторить генерацию PDF` action and explain the server's15-minute recovery wait. This action invokes only `{report_id,report_kind}` and never calls save, changes author/media selection, writes publication metadata, or calculates/grants lease expiry in the browser. Existing server claim/CAS enforces live-lease refusal and expired-lease replacement. Error text stays generic and suggests refreshing/retrying later. Status refresh opens the same exact version; successful recovery refreshes parent visibility and, if still mounted, the exact editor. Initial and session kinds both use the same guarded generation path.

RED: publishing editors had only refresh, with no recovery control. GREEN: tests invoke the real SQL claim protocol: live lease refuses and stays publishing; an admin-fixture timestamp simulates16 minutes elapsed, after which the same generation-only UI action can claim/complete and become published. The test Edge adapter orchestrates existing service-only claim/complete/revoke SQL locally; it does not execute Deno/SMTP/network Edge requests. Tests assert there are zero browser author/media mutations during recovery, cancellation emits no request, exact initial/session request bodies are used, and a delayed recovery response cannot refresh or restore a retired child/root.

### Final fix-round verification

After all fixes, responsive version/access styling and coordinated cache bumps (`parent-specialist.js?v=2`, app/CSS `0.171-parent-specialist`):

- `node --test tests/parent-specialist-contract.test.mjs tests/parent-specialist-ui.test.mjs tests/parent-publication-archive-sql.test.mjs tests/calendar-dom.test.mjs tests/patient-media-ui.test.mjs tests/legal-release.test.mjs`: **45 passed, 0 failed**, exit0.
- `npm test`: **137 passed, 0 failed**, exit0.
- `node --test supabase/functions/_shared/parent-portal.test.mjs supabase/functions/_shared/parent-publication.test.mjs supabase/functions/_shared/parent-pdf.test.mjs ops/security/production-rls-contract.test.mjs`: **25 passed, 0 failed**, exit0.
- `node --check parent-specialist.js`, `node --check app.js`, `git diff --check`: PASS, exit0.
- Migration012 and all backend contracts are unchanged in this fix round. The existing full archive/verifier tests pass.

Earlier broad totals are historical, superseded by these fix-round results. No manual browser/real-device/remote SQL/Storage/Auth/SMTP/Deno/network E2E gates were run; all previously listed staging limitations remain. The new UI contract tests add local PostgreSQL/real-RLS evidence and do not substitute for runtime release checks. No Task8, subagents, production operation, external email, merge, push or deployment. Controller progress and independent-review files are preserved and excluded from this fix commit.

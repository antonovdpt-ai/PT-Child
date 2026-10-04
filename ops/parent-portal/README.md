# Parent portal release gates

The frontend activates an already verified backend. `npm test` runs repository,
shared Edge helper, security, release and schedule tests with bounded concurrency.
Local PGlite and Happy DOM checks do not prove runtime readiness. No gates below
were executed against a network target during Task8 implementation.

## Prerequisites and evidence

Reconcile reviewed main ancestry with live source before release; a shallow clone
is insufficient evidence. STOP on any unknown live hash. Obtain a restorable
DB/Auth/Storage/config backup and verify restoration on an isolated target.
Keep the production frontend closed until backend gates pass. Confirm Auth redirect
allow-list entries for the exact parent invitation/acceptance URL, Auth templates,
SMTP delivery and recovery behavior. Never test with real records or send email to
real recipients. The agreed fictional fixture is Артём Смирнов (2020-04-15), Анна
Смирнова and synthetic specialists; both synthetic children use these fictional
labels and distinct UUIDs. Accounts are uniquely namespaced `@example.invalid`.

Server environment: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `ANON_KEY`),
`SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`) and `FIZIRA_ALLOWED_ORIGINS`.
The current invitation redirect is fixed at
`https://app.fizira.com/parent.html?invite=…`. There is no redirect override
environment variable in this implementation; check staging routing explicitly. Keys remain server-side and never enter evidence,
frontend, logs or URLs. Check the actual current Edge environment against the
invitation handler contract. Verify Deno jsr Supabase and npm pdf-lib/fontkit
imports, bundled `_shared/fonts/NotoSans-Regular.ttf`, `OFL.txt` and
`supabase/config.toml` static_files packaging. Edge runtime filesystem/config
paths differ by host: set `FIZIRA_PRODUCTION_FUNCTIONS` and
`FIZIRA_PRODUCTION_CONFIG` to the actual deployed source/config paths.

## Staging then production order

1. Read-only source audit using reviewed `FIZIRA_BASE_SHA`/`FIZIRA_PR_SHA` and
   `FIZIRA_AUDIT_MODE=preactivation`. New files absent in both baseline and live
   are `APPROVED_NEW_ASSET_ABSENT`; that state permits planning a first rollout,
   never claims runtime activation. Existing files must match reviewed base or
   head. Unknown live bytes, missing existing files or missing reviewed assets STOP.
2. Apply baseline migrations as needed, then **008 → 009 → 010 → 011 → 012**.
   Retain backups and legal versions/hashes. Legacy reports stay drafts; legacy
   contacts without email remain valid. Do not unpublish/alter old clinical records.
3. Run `psql -X -v ON_ERROR_STOP=1 -f supabase/verification/verify_parent_portal.sql`.
   It uses a read-only transaction and the full effective RLS/grant/function/body,
   private bucket, partial index, role and immutable publication verifier.
   The included `verify_parent_portal_definitions.sql` pins SHA-256 of complete
   catalog function definitions (body, signature/defaults, return type, language,
   security/search path and other attributes), named owners and explicit non-owner
   execute grants for all 008–012 functions plus the baseline `account_is_active`.
   It compares complete policy sets, roles, commands, permissiveness and both
   expressions on initial/session reports, selected media, goals, notifications
   and parent identity tables. Unknown drift **STOPs** the gate. Existing checks
   for clinical-source/Storage/account intersections and publication guards remain.
   References are generated offline only with
   `node ops/security/generate-parent-portal-definition-reference.mjs` from reviewed
   repository migration sources in disposable PGlite; commit and independently
   review changes to the assertion. Never regenerate from live SQL to accept drift.
   PostgreSQL version/deparser or owner-name differences may also STOP: reconcile
   against reviewed sources rather than normalizing literals or bypassing checks.
   Real-target read-only verification remains a required release gate.
4. Separately deploy all five Edge Functions: create-parent-invitation,
   resend-parent-invitation, revoke-parent-access, generate-parent-report-pdf,
   parent-report-file. Deploy their shared helpers, font/license and static_files
   config. Retain the coupled ptchild-ai and AI helper parity. Run Deno/font/PDF
   smoke checks, actual Auth redirect/template/SMTP flows, multi-connection
   invite/resend/accept and publication races. Verify Storage API/S3/ETag and
   upload/copy/move/sign/write/delete semantics for active/archived publications.
   Confirm an unchanged published photo/PDF remains retrievable and an attempted
   mutation is denied. Frontend workflow never applies DB or Edge deployment.
5. On a **separate disposable isolated target**, run the opt-in synthetic gate:

   ```sh
   FIZIRA_PARENT_PORTAL_E2E_CONFIRM=synthetic-parent-portal-test \
   FIZIRA_PARENT_PORTAL_TARGET=isolated-disposable \
   node ops/security/test-parent-portal-rls.mjs
   ```

   Supply only isolated server URL/keys through secure environment injection.
   Known production hostnames are rejected; this designation is an operator
   responsibility, not proof of isolation for arbitrary custom domains.
   The gate reserves each new invitation before Auth INSERT, accepts it, and
   asserts roles exactly `parent`. It tests positive own-child projections,
   actual Edge claim-generated PDF/photo handoffs, cross-child/report/media
   denial, direct clinical REST and own-prefix Storage read/sign/write denial,
   specialist regression, immutable artifact operations, archive and revocation.
   Bounded requests keep finally reachable. Cleanup discovers generated keys
   including partial publication orphans, deletes clinical fixture cascades
   before protected Storage objects and Auth users, and checks errors. Immutable
   parent_consent_audit and durable parent_signup_reservations are **retained**.
   Their private grants intentionally prevent listing/deleting them via REST.
   **Complete teardown requires disposal of the isolated target**. Never disable
   triggers or widen grants. Cleanup failure fails the run; inspect/dispose target.
6. Complete the manual desktop/mobile acceptance checklist below on staging.
   Record artifacts/time/operator for every gate. Then repeat read-only production
   verification after the explicit separate production backend rollout; verify all
   Edge/config/font hashes equal the reviewed head before frontend activation.
7. Only after these gates pass, manually dispatch the frontend workflow with the
   reviewed base SHA and concrete `release_evidence` JSON bound to `github.sha`:

   ```json
   {"base":"<reviewed 40-hex main>","head":"<reviewed 40-hex release>",
    "target":"production","sourceAudit":"preactivation","migrations":"008-012",
    "backup":true,"sqlVerification":true,"edgeRuntime":true,
    "syntheticIsolatedTarget":true,"manualDesktopMobile":true,"ancestryReconciled":true}
   ```

   Evidence is an operator attestation backed by retained external gate records;
   it is not generated by local tests. The workflow validates evidence before
   production mutation and executes a live source preflight with `FIZIRA_EDGE_REQUIRE_HEAD=1`, then
   repeats that preflight immediately before activation. The source audit
   retains base/new-asset states for frontend only at that point; all Edge
   files/config/fonts must already equal the reviewed head. Every static asset
   from frontend-assets.txt is packaged, stage-hashed, snapshotted and activated,
   with index.html last. Source lists include role-gate, cabinet and schedule
   dependencies. The index app/styles and parent shared-styles marker is
   `0.172-parent-release`; app imports cabinet at v7 and cabinet imports the
   schedule editor at v7. The dependency regression compares every packaged
   importer against the available f9f4220 snapshot to reject baseline URLs for
   modified existing dependencies. An importing app version alone cannot refresh
   a reused module URL.
   `postactivation` requires **exact reviewed-head bytes for every frontend,
   Edge/helper/font/config asset**, then checks hashes of every public asset.

## Rollback decisions

Keep one writer/maintenance window for live files. Workflow concurrency and unique
run ID + run attempt prevent backup reuse across invocations. Unknown/newer source
means STOP and reconcile; never deploy an older source over live changes.

Each invocation backs up existing files with before hashes, explicitly marks
absent new files as `ABSENT`, records reviewed release hashes, and writes a complete
snapshot marker before any activation. All manifests and backup files must verify.
On a partial activation/public verification failure, rollback preflights **all**
live files before mutation: each must equal either its own before-state or this
invocation's release-state. Unknown/newer contents STOP the entire rollback.
Restore previous existing files; remove only introduced files still belonging to
this reviewed invocation. Restore index.html last. Retain backup/evidence for review.

If the backend gate fails before frontend activation, leave frontend closed and
repair forward or restore the pre-rollout database/Edge backup after assessing
new writes. Frontend rollback does not roll back migrations, Auth, consent evidence,
reservations or immutable artifacts. Never drop those tables or weaken guards as a
rollback shortcut. If new legitimate writes exist, stop and obtain a reviewed
recovery plan. Keep previous frontend and backend compatible until recovery passes.

## Manual acceptance checklist (desktop and mobile)

- Specialist: old contacts without email, email edit, invite/resend, generic invalid/
  expired/revoked/email-mismatch/reused invite handling; latest invite only.
- Parent: invitation → authenticated email-bound acceptance with all three current
  documents → dashboard; exact parent-only role; no specialist patient list load.
- Child switch isolation; upcoming/history schedule and empty/loading/retry states;
  no price/payment/debt or internal notes in API/UI/notifications.
- Initial/session report publication and failure/retry, readable Cyrillic PDF,
  selected immutable photo, unavailable photo; cross-ID guessed file denied;
  unpublished/archived report hidden. Check Storage/S3 writes/copy/move independently.
- Published goals and numeric GMFM-66/HINE and categorical MACS dynamics without clinical
  interpretation; goal/schedule notifications, mark-read isolation and no financial
  update notification.
- Profile/logout and specialist/parent role switching; parent A/B isolation;
  revoke removes dashboards/projections/new file handoffs. Previously issued signed
  URLs can remain valid until their maximum five-minute expiry.
- Specialist historical records, schedule, media, draft/new version, explicit archive,
  ownership/dual role and account deletion flows remain functional.

Unexecuted runtime gates are release blockers: real Auth/redirect/template/SMTP,
multi-connection races, Storage API/S3/ETag/upload/copy/move/sign semantics,
Deno imports/font packaging, and manual desktop/mobile flows. Local syntax tests
and PGlite/Happy DOM do not mark any of those gates passed.

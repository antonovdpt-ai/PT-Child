# Fizira Parent Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Deliver a secure, mobile-first parent portal in which an invited parent can see only explicitly published information for explicitly linked children.

**Architecture:** Keep every clinical source table specialist-only. The parent UI communicates exclusively with narrow security-definer RPC projections and checked Edge Functions; publication creates an immutable parent-safe snapshot before a server-generated PDF is stored in private Storage. Invitation, role, publication and notification data are separate from the clinical record and are covered by RLS, ownership triggers and synthetic end-to-end checks.

**Tech Stack:** Static HTML/CSS/ES modules, Supabase JS 2.116.0, PostgreSQL/Supabase RLS and SQL functions, Deno Edge Functions with jsr:@supabase/supabase-js@2, pdf-lib + embedded Noto Sans Cyrillic font, Node 22 node:test, PGlite, Happy DOM, existing Timeweb deployment scripts.

**Spec:** docs/superpowers/specs/2026-10-02-parent-portal-design.md

## Global Constraints

- Start from main commit f9f4220; work only on codex/parent-portal; do not overwrite production with an older source.
- Parents receive no direct SELECT policy on patients, assessments, sessions, goals, patient_media, parent_reports or standardized_assessments.
- Every parent projection is a SECURITY DEFINER function with a fixed search_path, auth.uid() check, active parent-child check, least-privilege GRANT EXECUTE, and no anon grant.
- Do not store a raw invitation token, put a service-role key in browser/GitHub/URL, accept a browser-supplied Storage path, or rely on hidden UI elements for authorization.
- Preserve existing specialist workflows and all historical data; legacy parent reports begin as draft and legacy contacts may have no email.
- Parent-visible content is explicitly published and parent-safe. Internal notes, AI drafts, planned_session, clinical assessment notes, media paths, prices, payments and debts never enter a parent RPC, notification, HTML or PDF.
- Invitation token lifetime is 7 days; every resend revokes the prior active invitation for that contact; acceptance is atomic and one-time.
- Use the current legal documents terms, privacy, personal_data_consent, version 1.0, with their existing published SHA-256 values. The database—not browser metadata—selects the version/hash and writes the server timestamp.
- PDFs are server generated from the immutable published_snapshot, embed a Cyrillic font, stay in private patient-media Storage below <therapist-id>/parent-reports/, and are exposed only through a validated signed URL with TTL at most 5 minutes.
- Do not add chat, video, payments, self-booking, clinical editing, home-program editing, automated parent recommendations or push notifications in v1.
- Test only with the agreed fictional fixture: Артём Смирнов (DOB 2020-04-15), Анна Смирнова, and a synthetic test specialist. Production is read-only except an explicitly confirmed synthetic security run.
- The frontend deploy workflow does not apply migrations or deploy Edge Functions. Database and function rollout is an explicit staged operation before frontend activation.

## Review Focus

1. A parent opens an expired, revoked, already-used or email-mismatched invitation: show a generic recovery message without naming a child or contact. Tested in Tasks 2, 4 and 6.
2. A parent guesses another child/report/media UUID or uses PostgREST/Storage directly: return no source rows, no object and no signed URL. Tested in Tasks 3, 5 and 8.
3. Two resend/accept requests race: only the latest unrevoked token can create one active parent-child link. Tested in Tasks 2 and 4.
4. PDF upload or rendering fails after publication starts: the report remains invisible to the parent, records publication_error, and retry creates a new immutable artifact. Tested in Task 5.
5. A schedule update changes only price/payment/note: it creates no parent notification and no financial value reaches a parent response. Tested in Task 3.

---

## File Map

| Path | Responsibility |
|---|---|
| parent-domain.mjs | Pure formatting, status and request-shape helpers used by the parent UI. |
| tests/parent-domain.test.mjs, tests/parent-ui.test.mjs, tests/parent-specialist-ui.test.mjs | Unit and Happy DOM regression coverage for the two frontend surfaces. |
| supabase/migrations/20261003_008_parent_portal_identity.sql | Roles, legal catalogue, contacts email, invitation/access tables, ownership constraints and invitation acceptance functions. |
| supabase/migrations/20261003_009_parent_portal_publications.sql | Publication entities, safe parent RPCs, notifications, RLS and source-table hardening. |
| tests/parent-portal-identity-sql.test.mjs, tests/parent-portal-publications-sql.test.mjs | PGlite fixtures proving SQL transitions, least privilege and parent-safe response shapes. |
| supabase/functions/_shared/parent-portal.ts | Shared input validation, no-store CORS, token digest, UUID and safe error helpers for parent Edge Functions. |
| supabase/functions/_shared/parent-pdf.ts and supabase/functions/_shared/fonts/NotoSans-Regular.ttf | Immutable snapshot-to-PDF rendering with embedded Cyrillic font. |
| supabase/functions/create-parent-invitation/index.ts, resend-parent-invitation/index.ts, revoke-parent-access/index.ts | Specialist-only invitation and access lifecycle. |
| supabase/functions/generate-parent-report-pdf/index.ts, parent-report-file/index.ts | Server-only publication/PDF generation and parent-checked file handoff. |
| parent.html, parent.js, parent.css | Isolated parent entry point and mobile-first UI. |
| parent-specialist.js, app.js, index.html, styles.css | Role-aware specialist entry plus invite, publish, session-report and goal controls. |
| supabase/verification/verify_parent_portal.sql, ops/security/test-parent-portal-rls.mjs, ops/parent-portal/README.md | Read-only schema verification, opt-in synthetic E2E gate and rollout/rollback instructions. |
| .github/workflows/deploy-fizira-frontend.yml, ops/release/audit-production-source.sh, package.json | Complete test coverage and deployment/audit asset parity. |

The work is one security boundary, not several independent subsystems: a partially delivered invitation, projection, PDF or UI path would be neither usable nor safe. It therefore remains one plan with independently reviewable tasks below.

### Task 1: Parent-domain contract and frontend test seam

**Files:**
- Create: parent-domain.mjs
- Create: tests/parent-domain.test.mjs

**Interfaces:**
- Consumes: no feature code; existing security-utils.mjs remains the escaping/URL primitive.
- Produces: formatParentDate(value), formatParentAge(dateOfBirth, now), publicationLabel(status), dynamicsSeries(rows), parentFileRequest(input), and PARENT_NAV_ITEMS for Tasks 5–7.
- parentFileRequest accepts only { kind: "pdf"|"photo", reportId: UUID, mediaId?: UUID }; it returns a fresh allowlisted object and rejects a Storage path, patient ID, URL or unknown key.

- [ ] **Step 1: Write the failing domain tests**

Create tests/parent-domain.test.mjs with exact cases for Russian date/age formatting, the five publication labels, numeric GMFM-66 series versus categorical HINE/MACS timeline rows, and these request assertions:

~~~js
assert.deepEqual(
  parentFileRequest({ kind:"photo", reportId: REPORT_ID, mediaId: MEDIA_ID }),
  { kind:"photo", report_id: REPORT_ID, media_id: MEDIA_ID },
);
assert.throws(
  () => parentFileRequest({ kind:"pdf", reportId: REPORT_ID, storage_path:"u/p/secret.pdf" }),
  /Invalid parent file request/,
);
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test tests/parent-domain.test.mjs  
Expected: FAIL with ERR_MODULE_NOT_FOUND for parent-domain.mjs.

- [ ] **Step 3: Implement the pure parent-domain interface**

Create parent-domain.mjs with the exported functions above. Clamp/validate dates and UUIDs, use no DOM/Supabase calls, return a categorical timeline for non-numeric scale values, and never derive a clinical conclusion or percentage.

- [ ] **Step 4: Run the focused and current frontend tests**

Run: node --test tests/parent-domain.test.mjs tests/auth-domain.test.mjs tests/calendar-dom.test.mjs  
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add parent-domain.mjs tests/parent-domain.test.mjs
git commit -m "test: add parent portal domain contract"
~~~

### Task 2: Identity, legal acceptance and invitation/access SQL boundary

**Files:**
- Create: supabase/migrations/20261003_008_parent_portal_identity.sql
- Create: tests/parent-portal-identity-sql.test.mjs
- Modify: supabase/README.md
- Modify: supabase/verification/verify_migration.sql

**Interfaces:**
- Consumes: original schema, migration 20260930_007_legal_acceptances.sql, auth.uid(), Task 1 UUID rules.
- Produces: app_user_roles, legal_document_versions, parent_child_access, parent_invitations, contact email, and SQL functions:
  - current_app_roles() returns table(role text)
  - parent_has_active_access(p_parent_user_id uuid, p_patient_id uuid) returns boolean
  - parent_invitation_state(p_token text) returns jsonb
  - accept_parent_invitation(p_token text, p_accepted_documents jsonb) returns uuid
- Produces service-only record procedures for Task 4: issue_parent_invitation_record(...) and revoke_parent_access_record(...); direct browser grants are forbidden. Task 3 supplies publication state-transition helpers for Task 5.

- [ ] **Step 1: Write the failing PGlite identity/security test**

Create a minimal PGlite auth fixture in tests/parent-portal-identity-sql.test.mjs. Assert all of the following after executing 008:

~~~js
assert.equal(await rpcAs(parentA, "parent_has_active_access", [parentA, childA]), true);
assert.equal(await rpcAs(parentA, "parent_has_active_access", [parentA, childB]), false);
await assert.rejects(acceptAs(parentA, revokedToken, requiredDocuments), /invitation/i);
await assert.rejects(acceptAs(wrongEmailParent, liveToken, requiredDocuments), /email/i);
assert.equal(await directTableWriteAs(parentA, "app_user_roles"), false);
~~~

Also assert: existing auth.users are backfilled only with specialist; no raw token column exists; the digest is 64 hex characters; a mismatched therapist_id link is rejected; a second active link is impossible; and the database records its own legal version/hash/accepted time despite a caller-provided spoofed version.

- [ ] **Step 2: Run the SQL test to verify it fails**

Run: node --test tests/parent-portal-identity-sql.test.mjs  
Expected: FAIL because migration 20261003_008_parent_portal_identity.sql is absent.

- [ ] **Step 3: Implement migration 008**

Create the migration as one idempotent transaction.

1. Add nullable patient_contacts.email with trim/lowercase validation; do not make legacy contacts invalid.
2. Add app_user_roles(user_id, role, created_at); backfill specialist only for users present when this migration runs; revoke all authenticated writes.
3. Add legal_document_versions seeded with the three current v1.0 document hashes and authoritative public URLs. accept_parent_invitation must require the currently active required records and insert matching user_consents rows with database time, not trust a version/hash from JSON.
4. Add parent_child_access and parent_invitations with constraints/indexes described in the spec. Store token_digest only, set default expiry to now() + interval "7 days", and retain revoked/accepted audit fields.
5. Add a BEFORE INSERT OR UPDATE access trigger that reads patients and rejects a relation whose therapist_id differs from the child owner. Use a partial unique index for one active parent-child relation.
6. Implement the four exact function interfaces with SECURITY DEFINER, SET search_path = pg_catalog, public, bounded inputs, auth.uid() checks and grants only to the required role. parent_invitation_state may return only flow/validity state after email-bound authentication—never patient/contact identity.
7. Retain specialist RLS on existing tables; add no parent policy to a clinical source table. Add migration checks to verify_migration.sql for the new tables, RLS and no direct authenticated role/access writes.

- [ ] **Step 4: Run migration and legacy regression tests**

Run: node --test tests/parent-portal-identity-sql.test.mjs tests/legal-release.test.mjs tests/schedule-sql.test.mjs  
Expected: PASS, including atomic acceptance and unchanged legacy consent behavior.

- [ ] **Step 5: Commit**

~~~bash
git add supabase/migrations/20261003_008_parent_portal_identity.sql tests/parent-portal-identity-sql.test.mjs supabase/README.md supabase/verification/verify_migration.sql
git commit -m "feat: add secure parent invitation identity schema"
~~~

### Task 3: Publication model, parent projections and notification SQL boundary

**Files:**
- Create: supabase/migrations/20261003_009_parent_portal_publications.sql
- Create: tests/parent-portal-publications-sql.test.mjs
- Modify: supabase/verification/verify_migration.sql
- Modify: ops/security/production-rls-contract.test.mjs

**Interfaces:**
- Consumes: Task 2 parent_has_active_access, roles and access relations.
- Produces: parent_session_reports, parent_session_report_media, parent_goal_publications, parent_notifications; publication fields on parent_reports; and the parent RPC contract:
  - parent_portal_children() returns jsonb
  - parent_portal_dashboard(p_patient_id uuid) returns jsonb
  - parent_portal_schedule(p_patient_id uuid, p_mode text) returns jsonb
  - parent_portal_reports(p_patient_id uuid) returns jsonb
  - parent_portal_report(p_report_id uuid) returns jsonb
  - parent_portal_goals(p_patient_id uuid) returns jsonb
  - parent_portal_dynamics(p_patient_id uuid) returns jsonb
  - parent_portal_notifications(p_patient_id uuid) returns jsonb
  - parent_mark_notifications_read(p_notification_ids uuid[]) returns integer
- Parent response shape is fixed: child id, display_name, date_of_birth; schedule starts_at, ends_at, status; report list/detail snapshots plus opaque media IDs; goals title, description, status, updated_at; dynamics only scale, assessed_at, value_numeric/value_text; notifications id, type, title, body, entity_type, entity_id, created_at, read_at.

- [ ] **Step 1: Write failing publication/RPC tests**

Create tests/parent-portal-publications-sql.test.mjs using two children, two parents, one specialist and a selected image fixture. Pin these assertions:

~~~js
assert.equal((await parentRpc(parentA, "parent_portal_reports", childB)).length, 0);
assert.equal((await parentRpc(parentA, "parent_portal_report", unpublishedReport)).report, null);
assert.doesNotMatch(JSON.stringify(await parentRpc(parentA, "parent_portal_dashboard", childA)), /price_kopecks|paid_kopecks|note|planned_session/);
assert.equal(await directSelectAs(parentA, "sessions", childA), 0);
~~~

Also test legacy reports become draft; a published report returns its immutable snapshot rather than live source fields; selected media must match both child and therapist; an appointment price/payment/note-only update produces no notification; a time/status change creates a notification only for active parents; and an IDOR report/notification update affects zero rows.

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test tests/parent-portal-publications-sql.test.mjs  
Expected: FAIL because migration 009 and parent RPCs are absent.

- [ ] **Step 3: Implement migration 009**

Create one idempotent transaction that:

1. Extends parent_reports with publication_status, published_at, published_by, published_snapshot, pdf_storage_path, pdf_generated_at, publication_error and a publication revision; backfill every existing row to draft.
2. Adds the separate session-report, selected-media, goal-publication and notification tables with patient/therapist FKs, constraints, indexes, specialist RLS and the restrictive account_is_active policy. Do not copy sessions.note, AI data, planned_session, tolerance or assessment notes into them.
3. Rejects mutation of a published report’s content. The specialist UI must create a new draft version for a material revision; the old published snapshot/PDF remains immutable.
4. Adds same-child/same-therapist validation for selected media, and no parent Storage policy.
5. Adds notification triggers for transition to published and for only appointments INSERT or actual changes to starts_at, ends_at or status. Notification templates contain no finance or clinical-source field.
6. Implements all nine parent RPCs with one active-access helper call per requested child/report and a fixed allowlist of output columns. Use date/value fields only for dynamics, cap page/result sizes, reject unknown schedule modes, and return an empty/generic result for inaccessible IDs.
7. Revokes direct parent writes/selects to all new tables and confirms existing clinical source policies remain specialist-only. Update verify_migration.sql and production-rls-contract.test.mjs to enforce those invariants.

- [ ] **Step 4: Run publication, RLS-contract and specialist regression tests**

Run: node --test tests/parent-portal-publications-sql.test.mjs ops/security/production-rls-contract.test.mjs tests/schedule-sql.test.mjs  
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add supabase/migrations/20261003_009_parent_portal_publications.sql tests/parent-portal-publications-sql.test.mjs supabase/verification/verify_migration.sql ops/security/production-rls-contract.test.mjs
git commit -m "feat: add parent-safe publication projections"
~~~

### Task 4: Specialist-only invitation and access Edge Functions

**Files:**
- Create: supabase/functions/_shared/parent-portal.ts
- Create: supabase/functions/_shared/parent-portal.test.mjs
- Create: supabase/functions/create-parent-invitation/index.ts
- Create: supabase/functions/resend-parent-invitation/index.ts
- Create: supabase/functions/revoke-parent-access/index.ts
- Modify: supabase/functions/README.md

**Interfaces:**
- Consumes: Task 2 service-only invitation/access procedures and current FIZIRA_ALLOWED_ORIGINS behavior.
- Produces:
  - POST create-parent-invitation { patient_id: UUID, contact_id: UUID } → { ok:true, expires_at:string }
  - POST resend-parent-invitation { invitation_id: UUID } → { ok:true, expires_at:string }
  - POST revoke-parent-access { access_id: UUID } → { ok:true }
  - shared exports normalizeParentEmail(value), uuid(value), sha256Hex(value), parentCors(origin), parentJson(origin,status,body), and ParentPublicError.
- All three endpoints return generic public errors, use Cache-Control: no-store, require a valid bearer user, verify specialist ownership with a user-scoped client before using service-role work, and never return/log token, account-existence or Auth link data.

- [ ] **Step 1: Write the failing shared/endpoint contract tests**

Create supabase/functions/_shared/parent-portal.test.mjs. Test lowercase/trim email normalization, SHA-256 output, malformed UUID/body rejection, CORS rejection and no-store headers. Read endpoint sources to assert their payload allowlists, no token response field, no browser-provided email/Storage path, ownership query before any admin Auth call, and shouldCreateUser:false for an existing-user magic link.

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test supabase/functions/_shared/parent-portal.test.mjs  
Expected: FAIL with missing shared module/endpoints.

- [ ] **Step 3: Implement shared helpers and invitation lifecycle endpoints**

1. Generate a cryptographically random base64url token only in memory; store its SHA-256 digest using Task 2’s service-only procedure.
2. Build redirect URLs only as https://app.fizira.com/parent.html?invite=<encoded-token> (or configured same-origin equivalent); do not interpolate user-controlled origin/path.
3. For a new address call Supabase Auth invite with that redirect; for an existing address issue the configured magic-link flow with shouldCreateUser:false. Always return the same success shape to the specialist.
4. Resend revokes the prior active invitation atomically before creating/sending the new one. Revoke marks active access revoked and invalidates pending invitations for the same contact/child.
5. Document required server-only variables, redirect allow-list configuration and SMTP dependency in supabase/functions/README.md; no secrets appear in the repository.

- [ ] **Step 4: Run helper/function checks**

Run: node --test supabase/functions/_shared/parent-portal.test.mjs && node --experimental-strip-types --check supabase/functions/create-parent-invitation/index.ts && node --experimental-strip-types --check supabase/functions/resend-parent-invitation/index.ts && node --experimental-strip-types --check supabase/functions/revoke-parent-access/index.ts  
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add supabase/functions/_shared/parent-portal.ts supabase/functions/_shared/parent-portal.test.mjs supabase/functions/create-parent-invitation/index.ts supabase/functions/resend-parent-invitation/index.ts supabase/functions/revoke-parent-access/index.ts supabase/functions/README.md
git commit -m "feat: add parent invitation edge functions"
~~~

### Task 5: Immutable publication PDF and checked parent file handoff

**Files:**
- Create: supabase/functions/_shared/parent-pdf.ts
- Create: supabase/functions/_shared/parent-pdf.test.mjs
- Create: supabase/functions/_shared/fonts/NotoSans-Regular.ttf
- Create: supabase/functions/generate-parent-report-pdf/index.ts
- Create: supabase/functions/parent-report-file/index.ts
- Modify: supabase/functions/README.md

**Interfaces:**
- Consumes: Task 3 publication state/snapshots and Task 4 authentication, CORS and validation helpers.
- Produces:
  - POST generate-parent-report-pdf { report_id: UUID, report_kind:"initial"|"session" } → { publication_status:"published", generated_at:string } or a generic retry-safe error.
  - POST parent-report-file { kind:"pdf"|"photo", report_id: UUID, media_id?: UUID } → { url:string, expires_at:string }.
  - renderParentPublicationPdf(snapshot) -> Promise<Uint8Array> with embedded Noto Sans Cyrillic font.
- Neither endpoint accepts report body, patient ID, photo path, PDF path, signed URL, filename or status from the browser.

- [ ] **Step 1: Write the failing PDF/file contract tests**

Create supabase/functions/_shared/parent-pdf.test.mjs with a Cyrillic snapshot containing Артём Смирнов. Assert the output begins with %PDF-, is non-empty, embeds the chosen font name, and preserves the exact fixed snapshot/revision content. Add source-contract tests that generate-parent-report-pdf creates the snapshot server-side before Storage upload, records publication_error on upload/render failure, and that parent-report-file obtains a record-selected path only after parent access + publication + selected-media checks and creates a URL for no more than 300 seconds.

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test supabase/functions/_shared/parent-pdf.test.mjs  
Expected: FAIL with missing renderer and functions.

- [ ] **Step 3: Implement server-only publication and file functions**

1. Authenticate the actor with a user-scoped client. generate-parent-report-pdf permits only the owning specialist and reads the report/session-report source on the server.
2. Build a versioned immutable parent-safe published_snapshot; change status to publishing before work, write a PDF below <therapist-id>/parent-reports/<kind>/<report-id>/<revision>.pdf, then atomically mark published and emit a notification. On any failure record publication_error and leave it inaccessible to a parent.
3. Use pdf-lib and embedded Noto Sans Regular to render headings, source date, therapist signature fields and parent-safe body. Do not call AI or download external assets.
4. parent-report-file authenticates the parent, resolves only published report rows/explicit selected media from the database, then uses its service client to issue a 300-second-or-less URL. Return no path and no different error for guessed IDs.
5. Update function documentation with package/import, font-license attribution, immutable retry behavior, private Storage requirement and separate deployment order.

- [ ] **Step 4: Run PDF/function checks**

Run: node --test supabase/functions/_shared/parent-pdf.test.mjs supabase/functions/_shared/parent-portal.test.mjs && node --experimental-strip-types --check supabase/functions/generate-parent-report-pdf/index.ts && node --experimental-strip-types --check supabase/functions/parent-report-file/index.ts  
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add supabase/functions/_shared/parent-pdf.ts supabase/functions/_shared/parent-pdf.test.mjs supabase/functions/_shared/fonts/NotoSans-Regular.ttf supabase/functions/generate-parent-report-pdf/index.ts supabase/functions/parent-report-file/index.ts supabase/functions/README.md
git commit -m "feat: add immutable parent report PDFs"
~~~

### Task 6: Parent entry point, invitation acceptance and mobile portal UI

**Files:**
- Create: parent.html
- Create: parent.js
- Create: parent.css
- Create: tests/parent-ui.test.mjs
- Modify: app.js
- Modify: index.html

**Interfaces:**
- Consumes: Task 1 domain helpers; Tasks 2–5 RPC/Edge JSON contracts.
- Produces: createParentPortal({ app, sb, window, document }) in parent.js; it calls only parent RPC names and the two validated file/invitation endpoints.
- Modifies app.js with loadCurrentRoles() -> Promise<Set<"specialist"|"parent">>. A parent-only account redirects before loadPatients(); a dual-role account is offered an intentional link to parent.html.

- [ ] **Step 1: Write failing Happy DOM UI tests**

Create tests/parent-ui.test.mjs with a mocked sb.rpc/functions client and these assertions:

~~~js
assert.match(app.textContent, /Ближайшее занятие/);
assert.match(app.textContent, /Главная.*Расписание.*Отчёты.*Цели.*Динамика/s);
assert.equal(sourceTableCalls.length, 0);
assert.equal(await invokeFile("photo", REPORT_ID, MEDIA_ID).name, "parent-report-file");
assert.doesNotMatch(window.location.href, /invite=/);
~~~

Cover signed-in invitation acceptance (new account needs matching password/name/required legal checks; existing magic-link account may leave password blank), generic invalid-invitation screen, child switch, empty states, unread notification marking, photo-unavailable state, report download, profile/password/logout and parent-only root redirect before specialist data loading.

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test tests/parent-ui.test.mjs  
Expected: FAIL because parent.html and parent.js do not exist.

- [ ] **Step 3: Implement the parent frontend and role gate**

1. Create a no-referrer parent.html with the normal Fizira visual identity, module entry, viewport settings and no specialist sidebar.
2. Implement createParentPortal around parent_portal_children and the eight parent data RPCs. Render only escaped RPC fields; use the Task 1 helpers; never call .from() for a source table.
3. On an Auth redirect with invite, obtain only parent_invitation_state, let a new user set/confirm password and display legal links, call auth.updateUser first when needed, then call accept_parent_invitation. Remove invite with history.replaceState immediately after success and never expose token values in UI/errors.
4. Render the mobile-first dashboard, child picker, section navigation, skeleton/empty/retry states, safe dynamics display, report detail and a disabled Фото недоступно fallback. File requests use parentFileRequest then parent-report-file; never render a path or unvalidated URL.
5. Add profile, password change and sign-out. Add intentional route links for dual-role accounts. Modify app.js so current_app_roles() completes before profile/patient loading and parent-only users cannot reach the specialist app by URL.

- [ ] **Step 4: Run parent and existing auth/UI regressions**

Run: node --test tests/parent-domain.test.mjs tests/parent-ui.test.mjs tests/auth-domain.test.mjs tests/patient-media-ui.test.mjs  
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add parent.html parent.js parent.css tests/parent-ui.test.mjs app.js index.html
git commit -m "feat: add mobile parent portal"
~~~

### Task 7: Specialist parent-portal controls and backward-compatible authoring flow

**Files:**
- Create: parent-specialist.js
- Create: tests/parent-specialist-ui.test.mjs
- Modify: app.js
- Modify: styles.css

**Interfaces:**
- Consumes: Task 3 specialist publication tables and Task 4/5 Edge endpoints.
- Produces:
  - renderParentPortalSpecialist({ root, sb, user, patient, contacts, refresh })
  - renderParentSessionReportEditor({ root, sb, user, patient, session, refresh })
- The specialist module invokes create-parent-invitation, resend-parent-invitation, revoke-parent-access, generate-parent-report-pdf, and writes only specialist-owned draft/publication data permitted by Task 3 RLS.

- [ ] **Step 1: Write failing specialist UI tests**

Create tests/parent-specialist-ui.test.mjs with Happy DOM mocks. Assert a patient tab named Кабинет родителя, contact email edit/display, invitation lifecycle buttons, status labels Не приглашён, Приглашение отправлено, Активирован, Доступ отозван, confirmation before publish/revoke, retry after a PDF error and no token/path in rendered markup. Assert that a session report contains only the four parent-safe author fields and selected media IDs, not source note/AI/tolerance data.

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test tests/parent-specialist-ui.test.mjs  
Expected: FAIL with missing parent-specialist.js export.

- [ ] **Step 3: Integrate specialist controls**

1. Add email to the existing contact form/edit/list while retaining all old contacts without email.
2. Import the module in app.js, add the patient tab and load only required specialist-owned portal state.
3. Render contact invitation status, resend/revoke actions, and a visibility summary. Validate email before inviting; the browser sends only contact/patient/access identifiers, never invitation token or user role.
4. Convert existing parent-report save/print PDF behavior into draft authoring. Add an explicit confirmation that calls the server PDF publication endpoint; show draft, publishing, published and publication_error. A published report is immutable; new version creates a new draft.
5. Add session-report authoring with exact fields what_did, what_worked, attention, home_recommendations, explicit image selection and publish/retry. Add goal-publication controls for exact parent-safe title, description, status values new|in_progress|achieved|revised; do not render goal percentages to the parent.
6. Add narrow responsive CSS; preserve the current specialist dashboard, schedule, media and auth behavior.

- [ ] **Step 4: Run specialist and current regressions**

Run: node --test tests/parent-specialist-ui.test.mjs tests/calendar-dom.test.mjs tests/patient-media-ui.test.mjs tests/legal-release.test.mjs  
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add parent-specialist.js tests/parent-specialist-ui.test.mjs app.js styles.css
git commit -m "feat: add specialist parent portal controls"
~~~

### Task 8: Release parity, verification, synthetic E2E gate and rollout documentation

**Files:**
- Create: supabase/verification/verify_parent_portal.sql
- Create: ops/security/test-parent-portal-rls.mjs
- Create: ops/security/parent-portal-rls-contract.test.mjs
- Create: ops/parent-portal/README.md
- Create: ops/release/parent-portal-release.test.mjs
- Modify: .github/workflows/deploy-fizira-frontend.yml
- Modify: ops/release/audit-production-source.sh
- Modify: package.json
- Modify: README.md

**Interfaces:**
- Consumes: every production asset, function and SQL function from Tasks 1–7.
- Produces:
  - read-only psql verification of schema/RLS/functions/grants/no parent source-table policy;
  - opt-in FIZIRA_PARENT_PORTAL_E2E_CONFIRM=synthetic-parent-portal-test network gate;
  - documented staging→production order and manual parent UI acceptance checklist;
  - one npm test command that includes all tests/*.test.mjs, parent security/release contracts and shared function tests.

- [ ] **Step 1: Write failing release/security contract tests**

Create ops/security/parent-portal-rls-contract.test.mjs and ops/release/parent-portal-release.test.mjs. Assert the synthetic script requires its exact confirmation string, uses only @example.invalid users, has a finally cleanup for every created UUID/path, tests direct source-table/Storage denial and cross-child RPC/file denial. Assert the workflow package, remote stage/backup/activation and source-audit lists all of:

~~~
parent.html parent.js parent.css parent-domain.mjs parent-specialist.js
~~~

and verifies the Edge source list for the five new functions, shared helpers and font; the runbook must require their deployment and synthetic verification before the frontend becomes public.

- [ ] **Step 2: Run the tests to verify they fail**

Run: node --test ops/security/parent-portal-rls-contract.test.mjs ops/release/parent-portal-release.test.mjs  
Expected: FAIL because the release and E2E artifacts are absent.

- [ ] **Step 3: Implement verification, packaging and operational gate**

1. Create verify_parent_portal.sql as read-only checks for tables, RLS, partial indexes, fixed function grants, absent parent SELECT policies on clinical sources, private bucket, parent-only RPC grants and publication constraints.
2. Create test-parent-portal-rls.mjs. It must make two synthetic specialists, two synthetic parents and two fictional children; seed only its own fixture; prove invite state, acceptance, parent A/B isolation, direct REST/Storage denial, safe RPC fields, cross-ID file rejection, revoked access and cleanup. It must never run without explicit environment confirmation.
3. Extend npm test so every newly added test is actually executed; add Node syntax checks for all five Edge functions to the CI workflow.
4. Extend frontend packaging, stage verification, backup, activation, rollback and audit-production-source.sh to include every parent static asset. Add Edge source parity checks for all parent functions/shared files/font; leave actual Edge deployment outside the frontend workflow.
5. Write ops/parent-portal/README.md with prerequisites (backup, Auth redirect allow-list, SMTP, env variables, font/package availability), exact staged order (migration 008 → 009 → verification → Edge Functions → synthetic E2E → frontend), rollback decision points, no-real-data requirement, and manual browser flow: invitation → acceptance → dashboard → schedule → report/PDF/photo → goals/dynamics → profile/logout → revoke.
6. Update README.md with the parent-portal component boundaries and link to the runbook, without secrets or production account details.

- [ ] **Step 4: Run the complete automated verification**

Run: npm ci && npm test && node --experimental-strip-types --check supabase/functions/create-parent-invitation/index.ts && node --experimental-strip-types --check supabase/functions/resend-parent-invitation/index.ts && node --experimental-strip-types --check supabase/functions/revoke-parent-access/index.ts && node --experimental-strip-types --check supabase/functions/generate-parent-report-pdf/index.ts && node --experimental-strip-types --check supabase/functions/parent-report-file/index.ts  
Expected: PASS. Do not run the network E2E or deploy production without the explicit confirmation and a staging target.

- [ ] **Step 5: Commit**

~~~bash
git add supabase/verification/verify_parent_portal.sql ops/security/test-parent-portal-rls.mjs ops/security/parent-portal-rls-contract.test.mjs ops/parent-portal/README.md ops/release/parent-portal-release.test.mjs .github/workflows/deploy-fizira-frontend.yml ops/release/audit-production-source.sh package.json README.md
git commit -m "test: add parent portal release gate"
~~~

## Plan Self-Review

- **Spec coverage:** Tasks 2–4 cover invitation, roles, consents, explicit child access and RLS. Task 3 covers publication, goals, dynamics, schedule and notifications. Task 5 covers immutable PDFs/files. Tasks 6–7 cover both UI surfaces and role routing. Task 8 covers deployment distinction, testing, synthetic fixtures and operational verification. No v1 feature in the spec is omitted.
- **Step scan:** Every task has a specific failing test, focused command, named interface, implementation boundary, passing command and commit. SQL and Edge inputs that matter for authorization are fixed above; no task leaves a security decision as "appropriate validation".
- **Type consistency:** The parent uses only the RPC names and Edge JSON contracts declared by Tasks 2–5. parentFileRequest emits exactly the parent-report-file body; loadCurrentRoles calls only current_app_roles; specialist controls use the three invitation and one publication endpoint declared here.
- **Review focus:** Each listed human-facing or security failure mode is attached to a concrete test in its owning task; direct REST/Storage denial is also repeated in the opt-in production-safe synthetic gate.
- **Proportion:** The plan specifies interfaces, boundaries and evidence rather than reproducing SQL, UI templates or Edge implementation bodies.

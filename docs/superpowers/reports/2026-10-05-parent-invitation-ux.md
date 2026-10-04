# Parent invitation UX correction — 2026-10-05

## Source and scope

Base: `7566dc412e4918b1ea3f65831e3c9f024545b65a`, release branch `codex/task1-8-saved-20261004`.
All 17 files in `ops/release/frontend-assets.txt` were downloaded from production and exactly matched that base. Production entry remained `0.172-parent-release`.
No old main checkout was used. No migrations, servers, staging, DB/Storage records, Edge functions or existing rollback files were changed.

## Causes and correction

The existing specialist portal consumed contacts loaded from `patient_contacts` by `loadPatientData`, but contact creation was available only in the separate Overview tab. An empty portal directed the user back to Overview without a complete invitation workflow. Pending invitations were displayed without checking expiry.

The portal now creates representatives directly in the existing contact model, validates name/relationship/email and optional phone, then exposes ID-only create/resend invitation actions. It shows relationship, contact email/phone, saved invitation address and expiry, active/revoked access and individual revoke actions. Every active user attached to a contact stays visible; deleted-contact access remains manageable.

Unsaved email changes block both displayed buttons and retained create/resend handlers. Invalid/missing email cannot invite. Failed saves retain form values; a successful insert followed by failed refresh does not insert a duplicate. A refresh action recovers the authoritative list.

The existing backend creates an invitation before requesting email delivery. Therefore a persisted pending row is labelled "Приглашение создано" and does not falsely prove mail delivery. A successful current Edge response reports that sending succeeded; errors explicitly request status refresh. There is no invitation-cancellation endpoint in the existing architecture, so no client-side fake cancellation was introduced.

Mobile CSS previously combined a horizontal unwrapped patient tab strip, unconstrained intrinsic widths and absolute logout positioning competing with navigation. Navigation now reserves exit space, patient actions and tabs use responsive grids/wrapping, and long content can shrink/wrap. Entry CSS/app markers advance together to `0.173-parent-ux`; the specialist module advances to `?v=3`.

Only these frontend files need a later production update: `app.js`, `parent-specialist.js`, `styles.css`, `index.html`, `parent.html`. Backend deployment is unnecessary for this correction.

## Evidence

- Clean baseline aggregate: 211/211 PASS.
- Final aggregate on Node 22.23.3: **221/221 PASS**, no failures, skips or cancellations.
- Added regression cases fail against the unfixed behavior and pass with the changes: representative creation, required/invalid fields, failed save, persisted invite address/expiry, active/revoked access, failed Edge delivery confirmation, stale contact form, failed refresh duplicate prevention, multiple active users, unsaved email and retained handler disabled state.
- Contact creation executes against actual migration SQL in disposable in-memory PGlite, including normalization, owner fields and parent denial of contact reads. This is a local fixture, not a staging server or production migration.
- Actual specialist renderer, shared stylesheet, portal module and fictional contacts exercised in Chromium: **6/6 PASS**, comprising the suite and widths **375, 390, 430, 768, 1440**. Checks cover document horizontal overflow, key element bounds, navigation/exit overlap and wrapped mobile tabs. Long unbroken names and descriptions are included. Screenshots were visually inspected.
- Repeatable browser command: `CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:responsive`. This separate gate fails if a browser is not supplied; it does not silently skip.
- `git diff --check`, `node --check app.js` and `node --check parent-specialist.js`: PASS.
- Current production read-only negative smoke: all five parent Edge functions returned **HTTP 401** for anonymous-key-only requests with fictional UUIDs. No authorized mutation or email was attempted.

## Independent security review

Reviewer independently examined ownership, escaped rendering, stale handlers and actual invitation/access SQL contracts. It reproduced a Medium finding: one saved contact can have multiple active users, while an intermediate UI showed only one revoke action. Enumerating every access and matching accepted invitation emails by user fixed it. The reviewer subsequently checked unsaved-email and disabled-state changes and returned **no remaining Critical/High/Medium commit blockers**. Its final independent targeted run passed 31/31 UI tests; the preceding UI plus actual SQL contract run passed 38/38.

This local verdict is not production runtime approval.

## Outstanding production gates

Authenticated production E2E and deployment have **not** run. The available browser shows Fizira's specialist login; this workspace has no Timeweb SSH identity. Authenticated existing-service access and a designated working test mailbox are required.

After that access is available, use only fictional child/representative data to verify specialist create/save/invite, actual delivery and parent redirect/login/acceptance, exactly-parent role, authorized-child projections, cross-UUID denial, schedule/goals/reports, real PDF and protected photographs, new file/access denial after revoke and continued specialist operation.

Then preserve the current server rollback, activate only the five changed frontend files, verify their exact reviewed hashes/public entry and perform authenticated mobile production checks. Do not replay 008–012, alter working Auth/Storage/RLS, delete production data or merge main before successful production verification.

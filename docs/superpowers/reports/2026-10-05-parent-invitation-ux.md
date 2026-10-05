# Parent invitation UX correction — 2026-10-05

## Source and scope

Base: `7566dc412e4918b1ea3f65831e3c9f024545b65a`, release branch `codex/task1-8-saved-20261004`.
All 17 files in `ops/release/frontend-assets.txt` were downloaded from production and exactly matched that base. Production entry remained `0.172-parent-release`.
No old main checkout was used. No migrations, servers, staging, Edge functions or existing rollback files were changed. Authenticated production checks later created only the fictional test records described below; no existing records were removed.

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

## Authenticated production findings and follow-up fixes

The real patient list query omitted `therapist_id`. The specialist portal correctly required that owner field and therefore returned before rendering for a child loaded through the actual application. Earlier isolated fixtures supplied the field and missed this integration defect. The fix adds `therapist_id` to the existing RLS-protected projection; the ownership guard remains strict. A regression executes the actual list loader, actual parent-tab branch and actual specialist module, and also rejects a different owner. Source commit: `28793a929e0d0ff077a3dbccc0fada307e115753`.

A confirmed successful invitation send was also erased by the subsequent authoritative remount. A strict boolean notice now crosses the guarded refresh only after a valid current Edge response. The fresh view shows fixed confirmation text; an ordinary reload clears that transient notice and persisted pending rows retain the honest “created” label. No delivery/access status is invented in client storage. Source commit: `17eba82de395e6185a1d2dc2db2dcab4e3d176af`.

Final local aggregate: **232/232 PASS**. Chromium: **6/6 PASS**, widths 375/390/430/768/1440. Independent feedback review: **73/73 targeted PASS**, no blockers. Deployment manifests independently verified: 34 digests, exact four-file final delta; CSS stays untouched. Activation/CI checks: 11/11 PASS. The new confirmation/remount test reproduced the defect before the implementation.

## Production rollout and fictional fixture

- Initial frontend correction activated through existing GitHub Actions SSH secrets: run `37247135343`, commit `0a22df5cf56e0216941f3b28a7a56405be30fd3c`, source `2173a05341d40baa4285732c90a4686a3b189919`, entry `0.173-parent-ux`. Full CI229 + browser6 passed; all17 public digests matched.
- Owner projection activated in run `37248101965`, deployment commit `90ef847e2178d79c410b4e214a6bb9014e7b7100`, source `28793a9`, entry `0.174-parent-owner`. CI231/231 and browser6/6 PASS, `PARENT_UX_ACTIVATION_OK`, all17 public hashes PASS. Only app.js/index.html/parent.html changed in this follow-up.
- Final feedback rollout requested by deployment commit `d552a6179dd2b4ddbece5cb490e627a1cd8c06e6`, run `37262563653`, source `17eba82`, entry `0.175-parent-feedback`. Completed successfully: CI232/232, browser6/6, `PARENT_UX_ACTIVATION_OK`, all17 public hashes matched and public Auth/API smoke passed (Auth200, CORS200, anonymousAI401).
- Every activation uses the same existing webroot, rejects unknown drift, backs up only the actual delta to a fresh run-specific directory, builds all replacements before swapping, and activates index last. Existing rollback copies are retained. No automatic rollback, migration replay, backend rollout or main merge occurred.
- A standalone local-shell public smoke attempt could not connect through its proxy. This was an environment network failure, not evidence that production was unavailable. Cloud browser and Actions verification worked. The final Actions run additionally executes the existing read-only public production smoke after its17 checksum gate.

The signed-in specialist created only child `ТЕСТ Fizira E2E 20261005` (DOB2020-01-15, no medical content), representative `Анна Тестовая` / `Мать`, and test email alias `antonovdpt+fizira-e2e-20261005@gmail.com`. Missing email was rejected with no contact insert. The saved contact appeared with the correct name/relationship/email and an ID-based invitation button. Sending created a pending row with expiry, saved invitation email and a resend action. The connected Gmail API confirmed the exact invitation email from Fizira at2026-10-05T00:38:57Z; it was classified as SPAM. No authentication link/token is included in evidence. Later, the signed-in Gmail browser did not show that email when searched by exact alias or sender/subject; API delivery evidence and browser retrieval are not treated as equivalent. Opening the actual invitation link remains unverified.

A fictional goal was explicitly published through the specialist UI. A fictional initial report containing Cyrillic was explicitly published; the UI showed published state after the PDF Edge operation completed. Parent-side opening/downloading is still unverified. A fictional schedule appointment and session save were submitted; their final parent-visible result must still be checked. No real patient was used for test mutations. A synthetic image was prepared locally but has not yet been uploaded or published.

## Outstanding production gates

The full authenticated parent E2E is **not complete**. The cloud browser currently shows the signed-out specialist/parent login. Accepting the test invitation requires the user to open the email, create a new password and personally accept the three legal documents. Browser authentication guidance requires manual handoff for signup/new credentials; credentials must never be requested in chat.

After acceptance, verify exactly-parent role, authorized-child projections and cross-UUID denial, parent-safe data, schedule/goals/reports, actual parent PDF and protected synthetic photographs, access denial after revoke and specialist continuity. Re-check persisted session/appointment creation before adding another fixture, to avoid duplicates.

Automated responsive results use the actual renderer/styles/module with synthetic data. They do not establish a signed-in real-production mobile viewport result; that remains outstanding. Do not merge main or claim full production E2E success while these gates remain open.

# SDD ledger — plan: docs/superpowers/plans/2026-10-03-parent-portal.md

## Setup

- Worktree: /workspace/scratch/16d3a1422634/fizira-audit/.worktrees/parent-portal
- Branch: codex/parent-portal
- Merge base: f9f42204d907195ed04f09cd47f8ad563b2078fb
- Plan/spec read from docs/superpowers/plans/2026-10-03-parent-portal.md and docs/superpowers/specs/2026-10-02-parent-portal-design.md.
- Baseline: npm ci completed; npm test passed 6/6 on 2026-10-03.

## Task ledger

- Task 1: pending
- Task 2: pending
- Task 3: pending
- Task 4: pending
- Task 5: pending
- Task 6: pending
- Task 7: pending
- Task 8: pending

## Active task

- Task 1 dispatched to /root/task1_implementer. Base: 97aae31d43ed475c306e5835ef513620bac4b20d. Brief: task-1-brief.md. Report: task-1-report.md.
- Ruling: Task 1 uses project-consistent Russian presentation contracts — formatParentDate returns `Дата не указана` for missing/invalid values and otherwise ru-RU day/month/year; formatParentAge returns `Возраст не указан` for missing/invalid dates and existing app month/year wording; publicationLabel maps draft→`Черновик`, publishing→`Публикуется…`, published→`Опубликовано для родителя`, publication_error→`Ошибка публикации`, archived→`В архиве`. PARENT_NAV_ITEMS is [{ id:"home", label:"Главная" }, { id:"schedule", label:"Расписание" }, { id:"reports", label:"Отчёты" }, { id:"goals", label:"Цели" }, { id:"dynamics", label:"Динамика" }]. dynamicsSeries takes only rows with scale, assessed_at, value_numeric/value_text and returns { numeric: [{ scale, points:[{ assessed_at, value }] }], categorical: [{ scale, assessed_at, value }] }; numeric is finite value_numeric for GMFM-66/HINE, categorical is nonempty value_text for GMFCS/MACS/CFCS/EDACS, other/malformed data are dropped, both sorted ascending by assessed_at. This is safe because it shows stored values only, not clinical conclusions; cost if wrong is a future UI adapter change, not data exposure.
- Ruling: parentFileRequest is a discriminated request: photo requires mediaId; pdf must omit mediaId. The plan’s optional notation describes the union, not permission to send a meaningless media identifier. This prevents the client from creating ambiguous file authorisation requests; cost if wrong is a small future API extension if PDF attachments are added.
- Task 1 review: conditional pass. ⚠ Reported test evidence was read in task-1-report.md; reviewer did not independently re-run it by process design.
- Task 1: Ruling: HINE rows carrying a finite value_numeric are a numeric series, not a categorical timeline. The spec permits a linear graph only for a correct numeric series and HINE is a score when stored numerically; the Task 1 wording pairing HINE with MACS was imprecise. Code and tests stand. Cost if wrong is only an adapter/UI representation correction; no source field or authorization boundary changes.
- Task 1: minor (deferred): parent-domain.mjs age pluralization follows the existing app but is linguistically wrong for 21–24; final review should triage whether to improve shared Russian wording.
- Task 1: minor (deferred): parent-domain.mjs date parser should reject calendar rollover strings such as February 30; final review should triage validation hardening.
- Task 1: complete (commits 97aae31..41dd819, 2 minors deferred; plan conflict ruled).
- Task 2 dispatched to /root/task2_implementer. Base: 41dd8195eda82a601cd3c3b7d66b3bd94444834d. Brief: task-2-brief.md. Report: task-2-report.md.
- Ruling: Task 2 invitation record contract is issue_parent_invitation_record(p_therapist_id uuid, p_patient_id uuid, p_contact_id uuid, p_token_digest text, p_auth_flow text) returns table(invitation_id uuid, expires_at timestamptz). It reads and normalizes email only from the locked contact row, verifies therapist/patient/contact ownership itself, requires a 64-lower-hex digest and p_auth_flow in {new, existing}, revokes the prior pending invitation atomically, and exposes no raw token. This matches Task 4’s browser body of patient_id/contact_id while keeping email and token server-side; cost if wrong is an Edge adapter signature change.
- Ruling: Task 2 revoke contract is revoke_parent_access_record(p_therapist_id uuid, p_access_id uuid) returns integer. It verifies the access row belongs to that specialist before setting active access revoked and revoking pending invitations for the same contact/patient. This exactly matches Task 4’s { access_id } endpoint; cost if wrong is adding a separate pending-invitation revoke action later.
- Ruling: accept_parent_invitation accepts exactly JSON [{ document_type:"terms", accepted:true }, { document_type:"privacy", accepted:true }, { document_type:"personal_data_consent", accepted:true }] in any order, no duplicates/extra keys/types. SQL loads required current version/hash from legal_document_versions and writes server timestamp. parent_invitation_state returns only { state, auth_flow? } after authenticated lowercased email comparison, where state is valid|expired|revoked|accepted|invalid|email_mismatch and auth_flow appears only for valid same-email state. UI maps non-valid states to generic text. This makes consent auditable and prevents a token oracle/data leak; cost if wrong is a coordinated future legal-document UI update.
- Task 2 review: Important — accept_parent_invitation overwrites a matching consent's historical hash/accepted_at/source. Ruling: retain every prior consent evidence row in a new append-only authoritative parent-consent audit before updating the canonical current-consent row, because the global constraint preserves historical data and auditability is a legal boundary. Cost if wrong: added migration complexity and an extra table to protect, but no loss of prior evidence.
- Task 2 review: minor (deferred): following an ownership transfer, a stale active link can consume a new invitation but remain ineffective. Transfer workflows are outside v1 per the approved spec; final review must ensure the UI does not claim a successful active access where the helper denies it.
- Task 2 review: minor (deferred): contact deletion after a transfer can be blocked by the ownership trigger during FK nullification. Transfer/delete workflow remediation is not in v1; final review must triage it.
- Task 2: fix round 1/5 (1 addressed, 0 open — immutable historical consent evidence; commits 99e6033..6a14a74)
- Task 2: complete (commits 41dd819..6a14a74, review clean)
- Task 3: Ruling: scope the Task 2 identity test's execution of verify_migration.sql to the pre-009 marker, and have Task 3's publication test execute the 009 verification block. This preserves fail-closed verification while keeping each migration fixture self-contained; cost if wrong is a mistaken marker split could leave a verification statement untested, mitigated by Task 3's test explicitly executing the second block.
- Task 3 review: Important — verify_migration.sql Storage allowlist rejects the legitimate account_must_be_active baseline and accepts an unsafe policy merely by name. Ruling: validate policy role, command and predicate shape explicitly, while allowing the existing restrictive account_must_be_active policy; add baseline and unsafe-policy injection tests. Cost if wrong: predicate matching may require coordinated update when a legitimate Storage policy intentionally evolves, but name-only verification is unsafe.
- Task 3 review: Important — published report media is rebuilt from mutable patient_media fields. Ruling: capture an immutable publication-media reference/metadata at publication and make parent projection use it, without changing access to clinical source rows; add regression for source metadata mutation. Cost if wrong: a future legitimate content correction needs a new draft publication rather than mutating a published report, which is the intended immutability model.
- Task 3: fix round 1/5 (3 addressed, 0 open — Storage verification baseline/predicate safety and immutable published media; commits cd4fd67..111f869)
- Task 3: complete (commits 6a14a74..111f869, review clean)

## Preflight plan scan

| Pair or task | Shared file/interface | Finding / resolution |
|---|---|---|
| Task 1 ↔ Task 6 | parent-domain.mjs; parentFileRequest | Consistent: Task 1 emits exactly the parent-report-file allowlisted request used by Task 6. |
| Task 1 ↔ Task 7 | Parent labels/status helpers | Consistent: Task 7 may consume presentation helpers but does not redefine their contract. |
| Task 2 ↔ Task 3 | parent_has_active_access; verify_migration.sql | Consistent sequential dependency: Task 2 creates access authority; Task 3 consumes it and extends verification. |
| Task 2 ↔ Task 4 | issue_parent_invitation_record; revoke_parent_access_record | Consistent: Task 4 is the only browser-facing lifecycle layer and must use Task 2 service-only procedures after user-scoped ownership checks. |
| Task 2 ↔ Task 5 | roles/access context | Consistent: Task 5 uses Task 3 publication state and Task 2 access checks indirectly; no duplicate publication procedure is required. |
| Task 2 ↔ Task 6 | current_app_roles; invitation acceptance | Consistent: role lookup precedes specialist loading and invitation state stays generic and email-bound. |
| Task 3 ↔ Task 5 | publication_status; published_snapshot; private PDFs | Consistent: Task 3 owns state/data schema; Task 5 writes the immutable server-built snapshot and completion state. |
| Task 3 ↔ Task 6 | nine parent RPCs | Consistent: Task 6 consumes the exact allowlisted RPC names and no source-table query. |
| Task 3 ↔ Task 7 | specialist publication tables | Consistent: Task 7 authors only specialist-owned drafts/publications under Task 3 RLS. |
| Task 3 ↔ Task 8 | verification/RLS contract | Consistent: Task 8 checks, but does not alter, the Task 3 security boundary. |
| Task 4 ↔ Task 5 | shared parent-portal.ts helper | Consistent: Task 5 reuses CORS/auth/input helpers; task ownership remains separate by endpoint purpose. |
| Task 4 ↔ Task 6 | invitation endpoint + acceptance RPC | Consistent: Edge sends email/link; UI accepts an authenticated invitation through the SQL RPC. |
| Task 4 ↔ Task 7 | specialist invite/resend/revoke UI | Consistent: Task 7 sends only IDs to the three Task 4 endpoints. |
| Task 4 ↔ Task 8 | function syntax/deployment checks | Consistent: Task 8 validates sources and rollout order, while frontend workflow remains non-deploying for functions. |
| Task 5 ↔ Task 6 | parent-report-file request | Consistent: Task 6 sends only Task 1 allowlisted IDs; Task 5 resolves all storage paths server-side. |
| Task 5 ↔ Task 7 | generate-parent-report-pdf | Consistent: Task 7 explicitly confirms publication; Task 5 alone builds snapshot/PDF and sets success/failure. |
| Task 5 ↔ Task 8 | font/function parity checks | Consistent: Task 8 makes the font and function list release-visible without putting them in frontend activation. |
| Task 6 ↔ Task 7 | app.js, parent-specialist.js, role switching | Consistent sequential integration: Task 6 adds a guarded role route; Task 7 imports its specialist module without weakening the guard. |
| Task 6 ↔ Task 8 | parent static assets | Consistent: Task 8 packages all assets introduced by Task 6. |
| Task 7 ↔ Task 8 | parent-specialist.js, styles.css | Consistent: Task 8 adds release parity after Task 7 integration. |
| Task 1 | Tests, functions and commit agree; no external dependency. | Clean. |
| Task 2 | Migration, PGlite test, RLS and legal source are aligned. | Clean. |
| Task 3 | Publication schema, parent projections, notification tests and source-table guard are aligned. | Clean. |
| Task 4 | Payload contracts, server-only token lifecycle and helper tests are aligned. | Clean. |
| Task 5 | Server-only source/snapshot/path contract and PDF tests are aligned. | Clean. |
| Task 6 | Parent-only UI contract and role guard match Task 2–5 interfaces. | Clean. |
| Task 7 | Specialist controls preserve draft-first publication and source-data separation. | Clean. |
| Task 8 | Test command, release parity and staged deployment constraints are aligned. | Clean. |

## Resume 2026-10-03

- Recovered actual linked worktree codex/parent-portal at 111f869; git status, staged/unstaged diffs clean. Tasks 1–3 prior implementation and fixes retained; no rollback or redispatch of completed implementation.
- User requested a fresh independent security gate despite the prior Task 3 completion entry. Task 3 recheck dispatched to /root/task3_security_recheck against cd4fd67..111f869; downstream implementation remains gated pending verdict.
- Fresh focused verification: node --test tests/parent-portal-publications-sql.test.mjs ops/security/production-rls-contract.test.mjs tests/schedule-sql.test.mjs — 19 pass, 0 fail.
- Task 3 fresh independent security recheck: spec PASS, quality/security PASS; all 3 prior findings ADDRESSED, 0 open blockers/new regressions. Report: task-3-security-recheck.md. Fresh baseline npm test: 53 pass, 0 fail.
- Task 5 dependency: freeze photo bytes in a server-created publication artifact and serve that artifact; frozen published_media metadata alone cannot prevent source Storage overwrite. Carry this requirement into Task5 implementation/review.
- Task 4 starting from 111f869, only after successful Task3 recheck.
- Task 4 implementer: /root/task4_implementer; brief task-4-brief.md; report task-4-report.md; base 111f869. Boundary tests include role/ownership before privilege, payload rejection, delivery failures and generic public errors.
- Task 4 implementation: 678d6d1, clean tree, focused 11/11, npm 53/53, shared 27/27, four TS syntax checks PASS. Independent task review dispatched to /root/task4_review; task-4-review.md pending. Staging SMTP/Auth integration and Deno runtime verification remain rollout gates, no deployment attempted.
- Task 4: complete (commits 111f869..678d6d1, independent spec PASS, security/quality APPROVE, 0 Critical/Important findings). Report task-4-review.md.
- Task 4: minor (deferred): paginated Auth lookup timing/workload; parentJson expects an already validated origin. Final review should triage; current handler validates origin before use.
- Task 4 rollout checks deferred to isolated staging: Deno runtime/typecheck, Auth redirect/email-template/SMTP delivery and two-recipient end-to-end flows. No deployment or real recipient email sent.
- Fresh controller Task4 verification: shared parent tests 11/11 PASS; all three endpoint syntax checks PASS; git diff --check and status clean at 678d6d1.
- Next unimplemented task is Task 5: immutable PDF/photo artifacts and checked parent file handoff. Carry Task3 security dependency on frozen photo bytes and specialist Storage write protection; metadata/path capture alone is insufficient.

## Resume after Task4

- Confirmed clean codex/parent-portal at 678d6d1; Tasks1–4 retained and not repeated.
- Task5 implementer /root/task5_implementer; base 678d6d1; brief task-5-brief.md; report task-5-report.md. Sent Task3 frozen-byte security dependency, asked for concrete migration/claim/CAS/Storage guard proposal before implementing integration extension. No production/external account operations authorized.
- Task5 Ruling: add migration010 with service-only row-locked claim/complete/fail CAS RPCs, frozen allowlisted snapshot/source metadata and object version, publishing edit guards and private artifact mapping. Add restrictive authenticated Storage mutation protection for owner-id/parent-reports artifacts and temporarily claimed sources. No parent direct policy; retain required PDF prefix. Necessary because path-only capture plus owner Storage writes violates immutable publication. Cost if wrong: additional migration/verification/rollout complexity and temporary source-edit refusal during publishing. Stage008/009 checks must remain testable without010.
- Task5 Ruling: upload only the exact downloaded/hash-checked bytes to fresh immutable revision keys with upsert:false; compare frozen source identity/version through completion and fail closed on concurrent change. Stale workers use claim/revision CAS, cannot publish/fail/clean a newer claim; ambiguous completion retains private artifacts for reconciliation. Cost if wrong: publication retry/operational reconciliation rather than serving a changed image.
- Task5 dependency approval: pinned pdf-lib1.17.1/fontkit1.1.1 development deps/imports for real Cyrillic PDF tests. Ordinary registry lookup succeeded; no network restrictions bypassed.
- Task5 runtime gate: local SQL/mock tests cannot prove Storage byte-before-metadata ordering; isolated staging replacement-during-publication test is required. Artifact digest validation at handoff must fail closed if object changes. Unsupported photo formats must cause explicit publication_error, never silent omission.
- Carry migration010 and artifact protection/claim RPC verification into Task8 staging order and source-parity/runbook tests; original 008→009 order alone will be incomplete after Task5.
- Task5 Ruling: include minimal supabase/config.toml static_files configuration for bundled renderer font, validated against official supported schema; do not change existing function JWT settings or remote linkage. Carry config/font/OFL in Task8 parity/deployment tests. Needed because renderer reading a missing packaged font would fail despite local PDF tests. Cost if wrong: config-path adaptation in staging; no production target change.
- Task5 precommit security concern sent to implementer: comparing only storage.objects version/metadata at completion can miss already-in-flight byte overwrite before metadata update. Require source response ETag/immutable version binding to frozen claim before copying; missing reliable validator fails closed. Add adversarial case with DB metadata A and HTTP bytes/ETag B. This is a code boundary, not merely a staging caveat.
- Task5 implementation: 0cfd047; clean tree; focused30/30, full62/62, four TS syntax checks PASS, real Cyrillic PDF extracted/rendered/visually inspected. Independent Task5 review /root/task5_security_review against678d6d1..0cfd047 pending, report task-5-security-review.md.
- Task5 limitations to carry into integration: JPEG/PNG only, missing/weak/incompatible ETag => fail closed; legacy009 files lacking010 digests => no handoff; Deno/import/assets/liveStorage/race/cleanup integration requires isolated synthetic staging; crash-orphan reconciliation must check live references.
- Task5: complete (commits678d6d1..0cfd047, independent spec PASS, security/quality PASS WITH MINOR FOLLOW-UPS, 0 Critical/Important findings). Controller focused verification30/30 PASS.
- Task5 minor (deferred): accepted uppercase UUIDs may cause false rejection/path mismatch; incoming request-body reads lack deadline tied to handler abort. Final branch review must triage.
- Task6 starting after Task5 independent gate; base0cfd047, brief task-6-brief.md, report task-6-report.md.
- Task6 implementer /root/task6_implementer; base0cfd047. Explicitly carried role-first fail-closed root routing, deferred Auth callbacks, stale child/account request cancellation, no source-table calls, trusted signed URLs and minimal invite legal/name/password flow.
- Task6 noted dependency: migration008 backfills existing specialists only; fresh ordinary specialist registration has no server role provisioning. Do not auto-promote empty roles from browser metadata. Report/rollout must flag this pending onboarding boundary.
- Task6 Ruling: permit small role-gate.mjs seam used by app.js so role routing/authorization order is directly behavior-tested rather than only regex assertions. No new role grants or metadata fallback. Add asset to Task8 deployment/audit/rollback list. Cost if wrong: an additional small static dependency to package, mitigated by parity tests.
- Final-review named risk to assess: existing clinical/Storage owner-folder policies target authenticated rather than explicit specialist roles. Parents cannot access the linked specialist's sources, but could potentially create/read their own clinical rows or upload into their own prefix via direct REST. Determine whether approved parent no-source/no-editing boundary requires an additional restrictive specialist-role policy, preserving existing specialist permissive policies and dual-role behavior. Task8 synthetic gate should distinguish linked-source IDOR denial from parent-own clinical/Storage creation denial; do not claim all direct parent operations denied based only on linked-row tests.
- Task6 intermediate RED missingparent.js; requested focused UI/domain/auth/media suite24/24 GREEN. Implementer adding bootstrap execution/stale account/file tests before final verification. No Task6 completion claim until independent review.
- Task8 preflight named compatibility issue: existing audit-production-source.sh requires each asset exist in both base and PR plus production. New parent assets/functions are necessarily absent in base/predeploy production. Distinguish legitimate new-in-PR absence during preflight from unexpected live contents; postdeploy parity must require exact PR hashes. Never exempt differences in existing production files or overwrite unknown/newer live state. Carry this into Task8 implementation/review.
- Task6 review Important blocker (pending full report): parent.js accepts invite|magiclink but actual008 parent_invitation_state returns new|existing. All real valid invitations fail UI; tests used wrong mocked values. No downstream implementation until fixed/re-reviewed. Independent review /root/task6_review ongoing; collect complete findings before one fix dispatch.
- Task6 independent review REQUEST CHANGES at585d8ae: 3 Important findings (actual new|existing invitation contract mismatch; old specialist DOM/actions usable during changed-account role lookup; UTC appointment date combined with local time). Focused reviewer reproductions confirmed all. Full report task-6-review.md.
- Task6 fix round1/5 dispatched to original /root/task6_implementer at585d8ae, with actual DOM/account-switch + Europe/Moscow midnight + SQL flow contract regression cases. Await fixes and covering test evidence before scoped re-review.
- Task6 minor (deferred): mobile navigation sits above content instead of spec bottom navigation. Final branch review must triage.

## Recovery audit and independent review 2026-10-04

- Recovered actual linked worktree at585d8ae, branch codex/parent-portal; unstaged parent.js/tests/parent-ui.test.mjs retained. CSS fix was already committed; Task6 review and partial invitation/timezone fixes existed beyond the last conversational report. Tasks1–5 retained, not reimplemented.
- Repository is shallow; explicit baseline snapshot f9f42204d907195ed04f09cd47f8ad563b2078fb is available, but merge-base is not recoverable locally. Ancestry/source reconciliation remains mandatory before any later merge; no merge, push or deployment authorized/performed.
- Fresh implementer /root/task6_recovery_implementer completed frontend fix commit514e621. Report appendix records focused41/41, npm92/92, shared21/21, syntax/diff PASS. Independent reviewer /root/parent_security_reviewer accepted actual invitation enum, local appointment time/day, actual status labels, mobile bottom navigation, and partial root-account retirement.
- Independent cumulative review REQUEST CHANGES: effective parent-own clinical/Storage privileges violate specialist role boundary; ordinary new specialist signup has no authoritative role provisioning; goal publication notifications missing; old specialist photo overlay and pending profile/deletion callbacks survive identity change. Evidence: task-6-recovery-security-review.md. Task7 remains gated.
- Recovery Ruling: additive migration011 must intersect existing clinical owner/account policies with authoritative specialist role, including private Storage SELECT and mutations; preserve existing owner/account/immutable artifact guards and dual-role access. This implements the approved specialist-only boundary rather than replacing it with a UI check. Cost if wrong: migration/verifier rollout complexity; local and isolated runtime regressions are required.
- Recovery Ruling: preserve the existing ordinary self-service specialist registration with a trusted Auth INSERT provisioner and server-only durable new-parent signup reservation, serialized by normalized-email transaction lock. Never derive roles from browser metadata; invited/reserved parent accounts and existing parent roles cannot be promoted by retries/updates/expiry. Cost if wrong: blocked onboarding or excessive roles; authoritative fixture and staging Auth lifecycle checks gate release.
- Recovery Ruling: binding design section9 requires goal-publication notifications despite omission in Task3 plan. Add fixed safe notification copy for visible publication/material public changes/restoration; no private edits, financial values or inactive/revoked links. Cost if wrong: extra or missing notifications, covered by transition tests.
- One backend/frontend fix wave authorized within this branch only; independent re-review required after covering tests and commit. Task6 completion is not claimed while Important findings remain open.

## Final Task6 recovery gate

- Implementer final combined wave fdb091b: additive011, private signup reservations/ordinary signup roles, restrictive source/Storage role intersections, safe goal notifications, body-overlay/dialog/profile/patient/clinical/calendar/editor continuation fences, exact latest verifier and adversarial regressions. Migrations001–010 preserved. Report task-6-report.md includes RED→GREEN and final aggregate124/124/focused53/53.
- Controller independently ran fresh final source fdb091b: repository+parent Edge/publication/PDF124/124 PASS; ops/security10/10 PASS; remaining sharedAI/appAI+schedule schema17/17 PASS. Total151 PASS, zero failures/cancelled/skipped. Syntax app.js/parent.js/role-gate.mjs/cabinet.js/schedule-editor.js and git diff --check PASS; working tree clean.
- Independent reviewer /root/parent_security_reviewer final gate: SPEC PASS / SECURITY PASS / CODE QUALITY PASS for delivered Tasks1–6 atfdb091b. All recovery Important findings I1–I3/I5 addressed; UI I4 and prior invitation/timezone/navigation findings closed. Reviewer separately executed0116/6 PASS and four actual UI lifecycle repros4/4 PASS. Report task-6-recovery-security-review.md now carries final status.
- Task 6: complete (commits0cfd047..fdb091b, final independent review clean, no open Blocker/High/Important). Tasks1–5 retained and not repeated.
- Next approved implementation task: Task7 specialist parent-portal controls. Safe to continue development in this isolated branch; no release approval or merge/production authorization implied.
- Task8 mandatory carry-forward: apply008→009→010→011 before activation; package parent/role-gate and changed cabinet/editor assets; aggregate shared tests; parent-only fixtures must use reserved invitation→Auth creation→acceptance (ordinary createUser yields specialist). Isolated live Auth/SMTP, multiple-connection races, Storage API/S3/ETag/copy/move/sign/upload, Deno/font packaging and actual mobile-browser acceptance remain explicit runtime/release gates. Durable reservation prevents automatic parent→specialist conversion; explicit trusted grant required.
- No merge, push, production deployment, production migration, real-data access or external email performed. Ledger/review retained for next recovery.

## Task7 start

- User requested continued implementation and total task count; approved plan has8 tasks. Task7 dispatched to /root/task7_implementer from clean3baa330; source baselinefdb091b independently passed151 checks and security/spec/code review. Brief task-7-brief.md, report task-7-report.md.
- Carry-forward: consume actual008–011/Edge request contracts; preserve role/account/child/revision fences, immutable publication/server-only metadata, nullable legacy contact email, trusted IDs/no paths/tokens/clinical private data. No backend or architecture change without controller ruling. No production/network E2E/external email/merge/push/deploy.
- Task8 follows only after independent Task7 gate. Its runbook/order must include010/011 and role-gate/cabinet/editor; network E2E remains gated on explicit confirmation and isolated staging target.

- Task7 Ruling: the existing010 immutable-report guard allows published→archived in its content check but its authenticated metadata loop rejects that same approved withdrawal. Add migration012 with only a narrow published→archived status exception; keep complete immutable fields/PDF/photo/claim/RLS owner-role-account protection, prohibit all unarchive/publication/metadata edits, and test effective own/foreign/parent/inactive/archive-with-content-change behavior and replay/verifier. Do not rewrite001–011. Cost if wrong: an overly broad status exception could undermine publication immutability, so actual SQL security tests and independent review gate the extension. Task8 migration order must now include012.

## Task8 preflight notes (no implementation yet)

- Source audit currently treats files absent in baseline/production as unconditional STOP. New parent/role-gate/Edge/font files are absent in baseline by design; introduce explicit reviewed-new-asset staging states without silently accepting an existing production file with unknown hash or relaxing existing asset checks. Pre-activation and post-activation parity must be distinguished and documented.
- Network fixture must reserve parent emails before Auth INSERT and assert role set exactly parent; ordinary createUser then add parent invalidates parent-only tests after011. Use only uniquely namespaced@example.invalid fixture accounts and isolated explicitly confirmed target; no real email/network execution is authorized in this session.
- Cleanup-plan conflict:008 consent audit is append-only without lifecycle FKs;011 signup reservations are durable/private with no service CRUD grants. Removing Auth/clinical/Storage fixtures cannot erase these deliberate records. Do not disable immutable audit or add a broad test cleanup backdoor. The eventual isolated E2E runner/runbook must account for retained synthetic audit/reservation records honestly and require disposal of the isolated target where complete teardown is required; never claim all rows clean or permit production fixture runs on that basis. Controller must rule against the binding immutable-evidence spec before any cleanup implementation that changes this boundary.

- Task7 implementation committed86211d4; report task-7-report.md. Implementer final after-preview evidence: repository131/131, focused39/39, shared parent/security25/25; syntax/diff PASS. Review package review-3baa330..86211d4.diff; independent reviewer /root/task7_independent_reviewer (no implementation involvement), task-7-independent-review.md pending. Task8 remains gated on this verdict.
- Task8 Ruling: binding immutable consent evidence and durable parent signup reservations take precedence over plan wording requiring deletion of every fixture row. The runner must explicitly require an isolated disposable target, clean deletable Auth/clinical/Storage fixture resources in finally, report retained synthetic audit/reservations and require target disposal for complete teardown. No trigger disabling, broad service cleanup grants or production fixture execution. Why: deleting intentional immutable records would weaken approved access/audit semantics. Cost if wrong: disposable-target lifecycle and retained synthetic-only records until disposal.

- Controller fresh full local Task7 gate at86211d4: TZ=UTC node --test --test-concurrency=1 tests/*.test.mjs supabase/functions/_shared/*.test.mjs ops/security/*.test.mjs ops/schedule/schedule-schema.test.mjs =>179/179 PASS, zero failed/cancelled/skipped. Log task7-controller-final-tests.log. app.js,parent-specialist.js,parent.js,role-gate.mjs,cabinet.js,schedule-editor.js syntax and git diff --check PASS. Independent review still pending; no Task7 completion or production-readiness claim.

- Task7 independent review at86211d4: SPEC FAIL / SECURITY FAIL / CODE QUALITY FAIL. task-7-independent-review.md confirms R1 High nonexistent access created_at breaks entire tab; R2 High null-contact active access remains authorized without revoke UI; R3 Important newer session draft hides older publication archive control; R4 Important expired publishing claim has no recovery action.012 security delta accepted. Task8 blocked.
- Task7 fix round1/5 dispatched to original /root/task7_implementer from86211d4, four findings together, source-schema contract/actual orphaned access lifecycle/version reachability/server-only claim recovery regressions required. No new backend architecture change, no external operations. Scoped independent re-review follows commit/report.

## Resume 2026-10-04 after implementer usage-limit interruption

- Actual git recovery found newer commitbea5b92 already completed and committed, despite implementer's last tool notification being a usage-limit failure. Preserved it and read actual report; did not repeat implementation. Only controller progress.md is dirty. Fix report covers R1–R4 with real-SQL/HappyDOM RED→GREEN evidence; repository137/137, focused45/45, shared parent/security25/25.
- Scoped independent re-review dispatched to /root/task7_independent_reviewer with review-86211d4..bea5b92.diff and fix report, final verdict pending.
- Controller fresh full local gate atbea5b92: repository+all shared+all ops/security+schedule SQL185/185 PASS, zero failures/cancelled/skipped; log task7-controller-fix-final-tests.log. app/module syntax and git diff --check PASS. Task7 not marked complete until review closes all R1–R4.

- Task7 fix round1/5:4 addressed,0 open; commits86211d4..bea5b92. Independent reviewer final SPEC PASS / SECURITY PASS / CODE QUALITY PASS; six real-SQL contract checks and additional stale-signing/account/root lifecycle probes PASS.012 remains exact narrow approved exception.
- Task 7: complete (commits3baa330..bea5b92, independent review clean, controller185/185 PASS). No open High/Important/Blocker.
- Task8 starts only after this cleared gate. Supplemental integration constraints task-8-controller-constraints.md preserve staged012 order, effective rights/runtime gates, full asset/rollback/parity coverage and immutable synthetic evidence cleanup ruling. No production authorization implied.

- Task8 dispatched to fresh /root/task8_implementer from clean990e6d7, requirements task-8-brief.md plus task-8-controller-constraints.md, report task-8-report.md. Local implementation only; exact isolated synthetic gate remains unexecuted. Independent Task8/whole-branch gate follows commit.

- Task8 implementation9e182ed +reporta6ecece, clean source except controllerledger. Report includes focused RED→GREEN release/SQL/transport faults, npmci PASS and final202/202. Review range990e6d7..a6ecece; whole branch snapshot package final-branch-review-f9f4220..a6ecece.diff explicitly does NOT prove shallow ancestry.
- Independent Task8 +whole-branch reviewer /root/final_parent_portal_reviewer dispatched; final-parent-portal-review.md pending. Task8 completion remains gated on no High/Important/Blocker.
- Controller fresh npmtest at a6ecece =>202/202 PASS, zero failed/cancelled/skipped; log task8-controller-final-tests.log. Allfive TS syntax checks, newNode/shell syntax, gitdiff--check PASS. No external runtime/network/production actions.

## Resume 2026-10-04 final-review findings

- Recovered actualHEADa6ecece; onlycontrollerprogress dirty. Prior liveagents no longer present; completed final-parent-portal-review.md exists, read in full. Verdict TASK8 SPEC/SECURITY/QUALITY FAIL, WHOLEBRANCH REQUESTCHANGES: R1 High verifier accepts malicious parentRPCbody and publicationpolicyORtrue while metadata stays valid; R2 Important changed cabinet/editor securityfences reusebaselinev6 imports, parentstyles cachemarker mismatch. CurrentSQL/module source correctness accepted; unsafe drift/cache delivery paths blockcompletion.
- Final review deferred UUIDcase/bodydeadline as Minor; factual HINE checklist wording tocorrect. Runtime/ancestry/productiongates remain unexecuted.
- One consolidated final fixwave dispatched to fresh /root/final_review_fix_implementer froma6ecece, report final-review-fix-report.md. R1 systemicreadonly body+policy integrity and actualmutation regressions; R2 all changedtransitive cacheidentity audit and coordinated markers. No migrations001–012 rewrite or permission/backendarchitecture changes, no externalactions. Scoped independent re-review required.

- Consolidated final fixwave9029b0b committed; final-review-fix-report.md: R1 complete35function/18policy assertions generated from allrepo001–012, READONLY and maliciousdriftprobes; R2 actualv7 imports/allchangedtransitivebaselineURL audit/sharedCSS0.172 parity; HINEwording corrected. Implementer focused17/17 and aggregate209/209 PASS, migrations unchanged.
- Scoped independent re-review dispatched to fresh /root/final_scoped_reviewer with review-a6ecece..9029b0b.diff, originalfindings and fixreport. final-parent-portal-rereview.md pending. Controller fresh aggregate running; no completionclaim until finalverdict. No externalactions.

- Controller fresh final npmtest at9029b0b =>209/209 PASS, zero failures/cancelled/skipped; final-controller-tests.log. Syntax/diff PASS.
- Scoped reviewer reproduced new Important CI dependency regression introduced by R2 test: testrequiresbaselinef9f4220, deploy/frontend-tests/release-safety workflows shallowcheckout and don'tfetchbaseline; fresh localdepth1clone failscachetest. Original R1/R2 appearaddressed; finalreportpendingfullschema probes. Completion remains blocked.
- Ruling: resolve the newCI dependency with minimal verified baseline/history availability in every affected workflow, plus regression, before localcompletion. Why: userexplicitly forbids completion with High/blocking reviewissues; the newtest cannot pass in supportedfreshCI. Costifwrong: morecheckoutdata/time, no productionpermission or ancestryreconciliation implied. This narrow followup fixes newbreakage within finalreview delivery scope; do not reopen unrelatedfeatures.

- Independent scoped review at9029b0b: R1/R2 ADDRESSED, SECURITYPASS, newR3 ImportantCIbaselineavailability caused SPEC/QUALITYFAIL. Reportfinal-parent-portal-rereview.md retainslocaldepth1failureproof; targeted17/17 andlifecycle2/2 PASS.
- R3 narrowfollowup ac57a62 committed:3CIcallers execute exactpinnedbaselineprovision/validation beforetests, noHEADsubstitution/testskip; freshlocalmissingbaselineFAIL→provisionPASS→stalev6FAIL andinvalidoriginSTOP. Implementerfocused8/8, aggregate211/211, YAML/syntax/diffPASS.
- ScopedR3 independentre-review dispatched /root/final_scoped_reviewer with review-9029b0b..ac57a62.diff; R1/R2 unchanged. Controllerfreshfinalaggregate running. Completionpendingverdict, all livegates remainunexecuted.

## Final local gate 2026-10-04

- Independent final scoped review atac57a62: R1/R2/R3 ADDRESSED; SPEC/SECURITY/QUALITY PASS; no unresolved High/Important/Blocker. Original wholebranch review plus scopedfixreviews establish LOCAL implementationreadiness only. Reportfinal-parent-portal-rereview.md retainsfindinghistory and8/8 freshdetachedshallowcheckoutprobes; R1/R2 earlier17/17 andlifecycle2/2 independentlyverified.
- Controller fresh final npmtest atac57a62:211/211 PASS, zero failed/cancelled/skipped; final-controller-r3-tests.log. Finalhelper syntax/gitdiffcheckPASS.
- Task 8: complete (localimplementation commits990e6d7..ac57a62, independent final review clean after R1/R2/R3 fixes, controller211/211 PASS). All8planned implementationtasks complete locally. Runtime/releasegates remain BLOCKING forproduction; no claimtheywerepassed.
- Remaining Minor: noncanonicaluppercaseUUIDs can falselyreject; incomingbodydeadline relies onruntime limits. Carry intoisolatedruntimevalidation. HINEchecklistcorrected.
- Keepcodex/parent-portal andworktree/evidence intact peruserinstructions. No merge/push/deploy/productionmigration/networkE2E/realdata/externalemail performed. Shallowancestry remainsunestablished; beforeanymerge/release reconcileactualmain/GitHub/productionreadOnlystate andobtainuserconfirmation.

## Runtime preflight 2026-10-04

- Clean recovered snapshot 7eb4fd1 preserved. GitHub read-only comparisons: current main equals full f9f4220 baseline; remote checkpoint 97aae31 is five commits ahead with baseline as merge base. Direct local object-hash validation traversed 21 single-parent objects from HEAD through checkpoint, establishing local source ancestry without rewriting shallow metadata/history. Earlier unresolved ancestry item superseded for this checked source snapshot only; live production source equivalence still unknown.
- Runtime availability checked without printing secrets: no isolated Supabase URL/key/confirmation variables; Docker/Podman/Deno/Supabase CLI/psql absent, Node/SSH present. No configured disposable target; external runtime gates BLOCKED pending target and secure configuration. Existing runbook retained, no new architecture or implementation changes.
- Evidence: docs/superpowers/reports/2026-10-04-parent-portal-runtime-preflight.md. Last 211/211 and independent PASS unchanged; no unnecessary repeat test run, merge/push/deploy/network E2E/real-data access/external email.

## Isolated staging planning 2026-10-04

- User explicitly prohibits production app/data/server operations and main merge; requests minimum separate staging plan and one concrete manual step at a time. Read-only repository analysis only; no production requests.
- Plan: docs/superpowers/plans/2026-10-04-isolated-parent-portal-staging.md. Separate RF VPS, own Supabase/Auth/Storage/keys/volumes, staging.fizira.com + staging-auth.fizira.com, internal SMTP sink, synthetic fixtures, runtime and independent review gates. Six staging stages do not change the original eight completed Tasks.
- Found staging blockers in current code: app.js/parent.js production client defaults; parent signed-file origin production; Edge invite production redirect; legacy AI staging scripts and CI target production. Plan pins explicit environment routing and fail-closed staging checks before accounts/invitations, without weakening authorization or SQL verifier.
- No accessible staging SSH identity/environment/Timeweb management channel. Production workflow secrets are not an available staging connection and are not reused. STOP before external creation: first user action is open Timeweb Cloud new-server form only, no purchase or existing-server changes.

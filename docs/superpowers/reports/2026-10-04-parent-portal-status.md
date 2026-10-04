# Fizira parent portal — local implementation status, 2026-10-04

All **8 planned implementation tasks** are complete locally on `codex/parent-portal`.
Reviewed implementation head: `ac57a628bf804065d9550f4635187f1949f17d5d`.
This report does not approve production release, merge or deployment.

## Recovery and completion

- Tasks1–5 were retained. Recovery found Task6 source and CSS fixes already present, including changes beyond the interrupted conversation. No rollback or reimplementation was performed.
- Task6 recovery corrected actual invitation/status contracts, account/child async retirement, source/Storage role intersections, trusted signup reservation/provisioning and safe goal notifications. Its independent recovery gate passed.
- Task7 delivered specialist invitation/access controls, nullable contact email, explicit parent-safe reports/goals and immutable publication management. Review found and corrected real-schema ordering, orphaned access revocation, old session-version reachability and expired publication recovery. Additive012 permits only published→archived withdrawal without content/artifact mutation.
- Task8 delivered read-only verification, isolated synthetic gate, all asset/Edge/font/config parity, safe source audit/backup/activation/rollback and rollout documentation. Final review corrections enforce complete function/policy definitions, new cache identities and exact baseline availability in fresh CI.

## Final evidence

- Fresh controller `npm test`: **211 passed, 0 failed, 0 cancelled, 0 skipped**.
- Independent whole-branch review followed by scoped fix reviews: **SPEC / SECURITY / QUALITY PASS**; R1/R2/R3 addressed; no open High/Important/Blocker.
- Final scoped review independently checked fresh detached shallow-checkout scenarios **8/8**. Earlier scoped SQL/catalog/cache checks **17/17** and lifecycle checks **2/2** passed.
- Endpoint/frontend/release-script syntax and diff checks passed. Local fixtures and mocks do not establish real Supabase or browser behavior.

[Final independent review](../../../.superpowers/sdd/2026-10-03-parent-portal/final-parent-portal-rereview.md)

[Original whole-branch findings](../../../.superpowers/sdd/2026-10-03-parent-portal/final-parent-portal-review.md)

[Fix evidence](../../../.superpowers/sdd/2026-10-03-parent-portal/final-review-fix-report.md)

[Rollout runbook](../../../ops/parent-portal/README.md)

## Remaining release gates

Before production: reconcile actual main/GitHub/production source and shallow ancestry; prove restorable DB/Auth/Storage/config backup; run real read-only SQL/source audit; verify Auth redirect/templates/SMTP/recovery, multiple-connection invitation/publication races, Storage API/S3/ETag/copy/move/sign/write/delete and byte ordering, Deno/font packaging, isolated disposable-target synthetic network checks and manual desktop/mobile parent/specialist acceptance.

None of these external runtime gates ran in this work. The synthetic runner requires explicit confirmation and an isolated target. Immutable synthetic consent/reservation evidence is retained; complete teardown requires disposing of that target. Exact catalog owner/deparser differences intentionally STOP verification and require reconciliation against reviewed sources.

Two Minor follow-ups remain: uppercase UUIDs can falsely reject valid noncanonical requests; request-body reading lacks an application deadline tied to the publication timer. Canonical app IDs work; runtime limits must be checked before release.

The branch and worktree are preserved. No merge, push, deployment, production migration, network E2E, real-data access or external email occurred. The next permitted development step is isolated runtime validation; production requires separate actual-state verification and user confirmation.

## Recorded controller rulings

The following original ledger entries preserve decisions and their stated costs if wrong; they are historical design/implementation rulings, not evidence that external release gates passed.

- Ruling: Task 1 uses project-consistent Russian presentation contracts — formatParentDate returns `Дата не указана` for missing/invalid values and otherwise ru-RU day/month/year; formatParentAge returns `Возраст не указан` for missing/invalid dates and existing app month/year wording; publicationLabel maps draft→`Черновик`, publishing→`Публикуется…`, published→`Опубликовано для родителя`, publication_error→`Ошибка публикации`, archived→`В архиве`. PARENT_NAV_ITEMS is [{ id:"home", label:"Главная" }, { id:"schedule", label:"Расписание" }, { id:"reports", label:"Отчёты" }, { id:"goals", label:"Цели" }, { id:"dynamics", label:"Динамика" }]. dynamicsSeries takes only rows with scale, assessed_at, value_numeric/value_text and returns { numeric: [{ scale, points:[{ assessed_at, value }] }], categorical: [{ scale, assessed_at, value }] }; numeric is finite value_numeric for GMFM-66/HINE, categorical is nonempty value_text for GMFCS/MACS/CFCS/EDACS, other/malformed data are dropped, both sorted ascending by assessed_at. This is safe because it shows stored values only, not clinical conclusions; cost if wrong is a future UI adapter change, not data exposure.

- Ruling: parentFileRequest is a discriminated request: photo requires mediaId; pdf must omit mediaId. The plan’s optional notation describes the union, not permission to send a meaningless media identifier. This prevents the client from creating ambiguous file authorisation requests; cost if wrong is a small future API extension if PDF attachments are added.

- Task 1: Ruling: HINE rows carrying a finite value_numeric are a numeric series, not a categorical timeline. The spec permits a linear graph only for a correct numeric series and HINE is a score when stored numerically; the Task 1 wording pairing HINE with MACS was imprecise. Code and tests stand. Cost if wrong is only an adapter/UI representation correction; no source field or authorization boundary changes.

- Ruling: Task 2 invitation record contract is issue_parent_invitation_record(p_therapist_id uuid, p_patient_id uuid, p_contact_id uuid, p_token_digest text, p_auth_flow text) returns table(invitation_id uuid, expires_at timestamptz). It reads and normalizes email only from the locked contact row, verifies therapist/patient/contact ownership itself, requires a 64-lower-hex digest and p_auth_flow in {new, existing}, revokes the prior pending invitation atomically, and exposes no raw token. This matches Task 4’s browser body of patient_id/contact_id while keeping email and token server-side; cost if wrong is an Edge adapter signature change.

- Ruling: Task 2 revoke contract is revoke_parent_access_record(p_therapist_id uuid, p_access_id uuid) returns integer. It verifies the access row belongs to that specialist before setting active access revoked and revoking pending invitations for the same contact/patient. This exactly matches Task 4’s { access_id } endpoint; cost if wrong is adding a separate pending-invitation revoke action later.

- Ruling: accept_parent_invitation accepts exactly JSON [{ document_type:"terms", accepted:true }, { document_type:"privacy", accepted:true }, { document_type:"personal_data_consent", accepted:true }] in any order, no duplicates/extra keys/types. SQL loads required current version/hash from legal_document_versions and writes server timestamp. parent_invitation_state returns only { state, auth_flow? } after authenticated lowercased email comparison, where state is valid|expired|revoked|accepted|invalid|email_mismatch and auth_flow appears only for valid same-email state. UI maps non-valid states to generic text. This makes consent auditable and prevents a token oracle/data leak; cost if wrong is a coordinated future legal-document UI update.

- Task 2 review: Important — accept_parent_invitation overwrites a matching consent's historical hash/accepted_at/source. Ruling: retain every prior consent evidence row in a new append-only authoritative parent-consent audit before updating the canonical current-consent row, because the global constraint preserves historical data and auditability is a legal boundary. Cost if wrong: added migration complexity and an extra table to protect, but no loss of prior evidence.

- Task 3: Ruling: scope the Task 2 identity test's execution of verify_migration.sql to the pre-009 marker, and have Task 3's publication test execute the 009 verification block. This preserves fail-closed verification while keeping each migration fixture self-contained; cost if wrong is a mistaken marker split could leave a verification statement untested, mitigated by Task 3's test explicitly executing the second block.

- Task 3 review: Important — verify_migration.sql Storage allowlist rejects the legitimate account_must_be_active baseline and accepts an unsafe policy merely by name. Ruling: validate policy role, command and predicate shape explicitly, while allowing the existing restrictive account_must_be_active policy; add baseline and unsafe-policy injection tests. Cost if wrong: predicate matching may require coordinated update when a legitimate Storage policy intentionally evolves, but name-only verification is unsafe.

- Task 3 review: Important — published report media is rebuilt from mutable patient_media fields. Ruling: capture an immutable publication-media reference/metadata at publication and make parent projection use it, without changing access to clinical source rows; add regression for source metadata mutation. Cost if wrong: a future legitimate content correction needs a new draft publication rather than mutating a published report, which is the intended immutability model.

- Task5 Ruling: add migration010 with service-only row-locked claim/complete/fail CAS RPCs, frozen allowlisted snapshot/source metadata and object version, publishing edit guards and private artifact mapping. Add restrictive authenticated Storage mutation protection for owner-id/parent-reports artifacts and temporarily claimed sources. No parent direct policy; retain required PDF prefix. Necessary because path-only capture plus owner Storage writes violates immutable publication. Cost if wrong: additional migration/verification/rollout complexity and temporary source-edit refusal during publishing. Stage008/009 checks must remain testable without010.

- Task5 Ruling: upload only the exact downloaded/hash-checked bytes to fresh immutable revision keys with upsert:false; compare frozen source identity/version through completion and fail closed on concurrent change. Stale workers use claim/revision CAS, cannot publish/fail/clean a newer claim; ambiguous completion retains private artifacts for reconciliation. Cost if wrong: publication retry/operational reconciliation rather than serving a changed image.

- Task5 Ruling: include minimal supabase/config.toml static_files configuration for bundled renderer font, validated against official supported schema; do not change existing function JWT settings or remote linkage. Carry config/font/OFL in Task8 parity/deployment tests. Needed because renderer reading a missing packaged font would fail despite local PDF tests. Cost if wrong: config-path adaptation in staging; no production target change.

- Task6 Ruling: permit small role-gate.mjs seam used by app.js so role routing/authorization order is directly behavior-tested rather than only regex assertions. No new role grants or metadata fallback. Add asset to Task8 deployment/audit/rollback list. Cost if wrong: an additional small static dependency to package, mitigated by parity tests.

- Recovery Ruling: additive migration011 must intersect existing clinical owner/account policies with authoritative specialist role, including private Storage SELECT and mutations; preserve existing owner/account/immutable artifact guards and dual-role access. This implements the approved specialist-only boundary rather than replacing it with a UI check. Cost if wrong: migration/verifier rollout complexity; local and isolated runtime regressions are required.

- Recovery Ruling: preserve the existing ordinary self-service specialist registration with a trusted Auth INSERT provisioner and server-only durable new-parent signup reservation, serialized by normalized-email transaction lock. Never derive roles from browser metadata; invited/reserved parent accounts and existing parent roles cannot be promoted by retries/updates/expiry. Cost if wrong: blocked onboarding or excessive roles; authoritative fixture and staging Auth lifecycle checks gate release.

- Recovery Ruling: binding design section9 requires goal-publication notifications despite omission in Task3 plan. Add fixed safe notification copy for visible publication/material public changes/restoration; no private edits, financial values or inactive/revoked links. Cost if wrong: extra or missing notifications, covered by transition tests.

- Task7 Ruling: the existing010 immutable-report guard allows published→archived in its content check but its authenticated metadata loop rejects that same approved withdrawal. Add migration012 with only a narrow published→archived status exception; keep complete immutable fields/PDF/photo/claim/RLS owner-role-account protection, prohibit all unarchive/publication/metadata edits, and test effective own/foreign/parent/inactive/archive-with-content-change behavior and replay/verifier. Do not rewrite001–011. Cost if wrong: an overly broad status exception could undermine publication immutability, so actual SQL security tests and independent review gate the extension. Task8 migration order must now include012.

- Task8 Ruling: binding immutable consent evidence and durable parent signup reservations take precedence over plan wording requiring deletion of every fixture row. The runner must explicitly require an isolated disposable target, clean deletable Auth/clinical/Storage fixture resources in finally, report retained synthetic audit/reservations and require target disposal for complete teardown. No trigger disabling, broad service cleanup grants or production fixture execution. Why: deleting intentional immutable records would weaken approved access/audit semantics. Cost if wrong: disposable-target lifecycle and retained synthetic-only records until disposal.

- Ruling: resolve the newCI dependency with minimal verified baseline/history availability in every affected workflow, plus regression, before localcompletion. Why: userexplicitly forbids completion with High/blocking reviewissues; the newtest cannot pass in supportedfreshCI. Costifwrong: morecheckoutdata/time, no productionpermission or ancestryreconciliation implied. This narrow followup fixes newbreakage within finalreview delivery scope; do not reopen unrelatedfeatures.

## Subsequent runtime preflight — 2026-10-04

Source ancestry is now verified at `7eb4fd1`: 21 locally hash-validated commit objects reach remote checkpoint `97aae31`; GitHub confirms that checkpoint descends from baseline `f9f4220`, which still equals current main. This supersedes the earlier unresolved source-ancestry item only. Production source equivalence and all external runtime gates remain unverified. The isolated target and secure environment configuration are unavailable here, so runtime execution is blocked. See [runtime preflight evidence](2026-10-04-parent-portal-runtime-preflight.md). No merge, push or deployment occurred.

# Cumulative Tasks 1–6 independent recovery/security review

Status: final independent review through fdb091b — Spec PASS, Security PASS, Code-quality PASS for delivered Tasks1–6; no open Blocker/High/Important findings. See final section for resolved evidence and separate runtime/Tasks7–8 limits. Earlier provisional findings are preserved as review history.

Reviewed against explicit base snapshot `f9f42204d907195ed04f09cd47f8ad563b2078fb`, binding design and plan Global Constraints/Review Focus. Reviewed SQL 008–010, baseline clinical/Storage policies and account guard, Edge shared handlers/wrappers, publication/PDF renderer, domain/UI/root role gate, verifier and actual test bodies. No deployment, external writes, real-data access, implementation edits or subagents. Temporary synthetic PGlite test files were removed. The only durable review write is this report.

## Open Important findings

### I1 — Effective parent-only authorization still permits clinical editing and direct private Storage

Locations: `supabase/migrations/20260920_001_app_schema.sql:463–469,523`; `supabase/migrations/20260921_002_existing_target_security_fix.sql:257–277,320–327`; missing role restriction in migrations 008/009; 010 `parent_storage_write_allowed` excludes artifact/actively claimed paths but allows ordinary own-prefix source objects.

Concrete reproduction: start the local 010 test fixture with actual migration-002 Storage policies, account guard, and 008/009/010; authenticate as a user whose authoritative roles are exactly `[{role:'parent'}]`. INSERT a patient with therapist_id equal to that parent UUID, then INSERT a session for that child with an internal note. Direct SELECT returns both patient and `session.note`. INSERT `storage.objects(bucket_id='patient-media',name='<parent-id>/own.jpg')`; direct SELECT returns that object. The same parent sees no linked specialist rows or objects under another specialist's prefix.

The owner predicate is effective for tenant isolation, but it does not establish the approved specialist-only role boundary. This is an Important access-control/spec violation, not evidence of cross-tenant disclosure. The existing green direct-source tests seed only specialist-owned rows; an empty parent result in that fixture does not prove all direct parent routes denied. The verifier's exact owner-policy baseline likewise cannot prove the missing role restriction.

Required fix: add a restrictive authoritative specialist-role intersection for every clinical/source CRUD route and relevant private Storage command (SELECT/sign/download as well as upload/update/delete/copy/move behavior), while retaining owner/account restrictions and legitimate dual-role access. Do not replace this with a UI gate. Add executable parent-own source INSERT/SELECT and parent-own Storage prefix adversarial coverage, alongside specialist/dual-role and account-deactivation regressions. Actual Storage API route enforcement remains an isolated staging gate.

### I2 — Fresh specialist registration is blocked without any authoritative provisioning route

Locations: `supabase/migrations/20261003_008_parent_portal_identity.sql:28–42`; `app.js` ordinary `sb.auth.signUp` registration and `renderAuthView` empty-role rejection; `role-gate.mjs:11–14`.

Concrete reproduction: insert a fresh synthetic Auth user after 008 creation; authenticated `current_app_roles()` returns `[]`. Existing ordinary specialist signUp only creates the Auth account and metadata/profile/consents, while specialist backfill runs only when the role table is first created. The root correctly refuses empty roles, making the previously available specialist registration flow unusable. Neither Task 7 specialist controls nor Task 8 packaging supplies a provisioning interface as currently planned.

Grade: Important functional regression and release blocker until a trusted onboarding route/product decision is implemented. Required fix: preserve an authoritative server-side specialist registration/provisioning flow that cannot grant specialist to invited parent accounts or trust editable client metadata. If enrollment is intentionally changed to approval-based onboarding, explicitly obtain the product decision and implement/document the operational grant mechanism and user flow. Keep empty-role fail-closed behavior; never solve this using a client fallback or retry backfill promotion. Add fresh specialist and invited-parent negative tests.

### I3 — Publishing goals cannot produce the promised parent notification

Locations: `supabase/migrations/20261003_009_parent_portal_publications.sql:64,66`, `notify_parent_publication_or_appointment` and its installed triggers. Design §9 explicitly includes goal-publication notifications; Task 3's plan omitted that branch.

Concrete reproduction: owning specialist inserts a `parent_goal_publications` row with `status='new'` and `published_at=now()` for a child with active parent access. `parent_portal_goals` returns it; `parent_notifications` contains no row for that parent. There is no goal trigger, and existing type/entity constraints do not even represent a goal event. Task 7 can expose the authoring control but cannot satisfy this promise with the delivered backend.

Grade: Important spec completeness gap. Required fix: define a safe goal event/type/entity and trigger explicit publication/material republishing transitions, with active parent-child/current owner/account checks and fixed parent-safe copy. Avoid notifications for unpublished/private edits, avoid duplicates on irrelevant updates, and test inactive/revoked/foreign parents and safe output.

## Existing satisfactory boundaries and evidence limits

- Parent child/report/file access checks authoritative parent role, active child link, current specialist ownership, account tombstones and publication/explicit selection. Fixed RPC allowlists omit internal source notes, AI/tolerance/planned-session fields, finance and paths. New portal tables require specialist role for direct rows/writes. Anon/public execution and authenticated access to service-only publication/resolver procedures are revoked, with fixed definer search paths.
- Invitation hashes are server-derived from random tokens; legal version/hash/time are selected by the database; audit evidence is append-only. Patient/contact/invitation lock ordering serializes acceptance/resend/revoke. No raw token or account existence is returned by Edge. Local single-engine fixture tests establish sequential CAS/state semantics, not multi-connection scheduling or actual Auth delivery.
- Publication builds frozen safe text and selected source identity metadata before privileged file work. Report/selection locks, claim UUID/revision CAS, error visibility and retry namespace prevent stale publication/deletion. Selected bytes are conditionally fetched with matching strong ETag, copied to immutable artifacts, hashed and mapped by opaque IDs. No handoff rejoins current source paths. The file handler verifies digest/signature and repeats authorization before a <=300-second signed URL.
- Storage restrictive policies guard authenticated artifact namespace INSERT, UPDATE old/new paths, DELETE and actively publishing source keys. Baseline permissive owner policies continue to deny another specialist prefix. Service-role upload/copy behavior and distributed Storage/S3 races are not proven by local SQL; actual API upload/upsert/sign/copy/move/delete and in-flight overwrite/ETag behavior require isolated synthetic runtime verification. Already issued URLs may remain usable until their <=5-minute expiry.
- Migration replay, legacy drafts/contacts/consents, role non-promotion, grants, frozen report/content/selections, safe projection IDOR, account revocation and failure cases have executable PGlite coverage. Edge tests inject mocked HTTP/client failures; real PDF tests render/extract Cyrillic with bundled font. Existing passing suites were inspected rather than repeated. `npm test` currently runs tests/*.test.mjs but not shared Edge tests; Task 8 explicitly owns complete test aggregation.

## Deliberately unfinished Tasks 7/8

Specialist portal controls, release asset parity (including `role-gate.mjs`), complete test aggregation, opt-in isolated network E2E, runtime/deployment verification and rollout runbook are unimplemented plan tasks, not falsely claimed completed features. No release approval follows from this Tasks 1–6 review. The open role/provisioning/goal backend findings above affect already delivered behavior and cannot be silently deferred as packaging or UI tasks.

## Focused independently executed checks

1. Parent-only own patient/session INSERT and direct SELECT; own patient-media object INSERT/SELECT; cross-specialist Storage SELECT empty; fresh Auth user roles empty. One local synthetic PGlite run completed successfully while confirming the failures above.
2. Explicit goal publication visible through parent RPC with no goal notification. One local synthetic PGlite run completed successfully while confirming that spec gap.

Final Task 6 UI recovery assessment pending final fix commit/evidence.

## Task 6 UI contract finding pending implementer fix

### I4 — Actual appointment/goal statuses render as unknown

Location at reviewed HEAD585d8ae: `parent.js:12–13`. Appointment enum is `planned|completed|cancelled|no_show` (`supabase/migrations/20260923_005_specialist_schedule.sql:12`), while UI maps `scheduled|completed|cancelled`. Goal publication enum is `new|in_progress|achieved|revised` (`009:53`), while UI maps old clinical goal statuses `active|achieved|paused`. Thus every ordinary planned appointment, no-show, and three of four published goal statuses display “Статус не указан”, losing the intended parent-visible state. Existing UI mocks use scheduled/active and mask the mismatch.

Grade: Important UI/spec correctness; no authorization bypass. Required fix: map all actual appointment and parent-publication statuses to clear Russian copy, with separate mappings if needed; derive fixtures from real schema enum and assert all contract states in rendered dashboard/schedule/goals. Controller reports implementer is addressing it; final commit/evidence still pending.

The earlier Task6 review findings (new|existing invitation enum, synchronous account-switch retirement of old specialist actions, consistent local appointment calendar day/time) are tracked in `task-6-review.md`; uncommitted fixes observed are not final approval evidence. Mobile navigation remains a Minor design §10.2 mismatch: parent.js shell/parent.css place it in a top scrolling row instead of bottom navigation on mobile.

## Independent Task 6 UI re-review — commit 514e621

Reviewed clean final UI commit `514e62194bf5fb6e63dc76263c5a6577914ed86a` against `585d8ae` and the original Task6 findings. Controller/implementer evidence: focused 41/41, full npm 92/92, shared Edge/PDF 21/21, syntax/diff checks passing. Those suites were inspected, not redundantly rerun. Two additional narrowly focused synthetic HappyDOM reproductions executed real production handler bodies and auth retirement functions; temporary files were removed.

**Round verdict: REQUEST CHANGES.** Backend findings I1–I3 remain open. The frontend correction addresses invitation flow, appointment timezone, status labels and bottom navigation, but the original account-transition I2 is only partially fixed.

### Addressed findings

- Original Task6 invitation I1: real `new|existing` SQL enum is now consumed; tests derive the enum from migration008 and submit both forms, including existing-account blank password.
- Original Task6 timezone I3: timestamp appointment date and time both use browser local timezone; non-UTC midnight regression preserves separate date-only DOB/assessment behavior.
- This report I4: actual appointment `planned|completed|cancelled|no_show` and publication goal `new|in_progress|achieved|revised` labels are present, with all values checked in rendered schedule/goals.
- Minor mobile navigation mismatch: fixed bottom below760px with safe-area and content clearance, scoped parent selectors, desktop top placement. HappyDOM computed checks cover width320/390/759/1024 and specialist CSS unaffected; real browser visual QA remains separate.
- Original I2 partial progress: previous `#app`/header content and property handlers are synchronously cleared on changed identity/signout; new-patient captured action/submission, patient-list async summaries and core profile/patient/data load completions are revision-fenced. Same-account refresh/repeated sign-in preserve form inputs. Existing empty/pending authoritative role gate remains fail closed.

### I5 — Residual original I2: body overlays and already-running specialist callbacks cross account identity

**Severity: Important (frontend account isolation).** Locations: `app.js:1381–1393` retirement only covers app/header; `app.js:9244–9298` photo-preview overlay/body append; `app.js:2431–2481,2496–2527` deletion overlay and awaited deletion continuation; `app.js:2313–2326,2346–2399` profile logo/save continuation.

**Independent reproduction A — stale clinical photo remains visible:** start actual root auth harness with specialist role, render a media card, execute the actual `mediaList.querySelectorAll('[data-media-preview]')` registration/onclick, and click preview. The real handler appends `.media-preview-overlay` to `document.body` containing the signed old-specialist photo. Emit specialist→parent SIGNED_IN via real `init`. Real `scheduleAuthView` clears app synchronously (`app.children.length===0`), but `.media-preview-overlay img` remains connected and its src is the old specialist signed photo URL. The same code path leaves it after signout. This is visible prior-account clinical data, independent of whether the new backend token can query another specialist.

**Independent reproduction B — stale profile callback writes into new identity:** execute the actual specialist `profileForm.onsubmit` with old specialist full_name/profession and a logo file; defer the actual mocked Storage upload await. Emit specialist→parent auth change, then resolve upload. The still-running production callback reads mutable `user.id` after the await and sends `profiles.upsert` with `id:'parent'`, old specialist name/profession and `logo_path:'specialist/logo'`. It then assigns that payload to the new account's `state.profile`. A restrictive clinical-role migration alone does not cancel this UI callback or resolve ordinary own-profile access. The observed mock records the actual payload/state; this is not a production write claim.

**Related source-confirmed deletion risk:** the account-deletion password overlay also remains in body; its awaiting handler resumes without captured identity/revision check before the destructive Edge call. A user could finish a prior-account dialog using the current account's password/session, making the operation target the new identity. No destructive operation was performed in this review. This continuation needs cancellation even if overlay DOM is removed, because removing a dialog alone leaves its promise unresolved or a saved handler callable.

**Required correction:** retire/cancel all specialist-owned body overlays/dialogs on changed identity/signout, resolve pending interactive promises as cancelled, invalidate async preview recovery and revoke applicable object URLs. Capture account identity/revision at entry to specialist async mutation flows; recheck after each await before subsequent source/Storage/Edge calls, new state assignment or connected DOM work. At minimum fence profile logo→profile save and pending account deletion; review other multi-await specialist mutations/schedule callbacks for the same pattern. Existing in-flight requests may complete under their original token, but their continuation must not switch to a later account or restore prior data. Add regressions executing actual photo preview (not a synthetic generic overlay), deferred logo upload/profile save, pending deletion dialog cancellation, signout and specialist→parent/specialist switches. Preserve same-account refresh and unsaved form behavior.

No whole-boundary PASS is issued. Three backend Important findings plus this residual frontend account-isolation finding need the next fix wave and independent re-review. The four fixed UI/spec items above are accepted for this round, subject to unchanged final commit and later integration verification.

## In-progress backend wave review — migration011 (uncommitted)

Independent static review of `20261003_011_parent_role_boundaries.sql`, shared fixture, executable role-boundary tests and latest verifier delta found no new Important SQL regression. Final verdict remains pending committed UI/backend wave and covering evidence.

The restrictive specialist-role helper intersects all ten clinical/source tables and both private Storage buckets, preserving existing tenant/account and immutable artifact guards. UPDATE checks both old and new Storage rows; SELECT/sign/download policy paths are now included at the database layer. The service role remains intentionally privileged; browser role writes remain revoked. Ordinary specialist Auth INSERT is server-provisioned without metadata grants, excludes invited/anonymous/nonemail users, and is serialized with invitation INSERT using normalized-email advisory locks. New invitation records reserve email before Edge Auth creation; reservation survives token expiry/revocation/replay. Goal notifications use fixed safe copy for publication/material visible changes/republish and active-link/current owner/account checks.

A focused independently executed PGlite check using the shared fixture plus actual011 verified: parent-own patient INSERT fails `specialist_role_required`; parent-own patient-media prefix INSERT fails the same RLS intersection; a fresh ordinary synthetic Auth email gets authoritative specialist role; owning-specialist explicit goal publication produces `goal_published` for the eligible active parent. No full suite was repeated. The attempted name-filtered test command did not select nested tests and is not counted as executable coverage.

Operational note: durable reservation intentionally prevents future ordinary enrollment for any once-reserved email even when its invitation is revoked/expired. Document that consequence and the trusted role-management/reconciliation path. Actual Auth/SMTP ordering, multiple-connection races and Storage API routes still require isolated synthetic staging proof; these are runtime verification limits, not additional identified code blockers.

### Additional I5 schedule evidence (pre-lifecycle fix)

Inspected actual `openSchedule`→`renderCabinet` path. `cabinet.js:73` creates the schedule page synchronously before awaits, and refresh-finally/draw already check page.isConnected; a pending data response does not itself restore detached schedule DOM. A focused execution of the actual exported renderer deferred appointment/patient queries, retired root DOM, then resolved an old planned appointment: app remained empty, but `cabinet.js:63–67` resumed `completeDueAppointments` and issued `save_schedule_entries` after retirement. This is a stale specialist mutation continuation in original I5 scope. Existing schedule RPCs are SECURITY INVOKER, so migration011's role/owner RLS prevents parent write; a new specialist account must also not receive an old-account callback. Lifecycle checks should run before automatic completion, paginated follow-up reads and editor/save/refresh continuations. This is evidence of a late RPC, not a claimed unauthorized backend commit.

Current UI wave focused independent verification: `node --test --test-name-pattern='actual pending profile logo|real pending delete password|actual specialist photo preview|pending real calendar reads' tests/parent-ui.test.mjs tests/calendar-dom.test.mjs` executed four matching tests, **4/4 PASS**, zero failures/cancelled/skipped/todo. These execute actual profile/deletion/preview handler bodies and the real calendar renderer, establishing that the previously reproduced post-switch continuations now stop in the current delta. This does not supersede final committed-wave review.

Task8 synthetic-fixture requirement arising from provisioning: raw post011 Auth admin.createUser with an ordinary email now grants specialist. Parent-only network fixtures must use the actual reserved invitation/acceptance sequence; creating an ordinary Auth user then adding parent role produces a dual-role fixture and cannot prove parent-only source/Storage denial.

## Final independent cumulative Tasks 1–6 review — fdb091b

Final reviewed HEAD: **`fdb091bcb2a75b2d64b1dc8ea1ad6d8db4c942a2`**, clean implementation worktree. Read the complete `514e621..fdb091b` delta, final Task6 report appendix and migration/operational README additions, and reconciled these with the earlier cumulative review against explicit base `f9f42204d907195ed04f09cd47f8ad563b2078fb`. Earlier provisional REQUEST CHANGES verdicts above are preserved as review history and superseded by this final section.

**Spec verdict: PASS for delivered Tasks 1–6.**

**Security verdict: PASS for the reviewed implementation boundary.**

**Code-quality verdict: PASS. No open Blocker, High/Critical or Important finding remains in the reviewed delivered scope.** This is not deployment approval or a claim that unfinished Tasks7/8 or actual hosted runtime gates have passed.

### Resolution of all named findings

| Finding | Final status | Effective behavior/evidence |
| --- | --- | --- |
| I1 parent-only own-source/Storage bypass | ADDRESSED |011 restrictive ALL policies intersect ten source tables and both private buckets with authoritative specialist role + active account. Owner/patient integrity and010 artifact/source freezes remain. Parent own creation/read/update/delete are denied; specialist/dual-role owner access survives; account tombstones deny all. Existing save/settlement schedule RPCs are SECURITY INVOKER, so they remain subject to the new role RLS. No parent policy is widened. |
| I2 ordinary specialist onboarding gap | ADDRESSED | Trusted Auth INSERT trigger grants specialist only for ordinary nonanonymous email signup. Invitation INSERT reserves normalized new-flow email before Edge Auth administration; shared transaction advisory lock serializes reservation/provisioning. Invited/reserved/anonymous/nonemail cases, editable role metadata, Auth UPDATE and migration replay cannot grant specialist. Existing roles remain intact. Actual post011 reservation→Auth INSERT→acceptance test ends with exactly parent and denied clinical creation. Durable reservation/recreation consequences and synthetic-fixture route are documented. |
| I3 missing goal notification | ADDRESSED | Safe `goal_published`/`goal` event constraints and trigger cover first visible publish, restore visibility and material visible text/status updates. Unpublished/draft/timestamp-only changes emit none. Recipients require parent role/active access/current owner and no parent/specialist tombstone. Fixed notification copy excludes authored/private content. |
| I4 actual UI status mismatch | ADDRESSED at514e621 | All actual appointment and parent goal publication values render human labels; tests pin real SQL enums. |
| I5 residual original account-transition I2 | ADDRESSED | Root synchronously removes old body previews and cancels deletion dialog promises; profile/save/deletion/clinical/tab/AI/media/document callbacks capture account revision/id and stop secondary work/state/DOM after identity change. Profile IDs are captured before upload. Cabinet receives the same captured lifecycle predicate and checks reads, auto-completion, mutations, navigation and async continuation; editor carries it through save/settlement/delete/onSaved. Same-account refresh/recovery/form/editor behavior is retained. |

Original Task6 invitation enum/timezone findings and Minor bottom-navigation mismatch also remain closed at514e621. The final delta does not weaken role gating, escape/URL checks, invitation consent/token handling, parent RPC/file interfaces, immutable publication protocols or historical data migration behavior.

### Independently checked evidence

- The prior narrowly focused local manual checks reproduced each original effective own-source/Storage/provisioning/goal failure, then verified011 corrected them. The four actual UI lifecycle regressions (deferred profile logo/save, pending deletion promise, actual photo preview switch/signout, actual pending calendar auto-completion) passed **4/4** on the same final code now committed asfdb091b. Their test bodies execute real handler/renderer code, not merely source regexes.
- On final committed fdb091b, independently executed `node --test tests/parent-role-boundaries-sql.test.mjs`: **6/6 PASS**, zero failures/cancelled/skipped/todo, exit0. This includes the complete post011 invitation role classification, own-source/private Storage effective role checks, ordinary/reserved/invited/anonymous/nonemail/metadata/replay cases, safe goal transitions/account filters, complete latest verifier pre011 refusal/post011+replay acceptance and unsafe policy/trigger/grant/whole-constraint mutations.
- `git diff --check 514e621..fdb091b`: exit0. Confirmed clean implementation status and exact final SHA.
- Controller/implementer supplied final aggregate **124/124 PASS**, focused **53/53 PASS**, and syntax checks for app/parent/role-gate/cabinet/editor. Inspected the actual test coverage and final report; did not repeat aggregate suites already being independently run by controller. The aggregate explicitly includes21 shared Edge/publication/PDF checks; npm's current script alone still does not include those shared tests, which Task8 must fix.

### Remaining runtime/release limits (separate from code findings)

- Tasks7/8 remain deliberately unfinished: specialist portal controls, complete npm/CI aggregation, release asset/Edge/font parity, controlled deployment/rollout documentation and opt-in synthetic network E2E. Package migrations007–011 and all required static dependencies, including role-gate/cabinet/editor, in the prescribed staged order; frontend activation must follow backend verification.
- PGlite is single-engine synthetic SQL evidence. Verify actual multi-connection resend/accept/signup advisory lock order and GoTrue Auth INSERT/invited_at/SMTP/redirect behavior on an isolated target. Parent-only fixtures must be reserved invite→Auth creation→acceptance, not ordinary createUser then add parent.
- Verify actual private Storage upload/upsert/sign/download/copy/move/delete routes, distributed metadata/object ordering, strong conditional ETag behavior and in-flight source replacement. Local SQL and injected HTTP prove application checks; they do not prove all deployed Storage/S3 behavior. Artifact digest/path immutability and repeated active authorization remain essential. Already issued signed URLs may persist until <=5-minute expiry.
- Confirm bundled Cyrillic font/Deno npm package availability and actual Edge resource/timeout behavior; local real PDF rendering/extraction is meaningful but not hosted runtime evidence. Previously noted minor noncanonical UUID casing and request-body read deadline limitations are unchanged nonblocking follow-ups, not newly introduced findings.
- HappyDOM computed layout/real-body auth tests establish local behavior. Real mobile-browser visuals, dialogs, recovery/acceptance redirects and identity transitions still need isolated manual/browser acceptance. Frontend fences stop later account continuations; already-started remote requests are not transactionally cancelled.

No production/external writes, emails, real-data access, deployment, push, merge or implementation mutation occurred during this independent review. Only synthetic local checks and this report were written.

Final controller evidence confirmation: read `recovery-controller-final-tests.log`, `recovery-controller-security-tests.log` and `recovery-controller-specialist-tests.log`. They record respectively124/124 (14627ms),10/10 and17/17 PASS, **151 current checks total**, zero failures/skips/cancellations/todo. Controller confirmed fresh syntax/diff checks, clean fdb091b and no source edits afterward. These logs strengthen the final PASS above without replacing the separate isolated runtime/Tasks7–8 gates.

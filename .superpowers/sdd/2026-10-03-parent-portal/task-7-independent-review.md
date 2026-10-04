# Independent Task 7 review

## Current gate — scoped re-review round 1

Date: 2026-10-04. Independently reviewed fix commit **`bea5b92`**, diff **`86211d4..bea5b92`**, against the four original findings below. Confirmed the actual worktree HEAD rather than relying on an interrupted implementer conversation. The original review and reproduction evidence are retained below as historical findings.

**SPEC PASS · SECURITY PASS · CODE QUALITY PASS.** All four findings are **ADDRESSED**. No new High or Important defect was found in the fix diff. **Task 7's independent gate is cleared; Task 8 may proceed within its separately authorized scope and remaining release gates.** This is not staging/production approval.

| Finding | Original severity | Re-review status | Concrete correction and evidence |
| --- | --- | --- | --- |
| R1: nonexistent access ordering column | High | **ADDRESSED** | `parent-specialist.js:180` selects/orders by actual `granted_at`. The new contract adapter executes the UI's selected, filtered and ordered SQL under migrated specialist RLS, including an empty access table. Parent columns come from the real migrations; omitted source-fixture columns are added from the actual 001 declarations. This no longer relies on a no-op ordering mock. |
| R2: retained access hidden after contact deletion | High | **ADDRESSED** | `parent-specialist.js:203–207,227–235` renders every owned active access independently of contacts, labels deleted contacts and binds a confirmed ID-only revoke action. The SQL-backed regression performs real contact deletion, verifies null-contact access is still active, cancels without revocation, then invokes the existing service procedure and checks status becomes revoked. No backend authorization widening or automatic contact-deletion revocation was introduced. |
| R3: older session publication unreachable | Important | **ADDRESSED** | `parent-specialist.js:53–55,66,108–109` provides an owned same-session version list and opens the exact selected report ID. Explicit unavailable IDs now fail closed instead of selecting another version. Both actual app session-history and parent-tab entry points reach the older publication while a newer draft exists. The contract regression archives the older report through actual SQL, compares immutable metadata/content before and after, verifies parent invisibility and retains the newer draft. |
| R4: expired publishing lease has no UI recovery | Important | **ADDRESSED** | `parent-specialist.js:70,107,110–133` provides a separate confirmed recovery action that invokes only `{report_id,report_kind}`. It bypasses browser draft/media saves and delegates expiry, ownership and claim replacement entirely to the existing server protocol. SQL-backed tests observe live-lease refusal and expired-lease recovery for session/initial kinds, and assert no browser author/media mutations. |

### Re-review security and regression assessment

The new version actions, refresh and recovery handlers remain wrapped in the existing mounted-generation/action scope. After generation or archival they refresh only while current, and re-render the exact editor only if the refresh has not retired that view. The independent access list filters by captured patient/specialist ownership and active status before rendering, and rechecks the selected access ID before invoking revoke. Confirmation and post-await retirement checks remain in place. All displayed labels/IDs remain escaped; the diff adds no sensitive path/token projection.

The new recovery button does not accept or mutate claim IDs, revisions, timestamps, snapshots, paths or publication status from the browser. A live lease remains a server refusal. The ordinary publish path still saves explicitly authored data first; recovery uses only the generation path. No change to migration 012, SQL grants/RLS, Storage policies, immutable artifact behavior, Edge authorization or notification contracts was made in this fix round. The initial 012 security conclusion therefore remains valid.

The rest of the production diff is scoped access/version styling and coordinated app/module/CSS cache versions. No unrelated clinical or account behavior was changed. The new SQL test adapter serializes session-role changes during concurrent portal reads and rejects invalid schema columns and unexpected single-row cardinality. Its Edge adapter is intentionally local claim/complete/revoke orchestration, not a claim of real Deno/Storage/SMTP coverage.

### Independently executed evidence

- `node --test tests/parent-specialist-contract.test.mjs`: **6 passed, 0 failed, exit 0**. This targeted run verifies the newly added tests close the four concrete contract gaps; broad suites were not repeated.
- Additional real-module probe: switch from a draft with source signing still pending to the older published version. Resolve the old signing response; no source image attaches to the published view, the selected old text remains, and the retained prior save handler dispatches no query. **PASS.**
- Additional real-module probe: with no contacts, an owned null-contact active access remains actionable and a foreign-child access is absent. Change the account identity while revoke is pending; completion triggers no refresh. **PASS.**
- Additional real-module probe: detach the root while publishing recovery is pending; completion triggers no refresh and no browser author/media mutation. **PASS.**

One combined probe initially reused a mutable user object after its deliberate account-retirement scenario, causing the next independent scenario to fail setup (no recovery button). Recreating the harness in a fresh invocation resolved that probe-only contamination; the detached-root assertions then passed. It was not a production defect.

Reviewed the implementation's reported 137 repository / 45 focused / 25 helper-security pass evidence, but did not treat totals as a substitute for inspecting the fix and executing the targeted contract/lifecycle checks above. Existing manual browser/device, actual Supabase Auth/Storage/SMTP/Deno, staging rollout and release-parity gates remain for Task 8. No implementation edits, commits, subagents, network E2E, real data/email, merge, push or deployment were performed during re-review; only this report was updated.

## Historical first review — superseded gate at 86211d4

Reviewed head: `86211d4`; base: `3baa330`; branch: `codex/parent-portal`.
Reviewer scope: Task 7 actual implementation and its immediate SQL/Edge/app contracts. Read the Task 7 brief, implementation report, binding design sections 6, 9, 10.3 and security, and the plan's Global Constraints verbatim. This is an independent review, not acceptance of the implementation report or passing-suite totals.

## Original verdict (superseded by round 1 above)

- **SPEC FAIL** — R1, R2, R3 and R4 below.
- **SECURITY FAIL** — R2 prevents the specialist from seeing/revoking an active authorization after a supported contact deletion. No new direct RLS, IDOR, account-isolation or Storage privilege bypass was found in this diff. Migration 012's narrow archive extension passes the security review.
- **CODE QUALITY FAIL** — the production query/schema mismatch in R1 is hidden by an unconstrained test double; important multi-version/access/recovery states are absent from the behavior coverage.
- **Task 8 blocked.** Fix and independently re-review all four findings before proceeding.

## R1 — High: the entire parent-portal tab fails against the actual access schema

**Location:** `parent-specialist.js:167` (query), `:165–173` (shared Promise.all), `:236` (error UI). Actual schema: `supabase/migrations/20261003_008_parent_portal_identity.sql:118–132`. Test gap: `tests/parent-specialist-ui.test.mjs:14`.

The access query orders `parent_child_access` by `created_at`. That table has `granted_at`, not `created_at`; no later migration adds the requested column. PostgreSQL rejects the query even when it would return zero rows. Because this is one input to the initial Promise.all, no contacts, invitation controls, initial-report controls, session controls, goal controls or visibility summary render.

**Reproduction and observed evidence:** Load the existing local PGlite fixture and migrations 011 and 012; as its authenticated owning specialist, execute the exact SQL equivalent:

```sql
select id,contact_id,patient_id,therapist_id,status
from parent_child_access
where patient_id=$1 and therapist_id=$2
order by created_at desc;
```

Observed `{code:'42703', message:'column "created_at" does not exist'}`. Feeding that actual query error to the real `renderParentPortalSpecialist` produces only `Не удалось загрузить кабинет родителя. Обновите вкладку.` Reloading cannot recover.

**Required correction:** Use the actual access schema's timestamp/order. Add a contract regression that executes or validates the real selected/ordered columns against the migrated schema, including an empty access table. The current UI mock implements `order(){return this}` and cannot detect this defect. A successful in-memory portal render is not evidence of a valid database query.

## R2 — High: deleting a contact hides a still-active parent access and its revoke control

**Location:** `parent-specialist.js:176,183–189,196–208`. Existing supported deletion: `app.js:6094–6134`. Contract: migration 008 `parent_child_access.contact_id ... on delete set null`; `supabase/functions/_shared/parent-portal.ts:79–84` explicitly permits revocation after contact deletion.

All activation labels and revoke buttons are generated inside `contacts.map`. Active access rows whose `contact_id` is null are fetched but never represented. The existing overview's contact deletion remains available; it deletes the contact, and the database retains the parent access with a null contact reference. That parent remains authorized, but the new administration tab says to add a contact and provides no revoke control. Re-creating a contact produces a new UUID and does not reattach the old access.

**Reproduction and observed evidence:** In the local migrated fixture, attach the synthetic parent's existing active access to a synthetic contact, delete that contact as the owning specialist using the same operation as the overview, and query the result:

```text
select status,contact_id ... -> [{status:'active',contact_id:null}]
parent_has_active_access(parent_id,patient_id) as that parent -> true
parent_portal_children() as that parent -> still contains the child
```

Render the real portal with that active null-contact access and an empty contacts list (isolating this issue from R1). Observed: zero `[data-revoke]` buttons, no `Активирован` label, and `Добавьте контакт в обзоре карточки.` The backend already supports `{access_id}` revocation with a null contact, so the missing control is specifically a Task 7 integration defect.

**Required correction:** Represent every active owned access independently of the contacts list; retain an intelligible deleted-contact state and a confirmed revoke action using the existing access ID endpoint. Do not silently treat contact deletion as successful access revocation. Cover the actual contact-delete→null-contact→still-visible/revocable lifecycle, endpoint dispatch and stale-view fences. Automatic revocation on contact deletion is not required as a substitute for correct access administration.

## R3 — Important: a newer session draft makes the previous live publication unreachable for withdrawal

**Location:** `parent-specialist.js:51–54,123–133,191,217`; session-history entry at `app.js:7721–7728`.

Both session entry points supply a session identity without a report ID. The editor therefore always selects the latest created report for that session. Unlike initial reports, there is no list or selector for session report versions. `Новая версия` creates a newer draft and leaves the previous report published, correctly preserving its immutable content, but every subsequent entry opens only the new draft. The older published report's `В архив` action can no longer be reached. Publishing and archiving the new version still does not make the older version selectable, because the newest archived row continues to win.

**Reproduction and observed evidence:** Publish a session report, choose `Новая версия`, leave the new draft unpublished, and return to either session entry point. A focused real-editor probe with descending rows `[new draft, old published]` observed:

```text
displayed author text: New draft
archive controls: 0
report/version selectors: 0
old report database state: published
```

The parent projection still includes published reports independently; creating the draft does not withdraw the older report. This defeats the explicit withdrawal control delivered by Task 7/012 precisely in the supported revision workflow.

**Required correction:** Provide a reachable version/history control for every existing session report and pass its exact owned report ID into the editor. Keep new-version creation and archival explicit; do not silently archive an older version as a workaround. Cover two or more versions, opening/archiving the older live report while a newer draft exists, and verify the older artifact remains immutable and becomes parent-invisible only after archival.

## R4 — Important: an expired publishing lease cannot be recovered through the UI

**Location:** `parent-specialist.js:62,66–68,70–82,104–107`; server recovery contract: `supabase/migrations/20261003_010_parent_publication_artifacts.sql:142–145` and `supabase/functions/_shared/parent-publication.ts` claim/recovery path.

The server deliberately supports reclaiming a `publishing` report after its 15-minute lease expires. This handles a worker crash or unavailable failure persistence; no background sweeper in this implementation changes that state. The UI, however, offers only `Обновить статус` for every `publishing` report. It never invokes generation in this state, and its normal publish handler always calls `save()`, which rejects a publishing record before generation. Repeated refreshes cannot reclaim the lease, including after reopening the application.

**Reproduction and observed evidence:** Leave a report in `publishing` with an expired claim timestamp (the supported crash-recovery state), open either editor, and refresh after expiry. A focused real-editor probe observed exactly `['Обновить статус']` as the available buttons and no `[data-publish-report]` control. The SQL claim function would allow reclaiming that expired claim if the generation endpoint were invoked, but no UI path does so.

**Required correction:** Provide an explicit confirmed recovery/retry action for this state that invokes the existing `generate-parent-report-pdf` endpoint with only `{report_id,report_kind}`. Let the existing server claim protocol enforce lease expiry, ownership and claim replacement; do not update publication metadata or author/media selections from the browser to unlock it. Cover a live lease refusal, expired-lease successful recovery, and delayed retry responses after child/account/root retirement.

## Security and integration checks that passed review

- The four invoked Edge operations use the actual request-body contracts: create `{patient_id,contact_id}`, resend `{invitation_id}`, revoke `{access_id}`, generate `{report_id,report_kind}`. Generation returns the checked `publication_status`; no browser role or Storage path is supplied to these endpoints.
- Draft writes are owned by patient and specialist; session authoring allowlists the four parent-safe fields. Published content is rendered read-only; new versions copy allowlisted author data and source IDs, not snapshot, PDF path, frozen artifact metadata, claims or timestamps. Existing overview save remains draft-only, and published edit/print/delete actions route to publication management.
- Module continuations check root generation, connectedness and authoritative current-account/child state before secondary writes, refresh or attaching signed photos. The real app refresh captures account/child/root identity and checks around the loader. The loader rejects a delayed response for another selected child. No new retirement bypass was found during source review; this conclusion does not substitute for the missing R4 recovery lifecycle regression.
- Specialist source preview signing remains under existing specialist Storage rights. It filters owned photo rows and the publication-artifact namespace, validates same configured HTTPS origin, limits signing to 60 seconds, and fences delayed results. Published editors do not attach mutable source images as frozen publication photos. Parent source SELECT/Storage access is not widened.
- The 012 guard was mechanically compared with the 010 function: **exactly the approved `publication_status: published→archived` metadata-loop exception, and no other function-body change**. Published content/identity/snapshot/PDF/digest/claims/revision/photo immutability runs before that exception; publishing protections and authenticated metadata restrictions remain. The existing RLS owner/role/active-account intersections, trigger attachment, Storage guards, private resolver and projection visibility rules remain in force.
- The new verifier pins the normalized complete guard body and security-definer/fixed-search-path attributes. Earlier 011-specific verifier tests deliberately stop before 012; the added archive SQL test runs the full current verifier, migration replay and a weakened-body rejection. Source inspection confirms it tests both report kinds, owner success, parent/foreign/inactive denial, immutable metadata/content, no unarchive/delete, and parent list/detail/PDF/photo invisibility after archival.
- Goal publication uses the existing owned publication contract and 011's generic allowlisted notification trigger. It does not expose source percentages or auto-copy source goal text to parents. No change to clinical source projections or notification payloads was introduced here.

## Evidence and limits

Reviewed the actual diff, module, app integration, 008–012 contracts, selected private Edge helpers, verifier and tests. Used focused local probes for the failing SQL query, real portal error rendering, retained null-contact authorization and missing revoke control, session-version reachability, stale-lease controls, and the exact 010→012 guard comparison. The null-contact authorization probe uses the correct argument order `parent_has_active_access(parent_id,patient_id)`; its observed result is true, independently corroborated by `parent_portal_children()`.

Did not repeat the already-reported passing broad suites solely to repeat them. The report's 131 application tests plus 25 helper/security tests, and the controller's later 179-test aggregate, do not invalidate these targeted failures. The mock's unconstrained ordering illustrates the missing contract coverage directly.

No implementation edits, commits, subagents, network E2E, real data, email, migrations against external environments, merge, push or deployment were performed. Only this requested review report was written. Existing live Auth/SMTP/Storage/Deno/browser release gates remain outstanding for Task 8 after these findings are fixed.

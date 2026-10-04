# Independent Task 8 and whole-branch review

Reviewed head: `a6ececef7e1328e8f1740168d9615044683eceb1` (`codex/parent-portal`). Task 8 comparison: `990e6d7..a6ecece`. Whole-branch comparison: explicit available baseline snapshot `f9f4220..a6ecece`; **ancestry remains UNESTABLISHED in this shallow repository**. This is a source review, not merge or release approval.

## Verdict

- **TASK 8 SPEC: FAIL** — the effective SQL release verifier and release cache identity are incomplete.
- **TASK 8 SECURITY: FAIL** — the verifier accepts demonstrated cross-child disclosure drift; unchanged dependency URLs can omit the reviewed account-retirement fixes in an existing browser cache.
- **TASK 8 QUALITY: FAIL** — existing tests miss these two reproducible release paths.
- **WHOLE BRANCH: REQUEST CHANGES / FAIL** until R1 and R2 are fixed and independently re-reviewed. **One High and one Important finding; no additional Blocker identified.**

The current checked-in projection functions and publication policies do not contain the R1 injected defects. Likewise, the current calendar modules pass the retirement probe. The findings concern verifying and delivering the reviewed implementation, not a claim that its current SQL already discloses other children's data. Prior Task 6/7 fixes remain present; this review does not reopen their corrected source behavior.

## R1 — High: the full read-only release verifier accepts unsafe effective SQL drift

**Locations:** `supabase/verification/verify_parent_portal.sql:6–9`; delegated checks in `supabase/verification/verify_migration.sql:160–171,175–205` (and identity/service-function attribute-only checks at `:102–122,313–322`); regression coverage in `ops/security/parent-portal-rls-contract.test.mjs:23–38`.

The new release entry point advertises the entire effective boundary and exact function bodies, but for all parent projection RPCs the delegated verifier checks only existence, SECURITY DEFINER, search_path and grants. For the new publication-table `specialist_own` policies it checks three contained text fragments, not their complete authorization expressions. Keeping these metadata/tokens while removing authorization is enough to pass the production verification gate. The source audit covers frontend/Edge files, not deployed SQL function/policy definitions, so that separate check does not close this gap. The network synthetic gate runs on a separate disposable target and also does not establish the production database's effective definitions.

**Executed local reproduction A:** initialize the existing PGlite fixture, apply 011 and 012, insert the private bucket, and execute the full new entry point with its included verifier (psql directives removed only for local execution). Baseline passes. Then replace only the body of `parent_portal_goals`, preserving its signature, grants, SECURITY DEFINER and fixed search_path:

```sql
create or replace function public.parent_portal_goals(p_patient_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
begin
  return coalesce((select jsonb_agg(to_jsonb(g)) from public.goals g),'[]'::jsonb);
end; $$;
```

Observed: the **entire read-only entry point still passes**. A parent-A call then returns a child-B raw goal, including private source fields. This is an executable mutation test against actual SQL, not a string-search observation.

**Executed local reproduction B:** in a fresh 008–012 fixture, read the canonical original `qual` for `parent_session_reports.specialist_own`; alter both USING and WITH CHECK to `(<original qual>) OR true`. The expected owner/role/patient fragments remain in the expression. Observed:

```text
UNSAFE_OR_TRUE_POLICY_VERIFIER_PASS
parent A SELECT parent_session_reports ->
[{patient_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  publication_status:"draft",what_did:"UNPUBLISHED_OTHER_CHILD_DRAFT"}]
```

The exact current policy is correct, but the verifier explicitly accepts this unsafe variant. Existing mutation tests exercise the 011 restrictive role policy, Storage and grants, not these exported projection bodies or publication-policy expressions.

**Required correction / minimum boundary:** extend the new Task 8 read-only verifier (or an included release-only assertion file) to verify reviewed, complete security-relevant function definitions and complete publication-table policy expressions/sets, roles, commands and permissive/restrictive attributes. Cover the identity/access helpers, parent projections, internal projection/ownership/selection helpers and service claim/complete/fail/file resolver that implement this boundary; matching names, attributes or contained tokens cannot establish their authorization. Preserve the checks already implemented. Do not rewrite migrations 001–012 or weaken production guards. Add mutation regressions that preserve grants/search_path while removing child authorization, returning private source fields, or adding a broad OR to each relevant publication policy; each must make the full release entry point fail. Retain a positive full-current-schema read-only pass. Update the report/runbook claims to match the actual guarantee.

## R2 — Important: changed calendar security modules reuse baseline browser cache URLs

**Locations:** `app.js:8` imports `./cabinet.js?v=6`; `cabinet.js:2` imports `./schedule-editor.js?v=6`. These are exactly the dependency URLs in baseline `f9f4220`, although both files have changed to add account/root retirement checks. Related cache-parity mismatch: `parent.html:10` requests `styles.css?v=0.169-legal-release` while `index.html:12` requests `styles.css?v=0.171-parent-specialist`; `ops/parent-portal/README.md:99` claims those markers are consistent. The public verification loop in `.github/workflows/deploy-fizira-frontend.yml:115–119` requests a different `?release=<SHA>` URL.

A new version of the importing app does not change the URL/cache identity of its static imported modules. A returning browser with a fresh cached v6 module can load the new app together with the old calendar implementation, which ignores `isCurrent`. Neither the filesystem hash audit nor a fresh `?release=` curl request verifies or invalidates that already cached dependency. The repository supplies no enforced cache-revalidation guarantee that would make reuse impossible. This is a supported cache scenario, not a claim about unobserved production cache headers.

**Executed local reproduction:** load the actual baseline `cabinet.js` from `git show f9f4220:cabinet.js` as the cached v6 module, redirecting only its relative imports for local execution; compare with current `cabinet.js` using Happy DOM. Supply the new caller's `isCurrent:()=>false` option. Baseline performs two source reads and renders; current code performs zero reads and does not render. A second probe starts both modules while current, defers appointment/patient responses, then retires the account/root and resolves an old planned appointment:

```text
baseline-cached-v6: late RPC save_schedule_entries,
  entries=[{id:"old-appointment",patient_id:"old-child",
            status:"completed",note:"OLD_PRIVATE_NOTE",...}]
reviewed-module: late RPCs=[]
```

The baseline module does not repaint the detached root, but it sends the old-account continuation through the shared client after retirement. The backend's SECURITY INVOKER/role/owner protections still apply; this reproduction does **not** claim an unauthorized committed write. It demonstrates that the corrected delayed-action boundary can be absent in the delivered application despite the release hashes passing.

**Required correction:** give both changed calendar modules new cache identities at their actual import sites, and align the parent stylesheet marker with the reviewed index stylesheet. Audit changed transitive frontend dependencies against the baseline so the same defect is not missed elsewhere. Add an executable/static dependency-parity regression proving these modified modules are no longer requested using the baseline URLs; preserve the existing current-module lifecycle behavior tests. Changing only the top-level app marker or public-verification query is insufficient.

## What passed source review

- Parent source denial is effective in the current definitions: 011 restrictive specialist-role intersections cover clinical tables and private Storage without replacing tenant/account/artifact restrictions. Existing parent-only and ordinary-specialist provisioning contracts are consistent: private durable reservation precedes new-parent Auth INSERT, browser metadata grants nothing, acceptance adds parent, and dual roles remain explicitly supported.
- Parent RPCs use explicit safe projection fields and active child/owner checks; file handoffs repeat private authorization and validate digest/format before signing. Current endpoints accept IDs/kinds rather than browser Storage paths or publication content. Signed URL TTL is 300 seconds and current frontend validates trusted HTTPS Storage URLs.
- Publication uses service-only claim/revision CAS, frozen allowlisted author/source metadata, strong ETag equality and conditional source download, fresh immutable artifact names/upsert:false, completion version checks, and digest-checked handoff. Archived objects remain protected and parent-invisible. The 012 change remains the narrow authenticated published-to-archived exception, with content/claim/artifact fields immutable. No new parent direct Storage grant was found.
- Current parent UI fences delayed child/account/file continuations; specialist controls keep scoped ownership, explicit confirmation, safe author fields, null-contact access revocation, reachable session versions and server-controlled expired-lease recovery. Existing current-source account/overlay/profile/calendar fences and role-first root routing remain present. Parent CSS scopes the surface and implements mobile bottom navigation; real browser acceptance remains a release gate.
- Both release manifests include all five parent static files, role-gate, changed cabinet/editor dependencies, the five Edge endpoints, shared helpers, Cyrillic font/license, config and existing AI parity. Frontend workflow applies no migrations and deploys no Edge functions.
- Source audit recognizes reviewed new-file absence only before activation, refuses unknown bytes/missing existing assets, and requires exact head afterward. The workflow's `FIZIRA_EDGE_REQUIRE_HEAD=1` requires exact deployed Edge/helper/font/config bytes before frontend activation; it repeats source preflight before activation. This is not weakened by the legitimate new-frontend-file state.
- Activation checks stage assets, snapshots all prior files and explicit ABSENT states before mutation, uses unique run-id/attempt directories, refuses a completed reused backup, and activates index last. Rollback preflights every live file against before/release bytes, refuses unknown/newer state before mutation, restores existing files and removes only introduced known release files, index last. Single-writer maintenance discipline remains an explicit operational assumption.
- Evidence validation is head/base-bound and rejects missing/false required gate fields before live activation; live source parity is independently executed. The JSON remains an operator attestation, not proof that real Auth/Storage/browser tests ran; the runbook says so.
- The synthetic runner requires exact confirmation plus an isolated-disposable designation, rejects known production hosts, uses unique example.invalid accounts and the agreed fictional child/contact labels. Parent reservations occur before Auth insertion and exact roles are checked. It exercises actual session publication/file handoffs, own and cross-child projections, source/own-prefix Storage denials, specialist CRUD, archival and revocation. It tracks source/generated keys and discovers partial artifacts, uses bounded requests, checks cleanup failures, and explicitly retains immutable consent audit/reservations. No cleanup backdoor weakens these records. A local targeted patient/contact/access cascade probe also succeeded.
- The aggregate npm command includes repository, all shared function, security/release, schedule and AI-evaluation Node test directories with bounded concurrency. Existing Task 8 offline transport tests catch several injected failures. Those mocks do not prove real Storage routes/status/byte ordering, SMTP/Auth or Deno packaging.

## Minor follow-ups and explicit limits

- Prior uppercase UUID and incoming-body deadline follow-ups remain **Minor**: the Edge UUID validator accepts uppercase without canonicalizing it, while some path/media comparisons are case-sensitive; malformed/noncanonical calls can falsely fail. Request-body readers cap size but are not tied to the publication abort timer (invitation handlers also rely on runtime request lifetime). Neither creates a demonstrated cross-user grant. Canonical lowercase app-produced IDs work. Real platform time/resource limits must be checked during runtime validation.
- Runbook `ops/parent-portal/README.md:136` describes HINE as categorical, whereas `parent-domain.mjs` treats HINE as numeric. Correct the checklist wording so browser acceptance checks the intended implementation.
- The new network fixture publishes session reports; initial-PDF behavior is covered locally but still needs the documented live/manual initial-report gate. It does not replace actual create/resend invitation mail delivery or multi-connection races. Several direct-source denials concern empty fixture tables, so they should not be represented as independent populated-row coverage for every source table.

## Evidence and release status

Reviewed the requested task brief, controller constraints, reports/ledger, binding design/Global Constraints, supplied comparison packages and actual implementation files. Independently executed the two full-verifier SQL mutation probes, the current-versus-baseline cached-module probes and the targeted patient/contact/access lifecycle probe. No already-passing broad suite was repeated merely to reproduce the reported count. The implementation report's 202 local tests and controller's fresh aggregate are evidence of those tests, not counterevidence to the targeted failures above.

**Still unexecuted and release-blocking:** actual source ancestry reconciliation; restorable DB/Auth/Storage/config backup and restoration; real production read-only SQL/source audit; real Auth redirect/template/SMTP/recovery; multi-connection invitation and publication races; Storage API/S3/ETag/upload/copy/move/sign/delete behavior and byte ordering; Deno imports/font/config packaging; isolated-target network synthetic gate; manual desktop/mobile specialist and parent acceptance. Local SQL, Happy DOM, mocks and Node syntax do not pass those gates. Passing R1/R2 re-review would establish local implementation readiness only.

No implementation edits, commits, subagents, network E2E, real data/email, external database operations, remote commands, merge, push or deployment were performed. Only this review report was written; the controller's existing `progress.md` changes were left intact.

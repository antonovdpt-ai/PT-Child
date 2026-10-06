# Goal parent synchronization — reviewed release delta

## Root cause

Ordinary Goals wrote clinical goals while the parent RPC read independently edited
parent_goal_publications. There was no synchronization, goal_id uniqueness or
publication timestamp advancement. Session progress also bypassed the parent
editor. The UI reported success without describing parent visibility.

## Resulting behavior

Goals is the only editor. New goals are private by default. Each card shows
progress, criterion/deadline, published/hidden badge and edit/complete/visibility/
delete actions. Save feedback explicitly states whether the parent can see it.
The specialist parent tab is a read-only summary with navigation to Goals.
Parents see only safe title, starting point, criterion, deadline, progress,
status, optional addition and update time, with a refresh action.

Clinical parent_visible is the explicit decision. Migration 013 synchronizes the
safe projection inside the clinical transaction, including session updates.
A unique goal_id index and upsert reuse the same publication. Unpublish preserves
the clinical goal; republish reuses its row; clinical deletion cascades with an
explicit UI confirmation. Both clinical and published updated_at advance.
Captured timestamps reject obsolete goal editor/session progress updates.

| Clinical state | Parent state |
| --- | --- |
| active, progress 0 | new / Новая |
| active, progress 1–99 | in_progress / В работе |
| achieved or progress 100 | achieved / Достигнута, 100% |
| paused | paused / Приостановлена |
| cancelled | cancelled / Отменена |

Existing paused/cancelled states are preserved. Revised remains valid only for
legacy compatibility; synchronization never generates it or asks the specialist
to maintain a second status. Legacy parent descriptions are preserved as
parent_note in the ordinary editor. Existing safe publication content is not
silently expanded at install; its next explicit goal save synchronizes safe
fields. Migration replay does not reset later visibility decisions.

## Verification

Baseline release a5608c54e20cd29832d67c845840a3ba9d55aecb passed 233/233.
Initial added RED tests reproduced absent explicit visibility, stale edited
fields/timestamps/completion and duplicate goal_id acceptance before the fix.
Final aggregate tests: 262/262, no skips. Responsive Chromium tests: 12/12,
including actual Goals and parent Goals at 375,390,430,768,1440px. Inspected 375px
screenshots; long titles wrap and the progress percentage remains on one line.
Syntax checks and git diff --check pass.

Regression coverage includes private creation/edit, explicit publication, full
safe-field synchronization, one row per goal, hide/republish, completion,
delete/cascade, timestamp advancement, stale editor/session versions, atomic
rollback on projection failure, another child's parent, specialist ownership,
clinical SELECT denial, direct publication write denial, revoke and deletion.
Existing report/PDF/photo/invitation/access/security tests pass in the aggregate.
Migration replay, duplicate abort without cleanup, spoofed index abort and
read-only verifier security-drift rejection are tested against actual SQL.

## Independent security review

Independent implementation reviewer found no final blockers. It separately ran
82/82 earlier scoped checks,18/18 optimistic checks and9/9 final editor/verifier
checks; the new read-only verifier returned GOAL_PARENT_SYNC_VERIFIED. Its session
captured-version finding was fixed and retested before signoff.
Parents retain RPC-only clinical isolation. Both goals/dashboard use the same
explicit safe allowlist. Existing access/revoke/account-deletion checks, RLS,
report/file functions and Storage policy definitions remain preserved. Trigger
functions have fixed search_path and no client EXECUTE grants. Authenticated
publication mutation rights are revoked, preventing the old independent editor
from becoming another source of truth. Trusted service_role rights are retained.

Local SQL tests use PGlite real roles/policies. Multi-connection production
PostgreSQL races were not exercised; locks, unique index and transactional upsert
were structurally reviewed. Browser fixtures exercise real renderers with
synthetic inputs, not live mobile production accounts. Production backend
verification and live acceptance remain rollout steps, not claimed completed.

## Production preflight and minimal rollout

Production frontend was verified as 0.175-parent-feedback, matching release
app.js SHA25694ec9f572b62a237cbc98535b69d94f6c27c1c096a63da1eb10ea23fe25db0ba.
User-supplied real read-only console results:15 goals,1 publication,0 duplicate
groups,0 owner mismatches,0 different active titles,1 parent description.
Nothing has been applied to production. Migrations008–012 are unchanged.

1. On the existing database re-run preflight_goal_parent_sync.sql with privileged
   read-only visibility and baseline existing security verification before013.
   Stop on duplicates/ownership mismatch/custom active titles; do not repair data.
2. Apply only20261006_013_goal_parent_sync.sql. It repeats checks under bounded
   locks and rolls back on ambiguity; no new server/staging is needed.
3. Run verify_goal_parent_sync.sql with its definitions include from the same
   directory. This is the post013 fingerprint reference: the unchanged012
   reference intentionally differs for functions replaced by013.
4. Install exactly seven frontend files: app.js,index.html,parent-specialist.js,
   parent.js,parent.html,styles.css,parent.css (marker0.176-goal-sync).
   No Edge Function, Auth, Storage or report/PDF/photo deployment is needed.
5. Execute live acceptance below. No main merge or deployment trigger change is
   part of this commit. Do not run013 or publish frontend until rollout is chosen.

## Manual acceptance

Use synthetic test patients on the existing environment. Create an unchecked
private goal; verify hidden badge, explicit private success message and absence
for its parent. Enable visibility; verify title/baseline/criterion/deadline/
progress. Edit each field and update progress from a session; refresh the parent
view and verify data plus update time. Hide, edit while hidden and republish;
verify one logical publication. Complete and confirm achieved100 on both sides.
Delete a synthetic goal and verify its disappearance from both sides.

Try a stale editor after another tab hides/edits the goal; save must be rejected.
Verify specialist parent summary navigates to the only editor. At all five
widths check cards, form, visibility checkbox, actions and parent goal details.
Confirm another child's parent has no access; revoke access and refresh/re-enter
Goals. Smoke-check invite/accept/revoke, report publication, PDF opening/download
and photo viewing with both specialist and parent. An already open parent page
can contain previously received data until refresh; server calls after revoke
remain denied, and no promise of deleting already delivered browser data is made.

## Exact changed files

- `app.js`
- `docs/superpowers/plans/2026-10-06-goal-parent-sync.md`
- `docs/superpowers/reports/2026-10-06-goal-parent-sync.md`
- `docs/superpowers/reports/2026-10-06-goal-sync-preflight.md`
- `index.html`
- `ops/security/generate-goal-sync-definition-reference.mjs`
- `parent-specialist.js`
- `parent.css`
- `parent.html`
- `parent.js`
- `styles.css`
- `supabase/migrations/20261006_013_goal_parent_sync.sql`
- `supabase/verification/preflight_goal_parent_sync.sql`
- `supabase/verification/verify_goal_parent_sync.sql`
- `supabase/verification/verify_goal_parent_sync_definitions.sql`
- `tests/goal-editor-publication-ui.test.mjs`
- `tests/goal-editor-save.test.mjs`
- `tests/goal-migration-verification.test.mjs`
- `tests/goal-parent-sync.test.mjs`
- `tests/goal-preflight.test.mjs`
- `tests/goal-sync-lifecycle.test.mjs`
- `tests/parent-specialist-ui.test.mjs`
- `tests/parent-ui.test.mjs`
- `tests/responsive.browser.mjs`

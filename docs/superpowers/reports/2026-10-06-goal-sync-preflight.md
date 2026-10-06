# Goal synchronization investigation — preflight resolved

## Source state

Remote release HEAD was verified through GitHub API and a successful git fetch:
`a5608c54e20cd29832d67c845840a3ba9d55aecb` on
`codex/task1-8-saved-20261004`. The existing clean release checkout was
fast-forwarded from `cd068ec`, preserving newer PDF/photo handoff changes.
Git status/diff and worktree inventories were inspected. Historical unrelated
dirty checkouts were left untouched; main was not used as the source.

Production index currently advertises `0.175-parent-feedback`. Downloaded
production app.js and current release app.js both have SHA-256
`94ec9f572b62a237cbc98535b69d94f6c27c1c096a63da1eb10ea23fe25db0ba`.
This establishes frontend app.js parity, not current backend/schema parity.

## Confirmed root cause and scoped audit

- Ordinary Goals writes only goals; the specialist parent tab independently
  writes title/description/status into parent_goal_publications. The parent
  reads the latter through parent_portal_goals.
- Clinical UPDATE does not synchronize parent content, completion or updated_at.
- The current schema accepts multiple publications for the same goal_id.
- Session notes also update clinical progress; synchronizing only the Goals
  editor would leave this path stale.
- Both parent_portal_goals and dashboard embed goal projections; both need an
  explicit field allowlist in an eventual new migration.
- Clinical schema permits paused/cancelled as well as active/achieved. The
  ordinary form writes active unconditionally and only renders active/achieved.
- Existing separately authored parent wording may be intentionally safer than
  clinical wording. Never automatically backfill/overwrite it on the assumption
  that every difference is a stale value.
- The notification trigger currently compares title/description/status only.
  Progress/criterion/deadline notifications need a deliberate rule.
- Deleting a clinical goal currently cascades to its publications. A corrected
  UI must explain this effect and test it.
- Parent Goals remains visually stale while already open; navigation reloads
  data. Authorization after revoke must remain server-enforced regardless of UI.

## Regression evidence before implementation

The untouched release passed 233/233 tests. Added ordinary-form regression failed
because the visibility control was absent. SQL regressions against actual 001–012
failed for clinical edit synchronization, publication updated_at, completion and
accepted duplicate goal_id. Private creation and parent clinical SELECT denial
already passed. No production mutations were used to reproduce the defect.

## Production read-only prerequisite resolved

The existing Timeweb server could not be reached by the cloud browser. The user
provided real administrator console screenshots on 2026-10-06 at 15:55/15:57.
The second screenshot shows an aggregate read-only transaction ending ROLLBACK:
15 clinical goals, 1 publication, zero duplicate goal groups, zero ownership
mismatches, zero different parent titles, 1 description. Clinical statuses are
active13/achieved2, publication new1. Existing indexes cover publication PK(id)
and patient_id; there is no goal_id uniqueness guarantee.

The one existing description must be preserved. Migration 013 carries it into
clinical parent_note, editable only in the ordinary Goals form; existing safe
publication text is not automatically replaced with clinical fields at install.
Re-run preflight_goal_parent_sync.sql with privileged read-only visibility
immediately before rollout. Migration itself repeats ambiguity checks under
locks and aborts instead of repairing duplicates or mismatched active titles.

Independent preparatory reviewer reproduced the defects and confirmed the
aggregate preflight does not expose patient text/identifiers. Final implementation,
verification and rollout scope are recorded in 2026-10-06-goal-parent-sync.md.
Production data, migrations 008–012 and existing access rights were not changed.

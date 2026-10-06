# Goal parent synchronization implementation plan

**Goal:** Make ordinary Goals the sole editor, with explicit private-by-default parent visibility and atomic safe projections.

**Architecture:** Clinical goals store visibility. A database trigger synchronizes one parent-safe row per goal inside the clinical transaction, including session progress updates. Parents retain RPC-only reads, and authenticated clients lose independent publication writes. Existing parent description remains a preserved parent_note editable in the ordinary Goals form; migration does not rewrite its content.

**Scope:** User's supplied goal specification; release branch only, no main merge or production rollout. Production read-only screenshot confirms 15 clinical goals, one publication, zero duplicates/owner mismatches, matching title, one description; two achieved/thirteen active. Recheck immediately before applying 013.

## Tasks

- [x] Verify remote/local/production frontend and reproduce ordinary editor, sync, timestamp, completion and duplicate defects with RED tests.
- [x] Add lifecycle and real-role regressions: explicit visibility, repeat saves, private edits, unpublish/republish, completion, deletion, other child/specialist, revoke and account deletion; migration replay and preflight ambiguity abort.
- [x] Add migration 013: duplicate/owner preconditions, unique goal_id, safe columns, clinical parent_visible default false and existing visibility backfill, normalization/sync triggers, restricted projection writes, parent Goals/dashboard allowlists. Preserve curated description, RLS and report/file handlers.
- [x] Modify actual Goals form/cards/handlers: explicit switch, exact result copy, atomic writes, edit/complete/hide/delete controls, no stale child writes. Replace specialist parent editor with read-only summary/navigation. Render safe details and refresh action for parent Goals.
- [x] Extend browser fixtures to Goals and parent Goals at 375/390/430/768/1440. Run aggregate/security/whitespace/syntax checks and obtain independent security review.
- [x] Commit/push reviewed delta after green checks; stop before rollout. Report files, SHA, migration, exact manual acceptance checks and remaining runtime limitations.

## Review focus

Paused/cancelled goals retain their state; progress 100/achieved normalize together. Existing descriptions remain preserved additions within the single clinical editor. Unique index rejects racing publication inserts. Clinical and publication writes succeed/rollback together. Hidden goals remain hidden on session updates. Parent gets only named safe fields; current revoke/account checks remain intact. Already-open views require an explicit refresh, and detached handlers cannot mutate a different child.

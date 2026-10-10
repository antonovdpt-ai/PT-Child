# Flower release: current SQL verifier correction

This is an audit-only follow-up to `d2a117121990c329c3d052488425af9d78df52b9` on `codex/flower-ui-production-20261009`. It changes no frontend asset, migration, Edge function, server configuration, deploy gate or production database.

## Source-confirmed cause

The normalized `notify_parent_goal_publication()` body MD5 from migration 011 is `14180b7a3d3e55f036d5d50aefe9758b`. Migration 013 has MD5 `5324be33a033703dce16e6bdc1db0714`, matching the operator-confirmed production result. The legacy verifier still expected 011 and omitted `baseline`, `criterion`, `deadline` and `progress` change checks.

The complete parent catalog reference also stopped at 012. It had three stale hashes (`notify_parent_goal_publication`, `parent_portal_goals`, `parent_portal_dashboard`) and did not cover the two new 013 functions (`normalize_goal_completion`, `sync_goal_parent_projection`). It would block immediately after the first literal was corrected.

## Correction and evidence

- The legacy assertion now compares the complete normalized 013 body. There is no allowlist accepting the old 011 notification function.
- The complete reference is generated offline from repository migrations 001–013. Other function hashes, policies, exact attributes/owners/grants and overload rejection remain unchanged. The existing goal-sync reference regenerated without any byte change.
- Both actual read-only SQL entrypoints pass on a disposable 001–013 database. They reject the old 011 body and unknown changes in each added/changed 013 function, and do not change catalog or patient/goal/notification data.
- Historical 011/012 tests retain their reviewed 011 expectation through a TEST ONLY helper; this is never used by the production SQL auditor. Complete current-schema fixtures exercise the release verifier.
- RED regression: 1 PASS / 2 FAIL before the fix; GREEN 3/3 after it. Focused SQL/security/transition tests 28/28 PASS; final full suite 356/356 PASS, no failures/skips/cancellations.
- Independent review found two test-fixture regressions; both were reproduced and corrected before the final green suite.

## Mandatory next preflight

The standalone Timeweb SQL driver must be repinned to this follow-up commit and the five checked source hashes before re-running it. The previous driver pinned to `50758af…` is obsolete. Run only the two existing verification entrypoints with `PGOPTIONS` forcing read-only, `ON_ERROR_STOP`, and READ ONLY/ROLLBACK. Do not apply migrations or repair server functions.

Production SQL PASS has not been established by these local results. Runtime configuration review requires the complete previously collected `/tmp/fizira-runtime-result.json` and router source; screenshots of successful collection are insufficient. Backup verification requires the complete `/tmp/fizira-backup-result.json`, not only directory metadata. Live PDF/Edge and retained isolated-target results, fresh source audit, verified backup/rollback and head-bound release evidence remain separate mandatory gates. Timeweb panel access was unavailable from this environment during this session.

Deploy and main merge remain prohibited until all gates pass and the user separately confirms publication.

# Report export code installation handoff — 2026-10-08

Product source: `13f0e51fcec44f2fc096da3824ff51c84c3aa4e0`.
Production baseline: `f62c07b52469e588524c9d4e471a5e4f46879459`.

Production read-only comparison via GitHub Actions run 37764279728 confirmed 31 expected code paths with eight changed files on baseline and one new module absent. SSH cannot write existing Edge directories or access Docker, including via existing sudo. User opened the existing Timeweb root console and confirmed `id -u` = `0`.

The console installer `ops/release/install-report-export.py` changes exactly nine product files. It downloads only pinned GitHub source bytes and compares SHA256 locally. It rejects unknown files/symlinks, validates the existing functions container's bind mount without reading configuration/environment, backs up code only under `/root/fizira-code-backups`, preserves existing ownership/modes, installs Edge delta first, restarts only the existing functions runtime, waits for running/health status and anonymous gateway responses, installs frontend with index.html last, verifies resulting hashes, and attempts guarded rollback on failure.

No migrations, database operations, production data corrections, Auth/RLS/Storage configuration changes, new permissions, main merge, or new servers. Backup bytes remain on the existing server. Gateway 401/403 responses prove route availability, not an authenticated PDF export; the latter requires a manual owner-session check after installation.

Validation: Python installer safety tests 10/10; application npm test 318/318; 31 manifest digests verified against the exact Git objects. Review identified a premature rollback on transient post-restart gateway failure; reproduced and corrected with bounded readiness retries.

Production installation is pending execution by the user in the root console. Do not infer completion from script preparation or repository publication. Expected script completion marker: `REPORT_EXPORT_CODE_INSTALLED_OK`; final usability still needs opening a saved report and preparing/downloading/sharing its PDF without inviting a parent.

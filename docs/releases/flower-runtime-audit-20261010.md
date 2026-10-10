# Flower release: self-hosted runtime audit follow-up

Frontend candidate remains byte-identical to 50758af34e4e78d48ac1dc92d11f9be3debbc4a3. Only release preparation/checking code changes. No production, Docker, Edge, database or Auth changes are authorized.

## Why config.toml can be absent

The checked-in file contains only local CLI project identity and `functions.generate-parent-report-pdf.static_files` packaging entries. Supabase CLI uses these when bundling; the ordinary self-hosted Compose launches `edge-runtime start --main-service /home/deno/functions/main` with a functions bind mount and environment. The platform Compose/main router are not committed in PT-Child, so their actual bytes and command must be obtained from the VPS.

The deployed-source renderer imports `notoSansRegularBytes` from `font-data.ts` under Deno. It does not read the TTF via Deno.readFile or consume TOML; the filesystem TTF branch is for Node. The font source and license remain in the source-parity manifest. `parent-pdf-brand.ts` is not imported by this candidate.

References (reviewed 2026-10-10):
- https://supabase.com/docs/guides/local-development/cli/config#functions.function_name.static_files
- https://supabase.com/docs/guides/self-hosting/self-hosted-functions
- https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml
- https://github.com/supabase/supabase/blob/master/docker/volumes/functions/main/index.ts

## Equal-strength alternative

Default source audit still requires config.toml exact bytes. If it is physically absent, the alternative requires `ops/release/edge-runtime-profile.json` in the reviewed head. A collector output is not a reviewed profile and is never accepted automatically.

Review the real main router and import-map/config files; confirm that startup and routing do not consume the CLI TOML and that mounted assets/env reach user workers. Retain the actual output, review identity and time. Then populate the profile with `schemaVersion:1`, `status:"reviewed"`, `mode:"self-hosted-bind-mount"`, `sourceBase:<reviewed base>`, `cliConfigPath:<actual audited TOML path>`, `reviewEvidence:<actual retained evidence reference>` and the exact `snapshot` from collection. Commit and review the profile before release. Do not rename the pending template as an approval shortcut.

On every preactivation, immediately-before-activation and postactivation check, the Python verifier reads Docker metadata, Compose hashes and the complete mounted functions tree again. It pins image ID/tag, command, all mounts, every mounted file (including indirect router dependencies and custom per-function import maps), actual VERIFY_JWT/SUPABASE_URL/FIZIRA_ALLOWED_ORIGINS and required key presence. It rejects overlapping mounts, symlinks, unbounded trees, mounted credential files, unsupported startup flags and config-path changes. Only the known unchanged packaging-only TOML digest is eligible for replacement. All other frontend/Edge/font source comparisons remain mandatory and unchanged.

No profile is supplied yet: actual image/command/router/config evidence remains missing. The pending template is deliberately invalid and the source audit still fails on this VPS until genuine evidence is reviewed. Raw Docker environment is withheld; individual metadata strings are checked for known secret values before JSON serialization. Inline credential literals cause router-source withholding. Unknown hardcoded credentials still require private review; do not claim a general-purpose secret scanner guarantee. Metadata collection is not proof of Deno npm resolution, runtime PDF generation, RLS or Storage behavior.

## Gates and next evidence

User attests VPS frontend/Edge hashes match expected sources, functions mount is `/root/supabase-project/volumes/functions -> /home/deno/functions`, Edge/imgproxy are running and TOML is absent. This is operator evidence, not a locally executed server audit. Obtain actual startup snapshot/router source, verify any import maps, and confirm backup manifests/hashes and capacity for the workflow's fresh frontend snapshot. A report-export backup covering only a subset is not a complete Flower rollback snapshot.

Source contracts for PDF `{report_id,report_kind,mode:"export"}` and file handoff are unchanged. Live authenticated/synthetic PDF behavior is not yet attested. Use existing retained isolated runtime results or the existing isolated-disposable gate; do not run its write/cleanup fixture against production or create a new server automatically.

Existing read-only SQL gates remain `supabase/verification/verify_parent_portal.sql` and `verify_goal_parent_sync.sql`. Execute reviewed verifier bytes only; each wraps assertions in READ ONLY and ROLLBACK. Do not rerun migrations 008-012 (or 013). Catalog/parser drift STOPs must be reconciled, not normalized away. No SQL gate is set true without its actual PASS record.

Backup/rollback, reviewed_base_sha, release_evidence validator and activation script are unchanged. A missing external gate remains false. Deployment requires all genuine gates and the user's separate production approval. A tooling follow-up commit changes github.sha, so release_evidence.head must bind to that final reviewed commit rather than the old frontend-only SHA.

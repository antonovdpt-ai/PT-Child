# Fizira Edge cache: staged GitHub Actions review

This branch is based on pinned release `ed6c103578cbfcabe19ab0077e8eeff1305d8b3d` and does **not** merge into `main`.

## Status: prepared, not launched

The workflow is `workflow_dispatch`-only and is **not** on the default branch. GitHub does not accept manual dispatch for this branch-only workflow. Consequently no CI job has been requested or executed by preparing these files. Do not merge to `main` just to make it runnable.

**Activation plan (requires a separate explicit approval):** on this exact branch, add a temporary `push` trigger limited to the branch and changes to `.github/workflows/edge-deno-cache.yml`. Committing that trigger will launch the cache job once. After inspecting the run, remove the `push` trigger with another commit. Never enable `pull_request`, repository-wide triggers, deployment or production secrets. A GitHub Actions run may use CI minutes.

## After approval: what is collected

- GitHub-hosted Ubuntu; the exact reviewed `supabase/functions` source snapshot from `ed6c103`, with SHA ancestry and file-difference gate.
- A transient, limited Linux Docker container using `denoland/deno:2.5.6`, with no privileged mode, Docker socket, local project credentials, or production secrets.
- The seven Edge function entrypoints, shared parent PDF renderer, and explicit public npm PDF dependencies.
- A generated Deno dependency lock file, a Linux `DENO_DIR` cache, the image ID and basic evidence.
- A second resolution of the identical graph using `--cached-only` and `--network none`.
- A short-lived artifact with a tar archive and its SHA-256; inspect archive entries before extraction in WSL. Only move it into the local test environment after verification.

## Strict limitations

A passing workflow **does not prove actual Supabase Edge Runtime v1.76.2 compatibility**. The separate pinned upstream Supabase router and `deno.jsonc` import map from local WSL are not part of the PT-Child release snapshot and have not been included. No Edge handlers are invoked; no PDFs are generated; Auth/RLS/Storage are not retested. The `offline-runtime-review.json` authorization must remain absent or `reviewed=false` until operator-reviewed evidence establishes the actual runtime's import map, runtime image, cache dependencies and isolation.

No production URL, SSH connection, Supabase service role key, real user/patient record, SMTP sender or deployment is involved. The artifact can still contain untrusted public packages: review the module graph and hashes before use. Floating JSR major spec `@2` is resolved at CI time; the generated lock records the selected version and must be reviewed before considering further runs reproducible.

If the CI step fails or times out, do not claim PASS or automatically retry. Diagnose the CI log; the WSL stand remains unchanged.

## Next steps after successful run

1. Verify artifact SHA-256 and inspect the included generated lockfile and summary.
2. Compare the dependency graph and cache format with the actual isolated Linux Edge Runtime and its pinned router/import map. Do not set `reviewed=true` by hand.
3. Only after an additional explicit approval: import the verified cache to WSL, run local Edge with network disabled and then run synthetic PDF flow tests.

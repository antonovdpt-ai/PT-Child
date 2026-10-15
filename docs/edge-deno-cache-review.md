# Fizira Edge cache: staged GitHub Actions review

This branch is based on pinned release `ed6c103578cbfcabe19ab0077e8eeff1305d8b3d` and does **not** merge into `main`.

## Status: second approved run succeeded; offline source-graph cache ready for review

## Initial one-time CI result (2026-10-15)

Run [38748772005](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38748772005) failed at its **offline command-line check**, after successfully downloading the JSR `@supabase/supabase-js@2.118.0` graph and 32 npm packages on the Linux runner. Exact error: `unexpected argument '--cached-only' found`. No archive was published; no PDF or Edge handler executed. The one-time branch-only `push` trigger was removed immediately afterward.

The corrected script used Docker `--network none` and `DENO_NO_REMOTE=1` for offline resolution, without the unsupported CLI flag.

## Second approved CI run (2026-10-15)

Run [38749695300](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38749695300) completed **successfully**. The logs show `PUBLIC_LINUX_CACHE_OFFLINE_PASS` and `EDGE_RUNTIME_REVIEWED=NO`. Both the online fetch and offline resolution steps passed. GitHub published artifact [11979084991](https://github.com/antonovdpt-ai/PT-Child/actions/runs/38749695300/artifacts/11979084991), `fizira-edge-cache-ed6c103-38749695300`, a ZIP of 11,016,458 bytes containing a tar.gz and SHA-256 sidecar. GitHub reports ZIP SHA-256 `9386bae4b60628f33e69aed1aaa584f14fea08ffb560ea5a4f81a7119faf4c47`. Artifact expires 2026-10-18 at approximately 14:15 UTC. Re-validate the SHA-256 after download and separately compare the inner tarball with its checksum before extraction.

The branch-only automatic `push` trigger was removed immediately after this run was registered. No CI rerun is authorized or scheduled. GitHub's `workflow_dispatch` requires the workflow file to exist on the default branch; do **not** merge this workflow to `main` solely to dispatch it.

## After approval: what is collected

- GitHub-hosted Ubuntu; the exact reviewed `supabase/functions` source snapshot from `ed6c103`, with SHA ancestry and file-difference gate.
- A transient, limited Linux Docker container using `denoland/deno:2.5.6`, with no privileged mode, Docker socket, local project credentials, or production secrets.
- The seven Edge function entrypoints, shared parent PDF renderer, and explicit public npm PDF dependencies.
- A generated Deno dependency lock file, a Linux `DENO_DIR` cache, the image ID and basic evidence.
- A second resolution of the identical graph using Docker `--network none` and `DENO_NO_REMOTE=1`.
- A short-lived artifact with a tar archive and its SHA-256; inspect archive entries before extraction in WSL. Only move it into the local test environment after verification.

## Strict limitations

A passing workflow **does not prove actual Supabase Edge Runtime v1.76.2 compatibility**. The separate pinned upstream Supabase router and `deno.jsonc` import map from local WSL are not part of the PT-Child release snapshot and have not been included. No Edge handlers are invoked; no PDFs are generated; Auth/RLS/Storage are not retested. The `offline-runtime-review.json` authorization must remain absent or `reviewed=false` until operator-reviewed evidence establishes the actual runtime's import map, runtime image, cache dependencies and isolation.

No production URL, SSH connection, Supabase service role key, real user/patient record, SMTP sender or deployment is involved. The artifact can still contain untrusted public packages: review the module graph and hashes before use. Floating JSR major spec `@2` is resolved at CI time; the generated lock records the selected version and must be reviewed before considering further runs reproducible.

If the CI step fails or times out, do not claim PASS or automatically retry. Diagnose the CI log; the WSL stand remains unchanged.

## Next steps after successful run

1. Verify artifact SHA-256 and inspect the included generated lockfile and summary.
2. Compare the dependency graph and cache format with the actual isolated Linux Edge Runtime and its pinned router/import map. Do not set `reviewed=true` by hand.
3. Only after an additional explicit approval: import the verified cache to WSL, run local Edge with network disabled and then run synthetic PDF flow tests.

# Self-hosted Edge configuration audit

> Execute natively; preserve the approved Flower frontend and obtain real server evidence before enabling the alternative audit path.

Goal: replace an incorrectly mandatory CLI packaging file with an equally strict check of the actual self-hosted configuration. Production and backend remain unchanged.

Evidence: user reports matching frontend/Edge hashes, a running container and functions bind mount, but no config.toml. Repository config contains only project_id and font static_files; Deno PDF uses embedded font-data.ts. Actual image, startup command, main router and import-map bytes still require inspection.

- [x] Write integration regressions for the absent-config default STOP, an exact reviewed bind-mount profile, and runtime/source drift STOPs.
- [x] Add a read-only Python runtime collector/verifier. A profile must be in reviewed head, explicitly reviewed, and pin image ID, command, every mount, environment values/presence, the full mounted tree and Compose provenance. Pending profiles cannot pass. CLI config contents must remain the known packaging-only schema.
- [x] Integrate the verifier only for physically absent config.toml; retain all other Edge/frontend comparisons and evidence gates. Package its code through the existing workflow.
- [x] Run focused and full tests and review the complete diff. Product/backend bytes equal 50758af; 353/353 tests PASS.
- [ ] Obtain actual server command/image/router/backup outputs and remaining SQL/isolated-runtime PASS records. Review and commit an actual runtime profile; never mark release ready from local tests.

Independent review: two Important findings reproduced RED then fixed GREEN: complete mounted-tree hashing replaces an incomplete dependency allowlist; individual string safety checks precede JSON serialization to avoid escaped-secret leaks. Seven runtime integration tests and complete 353-test suite pass after the fix. No actual server execution was performed. The legacy cache probe also needed a real v8-to-v6 mutation; its previous v7 replacement was a no-op after the candidate commit.

Review focus: profiles made from unreviewed observations; overlapping mounts; wrapper commands or additional config/import maps; symlink/path traversal; accidentally exposing credentials. Exact drift must stop rather than be normalized away.

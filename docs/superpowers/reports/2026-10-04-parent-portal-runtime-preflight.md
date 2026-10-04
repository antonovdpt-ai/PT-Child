# Parent portal runtime preflight — 2026-10-04

## Verified source ancestry

Reviewed local snapshot: `7eb4fd1116a06fc51e39c1e46123e039fba0d480`, branch `codex/parent-portal`; working tree was clean before this documentation update.

Read-only GitHub comparison for `antonovdpt-ai/PT-Child` confirmed:

- Baseline `f9f42204d907195ed04f09cd47f8ad563b2078fb` versus `main`: identical, zero ahead/behind commits.
- Baseline versus remote checkpoint `97aae31d43ed475c306e5835ef513620bac4b20d`: ahead by five, behind by zero; merge base equals the baseline. Changes are limited to `.gitignore`, the approved plan and specification.

Locally, all 21 commit objects from the reviewed snapshot through that checkpoint were read directly, their Git object hashes recomputed and verified, and their single-parent links traversed. Together these checks establish that the reviewed local snapshot descends from the current GitHub main. Shallow metadata and history were not altered. This resolves source ancestry at the checked snapshot; it does not prove that production matches GitHub, authorize integration, or replace a fresh check before release.

## Runtime target availability — BLOCKED

No isolated target URL or credentials are configured in this execution environment. Presence-only checks found none of `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `FIZIRA_PARENT_PORTAL_TARGET` or `FIZIRA_PARENT_PORTAL_E2E_CONFIRM`. No secret values were printed.

Node and SSH are available; Docker, Podman, Deno, Supabase CLI and psql are absent. A disposable backend cannot currently be started locally or selected from the available configuration. No network E2E, live SQL verification, Auth/SMTP, Storage, restoration or staging browser acceptance gate was executed.

Required next input is an identified separate disposable target and a secure configuration path for its server-side environment. Do not paste service credentials into chat. Existing instructions and commands are in [the release runbook](../../../ops/parent-portal/README.md). The fixed invitation redirect also needs staging routing verification before exercising invitations.

## Readiness

All eight planned implementation tasks remain locally complete. Last final aggregate: 211/211 passing with no failures, cancellations or skips; independent final review: PASS, no open High/Important/Blocker findings. No implementation changes or repeated test run were necessary for this read-only preflight.

Production readiness remains blocked on the external runtime and live-source gates described in the runbook. No merge, push, deployment, production mutation, real-data access or external email occurred.

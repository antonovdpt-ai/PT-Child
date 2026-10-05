# Parent UX production deployment Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; independent security review before push.

**Goal:** Deploy only the five reviewed frontend changes using existing Timeweb SSH secrets in GitHub Actions.

**Architecture:** A release-branch-only push trigger packages frontend bytes pinned to `2173a05341d40baa4285732c90a4686a3b189919`. A remote script verifies all 17 live assets against the confirmed production baseline, preserves an additional backup and replaces five files with index.html last. No migrations, Edge deployment, servers, main changes or automatic rollback.

**Tech Stack:** Bash, Node tests, GitHub Actions, existing SSH.

**Spec:** User's production continuation request; `docs/superpowers/reports/2026-10-05-parent-invitation-ux.md`.

## Global Constraints
- Baseline `7566dc412e4918b1ea3f65831e3c9f024545b65a`; frontend release `2173a05341d40baa4285732c90a4686a3b189919`.
- Release branch `codex/task1-8-saved-20261004` only; no main merge.
- Only app.js, parent-specialist.js, styles.css, parent.html and index.html may change on production.
- Existing rollback, data, Auth/Storage/RLS, migrations and Edge Functions remain intact.

## Review Focus
- Unknown production drift stops before mutation.
- Corrupt uploaded files stop before mutation.
- Existing backup directory is never overwritten.
- Already deployed release verifies without mutation.
- Symlinked production or payload files are rejected.

### Task 1: Verified partial activation and workflow

**Files:** Create `ops/release/activate-parent-ux.sh`, two pinned hash manifests, `ops/release/activate-parent-ux.test.mjs`, `.github/workflows/deploy-parent-ux.yml`, and a single release trigger file.

**Interfaces:** Script accepts target, payload and fresh backup directories; manifests live beside script. Emits `PARENT_UX_ACTIVATION_OK` or `PARENT_UX_ALREADY_ACTIVE`; nonzero failure prevents deployment.

- [ ] Write real filesystem tests for exactly five changes, preservation of other bytes/backup, drift, corruption, reused backup, symlinks and idempotence.
- [ ] Run tests and confirm the missing activation behavior fails.
- [ ] Implement script with complete preflight, backup and index-last activation; package pinned bytes in workflow with existing SSH secrets.
- [ ] Run focused tests, full npm suite and responsive suite; syntax/diff checks.
- [ ] Independent security review, resolve blockers, commit/push current release branch.
- [ ] Verify workflow output and all 17 public hashes; continue authenticated UI E2E. Any unavailable Actions credentials or parent signup requiring user input is a concrete blocker, not a successful deployment.

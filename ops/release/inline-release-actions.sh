#!/usr/bin/env bash
# Frontend-only release mode guard for reviewed PR #36.
set -Eeuo pipefail
umask 077
mode="${1:?mode}"
root="$(pwd -P)"
expected_parent="$HOME/.cache/fizira-frontend/releases"
if [[ "$(dirname "$root")" != "$expected_parent" || ! "$(basename "$root")" =~ ^pr36-[0-9]+-[0-9]+$ ]]; then
  echo 'UNEXPECTED_DEPLOYMENT_DIRECTORY_STOP' >&2
  exit 1
fi
live='/root/supabase-project/volumes/proxy/app'
assets='tools/ops/release/frontend-assets.txt'
activator='tools/ops/release/activate-frontend.sh'
snapshot_tool='tools/ops/release/frontend-snapshot.py'
audit_tool='tools/ops/release/inline-release-readonly-audit.py'
test -d stage && test -f "$assets" && test -f "$activator" && test -f "$snapshot_tool"
test -s expected-source-hashes.b64 && test -s release-assets.sha256
case "$mode" in
  preflight)
    FIZIRA_EXPECTED_BASE_HASHES_B64="$(cat expected-source-hashes.b64)" python3 -B "$audit_tool"
    test -w "$live"
    test ! -e backup && test ! -L backup
    echo 'PR36_FINAL_PREACTIVATION_OK'
    ;;
  activate)
    # Snapshot and activation form a single guarded sequence. Snapshot is
    # independently verified BEFORE mutation by frontend-snapshot.py.
    bash "$0" preflight
    bash "$activator" activate "$live" "$root/stage" "$root/backup"
    python3 -B "$snapshot_tool" verify --assets "$assets" --backup "$root/backup"
    test -f backup/complete
    echo 'PR36_LIVE_ACTIVATION_AND_RUN_SNAPSHOT_OK'
    ;;
  verify)
    (cd "$live"; sha256sum -c "$root/release-assets.sha256")
    python3 -B "$snapshot_tool" verify --assets "$assets" --backup "$root/backup"
    echo 'PR36_LIVE_HASHES_AND_BACKUP_OK'
    ;;
  rollback)
    test -f backup/complete
    bash "$activator" rollback "$live" "$root/stage" "$root/backup"
    echo 'PR36_GUARDED_ROLLBACK_OK'
    ;;
  *) echo 'UNKNOWN_RELEASE_ACTION_STOP' >&2; exit 1 ;;
esac

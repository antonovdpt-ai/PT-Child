#!/usr/bin/env bash
# CI prerequisite for the cache audit. This is the reviewed f9f4220 snapshot,
# independent of deploy ancestry/evidence inputs; never substitute current HEAD.
set -euo pipefail
baseline='f9f42204d907195ed04f09cd47f8ad563b2078fb'
if ! git cat-file -e "${baseline}^{commit}" 2>/dev/null; then
  git fetch --no-tags --depth=1 origin "$baseline"
fi
actual="$(git rev-parse --verify "${baseline}^{commit}")"
[[ "$actual" == "$baseline" ]] || { echo 'STOP: reviewed cache baseline mismatch' >&2; exit 1; }
printf 'REVIEWED_PARENT_CACHE_BASELINE_OK %s\n' "$actual"

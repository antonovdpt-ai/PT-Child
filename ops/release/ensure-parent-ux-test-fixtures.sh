#!/usr/bin/env bash
# Historical read-only fixtures required by activate-parent-ux.test.mjs.
# Pin commits; never substitute current HEAD or fetch unreviewed refs.
set -euo pipefail
for sha in \
  '7566dc412e4918b1ea3f65831e3c9f024545b65a' \
  '2173a05341d40baa4285732c90a4686a3b189919'; do
  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    git fetch --no-tags --depth=1 origin "$sha"
  fi
  test "$(git rev-parse --verify "${sha}^{commit}")" = "$sha"
  git cat-file -e "${sha}:ops/release/frontend-assets.txt"
  printf 'PINNED_PARENT_UX_FIXTURE_OK %s\n' "$sha"
done

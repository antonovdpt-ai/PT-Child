#!/usr/bin/env bash
# Immutable source fixtures for existing parent activation tests and the
# schedule browser comparison. Local Git objects only; no production access.
set -euo pipefail
for sha in \
  '7566dc412e4918b1ea3f65831e3c9f024545b65a' \
  '2173a05341d40baa4285732c90a4686a3b189919' \
  '15b9def8c6460af1d54980a3f0e78a660634a5c2'; do
  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    git fetch --no-tags --depth=1 origin "$sha"
  fi
  test "$(git rev-parse --verify "${sha}^{commit}")" = "$sha"
  git cat-file -e "${sha}:ops/release/frontend-assets.txt"
  printf 'PINNED_SCHEDULE_TEST_FIXTURE_OK %s\n' "$sha"
done

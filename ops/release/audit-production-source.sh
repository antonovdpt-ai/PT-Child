#!/usr/bin/env bash
set -Eeuo pipefail

: "${FIZIRA_BASE_SHA:?Set FIZIRA_BASE_SHA to the reviewed main commit}"
: "${FIZIRA_PR_SHA:?Set FIZIRA_PR_SHA to the reviewed pull-request head}"

REPOSITORY="${FIZIRA_REPOSITORY:-antonovdpt-ai/PT-Child}"
PRODUCTION_APP="${FIZIRA_PRODUCTION_APP:-/root/supabase-project/volumes/proxy/app}"
PRODUCTION_FUNCTIONS="${FIZIRA_PRODUCTION_FUNCTIONS:-/root/supabase-project/volumes/functions}"

audit_dir="$(mktemp -d /tmp/fizira-source-audit.XXXXXX)"
trap 'rm -rf "$audit_dir"' EXIT
mkdir -p "$audit_dir/base" "$audit_dir/pr"

curl -fsSL \
  "https://github.com/${REPOSITORY}/archive/${FIZIRA_BASE_SHA}.tar.gz" \
  -o "$audit_dir/base.tar.gz"
curl -fsSL \
  "https://github.com/${REPOSITORY}/archive/${FIZIRA_PR_SHA}.tar.gz" \
  -o "$audit_dir/pr.tar.gz"
tar -xzf "$audit_dir/base.tar.gz" -C "$audit_dir/base" --strip-components=1
tar -xzf "$audit_dir/pr.tar.gz" -C "$audit_dir/pr" --strip-components=1

stop_count=0

compare_file() {
  local label="$1" production_file="$2" repository_file="$3"
  local base_file="$audit_dir/base/$repository_file"
  local pr_file="$audit_dir/pr/$repository_file"
  local production_sha base_sha pr_sha state

  if [[ ! -f "$production_file" ]]; then
    printf '%-42s MISSING_IN_PRODUCTION__STOP\n' "$label"
    stop_count=$((stop_count + 1))
    return
  fi
  if [[ ! -f "$base_file" || ! -f "$pr_file" ]]; then
    printf '%-42s MISSING_IN_REPOSITORY__STOP\n' "$label"
    stop_count=$((stop_count + 1))
    return
  fi

  production_sha="$(sha256sum "$production_file" | cut -d' ' -f1)"
  base_sha="$(sha256sum "$base_file" | cut -d' ' -f1)"
  pr_sha="$(sha256sum "$pr_file" | cut -d' ' -f1)"

  if [[ "$production_sha" == "$base_sha" && "$production_sha" == "$pr_sha" ]]; then
    state="MATCHES_BASE_AND_PR"
  elif [[ "$production_sha" == "$base_sha" ]]; then
    state="MATCHES_MAIN_BASE"
  elif [[ "$production_sha" == "$pr_sha" ]]; then
    state="MATCHES_PR_HEAD"
  else
    state="DIFFERS_FROM_BOTH__STOP"
    stop_count=$((stop_count + 1))
  fi

  printf '%-42s %s\n' "$label" "$state"
  printf '  production=%s\n  main_base=%s\n  pr_head=%s\n' \
    "$production_sha" "$base_sha" "$pr_sha"
}

echo "=== FRONTEND SOURCE AUDIT ==="
for file in index.html app.js cabinet.js styles.css media-fallback.css \
  auth-domain.mjs schedule-domain.mjs schedule-editor.js security-utils.mjs \
  favicon.ico fizira-symbol.png; do
  compare_file "frontend/$file" "$PRODUCTION_APP/$file" "$file"
done

echo "=== EDGE SOURCE AUDIT ==="
compare_file "functions/_shared/ai-helpers.ts" \
  "$PRODUCTION_FUNCTIONS/_shared/ai-helpers.ts" \
  "supabase/functions/_shared/ai-helpers.ts"
compare_file "functions/ptchild-ai/index.ts" \
  "$PRODUCTION_FUNCTIONS/ptchild-ai/index.ts" \
  "supabase/functions/ptchild-ai/index.ts"

echo "=== PUBLIC APP MARKER ==="
curl -fsSL --max-time 20 \
  "https://app.fizira.com/?source-audit=$(date +%s)" \
  -o "$audit_dir/public-index.html"
grep -Eo 'app\.js\?v=[^" ]+' "$audit_dir/public-index.html" | head -n 1 || true

if (( stop_count > 0 )); then
  printf 'SOURCE_AUDIT_STOP mismatches=%d base=%s pr=%s\n' \
    "$stop_count" "$FIZIRA_BASE_SHA" "$FIZIRA_PR_SHA"
  exit 1
fi

printf 'SOURCE_AUDIT_OK base=%s pr=%s\n' "$FIZIRA_BASE_SHA" "$FIZIRA_PR_SHA"

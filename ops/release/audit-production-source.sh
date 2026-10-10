#!/usr/bin/env bash
set -Eeuo pipefail
: "${FIZIRA_BASE_SHA:?Set reviewed main commit}"
: "${FIZIRA_PR_SHA:?Set reviewed release head}"
mode="${FIZIRA_AUDIT_MODE:-preactivation}"
case "$mode" in preactivation|postactivation) ;; *) echo 'Invalid audit mode' >&2; exit 1;; esac
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app="${FIZIRA_PRODUCTION_APP:-/root/supabase-project/volumes/proxy/app}"
functions="${FIZIRA_PRODUCTION_FUNCTIONS:-/root/supabase-project/volumes/functions}"
config="${FIZIRA_PRODUCTION_CONFIG:-/root/supabase-project/supabase/config.toml}"
audit_dir="$(mktemp -d /tmp/fizira-source-audit.XXXXXX)"
trap 'rm -rf -- "$audit_dir"' EXIT
if [[ -n "${FIZIRA_AUDIT_BASE_DIR:-}" || -n "${FIZIRA_AUDIT_HEAD_DIR:-}" ]]; then
 : "${FIZIRA_AUDIT_BASE_DIR:?Both local source directories required}" "${FIZIRA_AUDIT_HEAD_DIR:?Both local source directories required}"
 base="$FIZIRA_AUDIT_BASE_DIR"; head="$FIZIRA_AUDIT_HEAD_DIR"
else
 repository="${FIZIRA_REPOSITORY:-antonovdpt-ai/PT-Child}"
 base="$audit_dir/base"; head="$audit_dir/head"; mkdir -p "$base" "$head"
 curl -fsSL --max-time 60 "https://github.com/$repository/archive/$FIZIRA_BASE_SHA.tar.gz" -o "$audit_dir/base.tar.gz"
 curl -fsSL --max-time 60 "https://github.com/$repository/archive/$FIZIRA_PR_SHA.tar.gz" -o "$audit_dir/head.tar.gz"
 tar -xzf "$audit_dir/base.tar.gz" -C "$base" --strip-components=1
 tar -xzf "$audit_dir/head.tar.gz" -C "$head" --strip-components=1
fi
stop_count=0
compare_file() {
 local label="$1" live="$2" repo="$3" state live_sha='' base_sha='' head_sha='' effective_mode="$mode"
 if [[ "$repo" == supabase/* && "${FIZIRA_EDGE_REQUIRE_HEAD:-0}" == 1 ]]; then effective_mode=postactivation; fi
 if [[ ! -f "$head/$repo" || -L "$head/$repo" || -L "$live" || ( -e "$live" && ! -f "$live" ) ]]; then state=INVALID_ASSET__STOP
 else
  head_sha="$(sha256sum "$head/$repo" | cut -d' ' -f1)"
  if [[ -f "$base/$repo" ]]; then base_sha="$(sha256sum "$base/$repo" | cut -d' ' -f1)"; fi
  if [[ -f "$live" ]]; then live_sha="$(sha256sum "$live" | cut -d' ' -f1)"; fi
  if [[ "$live_sha" == "$head_sha" ]]; then state=MATCHES_PR_HEAD
  elif [[ "$effective_mode" == preactivation && -z "$base_sha" && -z "$live_sha" ]]; then state=APPROVED_NEW_ASSET_ABSENT
  elif [[ "$effective_mode" == preactivation && -n "$base_sha" && "$live_sha" == "$base_sha" ]]; then state=MATCHES_MAIN_BASE
  elif [[ -z "$live_sha" ]]; then state=MISSING_EXISTING_OR_HEAD__STOP
  else state=UNKNOWN_LIVE__STOP; fi
 fi
 printf '%-64s %s\n  live=%s base=%s head=%s\n' "$label" "$state" "$live_sha" "$base_sha" "$head_sha"
 if [[ "$state" == *__STOP ]]; then stop_count=$((stop_count+1)); fi
}
while IFS= read -r file; do [[ -z "$file" ]] || compare_file "frontend/$file" "$app/$file" "$file"; done < "$script_dir/frontend-assets.txt"
while IFS= read -r file; do
 [[ -n "$file" ]] || continue
 if [[ "$file" == config.toml ]]; then
  live="$config"
  # CLI static_files is not consumed by a direct self-hosted bind-mount runtime.
  # Its alternative is enabled only by a reviewed, commit-bound exact profile.
  if [[ ! -e "$live" && ! -L "$live" && -f "$head/ops/release/edge-runtime-profile.json" ]]; then
   if python3 -B "$script_dir/edge-runtime-audit.py" --functions "$functions" \
      --config "$config" --profile "$head/ops/release/edge-runtime-profile.json" \
      --base "$FIZIRA_BASE_SHA" --base-dir "$base" --head-dir "$head"; then
    continue
   else
    stop_count=$((stop_count+1)); continue
   fi
  fi
 else live="$functions/${file#functions/}"; fi
 compare_file "supabase/$file" "$live" "supabase/$file"
done < "$script_dir/edge-assets.txt"
if [[ "${FIZIRA_AUDIT_SKIP_PUBLIC:-0}" != 1 ]]; then
 curl -fsSL --max-time 20 "https://app.fizira.com/?source-audit=$(date +%s)" -o "$audit_dir/public-index.html"
 grep -Eo 'app\.js\?v=[^" ]+' "$audit_dir/public-index.html" | head -n1
fi
if ((stop_count)); then printf 'SOURCE_AUDIT_STOP mismatches=%d mode=%s base=%s pr=%s\n' "$stop_count" "$mode" "$FIZIRA_BASE_SHA" "$FIZIRA_PR_SHA"; exit 1; fi
printf 'SOURCE_AUDIT_OK mode=%s base=%s pr=%s\n' "$mode" "$FIZIRA_BASE_SHA" "$FIZIRA_PR_SHA"

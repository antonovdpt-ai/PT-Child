#!/usr/bin/env bash
set -Eeuo pipefail

# Public static files only; no protected API requests.
: "${FIZIRA_BASE_SHA:?Required main SHA}"
case "$FIZIRA_BASE_SHA" in
  *[!a-fA-F0-9]*|'') echo "Invalid SHA" >&2; exit 2 ;;
esac
[[ "${#FIZIRA_BASE_SHA}" == 40 ]] || exit 2
APP_ORIGIN="https://app.fizira.com"
RAW="https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/$FIZIRA_BASE_SHA"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
assets=( index.html app.js cabinet.js styles.css media-fallback.css
  auth-domain.mjs schedule-domain.mjs schedule-editor.js
  security-utils.mjs favicon.ico fizira-symbol.png )
stops=0
for asset in "${assets[@]}"; do
  src="$tmp/main-$asset"
  live="$tmp/live-$asset"
  if ! curl -fsSL --retry 2 --connect-timeout 10 --max-time 30 "$RAW/$asset" -o "$src"; then
    echo "$asset SOURCE_UNAVAILABLE__STOP"
    stops=$((stops+1))
    continue
  fi
  if [[ "$asset" == "index.html" ]]; then
    url="$APP_ORIGIN/?pwa-preflight=$FIZIRA_BASE_SHA"
  else
    url="$APP_ORIGIN/$asset?pwa-preflight=$FIZIRA_BASE_SHA"
  fi
  if ! curl -fsSL --retry 2 --connect-timeout 10 --max-time 30 "$url" -o "$live"; then
    echo "$asset PRODUCTION_UNAVAILABLE__STOP"
    stops=$((stops+1))
    continue
  fi
  if cmp -s "$src" "$live"; then
    echo "$asset MATCHES_MAIN_BASE"
  else
    echo "$asset DIFFERS_FROM_MAIN__STOP"
    echo "  main $(sha256sum "$src" | cut -d' ' -f1)"
    echo "  live $(sha256sum "$live" | cut -d' ' -f1)"
    stops=$((stops+1))
  fi
done
if (( stops )); then
  echo "FIZIRA_PWA_DEPLOY_BLOCKED mismatches=$stops"
  exit 1
fi
echo "FIZIRA_PWA_DEPLOY_PREFLIGHT_OK assets=${#assets[@]}"

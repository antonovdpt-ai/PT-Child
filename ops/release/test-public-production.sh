#!/usr/bin/env bash
set -Eeuo pipefail

APP_ORIGIN="${FIZIRA_APP_ORIGIN:-https://app.fizira.com}"
AUTH_ORIGIN="${FIZIRA_AUTH_ORIGIN:-https://auth.fizira.com}"
AI_PATH="/functions/v1/ptchild-ai"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT HUP INT TERM

curl_ok() {
  curl --fail --silent --show-error \
    --connect-timeout 10 --max-time 30 \
    --retry 3 --retry-delay 2 --retry-all-errors \
    "$@"
}

assets=(
  app.js
  cabinet.js
  styles.css
  media-fallback.css
  auth-domain.mjs
  schedule-domain.mjs
  schedule-editor.js
  security-utils.mjs
  favicon.ico
  fizira-symbol.png
)

curl_ok "$APP_ORIGIN/?production-smoke=$(date +%s)" -o "$tmp_dir/index.html"
expected_marker="$(grep -Eo 'app\.js\?v=[^\"]+' index.html | head -n 1)"
[[ -n "$expected_marker" ]]
grep -F "$expected_marker" "$tmp_dir/index.html" >/dev/null

for asset in "${assets[@]}"; do
  curl_ok "$APP_ORIGIN/$asset?production-smoke=$(date +%s)" -o "$tmp_dir/$asset"
  cmp --silent "$asset" "$tmp_dir/$asset" || {
    echo "ERROR: production asset differs from repository: $asset" >&2
    exit 1
  }
done

if grep -Eiq 'https://[^/]+\.supabase\.co' \
  "$tmp_dir/app.js" "$tmp_dir/cabinet.js" "$tmp_dir/"*.mjs; then
  echo "ERROR: deployed frontend still references a managed Supabase origin" >&2
  exit 1
fi
grep -F 'https://auth.fizira.com' "$tmp_dir/app.js" >/dev/null

auth_status="$(curl --silent --show-error --output "$tmp_dir/auth-health.json" \
  --write-out '%{http_code}' --connect-timeout 10 --max-time 30 \
  "$AUTH_ORIGIN/auth/v1/health")"
[[ "$auth_status" == "200" ]] || {
  echo "ERROR: Auth health returned HTTP $auth_status" >&2
  exit 1
}

preflight_status="$(curl --silent --show-error \
  --dump-header "$tmp_dir/preflight.headers" --output "$tmp_dir/preflight.body" \
  --write-out '%{http_code}' --connect-timeout 10 --max-time 30 \
  -X OPTIONS \
  -H "Origin: $APP_ORIGIN" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization, content-type' \
  "$AUTH_ORIGIN$AI_PATH")"
[[ "$preflight_status" == "200" || "$preflight_status" == "204" ]] || {
  echo "ERROR: AI preflight returned HTTP $preflight_status" >&2
  exit 1
}
tr -d '\r' < "$tmp_dir/preflight.headers" \
  | grep -Fqi "access-control-allow-origin: $APP_ORIGIN"

unauthorized_status="$(curl --silent --show-error \
  --output "$tmp_dir/ai-unauthorized.json" --write-out '%{http_code}' \
  --connect-timeout 10 --max-time 30 \
  -X POST \
  -H "Origin: $APP_ORIGIN" \
  -H 'Content-Type: application/json' \
  --data '{"operation":"patient_analysis","patient_id":"00000000-0000-4000-8000-000000000000"}' \
  "$AUTH_ORIGIN$AI_PATH")"
[[ "$unauthorized_status" == "401" ]] || {
  echo "ERROR: unauthenticated AI request returned HTTP $unauthorized_status, expected 401" >&2
  exit 1
}

printf 'PUBLIC_PRODUCTION_SMOKE_OK marker=%s assets=%s auth=%s preflight=%s ai_unauthorized=%s\n' \
  "$expected_marker" "${#assets[@]}" "$auth_status" "$preflight_status" "$unauthorized_status"

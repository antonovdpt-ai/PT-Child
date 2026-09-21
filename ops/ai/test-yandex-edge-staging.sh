#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/root/supabase-project"
PUBLIC_URL="https://auth.fizira.com"
TMP_DIR="$(mktemp -d)"
TEST_EMAIL="fizira-ai-test-$(date -u +%s)@example.com"
TEST_PASSWORD="$(openssl rand -base64 32 | tr -d '\n')"
TEST_USER_ID=""

cleanup() {
  if [[ -n "${TEST_USER_ID}" && -n "${SERVICE_ROLE_KEY:-}" ]]; then
    curl -sS --max-time 30 \
      -X DELETE \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      "${PUBLIC_URL}/auth/v1/admin/users/${TEST_USER_ID}" \
      >/dev/null || true
  fi
  rm -rf -- "${TMP_DIR}"
}
trap cleanup EXIT

[[ "$(id -u)" == "0" ]] || { echo "ERROR: run as root" >&2; exit 1; }
[[ -f "${PROJECT_ROOT}/.env" ]] || { echo "ERROR: .env not found" >&2; exit 1; }

mapfile -t env_values < <(python3 - "${PROJECT_ROOT}/.env" <<'PY'
from pathlib import Path
import sys

wanted = ("ANON_KEY", "SERVICE_ROLE_KEY")
values = {}
for raw_line in Path(sys.argv[1]).read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip()
    if key not in wanted:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    values[key] = value

for key in wanted:
    print(values.get(key, ""))
PY
)
ANON_KEY="${env_values[0]:-}"
SERVICE_ROLE_KEY="${env_values[1]:-}"

: "${ANON_KEY:?ANON_KEY is missing}"
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY is missing}"

python3 - "${TEST_EMAIL}" "${TEST_PASSWORD}" > "${TMP_DIR}/create-user.json" <<'PY'
import json
import sys
print(json.dumps({
    "email": sys.argv[1],
    "password": sys.argv[2],
    "email_confirm": True,
}))
PY

create_status="$(curl -sS --max-time 30 \
  -o "${TMP_DIR}/create-user.response" \
  -w '%{http_code}' \
  -X POST \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H 'Content-Type: application/json' \
  --data-binary "@${TMP_DIR}/create-user.json" \
  "${PUBLIC_URL}/auth/v1/admin/users")"
[[ "${create_status}" == "200" || "${create_status}" == "201" ]] || {
  echo "ERROR: temporary user creation returned HTTP ${create_status}" >&2
  exit 1
}

TEST_USER_ID="$(python3 - "${TMP_DIR}/create-user.response" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    print(json.load(source).get("id", ""))
PY
)"
[[ -n "${TEST_USER_ID}" ]] || { echo "ERROR: temporary user id is missing" >&2; exit 1; }

python3 - "${TEST_EMAIL}" "${TEST_PASSWORD}" > "${TMP_DIR}/login.json" <<'PY'
import json
import sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))
PY

login_status="$(curl -sS --max-time 30 \
  -o "${TMP_DIR}/login.response" \
  -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H 'Content-Type: application/json' \
  --data-binary "@${TMP_DIR}/login.json" \
  "${PUBLIC_URL}/auth/v1/token?grant_type=password")"
[[ "${login_status}" == "200" ]] || {
  echo "ERROR: temporary user login returned HTTP ${login_status}" >&2
  exit 1
}

ACCESS_TOKEN="$(python3 - "${TMP_DIR}/login.response" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    print(json.load(source).get("access_token", ""))
PY
)"
[[ -n "${ACCESS_TOKEN}" ]] || { echo "ERROR: access token is missing" >&2; exit 1; }

python3 > "${TMP_DIR}/request.json" <<'PY'
import json
print(json.dumps({
    "prompt": (
        "Синтетический тест. Ребёнок без имени прошёл 10 метров самостоятельно, "
        "затем в другой записи указано, что он ходит только с поддержкой. "
        "Назови только подтверждённые факты и противоречие. Не ставь диагноз."
    ),
    "files": [],
}, ensure_ascii=False))
PY

function_status="$(curl -sS --max-time 120 \
  -o "${TMP_DIR}/function.response" \
  -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'Origin: https://app.fizira.com' \
  -H 'Content-Type: application/json' \
  --data-binary "@${TMP_DIR}/request.json" \
  "${PUBLIC_URL}/functions/v1/ptchild-ai")"

if [[ "${function_status}" != "200" ]]; then
  echo "ERROR: ptchild-ai returned HTTP ${function_status}" >&2
  docker compose -f "${PROJECT_ROOT}/docker-compose.yml" \
    -f "${PROJECT_ROOT}/docker-compose.caddy.yml" \
    -f "${PROJECT_ROOT}/docker-compose.yandex-ai.yml" \
    logs --tail 80 functions >&2 || true
  exit 1
fi

python3 - "${TMP_DIR}/function.response" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    payload = json.load(source)
text = payload.get("text")
if not isinstance(text, str) or not text.strip():
    raise SystemExit("ERROR: ptchild-ai returned no text")
compact = " ".join(text.split())
print("AI_SYNTHETIC_EDGE_TEST_OK")
print("function_http=200")
print("response_preview=" + compact[:300])
PY

delete_status="$(curl -sS --max-time 30 \
  -o /dev/null \
  -w '%{http_code}' \
  -X DELETE \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  "${PUBLIC_URL}/auth/v1/admin/users/${TEST_USER_ID}")"
[[ "${delete_status}" == "200" || "${delete_status}" == "204" ]] || {
  echo "ERROR: temporary user cleanup returned HTTP ${delete_status}" >&2
  exit 1
}
TEST_USER_ID=""
echo "temporary_user_deleted=yes"

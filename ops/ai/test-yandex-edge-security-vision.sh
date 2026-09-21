#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/root/supabase-project"
PUBLIC_URL="https://auth.fizira.com"
TMP_DIR="$(mktemp -d)"
STAMP="$(date -u +%s)"
EMAIL_A="fizira-ai-isolation-a-${STAMP}@example.com"
EMAIL_B="fizira-ai-isolation-b-${STAMP}@example.com"
PASSWORD_A="$(openssl rand -base64 32 | tr -d '\n')"
PASSWORD_B="$(openssl rand -base64 32 | tr -d '\n')"
USER_A_ID=""
USER_B_ID=""
TOKEN_A=""
TOKEN_B=""
PATIENT_B_ID=""
STORAGE_PATH_B=""

json_file() {
  local target="$1"
  shift
  python3 - "${target}" "$@" <<'PY'
import json
import sys
target, *pairs = sys.argv[1:]
payload = dict(pair.split("=", 1) for pair in pairs)
with open(target, "w") as output:
    json.dump(payload, output, ensure_ascii=False)
PY
}

cleanup() {
  set +e
  if [[ -n "${STORAGE_PATH_B}" && -n "${SERVICE_ROLE_KEY:-}" ]]; then
    python3 - "${TMP_DIR}/remove-storage.json" "${STORAGE_PATH_B}" <<'PY'
import json
import sys
with open(sys.argv[1], "w") as output:
    json.dump({"prefixes": [sys.argv[2]]}, output)
PY
    curl -sS --max-time 30 -o /dev/null \
      -X DELETE \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H 'Content-Type: application/json' \
      --data-binary "@${TMP_DIR}/remove-storage.json" \
      "${PUBLIC_URL}/storage/v1/object/patient-media"
  fi
  if [[ -n "${PATIENT_B_ID}" && -n "${SERVICE_ROLE_KEY:-}" ]]; then
    curl -sS --max-time 30 -o /dev/null \
      -X DELETE \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      "${PUBLIC_URL}/rest/v1/patients?id=eq.${PATIENT_B_ID}"
  fi
  for user_id in "${USER_A_ID}" "${USER_B_ID}"; do
    if [[ -n "${user_id}" && -n "${SERVICE_ROLE_KEY:-}" ]]; then
      curl -sS --max-time 30 -o /dev/null \
        -X DELETE \
        -H "apikey: ${SERVICE_ROLE_KEY}" \
        -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
        "${PUBLIC_URL}/auth/v1/admin/users/${user_id}"
    fi
  done
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

create_user() {
  local email="$1" password="$2" response_file="$3"
  json_file "${TMP_DIR}/create-user.json" "email=${email}" "password=${password}"
  python3 - "${TMP_DIR}/create-user.json" <<'PY'
import json
import sys
path = sys.argv[1]
with open(path) as source:
    payload = json.load(source)
payload["email_confirm"] = True
with open(path, "w") as output:
    json.dump(payload, output)
PY
  local status
  status="$(curl -sS --max-time 30 -o "${response_file}" -w '%{http_code}' \
    -X POST \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H 'Content-Type: application/json' \
    --data-binary "@${TMP_DIR}/create-user.json" \
    "${PUBLIC_URL}/auth/v1/admin/users")"
  [[ "${status}" == "200" || "${status}" == "201" ]] || {
    echo "ERROR: temporary user creation returned HTTP ${status}" >&2
    exit 1
  }
}

login_user() {
  local email="$1" password="$2" response_file="$3"
  json_file "${TMP_DIR}/login.json" "email=${email}" "password=${password}"
  local status
  status="$(curl -sS --max-time 30 -o "${response_file}" -w '%{http_code}' \
    -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H 'Content-Type: application/json' \
    --data-binary "@${TMP_DIR}/login.json" \
    "${PUBLIC_URL}/auth/v1/token?grant_type=password")"
  [[ "${status}" == "200" ]] || {
    echo "ERROR: temporary user login returned HTTP ${status}" >&2
    exit 1
  }
}

json_value() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    payload = json.load(source)
for part in sys.argv[2].split("."):
    if part.isdigit():
        payload = payload[int(part)]
    else:
        payload = payload.get(part, "")
print(payload if isinstance(payload, str) else "")
PY
}

create_user "${EMAIL_A}" "${PASSWORD_A}" "${TMP_DIR}/user-a.json"
USER_A_ID="$(json_value "${TMP_DIR}/user-a.json" id)"
[[ -n "${USER_A_ID}" ]] || { echo "ERROR: user A id is missing" >&2; exit 1; }

create_user "${EMAIL_B}" "${PASSWORD_B}" "${TMP_DIR}/user-b.json"
USER_B_ID="$(json_value "${TMP_DIR}/user-b.json" id)"
[[ -n "${USER_B_ID}" ]] || { echo "ERROR: user B id is missing" >&2; exit 1; }

login_user "${EMAIL_A}" "${PASSWORD_A}" "${TMP_DIR}/login-a.json"
TOKEN_A="$(json_value "${TMP_DIR}/login-a.json" access_token)"
[[ -n "${TOKEN_A}" ]] || { echo "ERROR: user A token is missing" >&2; exit 1; }

login_user "${EMAIL_B}" "${PASSWORD_B}" "${TMP_DIR}/login-b.json"
TOKEN_B="$(json_value "${TMP_DIR}/login-b.json" access_token)"
[[ -n "${TOKEN_B}" ]] || { echo "ERROR: user B token is missing" >&2; exit 1; }

python3 - "${TMP_DIR}/patient.json" "${USER_B_ID}" <<'PY'
import json
import sys
with open(sys.argv[1], "w") as output:
    json.dump({
        "therapist_id": sys.argv[2],
        "display_name": "SYNTHETIC VISION TEST",
        "sex": "unspecified",
        "primary_complaint": "Synthetic test data only",
    }, output)
PY
patient_status="$(curl -sS --max-time 30 -o "${TMP_DIR}/patient.response" -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_B}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  --data-binary "@${TMP_DIR}/patient.json" \
  "${PUBLIC_URL}/rest/v1/patients")"
[[ "${patient_status}" == "201" ]] || { echo "ERROR: synthetic patient creation returned HTTP ${patient_status}" >&2; exit 1; }
PATIENT_B_ID="$(json_value "${TMP_DIR}/patient.response" 0.id)"
[[ -n "${PATIENT_B_ID}" ]] || { echo "ERROR: synthetic patient id is missing" >&2; exit 1; }

FOREIGN_PREFIX_PATH="${USER_B_ID}/${PATIENT_B_ID}/not-owned-by-a.png"
python3 - "${TMP_DIR}/prefix-request.json" "${FOREIGN_PREFIX_PATH}" <<'PY'
import json
import sys
with open(sys.argv[1], "w") as output:
    json.dump({
        "prompt": "Synthetic prefix-isolation test. This request must be rejected before any AI call.",
        "files": [{"storage_path": sys.argv[2]}],
    }, output)
PY
prefix_status="$(curl -sS --max-time 60 -o "${TMP_DIR}/prefix.response" -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_A}" \
  -H 'Origin: https://app.fizira.com' \
  -H 'Content-Type: application/json' \
  --data-binary "@${TMP_DIR}/prefix-request.json" \
  "${PUBLIC_URL}/functions/v1/ptchild-ai")"
[[ "${prefix_status}" == "400" ]] || {
  echo "ERROR: foreign user prefix returned HTTP ${prefix_status}, expected 400" >&2
  exit 1
}
python3 - "${TMP_DIR}/prefix.response" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    payload = json.load(source)
if payload.get("error") != "Invalid file selection":
    raise SystemExit("ERROR: foreign user prefix was not rejected by path validation")
PY

FORGED_PATH="${USER_A_ID}/${PATIENT_B_ID}/forged-owned-by-b.png"
python3 - "${TMP_DIR}/forged-media.json" "${PATIENT_B_ID}" "${USER_B_ID}" "${FORGED_PATH}" <<'PY'
import json
import sys
with open(sys.argv[1], "w") as output:
    json.dump({
        "patient_id": sys.argv[2],
        "therapist_id": sys.argv[3],
        "storage_path": sys.argv[4],
        "media_type": "photo",
        "category": "other",
        "note": "Synthetic isolation test",
    }, output)
PY
forged_status="$(curl -sS --max-time 30 -o "${TMP_DIR}/forged-media.response" -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_B}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=minimal' \
  --data-binary "@${TMP_DIR}/forged-media.json" \
  "${PUBLIC_URL}/rest/v1/patient_media")"
[[ "${forged_status}" == "201" ]] || { echo "ERROR: isolation fixture creation returned HTTP ${forged_status}" >&2; exit 1; }

python3 - "${TMP_DIR}/isolation-request.json" "${FORGED_PATH}" <<'PY'
import json
import sys
with open(sys.argv[1], "w") as output:
    json.dump({
        "prompt": "Synthetic isolation test. This request must be rejected before any AI call.",
        "files": [{"storage_path": sys.argv[2]}],
    }, output)
PY
isolation_status="$(curl -sS --max-time 60 -o "${TMP_DIR}/isolation.response" -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_A}" \
  -H 'Origin: https://app.fizira.com' \
  -H 'Content-Type: application/json' \
  --data-binary "@${TMP_DIR}/isolation-request.json" \
  "${PUBLIC_URL}/functions/v1/ptchild-ai")"
[[ "${isolation_status}" == "403" ]] || {
  echo "ERROR: cross-user path returned HTTP ${isolation_status}, expected 403" >&2
  exit 1
}
python3 - "${TMP_DIR}/isolation.response" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    payload = json.load(source)
if payload.get("error") != "A selected file is unavailable":
    raise SystemExit("ERROR: cross-user rejection did not occur at the RLS verification step")
PY

python3 - "${TMP_DIR}/synthetic.png" <<'PY'
import struct
import sys
import zlib

width = height = 128
rows = []
for y in range(height):
    row = bytearray([0])
    for x in range(width):
        inside = 32 <= x < 96 and 32 <= y < 96
        row.extend((220, 35, 35) if inside else (30, 90, 200))
    rows.append(bytes(row))

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
png += chunk(b"IEND", b"")
with open(sys.argv[1], "wb") as output:
    output.write(png)
PY

STORAGE_PATH_B="${USER_B_ID}/${PATIENT_B_ID}/synthetic-vision.png"
upload_status="$(curl -sS --max-time 60 -o "${TMP_DIR}/upload.response" -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_B}" \
  -H 'Content-Type: image/png' \
  -H 'x-upsert: false' \
  --data-binary "@${TMP_DIR}/synthetic.png" \
  "${PUBLIC_URL}/storage/v1/object/patient-media/${STORAGE_PATH_B}")"
[[ "${upload_status}" == "200" ]] || { echo "ERROR: synthetic image upload returned HTTP ${upload_status}" >&2; exit 1; }

python3 - "${TMP_DIR}/media.json" "${PATIENT_B_ID}" "${USER_B_ID}" "${STORAGE_PATH_B}" <<'PY'
import json
import sys
with open(sys.argv[1], "w") as output:
    json.dump({
        "patient_id": sys.argv[2],
        "therapist_id": sys.argv[3],
        "storage_path": sys.argv[4],
        "media_type": "photo",
        "category": "other",
        "note": "Synthetic red square on blue background",
    }, output)
PY
media_status="$(curl -sS --max-time 30 -o "${TMP_DIR}/media.response" -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_B}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=minimal' \
  --data-binary "@${TMP_DIR}/media.json" \
  "${PUBLIC_URL}/rest/v1/patient_media")"
[[ "${media_status}" == "201" ]] || { echo "ERROR: synthetic media row creation returned HTTP ${media_status}" >&2; exit 1; }

python3 - "${TMP_DIR}/vision-request.json" "${STORAGE_PATH_B}" <<'PY'
import json
import sys
with open(sys.argv[1], "w") as output:
    json.dump({
        "prompt": (
            "Синтетический тест изображения. Опиши только основные цвета и геометрическую форму. "
            "Не делай медицинских выводов."
        ),
        "files": [{"storage_path": sys.argv[2]}],
    }, output, ensure_ascii=False)
PY
vision_status="$(curl -sS --max-time 180 -o "${TMP_DIR}/vision.response" -w '%{http_code}' \
  -X POST \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_B}" \
  -H 'Origin: https://app.fizira.com' \
  -H 'Content-Type: application/json' \
  --data-binary "@${TMP_DIR}/vision-request.json" \
  "${PUBLIC_URL}/functions/v1/ptchild-ai")"
[[ "${vision_status}" == "200" ]] || {
  echo "ERROR: synthetic vision request returned HTTP ${vision_status}" >&2
  python3 - "${TMP_DIR}/vision.response" <<'PY' >&2
import json
import sys
try:
    with open(sys.argv[1]) as source:
        payload = json.load(source)
    print("provider_error=" + str(payload.get("error", "unknown error")))
except Exception:
    print("provider_error=unreadable response")
PY
  cd "${PROJECT_ROOT}"
  docker compose logs --tail 80 functions >&2 || true
  exit 1
}

python3 - "${TMP_DIR}/vision.response" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    payload = json.load(source)
text = payload.get("text")
if not isinstance(text, str) or not text.strip():
    raise SystemExit("ERROR: vision request returned no text")
compact = " ".join(text.split())
print("AI_EDGE_SECURITY_VISION_TEST_OK")
print("foreign_user_prefix_http=400")
print("cross_user_path_http=403")
print("vision_http=200")
print("vision_preview=" + compact[:300])
PY

cleanup
trap - EXIT
echo "temporary_data_deleted=yes"

#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${FIZIRA_PROJECT_ROOT:-/root/supabase-project}"
PUBLIC_URL="${FIZIRA_PUBLIC_URL:-https://auth.fizira.com}"
WORKER_SECRET_FILE="${FIZIRA_DELETION_SECRET_FILE:-/etc/fizira/account-deletion-worker-secret}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf -- "${TMP_DIR}"
}
trap cleanup EXIT

[[ -r "${PROJECT_ROOT}/.env" ]] || {
  echo "ERROR: Supabase .env is unavailable" >&2
  exit 1
}
[[ -s "${WORKER_SECRET_FILE}" ]] || {
  echo "ERROR: deletion worker secret is unavailable" >&2
  exit 1
}
[[ "$(stat -c '%a:%U:%G' "${WORKER_SECRET_FILE}")" == "600:root:root" ]] || {
  echo "ERROR: deletion worker secret permissions must be 600:root:root" >&2
  exit 1
}

service_role_key="$(python3 - "${PROJECT_ROOT}/.env" <<'PY'
from pathlib import Path
import sys

for line in Path(sys.argv[1]).read_text().splitlines():
    if line.startswith("SERVICE_ROLE_KEY="):
        print(line.split("=", 1)[1].strip())
        break
else:
    raise SystemExit("SERVICE_ROLE_KEY is missing")
PY
)"
worker_secret="$(tr -d '\r\n' < "${WORKER_SECRET_FILE}")"
[[ -n "${service_role_key}" && -n "${worker_secret}" ]] || {
  echo "ERROR: deletion worker credentials are empty" >&2
  exit 1
}

http_code="$(curl -sS --max-time 120 \
  -o "${TMP_DIR}/response.json" \
  -w '%{http_code}' \
  -X POST \
  -H "apikey: ${service_role_key}" \
  -H "Authorization: Bearer ${service_role_key}" \
  -H "X-Fizira-Deletion-Worker: ${worker_secret}" \
  -H 'Content-Type: application/json' \
  --data '{}' \
  "${PUBLIC_URL}/functions/v1/delete-account")"

python3 - "${TMP_DIR}/response.json" "${http_code}" <<'PY'
import json
import sys

body = json.loads(open(sys.argv[1]).read())
if sys.argv[2] != "200" or body.get("success") is not True:
    raise SystemExit("deletion worker request failed")
processed = int(body.get("processed", 0))
completed = int(body.get("completed", 0))
print(f"ACCOUNT_DELETION_WORKER_OK processed={processed} completed={completed}")
PY

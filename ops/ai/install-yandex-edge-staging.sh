#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/root/supabase-project"
SOURCE_COMMIT="949badc7f9abc540318a72d98ae9b1cd10a7421f"
RAW_BASE="https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/${SOURCE_COMMIT}"
FOLDER_ID="b1g9eenholug08hjppmp"
KEY_FILE="/etc/fizira/yandex-ai-api-key"
CONTAINER_ENV_FILE="/etc/fizira/yandex-ai.env"
OVERRIDE_NAME="docker-compose.yandex-ai.yml"
BACKUP_ROOT="/root/fizira-deploy-backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/yandex-ai-${STAMP}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf -- "${TMP_DIR}"
}

rollback() {
  local exit_code=$?
  trap - ERR
  echo "ERROR: deployment failed; restoring the previous files" >&2

  cp -a -- "${BACKUP_DIR}/.env" "${PROJECT_ROOT}/.env"

  if [[ -f "${BACKUP_DIR}/${OVERRIDE_NAME}" ]]; then
    cp -a -- "${BACKUP_DIR}/${OVERRIDE_NAME}" "${PROJECT_ROOT}/${OVERRIDE_NAME}"
  else
    rm -f -- "${PROJECT_ROOT}/${OVERRIDE_NAME}"
  fi

  if [[ -d "${BACKUP_DIR}/ptchild-ai" ]]; then
    rm -rf -- "${PROJECT_ROOT}/volumes/functions/ptchild-ai"
    cp -a -- "${BACKUP_DIR}/ptchild-ai" "${PROJECT_ROOT}/volumes/functions/ptchild-ai"
  else
    rm -rf -- "${PROJECT_ROOT}/volumes/functions/ptchild-ai"
  fi

  if [[ -d "${BACKUP_DIR}/_shared" ]]; then
    rm -rf -- "${PROJECT_ROOT}/volumes/functions/_shared"
    cp -a -- "${BACKUP_DIR}/_shared" "${PROJECT_ROOT}/volumes/functions/_shared"
  else
    rm -rf -- "${PROJECT_ROOT}/volumes/functions/_shared"
  fi

  if [[ -f "${BACKUP_DIR}/container-env" ]]; then
    cp -a -- "${BACKUP_DIR}/container-env" "${CONTAINER_ENV_FILE}"
  else
    rm -f -- "${CONTAINER_ENV_FILE}"
  fi

  (cd "${PROJECT_ROOT}" && docker compose up -d --no-deps functions) || true
  cleanup
  exit "${exit_code}"
}

trap cleanup EXIT
trap rollback ERR

[[ "$(id -u)" == "0" ]] || { echo "ERROR: run as root" >&2; exit 1; }
[[ -d "${PROJECT_ROOT}/volumes/functions" ]] || { echo "ERROR: Functions directory not found" >&2; exit 1; }
[[ -f "${PROJECT_ROOT}/.env" ]] || { echo "ERROR: .env not found" >&2; exit 1; }
[[ -s "${KEY_FILE}" ]] || { echo "ERROR: Yandex API key file is missing or empty" >&2; exit 1; }
[[ "$(stat -c '%a' "${KEY_FILE}")" == "600" ]] || { echo "ERROR: Yandex API key file must have mode 600" >&2; exit 1; }

mkdir -p -- "${BACKUP_DIR}"
cp -a -- "${PROJECT_ROOT}/.env" "${BACKUP_DIR}/.env"
[[ ! -f "${PROJECT_ROOT}/${OVERRIDE_NAME}" ]] || cp -a -- "${PROJECT_ROOT}/${OVERRIDE_NAME}" "${BACKUP_DIR}/${OVERRIDE_NAME}"
[[ ! -d "${PROJECT_ROOT}/volumes/functions/ptchild-ai" ]] || cp -a -- "${PROJECT_ROOT}/volumes/functions/ptchild-ai" "${BACKUP_DIR}/ptchild-ai"
[[ ! -d "${PROJECT_ROOT}/volumes/functions/_shared" ]] || cp -a -- "${PROJECT_ROOT}/volumes/functions/_shared" "${BACKUP_DIR}/_shared"
[[ ! -f "${CONTAINER_ENV_FILE}" ]] || cp -a -- "${CONTAINER_ENV_FILE}" "${BACKUP_DIR}/container-env"

python3 - "${KEY_FILE}" "${CONTAINER_ENV_FILE}" <<'PY'
from pathlib import Path
import os
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
value = source.read_text().strip()
if not value or "\n" in value or "\r" in value:
    raise SystemExit("invalid Yandex API key file")
target.write_text(f"YANDEX_AI_API_KEY={value}\n")
os.chmod(target, 0o600)
PY
chown root:root "${CONTAINER_ENV_FILE}"

mkdir -p -- "${TMP_DIR}/_shared" "${TMP_DIR}/ptchild-ai"
curl -fsSL "${RAW_BASE}/supabase/functions/_shared/ai-helpers.ts" -o "${TMP_DIR}/_shared/ai-helpers.ts"
curl -fsSL "${RAW_BASE}/supabase/functions/ptchild-ai/index.ts" -o "${TMP_DIR}/ptchild-ai/index.ts"

printf '%s  %s\n' \
  "5579a668fb7ac4f28edac3724dcd0c65338d4eb2121cb159d09ee4e0a73323ad" "${TMP_DIR}/_shared/ai-helpers.ts" \
  "83d4d88a7f173b1d019c8b22800f0391314a7ec6cb8d6fa814fe5bb88147a780" "${TMP_DIR}/ptchild-ai/index.ts" \
  | sha256sum --check --status

install -d -m 755 "${PROJECT_ROOT}/volumes/functions/_shared" "${PROJECT_ROOT}/volumes/functions/ptchild-ai"
install -m 644 "${TMP_DIR}/_shared/ai-helpers.ts" "${PROJECT_ROOT}/volumes/functions/_shared/ai-helpers.ts"
install -m 644 "${TMP_DIR}/ptchild-ai/index.ts" "${PROJECT_ROOT}/volumes/functions/ptchild-ai/index.ts"

printf '%s\n' \
  'services:' \
  '  functions:' \
  '    env_file:' \
  "      - ${CONTAINER_ENV_FILE}" \
  '    environment:' \
  "      YANDEX_FOLDER_ID: ${FOLDER_ID}" \
  '      FIZIRA_ALLOWED_ORIGINS: https://app.fizira.com' \
  '      FIZIRA_ALLOW_PDF_OCR: "no"' \
  > "${PROJECT_ROOT}/${OVERRIDE_NAME}"
chmod 600 "${PROJECT_ROOT}/${OVERRIDE_NAME}"

python3 - "${PROJECT_ROOT}/.env" "${OVERRIDE_NAME}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
override = sys.argv[2]
lines = path.read_text().splitlines()
found = False
for index, line in enumerate(lines):
    if line.startswith("COMPOSE_FILE="):
        files = [item for item in line.split("=", 1)[1].split(":") if item]
        if override not in files:
            files.append(override)
        lines[index] = "COMPOSE_FILE=" + ":".join(files)
        found = True
        break
if not found:
    raise SystemExit("COMPOSE_FILE is missing from .env")
path.write_text("\n".join(lines) + "\n")
PY
chmod 600 "${PROJECT_ROOT}/.env"

cd "${PROJECT_ROOT}"
docker compose config --quiet
docker compose up -d --no-deps functions

container_id="$(docker compose ps -q functions)"
[[ -n "${container_id}" ]] || { echo "ERROR: functions container was not created" >&2; exit 1; }

status=""
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  [[ "${status}" == "healthy" ]] && break
  [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]] && break
  sleep 2
done
[[ "${status}" == "healthy" ]] || { docker compose logs --tail 80 functions >&2; echo "ERROR: functions status is ${status}" >&2; exit 1; }

docker exec "${container_id}" /bin/sh -c 'test -n "$YANDEX_AI_API_KEY"'
[[ "$(stat -c '%a:%U:%G' "${CONTAINER_ENV_FILE}")" == "600:root:root" ]] || { echo "ERROR: generated environment file permissions are unsafe" >&2; exit 1; }

http_code="$(curl -sS -o "${TMP_DIR}/preflight.body" -w '%{http_code}' \
  -X OPTIONS \
  -H 'Origin: https://app.fizira.com' \
  -H 'Access-Control-Request-Method: POST' \
  'https://auth.fizira.com/functions/v1/ptchild-ai')"

trap - ERR
echo "YANDEX_EDGE_STAGING_INSTALL_OK"
echo "functions_status=${status}"
echo "preflight_http=${http_code}"
echo "pdf_ocr=disabled"
echo "backup=${BACKUP_DIR}"

#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/root/supabase-project"
SOURCE_KEY_FILE="/etc/fizira/yandex-ai-api-key"
CONTAINER_ENV_FILE="/etc/fizira/yandex-ai.env"
OVERRIDE_FILE="${PROJECT_ROOT}/docker-compose.yandex-ai.yml"
BACKUP_DIR="$(mktemp -d /root/fizira-yandex-key-repair.XXXXXX)"
COMPLETED="no"

cleanup() {
  if [[ "${COMPLETED}" == "yes" ]]; then
    rm -rf -- "${BACKUP_DIR}"
  fi
}

rollback() {
  local exit_code=$?
  trap - ERR
  echo "ERROR: key injection repair failed; restoring previous configuration" >&2
  [[ ! -f "${BACKUP_DIR}/override" ]] || cp -a -- "${BACKUP_DIR}/override" "${OVERRIDE_FILE}"
  if [[ -f "${BACKUP_DIR}/container-env" ]]; then
    cp -a -- "${BACKUP_DIR}/container-env" "${CONTAINER_ENV_FILE}"
  else
    rm -f -- "${CONTAINER_ENV_FILE}"
  fi
  (cd "${PROJECT_ROOT}" && docker compose up -d --no-deps functions) || true
  exit "${exit_code}"
}

trap cleanup EXIT
trap rollback ERR

[[ "$(id -u)" == "0" ]] || { echo "ERROR: run as root" >&2; exit 1; }
[[ -s "${SOURCE_KEY_FILE}" ]] || { echo "ERROR: source key file is missing or empty" >&2; exit 1; }
[[ "$(stat -c '%a:%U:%G' "${SOURCE_KEY_FILE}")" == "600:root:root" ]] || {
  echo "ERROR: source key must remain mode 600 and owned by root:root" >&2
  exit 1
}
[[ -f "${OVERRIDE_FILE}" ]] || { echo "ERROR: Yandex compose override not found" >&2; exit 1; }

cp -a -- "${OVERRIDE_FILE}" "${BACKUP_DIR}/override"
[[ ! -f "${CONTAINER_ENV_FILE}" ]] || cp -a -- "${CONTAINER_ENV_FILE}" "${BACKUP_DIR}/container-env"

python3 - "${SOURCE_KEY_FILE}" "${CONTAINER_ENV_FILE}" <<'PY'
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

cat > "${OVERRIDE_FILE}" <<'YAML'
services:
  functions:
    env_file:
      - /etc/fizira/yandex-ai.env
    environment:
      YANDEX_FOLDER_ID: b1g9eenholug08hjppmp
      FIZIRA_ALLOWED_ORIGINS: https://app.fizira.com
      FIZIRA_ALLOW_PDF_OCR: "no"
YAML
chmod 600 "${OVERRIDE_FILE}"

cd "${PROJECT_ROOT}"
docker compose config --quiet
docker compose up -d --no-deps functions
container_id="$(docker compose ps -q functions)"
[[ -n "${container_id}" ]] || { echo "ERROR: restarted functions container not found" >&2; exit 1; }

status=""
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  [[ "${status}" == "healthy" ]] && break
  [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]] && break
  sleep 2
done
[[ "${status}" == "healthy" ]] || {
  docker compose logs --tail 80 functions >&2
  echo "ERROR: functions status is ${status}" >&2
  exit 1
}

docker exec "${container_id}" /bin/sh -c 'test -n "$YANDEX_AI_API_KEY"'
[[ "$(stat -c '%a:%U:%G' "${CONTAINER_ENV_FILE}")" == "600:root:root" ]] || {
  echo "ERROR: generated environment file permissions are unsafe" >&2
  exit 1
}

COMPLETED="yes"
trap - ERR
echo "YANDEX_EDGE_KEY_INJECTION_REPAIR_OK"
echo "functions_status=${status}"
echo "source_key_mode=600"
echo "container_env_mode=600"
echo "pdf_ocr=disabled"

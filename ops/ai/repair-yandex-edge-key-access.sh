#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/root/supabase-project"
SOURCE_KEY_FILE="/etc/fizira/yandex-ai-api-key"
RUNTIME_SECRET_DIR="/etc/fizira/runtime"
RUNTIME_KEY_FILE="${RUNTIME_SECRET_DIR}/yandex-ai-api-key"
OVERRIDE_FILE="${PROJECT_ROOT}/docker-compose.yandex-ai.yml"
BACKUP_DIR="$(mktemp -d /root/fizira-yandex-key-repair.XXXXXX)"
CONTAINER_ID=""
COMPLETED="no"

cleanup() {
  if [[ "${COMPLETED}" == "yes" ]]; then
    rm -rf -- "${BACKUP_DIR}"
  fi
}

rollback() {
  local exit_code=$?
  trap - ERR
  echo "ERROR: key access repair failed; restoring previous configuration" >&2
  if [[ -f "${BACKUP_DIR}/override" ]]; then
    cp -a -- "${BACKUP_DIR}/override" "${OVERRIDE_FILE}"
  fi
  if [[ -f "${BACKUP_DIR}/runtime-key" ]]; then
    cp -a -- "${BACKUP_DIR}/runtime-key" "${RUNTIME_KEY_FILE}"
  else
    rm -f -- "${RUNTIME_KEY_FILE}"
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

cd "${PROJECT_ROOT}"
CONTAINER_ID="$(docker compose ps -q functions)"
[[ -n "${CONTAINER_ID}" ]] || { echo "ERROR: functions container not found" >&2; exit 1; }

runtime_uid="$(docker exec "${CONTAINER_ID}" id -u)"
runtime_gid="$(docker exec "${CONTAINER_ID}" id -g)"
[[ "${runtime_uid}" =~ ^[0-9]+$ && "${runtime_gid}" =~ ^[0-9]+$ ]] || {
  echo "ERROR: invalid runtime uid/gid" >&2
  exit 1
}
[[ "${runtime_uid}" != "0" ]] || { echo "ERROR: refusing to repair a root-running functions container" >&2; exit 1; }

cp -a -- "${OVERRIDE_FILE}" "${BACKUP_DIR}/override"
[[ ! -f "${RUNTIME_KEY_FILE}" ]] || cp -a -- "${RUNTIME_KEY_FILE}" "${BACKUP_DIR}/runtime-key"

install -d -o root -g root -m 700 "${RUNTIME_SECRET_DIR}"
install -o "${runtime_uid}" -g "${runtime_gid}" -m 400 "${SOURCE_KEY_FILE}" "${RUNTIME_KEY_FILE}"

python3 - "${OVERRIDE_FILE}" "${RUNTIME_KEY_FILE}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = sys.argv[2]
destination = "/run/secrets/yandex_ai_api_key:ro"
lines = path.read_text().splitlines()
matches = [index for index, line in enumerate(lines) if destination in line]
if len(matches) != 1:
    raise SystemExit(f"expected one Yandex key mount, found {len(matches)}")
indent = lines[matches[0]][: len(lines[matches[0]]) - len(lines[matches[0]].lstrip())]
lines[matches[0]] = f"{indent}- {source}:{destination}"
path.write_text("\n".join(lines) + "\n")
PY
chmod 600 "${OVERRIDE_FILE}"

docker compose config --quiet
docker compose up -d --no-deps functions
CONTAINER_ID="$(docker compose ps -q functions)"
[[ -n "${CONTAINER_ID}" ]] || { echo "ERROR: restarted functions container not found" >&2; exit 1; }

status=""
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_ID}")"
  [[ "${status}" == "healthy" ]] && break
  [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]] && break
  sleep 2
done
[[ "${status}" == "healthy" ]] || {
  docker compose logs --tail 80 functions >&2
  echo "ERROR: functions status is ${status}" >&2
  exit 1
}

docker exec "${CONTAINER_ID}" test -r /run/secrets/yandex_ai_api_key
mounted_rw="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/yandex_ai_api_key"}}{{.RW}}{{end}}{{end}}' "${CONTAINER_ID}")"
[[ "${mounted_rw}" == "false" ]] || { echo "ERROR: Yandex key mount is not read-only" >&2; exit 1; }

COMPLETED="yes"
trap - ERR
echo "YANDEX_EDGE_KEY_ACCESS_REPAIR_OK"
echo "functions_status=${status}"
echo "runtime_uid=${runtime_uid}"
echo "secret_mode=400"
echo "secret_mount=read-only"

#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${FIZIRA_PROJECT_ROOT:-/root/supabase-project}"
PUBLIC_URL="${FIZIRA_PUBLIC_URL:-https://auth.fizira.com}"
SOURCE_COMMIT="a73a2e69b5a06b076310d6bcdad2a38c12735688"
RAW_BASE="https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/${SOURCE_COMMIT}"
OVERRIDE_NAME="docker-compose.account-deletion.yml"
SECRET_FILE="/etc/fizira/account-deletion-worker-secret"
BACKUP_ROOT="/root/fizira-deploy-backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/account-deletion-${STAMP}"
TMP_DIR="$(mktemp -d)"
COMPLETED="no"
MIGRATION_APPLIED="no"

cleanup() {
  rm -rf -- "${TMP_DIR}"
}

restore_optional_file() {
  local backup_path="$1"
  local target_path="$2"
  if [[ -f "${backup_path}" ]]; then
    cp -a -- "${backup_path}" "${target_path}"
  else
    rm -f -- "${target_path}"
  fi
}

restore_optional_dir() {
  local backup_path="$1"
  local target_path="$2"
  rm -rf -- "${target_path}"
  [[ ! -d "${backup_path}" ]] || cp -a -- "${backup_path}" "${target_path}"
}

rollback() {
  local exit_code=$?
  trap - ERR
  echo "ERROR: account deletion staging failed; rolling back" >&2

  if [[ "${MIGRATION_APPLIED}" == "yes" && -f "${TMP_DIR}/rollback.sql" ]]; then
    (cd "${PROJECT_ROOT}" && docker compose exec -T db \
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -f - < "${TMP_DIR}/rollback.sql") || true
  fi

  restore_optional_dir \
    "${BACKUP_DIR}/delete-account" \
    "${PROJECT_ROOT}/volumes/functions/delete-account"
  restore_optional_file \
    "${BACKUP_DIR}/ai-helpers.ts" \
    "${PROJECT_ROOT}/volumes/functions/_shared/ai-helpers.ts"
  restore_optional_file \
    "${BACKUP_DIR}/project.env" \
    "${PROJECT_ROOT}/.env"
  restore_optional_file \
    "${BACKUP_DIR}/${OVERRIDE_NAME}" \
    "${PROJECT_ROOT}/${OVERRIDE_NAME}"
  restore_optional_file \
    "${BACKUP_DIR}/worker-secret" \
    "${SECRET_FILE}"
  restore_optional_file \
    "${BACKUP_DIR}/worker" \
    "/usr/local/sbin/fizira-account-deletion-worker"
  restore_optional_file \
    "${BACKUP_DIR}/service" \
    "/etc/systemd/system/fizira-account-deletion.service"
  restore_optional_file \
    "${BACKUP_DIR}/timer" \
    "/etc/systemd/system/fizira-account-deletion.timer"

  systemctl daemon-reload || true
  systemctl disable --now fizira-account-deletion.timer >/dev/null 2>&1 || true
  (cd "${PROJECT_ROOT}" && docker compose up -d --no-deps functions) || true
  cleanup
  exit "${exit_code}"
}

trap cleanup EXIT
trap rollback ERR

[[ "$(id -u)" == "0" ]] || { echo "ERROR: run as root" >&2; exit 1; }
[[ -f "${PROJECT_ROOT}/.env" ]] || { echo "ERROR: Supabase .env not found" >&2; exit 1; }
[[ -d "${PROJECT_ROOT}/volumes/functions" ]] || { echo "ERROR: Functions directory not found" >&2; exit 1; }
command -v docker >/dev/null
command -v node >/dev/null
command -v openssl >/dev/null
command -v systemctl >/dev/null

mkdir -p -- "${BACKUP_DIR}" /etc/fizira
cp -a -- "${PROJECT_ROOT}/.env" "${BACKUP_DIR}/project.env"
[[ ! -f "${PROJECT_ROOT}/${OVERRIDE_NAME}" ]] || \
  cp -a -- "${PROJECT_ROOT}/${OVERRIDE_NAME}" "${BACKUP_DIR}/${OVERRIDE_NAME}"
[[ ! -d "${PROJECT_ROOT}/volumes/functions/delete-account" ]] || \
  cp -a -- "${PROJECT_ROOT}/volumes/functions/delete-account" "${BACKUP_DIR}/delete-account"
[[ ! -f "${PROJECT_ROOT}/volumes/functions/_shared/ai-helpers.ts" ]] || \
  cp -a -- "${PROJECT_ROOT}/volumes/functions/_shared/ai-helpers.ts" "${BACKUP_DIR}/ai-helpers.ts"
[[ ! -f "${SECRET_FILE}" ]] || cp -a -- "${SECRET_FILE}" "${BACKUP_DIR}/worker-secret"
[[ ! -f /usr/local/sbin/fizira-account-deletion-worker ]] || \
  cp -a -- /usr/local/sbin/fizira-account-deletion-worker "${BACKUP_DIR}/worker"
[[ ! -f /etc/systemd/system/fizira-account-deletion.service ]] || \
  cp -a -- /etc/systemd/system/fizira-account-deletion.service "${BACKUP_DIR}/service"
[[ ! -f /etc/systemd/system/fizira-account-deletion.timer ]] || \
  cp -a -- /etc/systemd/system/fizira-account-deletion.timer "${BACKUP_DIR}/timer"

download() {
  local source_path="$1"
  local target_path="$2"
  curl -fsSL "${RAW_BASE}/${source_path}" -o "${target_path}"
}

mkdir -p -- "${TMP_DIR}/function" "${TMP_DIR}/shared" "${TMP_DIR}/systemd"
download supabase/functions/delete-account/index.ts "${TMP_DIR}/function/index.ts"
download supabase/functions/_shared/ai-helpers.ts "${TMP_DIR}/shared/ai-helpers.ts"
download supabase/migrations/20260922_004_account_deletion_jobs.sql "${TMP_DIR}/migration.sql"
download supabase/rollback/rollback_account_deletion_jobs.sql "${TMP_DIR}/rollback.sql"
download ops/account-deletion/run-worker.sh "${TMP_DIR}/run-worker.sh"
download ops/account-deletion/test-synthetic-deletion.mjs "${TMP_DIR}/test-synthetic-deletion.mjs"
download ops/account-deletion/systemd/fizira-account-deletion.service "${TMP_DIR}/systemd/service"
download ops/account-deletion/systemd/fizira-account-deletion.timer "${TMP_DIR}/systemd/timer"

printf '%s  %s\n' \
  'c0ae869cc2a50625adb871627b835b0ab7bd629e2aec88e818c2349e680683ec' "${TMP_DIR}/function/index.ts" \
  '5579a668fb7ac4f28edac3724dcd0c65338d4eb2121cb159d09ee4e0a73323ad' "${TMP_DIR}/shared/ai-helpers.ts" \
  '41296c901875bb32fbe4b5414aa394d749aaa11c200a19151c20d668b61fd8ce' "${TMP_DIR}/migration.sql" \
  'a6337aefa15da3fdddf8728ad0bfed0843115f85d2ece3bff1d4edae869658b1' "${TMP_DIR}/rollback.sql" \
  '9a01a049a1b8b5d652fe07a10407bc262d612d6207ce9345297b97538e310ed2' "${TMP_DIR}/run-worker.sh" \
  '55c1608e632590738d232bcb2ca2fb106a8f976c6572581fa453511dd5a34b02' "${TMP_DIR}/test-synthetic-deletion.mjs" \
  '02c095c764e7e37826656bc985438072173a01d489a9887dbd0090ad0933729b' "${TMP_DIR}/systemd/service" \
  '2ae6f647200a053c27694fabff35aea6254fc8711b778e268e47a62618a55d42' "${TMP_DIR}/systemd/timer" \
  | sha256sum --check --status

if [[ ! -s "${SECRET_FILE}" ]]; then
  openssl rand -hex 32 > "${SECRET_FILE}"
fi
chmod 600 "${SECRET_FILE}"
chown root:root "${SECRET_FILE}"
worker_secret="$(tr -d '\r\n' < "${SECRET_FILE}")"
[[ "${#worker_secret}" -ge 64 ]] || { echo "ERROR: worker secret is too short" >&2; exit 1; }

python3 - "${PROJECT_ROOT}/.env" "${worker_secret}" "${OVERRIDE_NAME}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
secret = sys.argv[2]
override = sys.argv[3]
lines = path.read_text().splitlines()

def set_value(name, value):
    prefix = name + "="
    for index, line in enumerate(lines):
        if line.startswith(prefix):
            lines[index] = prefix + value
            return
    lines.append(prefix + value)

set_value("FIZIRA_DELETION_WORKER_SECRET", secret)
for index, line in enumerate(lines):
    if line.startswith("COMPOSE_FILE="):
        files = [item for item in line.split("=", 1)[1].split(":") if item]
        if override not in files:
            files.append(override)
        lines[index] = "COMPOSE_FILE=" + ":".join(files)
        break
else:
    raise SystemExit("COMPOSE_FILE is missing from .env")

path.write_text("\n".join(lines) + "\n")
PY
chmod 600 "${PROJECT_ROOT}/.env"

printf '%s\n' \
  'services:' \
  '  functions:' \
  '    environment:' \
  '      FIZIRA_DELETION_WORKER_SECRET: ${FIZIRA_DELETION_WORKER_SECRET}' \
  > "${PROJECT_ROOT}/${OVERRIDE_NAME}"
chmod 600 "${PROJECT_ROOT}/${OVERRIDE_NAME}"

install -d -m 755 \
  "${PROJECT_ROOT}/volumes/functions/delete-account" \
  "${PROJECT_ROOT}/volumes/functions/_shared"
install -m 644 "${TMP_DIR}/function/index.ts" \
  "${PROJECT_ROOT}/volumes/functions/delete-account/index.ts"
install -m 644 "${TMP_DIR}/shared/ai-helpers.ts" \
  "${PROJECT_ROOT}/volumes/functions/_shared/ai-helpers.ts"
install -m 755 "${TMP_DIR}/run-worker.sh" \
  /usr/local/sbin/fizira-account-deletion-worker
install -m 644 "${TMP_DIR}/systemd/service" \
  /etc/systemd/system/fizira-account-deletion.service
install -m 644 "${TMP_DIR}/systemd/timer" \
  /etc/systemd/system/fizira-account-deletion.timer

cd "${PROJECT_ROOT}"
docker compose config --quiet
existing_table="$(docker compose exec -T db psql -U postgres -d postgres -At \
  -v ON_ERROR_STOP=1 -c \
  "select (to_regclass('public.account_deletion_jobs') is not null)::text")"
[[ "${existing_table}" == "false" || "${existing_table}" == "f" ]] || {
  echo "ERROR: account deletion schema already exists; refusing a fresh-install rollback path" >&2
  exit 1
}
docker compose exec -T db psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < "${TMP_DIR}/migration.sql"
MIGRATION_APPLIED="yes"
docker compose up -d --no-deps functions

container_id="$(docker compose ps -q functions)"
[[ -n "${container_id}" ]] || { echo "ERROR: functions container not found" >&2; exit 1; }
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
docker exec "${container_id}" /bin/sh -c 'test -n "$FIZIRA_DELETION_WORKER_SECRET"'

readarray -t credentials < <(python3 - "${PROJECT_ROOT}/.env" <<'PY'
from pathlib import Path
import sys

values = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value.strip()
for key in ("ANON_KEY", "SERVICE_ROLE_KEY"):
    value = values.get(key, "")
    if not value:
        raise SystemExit(f"{key} is missing")
    print(value)
PY
)

SUPABASE_URL="${PUBLIC_URL}" \
ANON_KEY="${credentials[0]}" \
SERVICE_ROLE_KEY="${credentials[1]}" \
FIZIRA_DELETION_WORKER_SECRET="${worker_secret}" \
node "${TMP_DIR}/test-synthetic-deletion.mjs"

systemctl daemon-reload
systemctl enable --now fizira-account-deletion.timer
systemctl is-active --quiet fizira-account-deletion.timer

COMPLETED="yes"
trap - ERR
echo "ACCOUNT_DELETION_INSTALL_AND_TEST_OK"
echo "functions_status=${status}"
echo "timer_status=active"
echo "backup=${BACKUP_DIR}"

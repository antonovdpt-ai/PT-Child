#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "ERROR: run this script as root on the self-hosted Supabase server" >&2
  exit 1
fi

PROJECT_ROOT="${FIZIRA_PROJECT_ROOT:-/root/supabase-project}"
DB_SERVICE="${FIZIRA_DB_SERVICE:-db}"
OUTPUT_ROOT="${FIZIRA_CUTOVER_EVIDENCE_ROOT:-/root/fizira-cutover-evidence}"
PREFLIGHT_COMMIT="0760d96336e7df09868a07a70e4fd814cef563c5"
PREFLIGHT_SHA256="0bbfaf8a5438ebcbb9f3beaabd49a5daff3139dd0df45a771fe8774f5dc25ad7"
PREFLIGHT_URL="https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/${PREFLIGHT_COMMIT}/ops/cutover/preflight.sh"

command -v docker >/dev/null 2>&1 || {
  echo "ERROR: docker is required" >&2
  exit 1
}

[[ -d "${PROJECT_ROOT}" ]] || {
  echo "ERROR: Supabase project directory not found: ${PROJECT_ROOT}" >&2
  exit 1
}

docker compose version >/dev/null

if ! (
  cd "${PROJECT_ROOT}"
  docker compose ps --status running --services | grep -Fxq "${DB_SERVICE}"
); then
  echo "ERROR: Docker Compose service is not running: ${DB_SERVICE}" >&2
  exit 1
fi

read -r -p "Source PostgreSQL host [db.bpacboofedxhdjhiizpy.supabase.co]: " SOURCE_HOST_INPUT
SOURCE_HOST="${SOURCE_HOST_INPUT:-db.bpacboofedxhdjhiizpy.supabase.co}"

read -r -p "Source PostgreSQL port [5432]: " SOURCE_PORT_INPUT
SOURCE_PORT="${SOURCE_PORT_INPUT:-5432}"

read -r -p "Source database [postgres]: " SOURCE_DATABASE_INPUT
SOURCE_DATABASE="${SOURCE_DATABASE_INPUT:-postgres}"

read -r -p "Source PostgreSQL user [postgres]: " SOURCE_USER_INPUT
SOURCE_USER="${SOURCE_USER_INPUT:-postgres}"

read -r -s -p "Source database password (hidden): " SOURCE_DB_PASSWORD
printf '\n'

[[ -n "${SOURCE_DB_PASSWORD}" ]] || {
  echo "ERROR: source database password must not be empty" >&2
  exit 1
}

[[ "${SOURCE_PORT}" =~ ^[0-9]+$ ]] || {
  echo "ERROR: source PostgreSQL port must be numeric" >&2
  exit 1
}

export PGPASSWORD="${SOURCE_DB_PASSWORD}"
export PGSSLMODE=require
export PGCONNECT_TIMEOUT=15
unset SOURCE_DB_PASSWORD

psql() {
  local service="${1:-}"
  shift || true

  case "${service}" in
    service=fizira-source)
      (
        cd "${PROJECT_ROOT}"
        docker compose exec -T \
          -e PGPASSWORD \
          -e PGSSLMODE \
          -e PGCONNECT_TIMEOUT \
          "${DB_SERVICE}" \
          psql \
            --host="${SOURCE_HOST}" \
            --port="${SOURCE_PORT}" \
            --username="${SOURCE_USER}" \
            --dbname="${SOURCE_DATABASE}" \
            "$@"
      )
      ;;
    service=fizira-target)
      (
        cd "${PROJECT_ROOT}"
        docker compose exec -T "${DB_SERVICE}" \
          psql --username=postgres --dbname=postgres "$@"
      )
      ;;
    *)
      echo "ERROR: unexpected PostgreSQL service selector: ${service}" >&2
      return 1
      ;;
  esac
}

echo "Checking read-only source connection..."
psql service=fizira-source -X --set=ON_ERROR_STOP=1 \
  --tuples-only --no-align --command='SELECT 1' | grep -Fxq '1'

echo "Checking target connection..."
psql service=fizira-target -X --set=ON_ERROR_STOP=1 \
  --tuples-only --no-align --command='SELECT 1' | grep -Fxq '1'

temporary_preflight=""
cleanup() {
  unset PGPASSWORD
  if [[ -n "${temporary_preflight}" ]]; then
    rm -f "${temporary_preflight}"
  fi
}
trap cleanup EXIT

if [[ -n "${FIZIRA_PREFLIGHT_SCRIPT:-}" ]]; then
  PREFLIGHT_SCRIPT="${FIZIRA_PREFLIGHT_SCRIPT}"
else
  command -v curl >/dev/null 2>&1 || {
    echo "ERROR: curl is required" >&2
    exit 1
  }
  command -v sha256sum >/dev/null 2>&1 || {
    echo "ERROR: sha256sum is required" >&2
    exit 1
  }

  temporary_preflight="$(mktemp)"
  curl -fsSL "${PREFLIGHT_URL}" -o "${temporary_preflight}"
  printf '%s  %s\n' "${PREFLIGHT_SHA256}" "${temporary_preflight}" | \
    sha256sum --check --status
  chmod 700 "${temporary_preflight}"
  PREFLIGHT_SCRIPT="${temporary_preflight}"
fi

[[ -f "${PREFLIGHT_SCRIPT}" ]] || {
  echo "ERROR: preflight script not found: ${PREFLIGHT_SCRIPT}" >&2
  exit 1
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
export FIZIRA_CUTOVER_OUTPUT_DIR="${OUTPUT_ROOT}/${timestamp}"
export FIZIRA_SOURCE_PGSERVICE=fizira-source
export FIZIRA_TARGET_PGSERVICE=fizira-target

echo "Running database parity preflight (SELECT only)..."
# shellcheck disable=SC1090
source "${PREFLIGHT_SCRIPT}"

printf 'READONLY_PRODUCTION_PREFLIGHT_OK evidence=%s\n' \
  "${FIZIRA_CUTOVER_OUTPUT_DIR}"


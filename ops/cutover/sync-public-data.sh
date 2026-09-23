#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

PROJECT_ROOT="${FIZIRA_PROJECT_ROOT:-/root/supabase-project}"
DB_CONTAINER="${FIZIRA_DB_CONTAINER:-supabase-db}"
BACKUP_ROOT="${FIZIRA_CUTOVER_BACKUP_ROOT:-/root/fizira-cutover-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK_DIR="$(mktemp -d)"

TABLES=(
  profiles patients assessments goals sessions patient_media patient_contacts
  parent_reports standardized_assessments ai_analysis_history user_consents
)

cleanup() {
  unset PGPASSWORD
  rm -rf -- "${WORK_DIR}"
}
trap cleanup EXIT

if (( EUID != 0 )); then
  echo "ERROR: run as root on the self-hosted Supabase server" >&2
  exit 1
fi

for command_name in docker pg_dump psql sha256sum; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: ${command_name}" >&2
    exit 1
  }
done

docker inspect "${DB_CONTAINER}" >/dev/null 2>&1 || {
  echo "ERROR: database container not found: ${DB_CONTAINER}" >&2
  exit 1
}

read -r -p "Source PostgreSQL host: " SOURCE_HOST
read -r -p "Source PostgreSQL port [5432]: " SOURCE_PORT_INPUT
SOURCE_PORT="${SOURCE_PORT_INPUT:-5432}"
read -r -p "Source database [postgres]: " SOURCE_DATABASE_INPUT
SOURCE_DATABASE="${SOURCE_DATABASE_INPUT:-postgres}"
read -r -p "Source PostgreSQL user: " SOURCE_USER
read -r -s -p "Source database password (hidden): " PGPASSWORD
printf '\n'
read -r -p "Type SYNC to replace target application rows: " CONFIRMATION

[[ "${CONFIRMATION}" == "SYNC" ]] || {
  echo "ABORTED: confirmation did not match" >&2
  exit 1
}

[[ -n "${SOURCE_HOST}" && -n "${SOURCE_USER}" && -n "${PGPASSWORD}" ]] || {
  echo "ERROR: source connection values must not be empty" >&2
  exit 1
}
[[ "${SOURCE_PORT}" =~ ^[0-9]+$ ]] || {
  echo "ERROR: source port must be numeric" >&2
  exit 1
}

export PGPASSWORD PGSSLMODE=require PGCONNECT_TIMEOUT=15

SOURCE_ARGS=(
  --host="${SOURCE_HOST}" --port="${SOURCE_PORT}"
  --username="${SOURCE_USER}" --dbname="${SOURCE_DATABASE}"
)

echo "[1/6] Checking source and target connections..."
psql "${SOURCE_ARGS[@]}" -X --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --command='select 1' | grep -Fxq '1'
docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -X \
  --set=ON_ERROR_STOP=1 --tuples-only --no-align --command='select 1' | grep -Fxq '1'

mkdir -p -- "${BACKUP_ROOT}"
BACKUP_FILE="${BACKUP_ROOT}/target-before-public-sync-${STAMP}.dump"

echo "[2/6] Creating full target database backup..."
docker exec "${DB_CONTAINER}" pg_dump -U postgres -d postgres \
  --format=custom --compress=9 --no-owner --no-privileges > "${BACKUP_FILE}"
docker exec -i "${DB_CONTAINER}" pg_restore --list < "${BACKUP_FILE}" >/dev/null
sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"

echo "[3/6] Verifying application table schemas..."
for table_name in "${TABLES[@]}"; do
  source_columns="$(psql "${SOURCE_ARGS[@]}" -XAt --set=ON_ERROR_STOP=1 --command="
    select string_agg(column_name || ':' || data_type, ',' order by ordinal_position)
    from information_schema.columns
    where table_schema='public' and table_name='${table_name}';")"
  target_columns="$(docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -XAt \
    --set=ON_ERROR_STOP=1 --command="
      select string_agg(column_name || ':' || data_type, ',' order by ordinal_position)
      from information_schema.columns
      where table_schema='public' and table_name='${table_name}';")"
  [[ -n "${source_columns}" && "${source_columns}" == "${target_columns}" ]] || {
    echo "ERROR: schema mismatch for public.${table_name}" >&2
    exit 1
  }
done

echo "[4/6] Exporting a consistent source snapshot..."
DUMP_FILE="${WORK_DIR}/source-public.sql"
PG_DUMP_ARGS=(--data-only --column-inserts --no-owner --no-privileges)
for table_name in "${TABLES[@]}"; do
  PG_DUMP_ARGS+=(--table="public.${table_name}")
done
pg_dump "${SOURCE_ARGS[@]}" "${PG_DUMP_ARGS[@]}" > "${DUMP_FILE}"

echo "[5/6] Applying snapshot to target in one transaction..."
{
  printf 'set session_replication_role = replica;\n'
  printf 'truncate table '
  separator=''
  for table_name in "${TABLES[@]}"; do
    printf '%s%s' "${separator}" "public.${table_name}"
    separator=', '
  done
  printf ';\n'
  cat "${DUMP_FILE}"
} | docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -X \
  --set=ON_ERROR_STOP=1 --single-transaction

echo "[6/6] Recording row counts without patient data..."
for table_name in "${TABLES[@]}"; do
  count="$(docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -XAt \
    --set=ON_ERROR_STOP=1 --command="select count(*) from public.${table_name};")"
  printf '%s=%s\n' "${table_name}" "${count}"
done

printf 'PUBLIC_DATA_SYNC_OK\nbackup=%s\n' "${BACKUP_FILE}"

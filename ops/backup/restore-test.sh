#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

BACKUP_ROOT="${FIZIRA_BACKUP_ROOT:-/root/fizira-backups}"
DB_CONTAINER="${FIZIRA_DB_CONTAINER:-supabase-db}"
BACKUP_DIR="${1:-}"
TEST_DB="fizira_restore_test_$(date -u +%Y%m%d%H%M%S)"
CONTAINER_DUMP="/tmp/${TEST_DB}.dump"
RESTORE_LOG=""

cleanup() {
  docker exec "$DB_CONTAINER" rm -f -- "$CONTAINER_DUMP" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" dropdb --username=postgres --if-exists --force "$TEST_DB" >/dev/null 2>&1 || true
  if [[ -n "$RESTORE_LOG" && -f "$RESTORE_LOG" ]]; then
    rm -f -- "$RESTORE_LOG"
  fi
}
trap cleanup EXIT

if [[ -z "$BACKUP_DIR" ]]; then
  BACKUP_DIR="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -nr | head -n 1 | cut -d' ' -f2-)"
fi

if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR" ]]; then
  echo "ERROR: no backup directory found under ${BACKUP_ROOT}" >&2
  exit 1
fi

for file in postgres.dump storage.tar.gz functions.tar.gz metadata.txt SHA256SUMS; do
  if [[ ! -f "${BACKUP_DIR}/${file}" ]]; then
    echo "ERROR: missing backup file: ${BACKUP_DIR}/${file}" >&2
    exit 1
  fi
done

if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" != "true" ]]; then
  echo "ERROR: database container is not running: ${DB_CONTAINER}" >&2
  exit 1
fi

echo "[1/6] Checking backup checksums..."
(
  cd "$BACKUP_DIR"
  sha256sum --check SHA256SUMS
)

echo "[2/6] Creating isolated temporary database ${TEST_DB}..."
docker exec "$DB_CONTAINER" createdb \
  --username=postgres \
  --template=template0 \
  "$TEST_DB"

echo "[3/6] Copying the dump into the database container..."
docker cp "${BACKUP_DIR}/postgres.dump" "${DB_CONTAINER}:${CONTAINER_DUMP}" >/dev/null

echo "[4/6] Restoring the dump (the live database is not modified)..."
RESTORE_LOG="$(mktemp)"
if ! docker exec "$DB_CONTAINER" pg_restore \
  --username=postgres \
  --dbname="$TEST_DB" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$CONTAINER_DUMP" >"$RESTORE_LOG" 2>&1; then
  echo "ERROR: restore failed; first database error:" >&2
  if ! grep -n -m 1 -B 2 -A 12 -E "pg_restore: error|ERROR:" "$RESTORE_LOG" >&2; then
    sed -n '1,80p' "$RESTORE_LOG" >&2
  fi
  exit 1
fi

COUNT_SQL="
select 'auth.users', count(*) from auth.users
union all select 'public.patients', count(*) from public.patients
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.assessments', count(*) from public.assessments
union all select 'public.goals', count(*) from public.goals
union all select 'public.sessions', count(*) from public.sessions
union all select 'public.patient_media', count(*) from public.patient_media
union all select 'public.patient_contacts', count(*) from public.patient_contacts
union all select 'public.parent_reports', count(*) from public.parent_reports
union all select 'public.standardized_assessments', count(*) from public.standardized_assessments
union all select 'public.ai_analysis_history', count(*) from public.ai_analysis_history
union all select 'public.user_consents', count(*) from public.user_consents
union all select 'storage.buckets', count(*) from storage.buckets
union all select 'storage.objects', count(*) from storage.objects
order by 1;"

echo "[5/6] Reading critical tables from the restored database..."
RESTORED_COUNTS="$(docker exec "$DB_CONTAINER" psql --username=postgres --dbname="$TEST_DB" \
  --tuples-only --no-align --field-separator='|' --command="$COUNT_SQL")"

echo "[6/6] Checking Storage and Functions archives..."
tar -tzf "${BACKUP_DIR}/storage.tar.gz" >/dev/null
tar -tzf "${BACKUP_DIR}/functions.tar.gz" >/dev/null

printf '%s\n' "$RESTORED_COUNTS"
echo
echo "RESTORE_TEST_OK"
echo "backup=${BACKUP_DIR}"
echo "The temporary database will now be removed automatically."

#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

PROJECT_ROOT="${FIZIRA_PROJECT_ROOT:-/root/supabase-project}"
BACKUP_ROOT="${FIZIRA_BACKUP_ROOT:-/root/fizira-backups}"
DB_CONTAINER="${FIZIRA_DB_CONTAINER:-supabase-db}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL_DIR="${BACKUP_ROOT}/${STAMP}"
WORK_DIR="${BACKUP_ROOT}/.${STAMP}.partial"

cleanup() {
  if [[ -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $1" >&2
    exit 1
  }
}

require_command docker
require_command tar
require_command sha256sum

if [[ ! -d "${PROJECT_ROOT}/volumes/storage" ]]; then
  echo "ERROR: Storage directory not found: ${PROJECT_ROOT}/volumes/storage" >&2
  exit 1
fi

if [[ ! -d "${PROJECT_ROOT}/volumes/functions" ]]; then
  echo "ERROR: Functions directory not found: ${PROJECT_ROOT}/volumes/functions" >&2
  exit 1
fi

if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "ERROR: database container not found: ${DB_CONTAINER}" >&2
  exit 1
fi

if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")" != "true" ]]; then
  echo "ERROR: database container is not running: ${DB_CONTAINER}" >&2
  exit 1
fi

mkdir -p -- "$BACKUP_ROOT"

if [[ -e "$FINAL_DIR" || -e "$WORK_DIR" ]]; then
  echo "ERROR: backup path already exists for timestamp ${STAMP}" >&2
  exit 1
fi

mkdir -- "$WORK_DIR"

echo "[1/6] Dumping PostgreSQL (includes Auth and application data)..."
docker exec "$DB_CONTAINER" pg_dump \
  --username=postgres \
  --dbname=postgres \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  > "${WORK_DIR}/postgres.dump"

echo "[2/6] Archiving Storage objects..."
tar -C "${PROJECT_ROOT}/volumes" -czf "${WORK_DIR}/storage.tar.gz" storage

echo "[3/6] Archiving Edge Functions source..."
tar -C "${PROJECT_ROOT}/volumes" -czf "${WORK_DIR}/functions.tar.gz" functions

echo "[4/6] Archiving disaster-recovery configuration (includes secrets)..."
tar -C "$PROJECT_ROOT" --one-file-system -czf "${WORK_DIR}/config.tar.gz" \
  --exclude='./.git' \
  --exclude='./volumes/db/data' \
  --exclude='./volumes/storage' \
  --exclude='./volumes/functions' \
  .

echo "[5/6] Recording metadata and checksums..."
{
  echo "created_at_utc=${STAMP}"
  echo "hostname=$(hostname)"
  echo "project_root=${PROJECT_ROOT}"
  echo "db_container=${DB_CONTAINER}"
  echo "db_image=$(docker inspect -f '{{.Config.Image}}' "$DB_CONTAINER")"
  echo "storage_path=${PROJECT_ROOT}/volumes/storage"
  echo "functions_path=${PROJECT_ROOT}/volumes/functions"
} > "${WORK_DIR}/metadata.txt"

(
  cd "$WORK_DIR"
  sha256sum postgres.dump storage.tar.gz functions.tar.gz config.tar.gz metadata.txt \
    > SHA256SUMS
)

echo "[6/6] Verifying archive readability..."
docker exec -i "$DB_CONTAINER" pg_restore --list \
  < "${WORK_DIR}/postgres.dump" >/dev/null
tar -tzf "${WORK_DIR}/storage.tar.gz" >/dev/null
tar -tzf "${WORK_DIR}/functions.tar.gz" >/dev/null
tar -tzf "${WORK_DIR}/config.tar.gz" >/dev/null
(
  cd "$WORK_DIR"
  sha256sum --check SHA256SUMS >/dev/null
)

mv -- "$WORK_DIR" "$FINAL_DIR"
trap - EXIT

echo
echo "BACKUP_OK"
echo "path=${FINAL_DIR}"
du -sh -- "$FINAL_DIR"
cat "${FINAL_DIR}/SHA256SUMS"
echo
echo "IMPORTANT: this is an unencrypted local snapshot on the same server."
echo "It is not a complete production backup until encrypted and copied off-server."

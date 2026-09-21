#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

CONFIG_FILE="${FIZIRA_BACKUP_CONFIG:-/etc/fizira/backup.env}"
if [[ -r "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CREATE_SCRIPT="${FIZIRA_CREATE_BACKUP_SCRIPT:-${SCRIPT_DIR}/create-backup.sh}"
RESTORE_SCRIPT="${FIZIRA_RESTORE_TEST_SCRIPT:-${SCRIPT_DIR}/restore-test.sh}"
BACKUP_ROOT="${FIZIRA_BACKUP_ROOT:-/root/fizira-backups}"
ENCRYPTED_ROOT="${FIZIRA_ENCRYPTED_ROOT:-/root/fizira-encrypted-backups}"
PASSPHRASE_FILE="${FIZIRA_BACKUP_PASSPHRASE_FILE:-/etc/fizira/backup-passphrase}"
LOCK_FILE="${FIZIRA_BACKUP_LOCK_FILE:-/run/lock/fizira-backup.lock}"
RCLONE_REMOTE="${FIZIRA_RCLONE_REMOTE:-}"
RCLONE_PATH="${FIZIRA_RCLONE_PATH:-fizira/backups}"
DELIVERY_MODE="${FIZIRA_DELIVERY_MODE:-rclone}"
PULL_USER="${FIZIRA_PULL_USER:-ftransfer}"
LOCAL_RETENTION_DAYS="${FIZIRA_LOCAL_RETENTION_DAYS:-7}"
VERIFY_RESTORE="${FIZIRA_VERIFY_RESTORE:-1}"
DELETE_RAW_AFTER_UPLOAD="${FIZIRA_DELETE_RAW_AFTER_UPLOAD:-1}"
PBKDF2_ITERATIONS="${FIZIRA_PBKDF2_ITERATIONS:-600000}"

RUN_LOG=""
PARTIAL_ARCHIVE=""

cleanup() {
  [[ -z "$RUN_LOG" || ! -f "$RUN_LOG" ]] || rm -f -- "$RUN_LOG"
  [[ -z "$PARTIAL_ARCHIVE" || ! -f "$PARTIAL_ARCHIVE" ]] || rm -f -- "$PARTIAL_ARCHIVE"
}
trap cleanup EXIT

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_uint() {
  [[ "$2" =~ ^[0-9]+$ ]] || die "$1 must be a non-negative integer"
}

[[ "$EUID" -eq 0 ]] || die "run this script as root"

for command in flock openssl sha256sum stat tar; do
  require_command "$command"
done

[[ -x "$CREATE_SCRIPT" ]] || die "backup script is not executable: $CREATE_SCRIPT"
if [[ "$VERIFY_RESTORE" == "1" ]]; then
  [[ -x "$RESTORE_SCRIPT" ]] || die "restore test script is not executable: $RESTORE_SCRIPT"
elif [[ "$VERIFY_RESTORE" != "0" ]]; then
  die "FIZIRA_VERIFY_RESTORE must be 0 or 1"
fi

[[ "$DELETE_RAW_AFTER_UPLOAD" == "0" || "$DELETE_RAW_AFTER_UPLOAD" == "1" ]] \
  || die "FIZIRA_DELETE_RAW_AFTER_UPLOAD must be 0 or 1"
require_uint FIZIRA_LOCAL_RETENTION_DAYS "$LOCAL_RETENTION_DAYS"
require_uint FIZIRA_PBKDF2_ITERATIONS "$PBKDF2_ITERATIONS"
(( PBKDF2_ITERATIONS >= 100000 )) || die "FIZIRA_PBKDF2_ITERATIONS must be at least 100000"

case "$DELIVERY_MODE" in
  rclone)
    require_command rclone
    [[ -n "$RCLONE_REMOTE" ]] || die "FIZIRA_RCLONE_REMOTE is not configured"
    [[ "$RCLONE_REMOTE" != *:* ]] || die "FIZIRA_RCLONE_REMOTE must be a remote name without ':'"
    [[ -n "$RCLONE_PATH" && "$RCLONE_PATH" != /* && "$RCLONE_PATH" != *".."* ]] \
      || die "FIZIRA_RCLONE_PATH must be a relative path without '..'"
    rclone listremotes | grep -Fxq "${RCLONE_REMOTE}:" \
      || die "rclone remote is not configured: ${RCLONE_REMOTE}"
    ;;
  pull)
    id "$PULL_USER" >/dev/null 2>&1 || die "pull user does not exist: $PULL_USER"
    ;;
  *) die "FIZIRA_DELIVERY_MODE must be rclone or pull" ;;
esac

[[ -f "$PASSPHRASE_FILE" && -r "$PASSPHRASE_FILE" ]] \
  || die "backup passphrase file is missing or unreadable: $PASSPHRASE_FILE"
[[ -s "$PASSPHRASE_FILE" ]] || die "backup passphrase file is empty: $PASSPHRASE_FILE"
PASSPHRASE_MODE="$(stat -c '%a' "$PASSPHRASE_FILE")"
PASSPHRASE_OWNER="$(stat -c '%U' "$PASSPHRASE_FILE")"
[[ "$PASSPHRASE_OWNER" == "root" ]] || die "passphrase file must be owned by root"
(( (8#$PASSPHRASE_MODE & 077) == 0 )) || die "passphrase file must not be accessible by group or others"

mkdir -p -- "$(dirname -- "$LOCK_FILE")"
install -m 700 -d "$BACKUP_ROOT"
if [[ "$DELIVERY_MODE" == "pull" ]]; then
  PULL_GROUP="$(id -gn "$PULL_USER")"
  install -o root -g "$PULL_GROUP" -m 750 -d "$ENCRYPTED_ROOT"
else
  install -m 700 -d "$ENCRYPTED_ROOT"
fi
exec 9>"$LOCK_FILE"
flock -n 9 || die "another Fizira backup is already running"

echo "[1/7] Creating verified local snapshot..."
RUN_LOG="$(mktemp)"
FIZIRA_BACKUP_ROOT="$BACKUP_ROOT" "$CREATE_SCRIPT" | tee "$RUN_LOG"
BACKUP_DIR="$(sed -n 's/^path=//p' "$RUN_LOG" | tail -n 1)"
[[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]] || die "could not determine the new backup directory"
[[ "$(dirname -- "$BACKUP_DIR")" == "$BACKUP_ROOT" ]] || die "backup path escaped FIZIRA_BACKUP_ROOT"
STAMP="$(basename -- "$BACKUP_DIR")"
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "unexpected backup directory name: $STAMP"

if [[ "$VERIFY_RESTORE" == "1" ]]; then
  echo "[2/7] Restoring snapshot into an isolated temporary database..."
  FIZIRA_BACKUP_ROOT="$BACKUP_ROOT" "$RESTORE_SCRIPT" "$BACKUP_DIR"
else
  echo "[2/7] Restore test disabled by configuration."
fi

ARCHIVE_NAME="fizira-backup-${STAMP}.tar.enc"
ARCHIVE_PATH="${ENCRYPTED_ROOT}/${ARCHIVE_NAME}"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
PARTIAL_ARCHIVE="${ARCHIVE_PATH}.partial"
if [[ "$DELIVERY_MODE" == "rclone" ]]; then
  REMOTE_OBJECT="${RCLONE_REMOTE}:${RCLONE_PATH}/${ARCHIVE_NAME}"
  REMOTE_CHECKSUM="${REMOTE_OBJECT}.sha256"
fi

[[ ! -e "$ARCHIVE_PATH" && ! -e "$PARTIAL_ARCHIVE" ]] \
  || die "encrypted archive already exists: $ARCHIVE_PATH"

echo "[3/7] Encrypting snapshot..."
tar -C "$BACKUP_ROOT" -cf - "$STAMP" \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter "$PBKDF2_ITERATIONS" \
      -pass "file:${PASSPHRASE_FILE}" -out "$PARTIAL_ARCHIVE"
mv -- "$PARTIAL_ARCHIVE" "$ARCHIVE_PATH"
PARTIAL_ARCHIVE=""
(
  cd "$ENCRYPTED_ROOT"
  sha256sum "$ARCHIVE_NAME" > "${ARCHIVE_NAME}.sha256"
)
if [[ "$DELIVERY_MODE" == "pull" ]]; then
  chown root:"$PULL_GROUP" "$ARCHIVE_PATH" "$CHECKSUM_PATH"
  chmod 640 "$ARCHIVE_PATH" "$CHECKSUM_PATH"
fi

echo "[4/7] Verifying encrypted archive and password..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITERATIONS" \
  -pass "file:${PASSPHRASE_FILE}" -in "$ARCHIVE_PATH" \
  | tar -tf - >/dev/null
(
  cd "$ENCRYPTED_ROOT"
  sha256sum --check "${ARCHIVE_NAME}.sha256" >/dev/null
)

LOCAL_SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
if [[ "$DELIVERY_MODE" == "rclone" ]]; then
  echo "[5/7] Uploading encrypted archive to off-server storage..."
  rclone copyto "$ARCHIVE_PATH" "$REMOTE_OBJECT" --immutable
  rclone copyto "$CHECKSUM_PATH" "$REMOTE_CHECKSUM" --immutable

  echo "[6/7] Reading the uploaded object back and verifying SHA-256..."
  REMOTE_SHA256="$(rclone cat "$REMOTE_OBJECT" | sha256sum | awk '{print $1}')"
  [[ "$LOCAL_SHA256" == "$REMOTE_SHA256" ]] || die "uploaded archive checksum does not match local archive"
else
  echo "[5/7] Staging encrypted archive for pull by ${PULL_USER}..."
  echo "[6/7] Off-server verification will be performed by the Windows pull task."
fi

if [[ "$DELETE_RAW_AFTER_UPLOAD" == "1" ]]; then
  rm -rf --one-file-system -- "$BACKUP_DIR"
fi

echo "[7/7] Applying local encrypted-copy retention..."
find "$ENCRYPTED_ROOT" -maxdepth 1 -type f \
  \( -name 'fizira-backup-????????T??????Z.tar.enc' -o \
     -name 'fizira-backup-????????T??????Z.tar.enc.sha256' \) \
  -mtime "+${LOCAL_RETENTION_DAYS}" -delete

echo
echo "AUTOMATED_BACKUP_OK"
echo "archive=${ARCHIVE_PATH}"
if [[ "$DELIVERY_MODE" == "rclone" ]]; then
  echo "remote=${REMOTE_OBJECT}"
else
  echo "pull_ready=${ARCHIVE_PATH}"
fi
echo "sha256=${LOCAL_SHA256}"
if [[ "$DELIVERY_MODE" == "rclone" ]]; then
  echo "Remote retention must be configured with the object-storage provider."
else
  echo "The archive remains on the server until the Windows pull task copies it."
fi

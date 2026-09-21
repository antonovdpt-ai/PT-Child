#!/usr/bin/env bash
set -Eeuo pipefail

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

mkdir -p \
  "$TEST_ROOT/bin" \
  "$TEST_ROOT/backups" \
  "$TEST_ROOT/encrypted" \
  "$TEST_ROOT/remote"

cat > "$TEST_ROOT/create-backup" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
stamp=20260921T120000Z
mkdir -p "${FIZIRA_BACKUP_ROOT}/${stamp}"
printf 'database fixture\n' > "${FIZIRA_BACKUP_ROOT}/${stamp}/postgres.dump"
printf 'BACKUP_OK\npath=%s\n' "${FIZIRA_BACKUP_ROOT}/${stamp}"
SCRIPT

cat > "$TEST_ROOT/restore-test" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ -f "$1/postgres.dump" ]]
echo RESTORE_TEST_OK
SCRIPT

cat > "$TEST_ROOT/bin/rclone" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$1" in
  listremotes)
    echo 'fizira-offsite:'
    ;;
  copyto)
    source_path="$2"
    remote_path="${3#*:}"
    destination="${TEST_REMOTE_ROOT}/${remote_path}"
    mkdir -p "$(dirname -- "$destination")"
    [[ ! -e "$destination" ]] || {
      echo "immutable object already exists" >&2
      exit 1
    }
    cp -- "$source_path" "$destination"
    ;;
  cat)
    remote_path="${2#*:}"
    cat -- "${TEST_REMOTE_ROOT}/${remote_path}"
    ;;
  *)
    echo "unsupported fake rclone command: $1" >&2
    exit 1
    ;;
esac
SCRIPT

chmod 700 "$TEST_ROOT/create-backup" "$TEST_ROOT/restore-test" "$TEST_ROOT/bin/rclone"
printf 'correct horse battery staple\n' > "$TEST_ROOT/passphrase"
chmod 600 "$TEST_ROOT/passphrase"

cat > "$TEST_ROOT/backup.env" <<EOF
FIZIRA_CREATE_BACKUP_SCRIPT=$TEST_ROOT/create-backup
FIZIRA_RESTORE_TEST_SCRIPT=$TEST_ROOT/restore-test
FIZIRA_BACKUP_ROOT=$TEST_ROOT/backups
FIZIRA_ENCRYPTED_ROOT=$TEST_ROOT/encrypted
FIZIRA_BACKUP_PASSPHRASE_FILE=$TEST_ROOT/passphrase
FIZIRA_BACKUP_LOCK_FILE=$TEST_ROOT/backup.lock
FIZIRA_RCLONE_REMOTE=fizira-offsite
FIZIRA_RCLONE_PATH=fizira-production/backups
FIZIRA_LOCAL_RETENTION_DAYS=7
FIZIRA_VERIFY_RESTORE=1
FIZIRA_DELETE_RAW_AFTER_UPLOAD=1
FIZIRA_PBKDF2_ITERATIONS=100000
EOF
chmod 600 "$TEST_ROOT/backup.env"

export TEST_REMOTE_ROOT="$TEST_ROOT/remote"
OUTPUT="$(
  PATH="$TEST_ROOT/bin:$PATH" \
  FIZIRA_BACKUP_CONFIG="$TEST_ROOT/backup.env" \
  "$(dirname -- "${BASH_SOURCE[0]}")/../automated-backup.sh"
)"

grep -Fq AUTOMATED_BACKUP_OK <<< "$OUTPUT"
ARCHIVE_NAME=fizira-backup-20260921T120000Z.tar.enc
LOCAL_ARCHIVE="$TEST_ROOT/encrypted/$ARCHIVE_NAME"
REMOTE_ARCHIVE="$TEST_ROOT/remote/fizira-production/backups/$ARCHIVE_NAME"

[[ -f "$LOCAL_ARCHIVE" ]]
[[ -f "${LOCAL_ARCHIVE}.sha256" ]]
[[ -f "$REMOTE_ARCHIVE" ]]
[[ -f "${REMOTE_ARCHIVE}.sha256" ]]
[[ ! -e "$TEST_ROOT/backups/20260921T120000Z" ]]
[[ "$(sha256sum "$LOCAL_ARCHIVE" | awk '{print $1}')" == \
   "$(sha256sum "$REMOTE_ARCHIVE" | awk '{print $1}')" ]]

openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
  -pass "file:${TEST_ROOT}/passphrase" -in "$REMOTE_ARCHIVE" \
  | tar -tf - | grep -Fq '20260921T120000Z/postgres.dump'

echo TEST_AUTOMATED_BACKUP_OK

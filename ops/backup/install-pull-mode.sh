#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$EUID" -eq 0 ]] || {
  echo "ERROR: run this installer as root" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || {
  echo "ERROR: curl is required" >&2
  exit 1
}
id ftransfer >/dev/null 2>&1 || {
  echo "ERROR: the ftransfer account must exist before installing pull mode" >&2
  exit 1
}

SOURCE_REF="${FIZIRA_BACKUP_SOURCE_REF:-main}"
SOURCE_ROOT="https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/${SOURCE_REF}/ops/backup"
WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$WORK_DIR"; }
trap cleanup EXIT

mkdir -p "$WORK_DIR/systemd"
for file in create-backup.sh restore-test.sh automated-backup.sh install.sh backup.env.example; do
  curl -fsSL "${SOURCE_ROOT}/${file}" -o "${WORK_DIR}/${file}"
done
for file in fizira-backup.service fizira-backup.timer; do
  curl -fsSL "${SOURCE_ROOT}/systemd/${file}" -o "${WORK_DIR}/systemd/${file}"
done
chmod 700 "$WORK_DIR"/*.sh
bash "$WORK_DIR/install.sh"

if [[ -f /etc/fizira/backup.env ]]; then
  cp -a /etc/fizira/backup.env "/etc/fizira/backup.env.before-pull.$(date -u +%Y%m%dT%H%M%SZ)"
fi
cat > /etc/fizira/backup.env <<'EOF'
FIZIRA_PROJECT_ROOT=/root/supabase-project
FIZIRA_BACKUP_ROOT=/root/fizira-backups
FIZIRA_ENCRYPTED_ROOT=/home/ftransfer/fizira-backups
FIZIRA_DB_CONTAINER=supabase-db
FIZIRA_DELIVERY_MODE=pull
FIZIRA_PULL_USER=ftransfer
FIZIRA_BACKUP_PASSPHRASE_FILE=/etc/fizira/backup-passphrase
FIZIRA_LOCAL_RETENTION_DAYS=14
FIZIRA_VERIFY_RESTORE=1
FIZIRA_DELETE_RAW_AFTER_UPLOAD=1
FIZIRA_PBKDF2_ITERATIONS=600000
EOF
chown root:root /etc/fizira/backup.env
chmod 600 /etc/fizira/backup.env

if [[ ! -s /etc/fizira/backup-passphrase ]]; then
  while true; do
    IFS= read -r -s -p "Backup encryption password (at least 16 characters): " first < /dev/tty
    printf '\n' > /dev/tty
    if (( ${#first} < 16 )); then
      echo "Password is too short." > /dev/tty
      continue
    fi
    IFS= read -r -s -p "Repeat the password: " second < /dev/tty
    printf '\n' > /dev/tty
    [[ "$first" == "$second" ]] || {
      echo "Passwords do not match." > /dev/tty
      continue
    }
    break
  done
  umask 077
  printf '%s\n' "$first" > /etc/fizira/backup-passphrase
  unset first second
fi
chown root:root /etc/fizira/backup-passphrase
chmod 600 /etc/fizira/backup-passphrase

echo "Running the first full backup and isolated restore test..."
if ! systemctl start fizira-backup.service; then
  journalctl -u fizira-backup.service --no-pager -n 100 >&2
  exit 1
fi
systemctl enable --now fizira-backup.timer

echo
echo "PULL_BACKUP_INSTALL_OK"
systemctl list-timers fizira-backup.timer --no-pager
echo "Encrypted archives are ready in /home/ftransfer/fizira-backups."

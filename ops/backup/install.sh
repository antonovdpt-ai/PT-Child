#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$EUID" -eq 0 ]] || {
  echo "ERROR: run this installer as root" >&2
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/usr/local/lib/fizira-backup"
CONFIG_DIR="/etc/fizira"
SYSTEMD_DIR="/etc/systemd/system"

for file in create-backup.sh restore-test.sh automated-backup.sh backup.env.example; do
  [[ -f "${SCRIPT_DIR}/${file}" ]] || {
    echo "ERROR: missing installation file: ${SCRIPT_DIR}/${file}" >&2
    exit 1
  }
done

for file in fizira-backup.service fizira-backup.timer; do
  [[ -f "${SCRIPT_DIR}/systemd/${file}" ]] || {
    echo "ERROR: missing systemd file: ${SCRIPT_DIR}/systemd/${file}" >&2
    exit 1
  }
done

install -m 700 -d "$INSTALL_DIR" "$CONFIG_DIR"
install -m 700 \
  "${SCRIPT_DIR}/create-backup.sh" \
  "${SCRIPT_DIR}/restore-test.sh" \
  "${SCRIPT_DIR}/automated-backup.sh" \
  "$INSTALL_DIR/"

if [[ ! -e "${CONFIG_DIR}/backup.env" ]]; then
  install -m 600 "${SCRIPT_DIR}/backup.env.example" "${CONFIG_DIR}/backup.env"
  echo "Created ${CONFIG_DIR}/backup.env; configure it before enabling the timer."
fi

install -m 644 "${SCRIPT_DIR}/systemd/fizira-backup.service" "$SYSTEMD_DIR/"
install -m 644 "${SCRIPT_DIR}/systemd/fizira-backup.timer" "$SYSTEMD_DIR/"
systemctl daemon-reload

echo "INSTALL_OK"
echo "The timer was installed but not enabled."
echo "Configure the delivery mode and passphrase file, run a manual backup, then enable the timer."

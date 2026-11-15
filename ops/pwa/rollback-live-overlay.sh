#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$#" == 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || exit 2
release="$1"
target="/root/supabase-project/volumes/proxy/app"
root="$HOME/.cache/fizira-pwa/backups"
backup="$root/$release.tar.gz"
list="$root/$release.paths"
test -f "$backup" && test -f "$list"
files=(index.html manifest.webmanifest service-worker.js offline.html icons/icon-180.png icons/icon-192.png icons/icon-512.png)
for f in "${files[@]}"; do
  if ! grep -Fxq "$f" "$list"; then rm -f "$target/$f"; fi
done
tar -xzf "$backup" -C "$target"
echo "FIZIRA_PWA_ROLLBACK_RESTORED"

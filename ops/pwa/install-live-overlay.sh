#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$#" == 3 ]] || exit 2
stage="$1"; expected="$2"; release="$3"
target="/root/supabase-project/volumes/proxy/app"
root="$HOME/.cache/fizira-pwa/backups"
backup="$root/$release.tar.gz"
list="$root/$release.paths"
files=( index.html manifest.webmanifest service-worker.js offline.html icons/icon-180.png icons/icon-192.png icons/icon-512.png )
protected=( app.js cabinet.js styles.css schedule-domain.mjs schedule-editor.js )
[[ -d "$stage" && -d "$target" && "$expected" =~ ^[a-f0-9]{64}$ && "$release" =~ ^[a-f0-9]{40}$ ]] || exit 2
current="$(sha256sum "$target/index.html" | cut -d' ' -f1)"
[[ "$current" == "$expected" ]] || { echo "STOP: live index SHA does not match audited release baseline"; exit 1; }
for f in manifest.webmanifest service-worker.js offline.html icons/icon-180.png icons/icon-192.png icons/icon-512.png ops/pwa/patch-live-index.py; do
  test -f "$stage/$f"
done
mkdir -p "$root"
[[ ! -e "$backup" && ! -e "$list" ]] || { echo "STOP: backup already exists"; exit 1; }
: > "$list"
for f in "${files[@]}"; do [[ ! -f "$target/$f" ]] || printf '%s\n' "$f" >> "$list"; done
tar -czf "$backup" -C "$target" -T "$list"
sha256sum "$backup" > "$backup.sha256"
cp "$target/index.html" "$stage/patched-index.html"
python3 "$stage/ops/pwa/patch-live-index.py" "$stage/patched-index.html"
grep -Fq '<!-- Fizira PWA overlay v1 -->' "$stage/patched-index.html"
before="$(for f in "${protected[@]}"; do sha256sum "$target/$f"; done)"
activated=0
rollback_on_failure() {
  status=$?
  if [[ "$status" != 0 && "$activated" == 1 ]]; then
    echo "ROLLBACK: restoring original public assets"
    for f in "${files[@]}"; do
      if ! grep -Fxq "$f" "$list"; then rm -f "$target/$f"; fi
    done
    tar -xzf "$backup" -C "$target" || true
  fi
  exit "$status"
}
trap rollback_on_failure EXIT
activated=1
mkdir -p "$target/icons"
for f in manifest.webmanifest service-worker.js offline.html icons/icon-180.png icons/icon-192.png icons/icon-512.png; do
  install -m 0644 "$stage/$f" "$target/$f"
done
install -m 0644 "$stage/patched-index.html" "$target/index.html.pwa-next"
mv -f "$target/index.html.pwa-next" "$target/index.html"
after="$(for f in "${protected[@]}"; do sha256sum "$target/$f"; done)"
[[ "$before" == "$after" ]] || { echo "STOP: protected files changed"; exit 1; }
grep -Fq 'id="fizira-pwa-bootstrap"' "$target/index.html"
trap - EXIT
echo "FIZIRA_PWA_OVERLAY_APPLIED release=$release"

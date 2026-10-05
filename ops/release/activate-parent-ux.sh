#!/usr/bin/env bash
# One reviewed frontend correction; no DB, Edge or automatic rollback.
set -Eeuo pipefail
target="${1:?live frontend directory}"
payload="${2:?five reviewed files}"
backup="${3:?fresh additional backup directory}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
allowed=(app.js parent-specialist.js styles.css parent.html index.html)
changed=()
while read -r digest file; do
 old="$(awk -v f="$file" '$2==f{print $1}' "$script_dir/parent-ux-baseline.sha256")"
 test -n "$old"
 if [[ "$old" != "$digest" ]]; then
  case "$file" in app.js|parent-specialist.js|styles.css|parent.html|index.html) ;; *) echo "UNSUPPORTED_ASSET_DIFFERENCE $file" >&2; exit 1;; esac
 fi
done < "$script_dir/parent-ux-release.sha256"
for file in "${allowed[@]}"; do
 old="$(awk -v f="$file" '$2==f{print $1}' "$script_dir/parent-ux-baseline.sha256")"
 new="$(awk -v f="$file" '$2==f{print $1}' "$script_dir/parent-ux-release.sha256")"
 test -n "$old"; test -n "$new"
 if [[ "$old" != "$new" ]]; then changed+=("$file"); fi
done
test "${#changed[@]}" -gt 0
test -d "$target"; test ! -L "$target"
test -d "$payload"; test ! -L "$payload"
while read -r digest file; do
 test -f "$target/$file"; test ! -L "$target/$file"
done < "$script_dir/parent-ux-release.sha256"
for file in "${changed[@]}"; do
 test -f "$payload/$file"; test ! -L "$payload/$file"
 expected="$(awk -v f="$file" '$2==f{print $1}' "$script_dir/parent-ux-release.sha256")"
 test "$(sha256sum "$payload/$file" | cut -d' ' -f1)" == "$expected"
done
if (cd "$target"; sha256sum --status -c "$script_dir/parent-ux-release.sha256"); then
 echo PARENT_UX_ALREADY_ACTIVE
 exit 0
fi
# All 17 assets must still match the confirmed production baseline.
(cd "$target"; sha256sum --status -c "$script_dir/parent-ux-baseline.sha256")
test ! -e "$backup"; test ! -L "$backup"
mkdir -p "$backup/files"
for file in "${changed[@]}"; do cp -p -- "$target/$file" "$backup/files/$file"; done
cp -- "$script_dir/parent-ux-baseline.sha256" "$backup/before.sha256"
cp -- "$script_dir/parent-ux-release.sha256" "$backup/after.sha256"
for file in "${changed[@]}"; do
 expected="$(awk -v f="$file" '$2==f{print $1}' "$backup/before.sha256")"
 test "$(sha256sum "$backup/files/$file" | cut -d' ' -f1)" == "$expected"
done
touch "$backup/complete"
(cd "$target"; sha256sum --status -c "$script_dir/parent-ux-baseline.sha256")
temps=()
trap 'for temp in "${temps[@]}"; do rm -f -- "$temp"; done' EXIT
# Preserve live ownership and permissions; index.html activates new cache keys last.
for file in "${changed[@]}"; do
 temp="$(mktemp "$target/.parent-ux-XXXXXXXX")"
 temps+=("$temp")
 cp -p -- "$target/$file" "$temp"
 cat -- "$payload/$file" > "$temp"
 expected="$(awk -v f="$file" '$2==f{print $1}' "$backup/after.sha256")"
 test "$(sha256sum "$temp" | cut -d' ' -f1)" == "$expected"
done
# Prepare every replacement before changing any live byte (e.g. disk-full failures).
(cd "$target"; sha256sum --status -c "$script_dir/parent-ux-baseline.sha256")
for index in "${!changed[@]}"; do mv -- "${temps[$index]}" "$target/${changed[$index]}"; done
(cd "$target"; sha256sum --status -c "$script_dir/parent-ux-release.sha256")
echo PARENT_UX_ACTIVATION_OK

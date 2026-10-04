#!/usr/bin/env bash
# Runs only on the target after the source/release preflight; also exercised locally.
set -Eeuo pipefail
mode="${1:?activate or rollback}"; target="${2:?target}"; stage="${3:?stage}"; backup="${4:?backup}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mapfile -t assets < "$script_dir/frontend-assets.txt"
hash() { sha256sum "$1" | cut -d' ' -f1; }
if [[ "$mode" == activate ]]; then
 test -d "$target"; test -d "$stage"
 # Validate all bytes before mutation; index.html is deliberately last.
 for file in "${assets[@]}"; do test -f "$stage/$file"; test ! -L "$stage/$file"; test ! -L "$target/$file"; done
 if [[ -e "$backup/complete" ]]; then echo 'Backup already exists; refusing reused release' >&2; exit 1; fi
 mkdir -p "$backup/files"
 : > "$backup/before.tsv"; : > "$backup/release.tsv"
 for file in "${assets[@]}"; do
  if [[ -e "$target/$file" ]]; then test -f "$target/$file"; cp -p -- "$target/$file" "$backup/files/$file"; old="$(hash "$target/$file")"; else old=ABSENT; fi
  printf '%s\t%s\n' "$file" "$old" >> "$backup/before.tsv"
  printf '%s\t%s\n' "$file" "$(hash "$stage/$file")" >> "$backup/release.tsv"
 done
 touch "$backup/complete"
 # Recheck the snapshot immediately before overwriting a live asset.
 while IFS=$'\t' read -r file old; do
  if [[ "$old" == ABSENT ]]; then test ! -e "$target/$file"; else test "$(hash "$target/$file")" == "$old"; fi
 done < "$backup/before.tsv"
 for file in "${assets[@]}"; do mv -- "$stage/$file" "$target/$file"; done
 for file in "${assets[@]}"; do expected="$(awk -F '\t' -v f="$file" '$1==f{print $2}' "$backup/release.tsv")"; test "$(hash "$target/$file")" == "$expected"; done
elif [[ "$mode" == rollback ]]; then
 test -f "$backup/complete"
 # Abort the whole rollback before any mutation if a live file is unknown/newer.
 for file in "${assets[@]}"; do
  test ! -L "$target/$file"
  old="$(awk -F '\t' -v f="$file" '$1==f{print $2}' "$backup/before.tsv")"
  released="$(awk -F '\t' -v f="$file" '$1==f{print $2}' "$backup/release.tsv")"
  test -n "$old"; test -n "$released"
  if [[ -f "$target/$file" ]]; then current="$(hash "$target/$file")"; else test ! -e "$target/$file"; current=ABSENT; fi
  if [[ "$current" != "$old" && "$current" != "$released" ]]; then echo "UNKNOWN_LIVE__STOP $file" >&2; exit 1; fi
  if [[ "$old" != ABSENT ]]; then test "$(hash "$backup/files/$file")" == "$old"; fi
 done
 for file in "${assets[@]}"; do
  old="$(awk -F '\t' -v f="$file" '$1==f{print $2}' "$backup/before.tsv")"
  if [[ "$old" == ABSENT ]]; then rm -f -- "$target/$file"; else cp -p -- "$backup/files/$file" "$target/$file.rollback"; mv -- "$target/$file.rollback" "$target/$file"; fi
 done
else echo 'Unknown mode' >&2; exit 1; fi

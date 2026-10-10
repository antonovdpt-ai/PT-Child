#!/usr/bin/env bash
# Runs only on the target after the source/release preflight; also exercised locally.
set -Eeuo pipefail
mode="${1:?activate, snapshot or rollback}"; target="${2:?target}"; stage="${3:?stage}"; backup="${4:?backup}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mapfile -t assets < "$script_dir/frontend-assets.txt"
if [[ "$mode" == activate || "$mode" == snapshot ]]; then
 test -d "$target"; test -d "$stage"
 # Validate all bytes before mutation; index.html is deliberately last.
 for file in "${assets[@]}"; do test -f "$stage/$file"; test ! -L "$stage/$file"; test ! -L "$target/$file"; done
 if [[ -e "$backup/complete" ]]; then echo 'Backup already exists; refusing reused release' >&2; exit 1; fi
 python3 -B "$script_dir/frontend-snapshot.py" create --target "$target" --stage "$stage" --backup "$backup" --assets "$script_dir/frontend-assets.txt"
 if [[ "$mode" == snapshot ]]; then echo 'SNAPSHOT_CREATED_NO_LIVE_CHANGES'; exit 0; fi
 # FD-based verified copy/rename keeps unchanged dependencies in place and
 # publishes index.html last. Unknown bytes still stop before mutation.
 python3 -B "$script_dir/frontend-snapshot.py" activate --target "$target" --stage "$stage" --backup "$backup" --assets "$script_dir/frontend-assets.txt"
elif [[ "$mode" == rollback ]]; then
 test -f "$backup/complete"
 # Verifies the entire copy and every live state before restoration; exclusive
 # random temporary files cannot follow a planted *.rollback symlink.
 python3 -B "$script_dir/frontend-snapshot.py" rollback --target "$target" --backup "$backup" --assets "$script_dir/frontend-assets.txt"
else echo 'Unknown mode' >&2; exit 1; fi

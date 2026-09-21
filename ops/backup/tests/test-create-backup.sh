#!/usr/bin/env bash
set -Eeuo pipefail

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

PROJECT_ROOT="$TEST_ROOT/project"
BACKUP_ROOT="$TEST_ROOT/backups"
mkdir -p \
  "$TEST_ROOT/bin" \
  "$PROJECT_ROOT/volumes/storage/bucket" \
  "$PROJECT_ROOT/volumes/functions/example" \
  "$PROJECT_ROOT/volumes/db/data" \
  "$PROJECT_ROOT/volumes/api"

printf 'JWT_SECRET=test-secret\n' > "$PROJECT_ROOT/.env"
printf 'compose fixture\n' > "$PROJECT_ROOT/docker-compose.yml"
printf 'stored object\n' > "$PROJECT_ROOT/volumes/storage/bucket/object"
printf 'function source\n' > "$PROJECT_ROOT/volumes/functions/example/index.ts"
printf 'database volume\n' > "$PROJECT_ROOT/volumes/db/data/postgres-file"
printf 'api config\n' > "$PROJECT_ROOT/volumes/api/config.yml"

cat > "$TEST_ROOT/bin/docker" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$1" in
  inspect)
    if [[ "${2:-}" == "-f" ]]; then
      case "$3" in
        *State.Running*) echo true ;;
        *Config.Image*) echo supabase/postgres:test ;;
        *) exit 1 ;;
      esac
    else
      echo '{}'
    fi
    ;;
  exec)
    if [[ "$*" == *" pg_dump "* ]]; then
      printf 'custom dump fixture\n'
    elif [[ "$*" == *" pg_restore --list"* ]]; then
      cat >/dev/null
    else
      exit 1
    fi
    ;;
  *)
    exit 1
    ;;
esac
SCRIPT
chmod 700 "$TEST_ROOT/bin/docker"

OUTPUT="$(
  PATH="$TEST_ROOT/bin:$PATH" \
  FIZIRA_PROJECT_ROOT="$PROJECT_ROOT" \
  FIZIRA_BACKUP_ROOT="$BACKUP_ROOT" \
  FIZIRA_DB_CONTAINER=supabase-db \
  "$(dirname -- "${BASH_SOURCE[0]}")/../create-backup.sh"
)"

grep -Fq BACKUP_OK <<< "$OUTPUT"
BACKUP_DIR="$(sed -n 's/^path=//p' <<< "$OUTPUT")"
[[ -d "$BACKUP_DIR" ]]

for file in postgres.dump storage.tar.gz functions.tar.gz config.tar.gz metadata.txt SHA256SUMS; do
  [[ -f "$BACKUP_DIR/$file" ]]
done

(
  cd "$BACKUP_DIR"
  sha256sum --check SHA256SUMS >/dev/null
)

CONFIG_LIST="$(tar -tzf "$BACKUP_DIR/config.tar.gz")"
grep -Fxq './.env' <<< "$CONFIG_LIST"
grep -Fxq './docker-compose.yml' <<< "$CONFIG_LIST"
grep -Fxq './volumes/api/config.yml' <<< "$CONFIG_LIST"
if grep -Eq '^\./volumes/(storage|functions|db/data)(/|$)' <<< "$CONFIG_LIST"; then
  echo "excluded data directory leaked into config.tar.gz" >&2
  exit 1
fi

echo TEST_CREATE_BACKUP_OK

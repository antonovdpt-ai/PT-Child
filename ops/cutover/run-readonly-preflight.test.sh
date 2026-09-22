#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT_DIR}/ops/cutover/run-readonly-preflight.sh"

bash -n "${SCRIPT}"

grep -Fq 'read -r -s -p' "${SCRIPT}"
grep -Fq -- '-e PGPASSWORD' "${SCRIPT}"
grep -Fq 'unset PGPASSWORD' "${SCRIPT}"
grep -Fq 'Running database parity preflight (SELECT only)' "${SCRIPT}"
grep -Fq 'READONLY_PRODUCTION_PREFLIGHT_OK' "${SCRIPT}"

if grep -Eq -- '--password=|postgresql://[^ ]+:[^ ]+@' "${SCRIPT}"; then
  echo 'ERROR: wrapper places a database password in command arguments' >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

mkdir -p "${TMP_DIR}/project" "${TMP_DIR}/bin"

cat > "${TMP_DIR}/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "compose" && "${2:-}" == "version" ]]; then
  printf 'Docker Compose mock\n'
  exit 0
fi

if [[ "${1:-}" == "compose" && "${2:-}" == "ps" ]]; then
  printf 'db\n'
  exit 0
fi

if [[ "${1:-}" == "compose" && "${2:-}" == "exec" ]]; then
  [[ -n "${PGPASSWORD:-}" ]] || {
    echo 'ERROR: PGPASSWORD was not passed through the environment' >&2
    exit 1
  }
  printf '1\n'
  exit 0
fi

echo "ERROR: unexpected docker invocation: $*" >&2
exit 1
MOCK_DOCKER
chmod 700 "${TMP_DIR}/bin/docker"

cat > "${TMP_DIR}/fake-preflight.sh" <<'MOCK_PREFLIGHT'
#!/usr/bin/env bash
set -euo pipefail

[[ "$(psql service=fizira-source --command='SELECT 1')" == '1' ]]
[[ "$(psql service=fizira-target --command='SELECT 1')" == '1' ]]
printf 'CUTOVER_DATABASE_PARITY_OK\n'
MOCK_PREFLIGHT
chmod 700 "${TMP_DIR}/fake-preflight.sh"

output="$(
  printf '\n\n\n\nmock-secret\n' | \
    PATH="${TMP_DIR}/bin:${PATH}" \
    FIZIRA_PROJECT_ROOT="${TMP_DIR}/project" \
    FIZIRA_CUTOVER_EVIDENCE_ROOT="${TMP_DIR}/evidence" \
    FIZIRA_PREFLIGHT_SCRIPT="${TMP_DIR}/fake-preflight.sh" \
    bash "${SCRIPT}"
)"

grep -Fq 'CUTOVER_DATABASE_PARITY_OK' <<< "${output}"
grep -Fq 'READONLY_PRODUCTION_PREFLIGHT_OK' <<< "${output}"

if grep -Fq 'mock-secret' <<< "${output}"; then
  echo 'ERROR: source database password leaked to output' >&2
  exit 1
fi

printf 'READONLY_PREFLIGHT_WRAPPER_TEST_OK\n'


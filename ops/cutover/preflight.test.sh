#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT_DIR}/ops/cutover/preflight.sh"

bash -n "${SCRIPT}"

grep -Fq 'source and target PostgreSQL services must be different' "${SCRIPT}"
grep -Fq 'storage.objects' "${SCRIPT}"
grep -Fq 'auth.users' "${SCRIPT}"
grep -Fq 'row_to_json' "${SCRIPT}"
grep -Fq 'CUTOVER_DATABASE_PARITY_OK' "${SCRIPT}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

psql() {
  local service="$1"
  local query="${*: -1}"

  if [[ "${FAKE_MISMATCH:-no}" == "yes" ]] &&
     [[ "${service}" == "service=fizira-target" ]] &&
     [[ "${query}" == *"public.patients AS t"* ]]; then
    printf '12\tmismatch\n'
  else
    printf '11\tmatching-digest\n'
  fi
}

export -f psql

success_output="$(
  FIZIRA_CUTOVER_OUTPUT_DIR="${TMP_DIR}/success" \
    bash "${SCRIPT}"
)"

grep -Fq 'CUTOVER_DATABASE_PARITY_OK' <<< "${success_output}"

if FAKE_MISMATCH=yes \
  FIZIRA_CUTOVER_OUTPUT_DIR="${TMP_DIR}/mismatch" \
  bash "${SCRIPT}" > "${TMP_DIR}/mismatch.stdout" 2> "${TMP_DIR}/mismatch.stderr"; then
  echo 'ERROR: mismatched databases were accepted' >&2
  exit 1
fi

grep -Fq 'CUTOVER_DATABASE_PARITY_FAILED' "${TMP_DIR}/mismatch.stderr"
grep -Fq 'public.patients' "${TMP_DIR}/mismatch/database.diff"

printf 'CUTOVER_PREFLIGHT_STATIC_TEST_OK\n'

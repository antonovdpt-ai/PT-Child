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

printf 'CUTOVER_PREFLIGHT_STATIC_TEST_OK\n'

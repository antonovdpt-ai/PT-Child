#!/usr/bin/env bash
set -euo pipefail

SOURCE_SERVICE="${FIZIRA_SOURCE_PGSERVICE:-fizira-source}"
TARGET_SERVICE="${FIZIRA_TARGET_PGSERVICE:-fizira-target}"
OUTPUT_DIR="${FIZIRA_CUTOVER_OUTPUT_DIR:-$(pwd)/cutover-evidence}"

if [[ "${SOURCE_SERVICE}" == "${TARGET_SERVICE}" ]]; then
  echo "ERROR: source and target PostgreSQL services must be different" >&2
  exit 1
fi

command -v psql >/dev/null 2>&1 || {
  echo "ERROR: psql is required" >&2
  exit 1
}

mkdir -p "${OUTPUT_DIR}"
chmod 700 "${OUTPUT_DIR}"

RELATIONS=(
  auth.users
  public.profiles
  public.patients
  public.assessments
  public.goals
  public.sessions
  public.patient_media
  public.patient_contacts
  public.parent_reports
  public.standardized_assessments
  public.ai_analysis_history
  public.user_consents
  storage.buckets
  storage.objects
)

sql_for_relation() {
  local relation="$1"

  case "${relation}" in
    auth.users|public.profiles|public.patients|public.assessments|public.goals|\
    public.sessions|public.patient_media|public.patient_contacts|\
    public.parent_reports|public.standardized_assessments|\
    public.ai_analysis_history|public.user_consents|storage.buckets|storage.objects)
      ;;
    *)
      echo "ERROR: relation is not allow-listed: ${relation}" >&2
      exit 1
      ;;
  esac

  printf '%s' "
    SELECT
      count(*)::text,
      COALESCE(
        md5(string_agg(row_hash, '' ORDER BY row_hash)),
        md5('')
      )
    FROM (
      SELECT md5(row_to_json(t)::text) AS row_hash
      FROM ${relation} AS t
    ) AS rows;
  "
}

capture_inventory() {
  local service="$1"
  local destination="$2"
  local temporary
  temporary="$(mktemp "${OUTPUT_DIR}/inventory.XXXXXX")"
  chmod 600 "${temporary}"

  {
    printf 'relation\trows\trow_digest\n'

    for relation in "${RELATIONS[@]}"; do
      result="$(
        psql "service=${service}" \
          -X \
          --set=ON_ERROR_STOP=1 \
          --tuples-only \
          --no-align \
          --field-separator=$'\t' \
          --command="$(sql_for_relation "${relation}")"
      )"

      printf '%s\t%s\n' "${relation}" "${result}"
    done
  } > "${temporary}"

  mv "${temporary}" "${destination}"
}

echo "Capturing source inventory..."
capture_inventory "${SOURCE_SERVICE}" "${OUTPUT_DIR}/source.tsv"

echo "Capturing target inventory..."
capture_inventory "${TARGET_SERVICE}" "${OUTPUT_DIR}/target.tsv"

if diff -u "${OUTPUT_DIR}/source.tsv" "${OUTPUT_DIR}/target.tsv" \
  > "${OUTPUT_DIR}/database.diff"; then
  rm -f "${OUTPUT_DIR}/database.diff"
  printf 'CUTOVER_DATABASE_PARITY_OK\n'
else
  chmod 600 "${OUTPUT_DIR}/database.diff"
  printf 'CUTOVER_DATABASE_PARITY_FAILED diff=%s\n' \
    "${OUTPUT_DIR}/database.diff" >&2
  exit 1
fi

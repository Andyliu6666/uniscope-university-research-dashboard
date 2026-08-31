#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
OUTPUT_FILE="${1:-$PROJECT_DIR/data/import-status.json}"
TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/uniscope-import-status.XXXXXX")
trap 'rm -f "$TEMP_FILE"' EXIT

cd "$PROJECT_DIR"
mkdir -p "$(dirname "$OUTPUT_FILE")"

docker compose exec -T db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' >"$TEMP_FILE" <<'SQL'
WITH latest_run AS (
  SELECT *
  FROM import_runs
  ORDER BY updated_at DESC, started_at DESC
  LIMIT 1
)
SELECT jsonb_pretty(
  jsonb_build_object(
    'schemaVersion', 1,
    'generatedAt', to_char(current_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'database', jsonb_build_object(
      'universities', (SELECT count(*) FROM universities),
      'countries', (SELECT count(DISTINCT country) FROM universities),
      'sourcedProfiles', (SELECT count(DISTINCT university_id) FROM sources),
      'rorIdentifiers', (
        SELECT count(*) FROM institution_identifiers WHERE provider = 'ror'
      ),
      'identifierCounts', COALESCE(
        (
          SELECT jsonb_object_agg(provider, identifier_count ORDER BY provider)
          FROM (
            SELECT provider, count(*) AS identifier_count
            FROM institution_identifiers
            GROUP BY provider
          ) counts
        ),
        '{}'::jsonb
      ),
      'factCounts', jsonb_build_object(
        'programs', (SELECT count(*) FROM programs),
        'deadlines', (SELECT count(*) FROM deadlines),
        'admissionProfiles', (SELECT count(*) FROM admission_profiles),
        'admissionCounts', (SELECT count(*) FROM admission_counts),
        'admissionRequirements', (SELECT count(*) FROM admission_requirements),
        'admissionTestScores', (SELECT count(*) FROM admission_test_scores),
        'enrollmentSnapshots', (SELECT count(*) FROM enrollment_snapshots),
        'costSnapshots', (SELECT count(*) FROM cost_snapshots),
        'financialAidSnapshots', (SELECT count(*) FROM financial_aid_snapshots)
      ),
      'profileCoverage', jsonb_build_object(
        'programs', (SELECT count(DISTINCT university_id) FROM programs),
        'deadlines', (SELECT count(DISTINCT university_id) FROM deadlines),
        'admissions', (SELECT count(DISTINCT university_id) FROM admission_profiles),
        'enrollment', (SELECT count(DISTINCT university_id) FROM enrollment_snapshots),
        'costs', (SELECT count(DISTINCT university_id) FROM cost_snapshots),
        'financialAid', (SELECT count(DISTINCT university_id) FROM financial_aid_snapshots)
      ),
      'coreCoverage', jsonb_build_object(
        'institutionType', (
          SELECT count(*) FROM universities WHERE institution_type <> 'unknown'
        ),
        'ownership', (
          SELECT count(*) FROM universities WHERE ownership IS NOT NULL AND ownership <> 'unknown'
        ),
        'operatingStatus', (
          SELECT count(*) FROM universities WHERE operating_status IS NOT NULL AND operating_status <> 'unknown'
        ),
        'offersUndergraduate', (
          SELECT count(*) FROM universities WHERE offers_undergraduate IS NOT NULL
        ),
        'offersGraduate', (
          SELECT count(*) FROM universities WHERE offers_graduate IS NOT NULL
        ),
        'studentCount', (SELECT count(*) FROM universities WHERE student_count IS NOT NULL),
        'establishedYear', (SELECT count(*) FROM universities WHERE established_year IS NOT NULL),
        'officialWebsite', (SELECT count(*) FROM universities WHERE official_website IS NOT NULL),
        'admissionsUrl', (SELECT count(*) FROM universities WHERE admissions_url IS NOT NULL),
        'financialAidUrl', (SELECT count(*) FROM universities WHERE financial_aid_url IS NOT NULL),
        'netPriceUrl', (SELECT count(*) FROM universities WHERE net_price_url IS NOT NULL)
      ),
      'rejectedRows', (SELECT count(*) FROM import_rejections)
    ),
    'latestImport', COALESCE(
      (
        SELECT jsonb_build_object(
          'provider', provider,
          'datasetVersion', dataset_version,
          'artifactSha256', artifact_hash,
          'status', status,
          'checkpoint', checkpoint,
          'processed', processed_count,
          'inserted', inserted_count,
          'updated', updated_count,
          'skipped', skipped_count,
          'rejected', rejected_count,
          'startedAt', started_at,
          'finishedAt', finished_at,
          'updatedAt', updated_at
        )
        FROM latest_run
      ),
      'null'::jsonb
    )
  )
);
SQL

mv "$TEMP_FILE" "$OUTPUT_FILE"
trap - EXIT
echo "Wrote import status to $OUTPUT_FILE"

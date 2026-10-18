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
), ib_rows AS (
  SELECT q.id, p.university_id, p.program_id, p.level,
         q.source_flags #>> '{ib,status}' AS status
  FROM qualification_requirements q
  INNER JOIN admission_profiles p ON p.id = q.admission_profile_id
  INNER JOIN sources s ON s.id = q.source_id AND s.university_id = p.university_id
  WHERE q.qualification_system = 'IB'
    AND q.source_flags->>'provider' = 'official_ib'
    AND s.category = 'official'
)
SELECT jsonb_pretty(
  jsonb_build_object(
    'schemaVersion', 2,
    'generatedAt', to_char(current_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'database', jsonb_build_object(
      'universities', (SELECT count(*) FROM universities),
      'countries', (SELECT count(DISTINCT country) FROM universities),
      'sourcedProfiles', (SELECT count(DISTINCT university_id) FROM sources),
      'rorIdentifiers', (
        SELECT count(*) FROM institution_identifiers WHERE provider = 'ror'
      ),
      'institutionAliases', (SELECT count(*) FROM institution_aliases),
      'aliasedProfiles', (SELECT count(DISTINCT university_id) FROM institution_aliases),
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
        'qualificationRequirements', (SELECT count(*) FROM qualification_requirements),
        'admissionTestScores', (SELECT count(*) FROM admission_test_scores),
        'enrollmentSnapshots', (SELECT count(*) FROM enrollment_snapshots),
        'costSnapshots', (SELECT count(*) FROM cost_snapshots),
        'financialAidSnapshots', (SELECT count(*) FROM financial_aid_snapshots),
        'researchProfiles', (SELECT count(*) FROM research_profiles)
      ),
      'profileCoverage', jsonb_build_object(
        'programs', (SELECT count(DISTINCT university_id) FROM programs),
        'deadlines', (SELECT count(DISTINCT university_id) FROM deadlines),
        'admissions', (SELECT count(DISTINCT university_id) FROM admission_profiles),
        'enrollment', (SELECT count(DISTINCT university_id) FROM enrollment_snapshots),
        'costs', (SELECT count(DISTINCT university_id) FROM cost_snapshots),
        'financialAid', (SELECT count(DISTINCT university_id) FROM financial_aid_snapshots),
        'research', (SELECT count(DISTINCT university_id) FROM research_profiles),
        'noStructuredApplicationFacts', (
          SELECT count(*)
          FROM universities university
          WHERE NOT EXISTS (
            SELECT 1 FROM programs program WHERE program.university_id = university.id
          )
            AND NOT EXISTS (
              SELECT 1 FROM deadlines deadline WHERE deadline.university_id = university.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM admission_profiles admission WHERE admission.university_id = university.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM enrollment_snapshots enrollment WHERE enrollment.university_id = university.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM cost_snapshots cost WHERE cost.university_id = university.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM financial_aid_snapshots aid WHERE aid.university_id = university.id
            )
        )
      ),
      'reviewedAdmissionsCoverage', jsonb_build_object(
        'facts', (SELECT count(*) FROM admission_requirements WHERE source_flags->>'provider' = 'official_admissions'),
        'profiles', (SELECT count(DISTINCT admission_profile_id) FROM admission_requirements WHERE source_flags->>'provider' = 'official_admissions'),
        'institutions', (SELECT count(DISTINCT p.university_id) FROM admission_requirements r JOIN admission_profiles p ON p.id = r.admission_profile_id WHERE r.source_flags->>'provider' = 'official_admissions')
      ),
      'ibCoverage', jsonb_build_object(
        'reviewedRecords', (SELECT count(*) FROM ib_rows),
        'institutionsWithReviewedIb', (SELECT count(DISTINCT university_id) FROM ib_rows),
        'institutionWidePolicies', (SELECT count(*) FROM ib_rows WHERE program_id IS NULL),
        'programsWithReviewedIb', (SELECT count(DISTINCT program_id) FROM ib_rows),
        'programsWithPublishedTotals', (
          SELECT count(DISTINCT program_id) FROM ib_rows WHERE status = 'published'
        ),
        'undergraduateCatalogEntries', (SELECT count(*) FROM programs WHERE level = 'undergraduate'),
        'byCountry', COALESCE((
          SELECT jsonb_agg(country_counts ORDER BY country)
          FROM (
            SELECT u.country, count(DISTINCT ib.university_id) AS institutions,
                   count(DISTINCT ib.program_id) AS programs_with_reviewed_ib,
                   count(DISTINCT ib.program_id) FILTER (WHERE ib.status = 'published') AS programs_with_published_totals
            FROM ib_rows ib INNER JOIN universities u ON u.id = ib.university_id
            GROUP BY u.country
          ) country_counts
        ), '[]'::jsonb)
      ),
      'coreCoverage', jsonb_build_object(
        'countryCode', (SELECT count(*) FROM universities WHERE country_code IS NOT NULL),
        'continentCode', (SELECT count(*) FROM universities WHERE continent_code IS NOT NULL),
        'region', (SELECT count(*) FROM universities WHERE region IS NOT NULL),
        'address', (SELECT count(*) FROM universities WHERE address_line IS NOT NULL),
        'postalCode', (SELECT count(*) FROM universities WHERE postal_code IS NOT NULL),
        'phone', (SELECT count(*) FROM universities WHERE phone IS NOT NULL),
        'coordinates', (
          SELECT count(*) FROM universities WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ),
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
        'wikipediaUrl', (SELECT count(*) FROM universities WHERE wikipedia_url IS NOT NULL),
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

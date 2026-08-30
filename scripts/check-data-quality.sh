#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
cd "$PROJECT_DIR"

docker compose exec -T db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
\pset pager off

SELECT
  (SELECT count(*) FROM universities) AS universities,
  (SELECT count(DISTINCT country) FROM universities) AS countries,
  (SELECT count(DISTINCT university_id) FROM sources) AS sourced_profiles,
  (SELECT count(*) FROM import_rejections) AS rejected_import_rows;

DO $$
DECLARE
  missing_sources integer;
  missing_identifiers integer;
  duplicate_identifiers integer;
  duplicate_slugs integer;
  orphan_identifiers integer;
  insecure_sources integer;
  failed_imports integer;
  running_imports integer;
  inconsistent_import_counts integer;
  inconsistent_rejection_ledgers integer;
  ipeds_rejections_without_source_rows integer;
  invalid_completed_ipeds_runs integer;
BEGIN
  SELECT count(*) INTO missing_sources
  FROM universities u
  WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.university_id = u.id);

  SELECT count(*) INTO missing_identifiers
  FROM universities u
  WHERE NOT EXISTS (
    SELECT 1 FROM institution_identifiers i WHERE i.university_id = u.id
  );

  SELECT count(*) INTO duplicate_identifiers
  FROM (
    SELECT provider, external_id
    FROM institution_identifiers
    GROUP BY provider, external_id
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO duplicate_slugs
  FROM (
    SELECT slug
    FROM universities
    GROUP BY slug
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO orphan_identifiers
  FROM institution_identifiers i
  LEFT JOIN universities u ON u.id = i.university_id
  WHERE u.id IS NULL;

  SELECT count(*) INTO insecure_sources
  FROM sources
  WHERE url !~ '^https://';

  SELECT count(*) INTO failed_imports
  FROM import_runs
  WHERE status = 'failed';

  SELECT count(*) INTO running_imports
  FROM import_runs
  WHERE status = 'running';

  SELECT count(*) INTO inconsistent_import_counts
  FROM import_runs
  WHERE processed_count <> inserted_count + updated_count + skipped_count + rejected_count;

  SELECT count(*) INTO inconsistent_rejection_ledgers
  FROM import_runs r
  WHERE rejected_count <> (
    SELECT count(*) FROM import_rejections rejection WHERE rejection.run_id = r.id
  );

  SELECT count(*) INTO ipeds_rejections_without_source_rows
  FROM import_rejections rejection
  INNER JOIN import_runs run ON run.id = rejection.run_id
  WHERE run.provider = 'ipeds' AND rejection.source_row IS NULL;

  SELECT count(*) INTO invalid_completed_ipeds_runs
  FROM import_runs
  WHERE provider = 'ipeds'
    AND status = 'completed'
    AND (
      jsonb_typeof(checkpoint->'sourceRow') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'sourceRows') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'eligibleRows') IS DISTINCT FROM 'number' OR
      (checkpoint->>'sourceRow')::integer <> (checkpoint->>'sourceRows')::integer OR
      processed_count <> (checkpoint->>'eligibleRows')::integer
    );

  IF
    missing_sources > 0 OR
    missing_identifiers > 0 OR
    duplicate_identifiers > 0 OR
    duplicate_slugs > 0 OR
    orphan_identifiers > 0 OR
    insecure_sources > 0 OR
    failed_imports > 0 OR
    running_imports > 0 OR
    inconsistent_import_counts > 0 OR
    inconsistent_rejection_ledgers > 0 OR
    ipeds_rejections_without_source_rows > 0 OR
    invalid_completed_ipeds_runs > 0
  THEN
    RAISE EXCEPTION
      'Data quality gate failed: missing sources %, missing identifiers %, duplicate identifiers %, duplicate slugs %, orphan identifiers %, insecure sources %, failed imports %, running imports %, inconsistent import counts %, inconsistent rejection ledgers %, IPEDS rejections without source rows %, invalid completed IPEDS runs %',
      missing_sources,
      missing_identifiers,
      duplicate_identifiers,
      duplicate_slugs,
      orphan_identifiers,
      insecure_sources,
      failed_imports,
      running_imports,
      inconsistent_import_counts,
      inconsistent_rejection_ledgers,
      ipeds_rejections_without_source_rows,
      invalid_completed_ipeds_runs;
  END IF;
END $$;
SQL

curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:5173/healthz >/dev/null
echo "Data quality, API, and website checks passed."

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
  (SELECT count(*) FROM admission_profiles) AS admission_profiles,
  (SELECT count(*) FROM admission_counts) AS admission_counts,
  (SELECT count(*) FROM admission_requirements) AS admission_requirements,
  (SELECT count(*) FROM admission_test_scores) AS admission_test_scores,
  (SELECT count(*) FROM enrollment_snapshots) AS enrollment_snapshots,
  (SELECT count(*) FROM cost_snapshots) AS cost_snapshots,
  (SELECT count(*) FROM financial_aid_snapshots) AS financial_aid_snapshots,
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
  invalid_completed_admission_runs integer;
  invalid_completed_enrichment_runs integer;
  orphan_admission_profiles integer;
  orphan_admission_facts integer;
  orphan_enrichment_facts integer;
  negative_admission_counts integer;
  invalid_admission_test_values integer;
  negative_enrollment_counts integer;
  invalid_cost_values integer;
  invalid_financial_aid_values integer;
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

  SELECT count(*) INTO orphan_admission_profiles
  FROM admission_profiles p
  LEFT JOIN universities u ON u.id = p.university_id
  LEFT JOIN sources s ON s.id = p.source_id
  WHERE u.id IS NULL OR s.id IS NULL;

  SELECT COALESCE(SUM(orphan_count), 0)::integer INTO orphan_admission_facts
  FROM (
    SELECT count(*) AS orphan_count
    FROM admission_counts c
    LEFT JOIN admission_profiles p ON p.id = c.admission_profile_id
    LEFT JOIN sources s ON s.id = c.source_id
    WHERE p.id IS NULL OR s.id IS NULL
    UNION ALL
    SELECT count(*) AS orphan_count
    FROM admission_requirements r
    LEFT JOIN admission_profiles p ON p.id = r.admission_profile_id
    LEFT JOIN sources s ON s.id = r.source_id
    WHERE p.id IS NULL OR s.id IS NULL
    UNION ALL
    SELECT count(*) AS orphan_count
    FROM qualification_requirements q
    LEFT JOIN admission_profiles p ON p.id = q.admission_profile_id
    LEFT JOIN sources s ON s.id = q.source_id
    WHERE p.id IS NULL OR s.id IS NULL
    UNION ALL
    SELECT count(*) AS orphan_count
    FROM admission_test_scores t
    LEFT JOIN admission_profiles p ON p.id = t.admission_profile_id
    LEFT JOIN sources s ON s.id = t.source_id
    WHERE p.id IS NULL OR s.id IS NULL
  ) orphaned;

  SELECT COALESCE(SUM(orphan_count), 0)::integer INTO orphan_enrichment_facts
  FROM (
    SELECT count(*) AS orphan_count
    FROM enrollment_snapshots e
    LEFT JOIN universities u ON u.id = e.university_id
    LEFT JOIN sources s ON s.id = e.source_id
    WHERE u.id IS NULL OR s.id IS NULL
    UNION ALL
    SELECT count(*) AS orphan_count
    FROM cost_snapshots c
    LEFT JOIN universities u ON u.id = c.university_id
    LEFT JOIN sources s ON s.id = c.source_id
    WHERE u.id IS NULL OR s.id IS NULL
    UNION ALL
    SELECT count(*) AS orphan_count
    FROM financial_aid_snapshots f
    LEFT JOIN universities u ON u.id = f.university_id
    LEFT JOIN sources s ON s.id = f.source_id
    WHERE u.id IS NULL OR s.id IS NULL
  ) orphaned;

  SELECT count(*) INTO insecure_sources
  FROM sources
  WHERE url !~ '^https://';

  SELECT count(*) INTO negative_admission_counts
  FROM admission_counts
  WHERE value < 0;

  SELECT count(*) INTO invalid_admission_test_values
  FROM admission_test_scores
  WHERE submitters_count < 0
    OR submitters_percent < 0
    OR submitters_percent > 100
    OR minimum_score < 0
    OR maximum_score < 0
    OR average_score < 0
    OR percentile_25 < 0
    OR percentile_50 < 0
    OR percentile_75 < 0
    OR (minimum_score IS NOT NULL AND maximum_score IS NOT NULL AND minimum_score > maximum_score)
    OR (percentile_25 IS NOT NULL AND percentile_50 IS NOT NULL AND percentile_25 > percentile_50)
    OR (percentile_50 IS NOT NULL AND percentile_75 IS NOT NULL AND percentile_50 > percentile_75)
    OR (percentile_25 IS NOT NULL AND percentile_75 IS NOT NULL AND percentile_25 > percentile_75);

  SELECT count(*) INTO negative_enrollment_counts
  FROM enrollment_snapshots
  WHERE student_count < 0;

  SELECT count(*) INTO invalid_cost_values
  FROM cost_snapshots
  WHERE amount < 0 OR currency !~ '^[A-Z]{3}$';

  SELECT count(*) INTO invalid_financial_aid_values
  FROM financial_aid_snapshots
  WHERE recipient_count < 0
    OR recipient_percent < 0
    OR recipient_percent > 100
    OR average_amount < 0
    OR total_amount < 0
    OR ((average_amount IS NOT NULL OR total_amount IS NOT NULL) AND currency IS NULL)
    OR (currency IS NOT NULL AND currency !~ '^[A-Z]{3}$');

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
  WHERE run.provider IN ('ipeds', 'ipeds-admissions', 'ipeds-enrichment')
    AND rejection.source_row IS NULL;

  SELECT count(*) INTO invalid_completed_ipeds_runs
  FROM import_runs
  WHERE provider = 'ipeds'
    AND status = 'completed'
    AND (
      jsonb_typeof(checkpoint->'sourceRow') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'sourceRows') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'eligibleRows') IS DISTINCT FROM 'number' OR
      CASE
        WHEN (checkpoint->>'sourceRow') ~ '^[0-9]+$'
          AND (checkpoint->>'sourceRows') ~ '^[0-9]+$'
        THEN (checkpoint->>'sourceRow')::bigint <> (checkpoint->>'sourceRows')::bigint
        ELSE true
      END OR
      CASE
        WHEN (checkpoint->>'eligibleRows') ~ '^[0-9]+$'
        THEN processed_count <> (checkpoint->>'eligibleRows')::bigint
        ELSE true
      END
    );

  SELECT count(*) INTO invalid_completed_admission_runs
  FROM import_runs
  WHERE provider = 'ipeds-admissions'
    AND status = 'completed'
    AND (
      jsonb_typeof(checkpoint->'sourceRow') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'sourceRows') IS DISTINCT FROM 'number' OR
      CASE
        WHEN (checkpoint->>'sourceRow') ~ '^[0-9]+$'
          AND (checkpoint->>'sourceRows') ~ '^[0-9]+$'
        THEN (checkpoint->>'sourceRow')::bigint <> (checkpoint->>'sourceRows')::bigint
        ELSE true
      END OR
      CASE
        WHEN (checkpoint->>'sourceRows') ~ '^[0-9]+$'
        THEN processed_count <> (checkpoint->>'sourceRows')::bigint
        ELSE true
      END
    );

  SELECT count(*) INTO invalid_completed_enrichment_runs
  FROM import_runs
  WHERE provider = 'ipeds-enrichment'
    AND status = 'completed'
    AND (
      checkpoint->>'phase' IS DISTINCT FROM 'completed' OR
      jsonb_typeof(checkpoint->'characteristicsSourceRow') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'costsSourceRow') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'characteristicsSourceRows') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'costsSourceRows') IS DISTINCT FROM 'number' OR
      CASE
        WHEN (checkpoint->>'characteristicsSourceRow') ~ '^[0-9]+$'
          AND (checkpoint->>'characteristicsSourceRows') ~ '^[0-9]+$'
        THEN (checkpoint->>'characteristicsSourceRow')::bigint <> (checkpoint->>'characteristicsSourceRows')::bigint
        ELSE true
      END OR
      CASE
        WHEN (checkpoint->>'costsSourceRow') ~ '^[0-9]+$'
          AND (checkpoint->>'costsSourceRows') ~ '^[0-9]+$'
        THEN (checkpoint->>'costsSourceRow')::bigint <> (checkpoint->>'costsSourceRows')::bigint
        ELSE true
      END OR
      CASE
        WHEN (checkpoint->>'characteristicsSourceRows') ~ '^[0-9]+$'
          AND (checkpoint->>'costsSourceRows') ~ '^[0-9]+$'
        THEN processed_count <> (checkpoint->>'characteristicsSourceRows')::bigint + (checkpoint->>'costsSourceRows')::bigint
        ELSE true
      END
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
    invalid_completed_ipeds_runs > 0 OR
    invalid_completed_admission_runs > 0 OR
    invalid_completed_enrichment_runs > 0 OR
    orphan_admission_profiles > 0 OR
    orphan_admission_facts > 0 OR
    orphan_enrichment_facts > 0 OR
    negative_admission_counts > 0 OR
    invalid_admission_test_values > 0 OR
    negative_enrollment_counts > 0 OR
    invalid_cost_values > 0 OR
    invalid_financial_aid_values > 0
  THEN
    RAISE EXCEPTION
      'Data quality gate failed: missing sources %, missing identifiers %, duplicate identifiers %, duplicate slugs %, orphan identifiers %, insecure sources %, failed imports %, running imports %, inconsistent import counts %, inconsistent rejection ledgers %, IPEDS rejections without source rows %, invalid completed IPEDS runs %, invalid completed admission runs %, invalid completed enrichment runs %, orphan admission profiles %, orphan admission facts %, orphan enrichment facts %, negative admission counts %, invalid admission test values %, negative enrollment counts %, invalid cost values %, invalid financial aid values %',
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
      invalid_completed_ipeds_runs,
      invalid_completed_admission_runs,
      invalid_completed_enrichment_runs,
      orphan_admission_profiles,
      orphan_admission_facts,
      orphan_enrichment_facts,
      negative_admission_counts,
      invalid_admission_test_values,
      negative_enrollment_counts,
      invalid_cost_values,
      invalid_financial_aid_values;
  END IF;
END $$;
SQL

curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:5173/healthz >/dev/null
echo "Data quality, API, and website checks passed."

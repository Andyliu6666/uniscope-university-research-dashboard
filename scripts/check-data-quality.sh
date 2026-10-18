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
  (SELECT count(*) FROM research_profiles) AS research_profiles,
  (SELECT count(*) FROM institution_aliases) AS institution_aliases,
  (SELECT count(*) FROM import_rejections) AS rejected_import_rows;

DO $$
DECLARE
  missing_sources integer;
  missing_identifiers integer;
  duplicate_identifiers integer;
  duplicate_slugs integer;
  orphan_identifiers integer;
  insecure_sources integer;
  insecure_official_websites integer;
  failed_imports integer;
  running_imports integer;
  inconsistent_import_counts integer;
  inconsistent_rejection_ledgers integer;
  reviewed_rejections_without_source_rows integer;
  invalid_completed_ipeds_runs integer;
  invalid_completed_ipeds_core_runs integer;
  invalid_completed_ipeds_program_runs integer;
  invalid_completed_admission_runs integer;
  invalid_completed_enrichment_runs integer;
  invalid_completed_wikidata_runs integer;
  invalid_completed_wikidata_crosswalk_runs integer;
  invalid_completed_ror_core_runs integer;
  invalid_completed_openalex_research_runs integer;
  invalid_completed_taiwan_moe_runs integer;
  invalid_completed_taiwan_moe_enrichment_runs integer;
  invalid_taiwan_moe_enrichment_rejections integer;
  orphan_admission_profiles integer;
  orphan_admission_facts integer;
  orphan_enrichment_facts integer;
  orphan_research_profiles integer;
  orphan_aliases integer;
  orphan_program_provenance integer;
  invalid_research_values integer;
  invalid_aliases integer;
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

  SELECT count(*) INTO orphan_research_profiles
  FROM research_profiles research
  LEFT JOIN universities university ON university.id = research.university_id
  LEFT JOIN sources source ON source.id = research.source_id
  WHERE university.id IS NULL OR source.id IS NULL;

  SELECT count(*) INTO orphan_aliases
  FROM institution_aliases alias
  LEFT JOIN universities university ON university.id = alias.university_id
  WHERE university.id IS NULL;

  SELECT count(*) INTO orphan_program_provenance
  FROM programs p
  LEFT JOIN sources s ON s.id = p.source_id
  WHERE
    (p.source_id IS NOT NULL AND (
      s.id IS NULL OR s.university_id <> p.university_id
    ))
    OR (
      p.source_provider = 'tw_moe_departments'
      AND (
        p.source_id IS NULL OR
        p.source_external_id IS NULL OR
        p.academic_year IS NULL OR
        s.id IS NULL OR
        s.university_id <> p.university_id OR
        CASE
          WHEN jsonb_typeof(p.source_flags->'sourceRows') = 'array'
          THEN jsonb_array_length(p.source_flags->'sourceRows') = 0
          ELSE true
        END
      )
    )
    OR (
      p.source_provider = 'official_admissions'
      AND (
        p.source_id IS NULL OR s.category <> 'official' OR
        p.source_external_id IS NULL OR p.academic_year <> 'unspecified' OR
        p.source_flags->>'provider' IS DISTINCT FROM 'official_admissions' OR
        p.source_flags->>'sourceUrl' IS DISTINCT FROM s.url
      )
    );

  SELECT count(*) INTO invalid_research_values
  FROM research_profiles
  WHERE works_count < 0
    OR cited_by_count < 0
    OR h_index < 0
    OR i10_index < 0
    OR two_year_mean_citedness < 0
    OR openalex_id !~ '^I[1-9][0-9]*$'
    OR status NOT IN ('active', 'inactive', 'withdrawn');

  SELECT count(*) INTO invalid_aliases
  FROM institution_aliases
  WHERE length(btrim(name)) = 0
    OR kind NOT IN ('acronym', 'alias', 'label');

  SELECT count(*) INTO insecure_sources
  FROM sources
  WHERE url !~ '^https://';

  SELECT count(*) INTO insecure_official_websites
  FROM universities
  WHERE official_website IS NOT NULL AND official_website !~ '^https://';

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

  SELECT count(*) INTO reviewed_rejections_without_source_rows
  FROM import_rejections rejection
  INNER JOIN import_runs run ON run.id = rejection.run_id
  WHERE run.provider IN (
    'ipeds',
    'ipeds-core',
    'ipeds-admissions',
    'ipeds-enrichment',
    'ipeds-programs',
    'ror-core',
    'openalex-research',
    'tw_moe',
    'tw_moe_enrichment',
    'wikidata-enrichment',
    'wikidata-ror-crosswalk'
  )
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

  SELECT count(*) INTO invalid_completed_ipeds_core_runs
  FROM import_runs
  WHERE provider = 'ipeds-core'
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

  SELECT count(*) INTO invalid_completed_ipeds_program_runs
  FROM import_runs
  WHERE provider = 'ipeds-programs'
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

  SELECT count(*) INTO invalid_completed_wikidata_runs
  FROM import_runs
  WHERE provider = 'wikidata-enrichment'
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

  SELECT count(*) INTO invalid_completed_wikidata_crosswalk_runs
  FROM import_runs
  WHERE provider = 'wikidata-ror-crosswalk'
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

  SELECT count(*) INTO invalid_completed_ror_core_runs
  FROM import_runs
  WHERE provider = 'ror-core'
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

  SELECT count(*) INTO invalid_completed_openalex_research_runs
  FROM import_runs
  WHERE provider = 'openalex-research'
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

  SELECT count(*) INTO invalid_completed_taiwan_moe_runs
  FROM import_runs
  WHERE provider = 'tw_moe'
    AND status = 'completed'
    AND (
      jsonb_typeof(checkpoint->'schoolIndex') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'sourceSchools') IS DISTINCT FROM 'number' OR
      CASE
        WHEN (checkpoint->>'schoolIndex') ~ '^[0-9]+$'
          AND (checkpoint->>'sourceSchools') ~ '^[0-9]+$'
        THEN (checkpoint->>'schoolIndex')::bigint <> (checkpoint->>'sourceSchools')::bigint
        ELSE true
      END OR
      CASE
        WHEN (checkpoint->>'sourceSchools') ~ '^[0-9]+$'
        THEN processed_count <> (checkpoint->>'sourceSchools')::bigint
        ELSE true
      END
    );

  SELECT count(*) INTO invalid_completed_taiwan_moe_enrichment_runs
  FROM import_runs
  WHERE provider = 'tw_moe_enrichment'
    AND status = 'completed'
    AND (
      jsonb_typeof(checkpoint->'schoolIndex') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'sourceSchools') IS DISTINCT FROM 'number' OR
      jsonb_typeof(checkpoint->'metrics') IS DISTINCT FROM 'object' OR
      CASE
        WHEN (checkpoint->>'schoolIndex') ~ '^[0-9]+$'
          AND (checkpoint->>'sourceSchools') ~ '^[1-9][0-9]*$'
        THEN (checkpoint->>'schoolIndex')::numeric <> (checkpoint->>'sourceSchools')::numeric
        ELSE true
      END OR
      CASE
        WHEN (checkpoint->>'sourceSchools') ~ '^[1-9][0-9]*$'
        THEN processed_count <> (checkpoint->>'sourceSchools')::numeric
        ELSE true
      END OR
      inserted_count <> 0 OR
      skipped_count <> 0 OR
      updated_count + rejected_count <> processed_count OR
      EXISTS (
        SELECT 1
        FROM (
          VALUES
            ('programCandidatesMatched'),
            ('programsInserted'),
            ('programsAlreadyPresent'),
            ('organizationalUnitRowsSkipped'),
            ('unsupportedQualificationRowsSkipped'),
            ('duplicateOfferingRowsCollapsed'),
            ('positiveCostCellsMatched'),
            ('costsInserted'),
            ('costsUpdated'),
            ('sourceReportedZeroCellsSkipped'),
            ('sourceBlankCellsSkipped'),
            ('unmatchedProgramCandidates'),
            ('unmatchedPositiveCostCells')
        ) AS required_metric(key)
        WHERE jsonb_typeof(checkpoint->'metrics'->required_metric.key) IS DISTINCT FROM 'number'
          OR (checkpoint->'metrics'->>required_metric.key) !~ '^[0-9]+$'
      ) OR
      CASE
        WHEN (checkpoint->'metrics'->>'programCandidatesMatched') ~ '^[0-9]+$'
          AND (checkpoint->'metrics'->>'programsInserted') ~ '^[0-9]+$'
          AND (checkpoint->'metrics'->>'programsAlreadyPresent') ~ '^[0-9]+$'
        THEN (checkpoint->'metrics'->>'programCandidatesMatched')::numeric <>
          (checkpoint->'metrics'->>'programsInserted')::numeric +
          (checkpoint->'metrics'->>'programsAlreadyPresent')::numeric
        ELSE true
      END OR
      CASE
        WHEN (checkpoint->'metrics'->>'positiveCostCellsMatched') ~ '^[0-9]+$'
          AND (checkpoint->'metrics'->>'costsInserted') ~ '^[0-9]+$'
          AND (checkpoint->'metrics'->>'costsUpdated') ~ '^[0-9]+$'
        THEN (checkpoint->'metrics'->>'positiveCostCellsMatched')::numeric <>
          (checkpoint->'metrics'->>'costsInserted')::numeric +
          (checkpoint->'metrics'->>'costsUpdated')::numeric
        ELSE true
      END
    );

  SELECT COALESCE(SUM(invalid_count), 0)::integer
  INTO invalid_taiwan_moe_enrichment_rejections
  FROM (
    SELECT count(*) AS invalid_count
    FROM import_rejections rejection
    INNER JOIN import_runs run ON run.id = rejection.run_id
    WHERE run.provider = 'tw_moe_enrichment'
      AND (
        rejection.source_row IS NULL OR
        rejection.source_row < 1 OR
        rejection.external_id IS NULL OR
        length(btrim(rejection.external_id)) = 0 OR
        rejection.payload_hash !~ '^[a-f0-9]{64}$' OR
        jsonb_typeof(rejection.payload) IS DISTINCT FROM 'object' OR
        CASE
          WHEN (run.checkpoint->>'sourceSchools') ~ '^[1-9][0-9]*$'
          THEN rejection.source_row > (run.checkpoint->>'sourceSchools')::numeric
          ELSE true
        END
      )
    UNION ALL
    SELECT count(*) AS invalid_count
    FROM (
      SELECT rejection.run_id, rejection.source_row
      FROM import_rejections rejection
      INNER JOIN import_runs run ON run.id = rejection.run_id
      WHERE run.provider = 'tw_moe_enrichment'
      GROUP BY rejection.run_id, rejection.source_row
      HAVING count(*) > 1
    ) duplicate_rejections
  ) invalid_rejections;

  IF
    missing_sources > 0 OR
    missing_identifiers > 0 OR
    duplicate_identifiers > 0 OR
    duplicate_slugs > 0 OR
    orphan_identifiers > 0 OR
    insecure_sources > 0 OR
    insecure_official_websites > 0 OR
    failed_imports > 0 OR
    running_imports > 0 OR
    inconsistent_import_counts > 0 OR
    inconsistent_rejection_ledgers > 0 OR
    reviewed_rejections_without_source_rows > 0 OR
    invalid_completed_ipeds_runs > 0 OR
    invalid_completed_ipeds_core_runs > 0 OR
    invalid_completed_ipeds_program_runs > 0 OR
    invalid_completed_admission_runs > 0 OR
    invalid_completed_enrichment_runs > 0 OR
    invalid_completed_wikidata_runs > 0 OR
    invalid_completed_wikidata_crosswalk_runs > 0 OR
    invalid_completed_ror_core_runs > 0 OR
    invalid_completed_openalex_research_runs > 0 OR
    invalid_completed_taiwan_moe_runs > 0 OR
    invalid_completed_taiwan_moe_enrichment_runs > 0 OR
    invalid_taiwan_moe_enrichment_rejections > 0 OR
    orphan_admission_profiles > 0 OR
    orphan_admission_facts > 0 OR
    orphan_enrichment_facts > 0 OR
    orphan_research_profiles > 0 OR
    orphan_aliases > 0 OR
    orphan_program_provenance > 0 OR
    negative_admission_counts > 0 OR
    invalid_admission_test_values > 0 OR
    negative_enrollment_counts > 0 OR
    invalid_cost_values > 0 OR
    invalid_financial_aid_values > 0 OR
    invalid_research_values > 0 OR
    invalid_aliases > 0
  THEN
    RAISE EXCEPTION
      'Data quality gate failed: missing sources %, missing identifiers %, duplicate identifiers %, duplicate slugs %, orphan identifiers %, insecure sources %, insecure official websites %, failed imports %, running imports %, inconsistent import counts %, inconsistent rejection ledgers %, reviewed-source rejections without source rows %, invalid completed IPEDS runs %, invalid completed IPEDS core runs %, invalid completed IPEDS program runs %, invalid completed admission runs %, invalid completed enrichment runs %, invalid completed Wikidata runs %, invalid completed Wikidata crosswalk runs %, invalid completed ROR core runs %, invalid completed OpenAlex research runs %, invalid completed Taiwan MOE runs %, invalid completed Taiwan MOE enrichment runs %, invalid Taiwan MOE enrichment rejections %, orphan admission profiles %, orphan admission facts %, orphan enrichment facts %, orphan research profiles %, orphan aliases %, orphan program provenance %, negative admission counts %, invalid admission test values %, negative enrollment counts %, invalid cost values %, invalid financial aid values %, invalid research values %, invalid aliases %',
      missing_sources,
      missing_identifiers,
      duplicate_identifiers,
      duplicate_slugs,
      orphan_identifiers,
      insecure_sources,
      insecure_official_websites,
      failed_imports,
      running_imports,
      inconsistent_import_counts,
      inconsistent_rejection_ledgers,
      reviewed_rejections_without_source_rows,
      invalid_completed_ipeds_runs,
      invalid_completed_ipeds_core_runs,
      invalid_completed_ipeds_program_runs,
      invalid_completed_admission_runs,
      invalid_completed_enrichment_runs,
      invalid_completed_wikidata_runs,
      invalid_completed_wikidata_crosswalk_runs,
      invalid_completed_ror_core_runs,
      invalid_completed_openalex_research_runs,
      invalid_completed_taiwan_moe_runs,
      invalid_completed_taiwan_moe_enrichment_runs,
      invalid_taiwan_moe_enrichment_rejections,
      orphan_admission_profiles,
      orphan_admission_facts,
      orphan_enrichment_facts,
      orphan_research_profiles,
      orphan_aliases,
      orphan_program_provenance,
      negative_admission_counts,
      invalid_admission_test_values,
      negative_enrollment_counts,
      invalid_cost_values,
      invalid_financial_aid_values,
      invalid_research_values,
      invalid_aliases;
  END IF;
END $$;
DO $$
DECLARE invalid_ib integer;
BEGIN
  SELECT count(*) INTO invalid_ib
  FROM qualification_requirements q
  INNER JOIN admission_profiles p ON p.id = q.admission_profile_id
  INNER JOIN sources s ON s.id = q.source_id
  LEFT JOIN programs program ON program.id = p.program_id
  WHERE q.source_flags->>'provider' = 'official_ib'
    AND (
      q.qualification_system <> 'IB'
      OR s.category <> 'official' OR s.university_id <> p.university_id
      OR (p.program_id IS NOT NULL AND
          (program.university_id IS DISTINCT FROM p.university_id OR program.level::text IS DISTINCT FROM p.level::text))
      OR q.source_flags #>> '{ib,recordKey}' IS DISTINCT FROM q.subject
      OR q.source_flags #>> '{ib,academicYear}' IS DISTINCT FROM p.academic_year
      OR q.source_flags #>> '{ib,intakeTerm}' IS DISTINCT FROM p.intake_term
      OR q.source_flags #>> '{ib,entryType}' IS DISTINCT FROM p.entry_type::text
      OR q.source_flags #>> '{ib,applicantType}' IS DISTINCT FROM p.applicant_type::text
      OR q.source_flags #>> '{ib,source,url}' IS DISTINCT FROM s.url
      OR COALESCE(q.source_flags #>> '{ib,status}', '') NOT IN
        ('published', 'not_stated_in_source', 'no_fixed_minimum', 'conversion_required', 'not_applicable', 'not_accepted')
      OR (q.source_flags #>> '{ib,status}' = 'published' AND (
        q.minimum_value IS NULL OR q.minimum_value < 1 OR q.minimum_value > 45
        OR COALESCE(q.scale, '') NOT IN ('42', '45')
        OR p.level = 'graduate'
        OR COALESCE(q.source_flags #>> '{ib,scoreKind}', '') NOT IN
          ('minimum_entry', 'typical_offer', 'contextual_offer', 'guaranteed_entry')
      ))
      OR (q.source_flags #>> '{ib,status}' <> 'published' AND
          (q.minimum_value IS NOT NULL OR q.maximum_value IS NOT NULL OR q.scale IS NOT NULL))
    );
  IF invalid_ib > 0 THEN
    RAISE EXCEPTION 'IB quality gate failed: % records have invalid scope, provenance or score semantics', invalid_ib;
  END IF;
END $$;
SQL

curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:5173/healthz >/dev/null
echo "Data quality, API, and website checks passed."

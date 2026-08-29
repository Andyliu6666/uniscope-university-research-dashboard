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
  duplicate_identifiers integer;
  orphan_identifiers integer;
BEGIN
  SELECT count(*) INTO missing_sources
  FROM universities u
  WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.university_id = u.id);

  SELECT count(*) INTO duplicate_identifiers
  FROM (
    SELECT provider, external_id
    FROM institution_identifiers
    GROUP BY provider, external_id
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO orphan_identifiers
  FROM institution_identifiers i
  LEFT JOIN universities u ON u.id = i.university_id
  WHERE u.id IS NULL;

  IF missing_sources > 0 OR duplicate_identifiers > 0 OR orphan_identifiers > 0 THEN
    RAISE EXCEPTION
      'Data quality gate failed: missing sources %, duplicate identifiers %, orphan identifiers %',
      missing_sources,
      duplicate_identifiers,
      orphan_identifiers;
  END IF;
END $$;
SQL

curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:5173/healthz >/dev/null
echo "Data quality, API, and website checks passed."

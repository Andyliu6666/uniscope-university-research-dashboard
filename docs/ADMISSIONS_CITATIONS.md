# Maintain reviewed admissions citations

Use `refresh:citations` when an official document moves and the replacement has been independently checked against every affected stored condition. This tool changes citation metadata. Academic corrections belong in a separate reviewed correction: this command rejects changed grades, wording, status, course, original dataset or admission scope.

The checked-in [UTech manifest](../data/corrections/utech-citations-20261120.json) is an example. Each record preserves the exact original fact, source URL/title/check date, programme and six scope fields, and supplies the reviewed replacement URL, page locator, check date and downloaded-file SHA-256. The institution requires an exact existing ROR and country match. Official domains are supplied by the human source review; declaring a domain is not independent verification of its ownership. The checksum records the bytes reviewed; the CLI does not download or re-review a document.

From the repository root, validate without a database, then preview against the database:

```sh
pnpm --filter @urd/api run refresh:citations ../../data/corrections/utech-citations-20261120.json --validate-only
pnpm --filter @urd/api run refresh:citations ../../data/corrections/utech-citations-20261120.json --dry-run
```

For Docker, rebuild after adding or changing an artifact or script:

```sh
docker compose up -d --no-deps --build api
docker compose exec -T api pnpm --filter @urd/api run refresh:citations /app/data/corrections/utech-citations-20261120.json --validate-only
docker compose exec -T api pnpm --filter @urd/api run refresh:citations /app/data/corrections/utech-citations-20261120.json --dry-run
```

Take and verify a complete database backup before applying. Omit the flag to apply the reviewed manifest, then repeat to confirm `already-completed`. Run `pnpm data:check`, export `pnpm data:status` and inspect the affected API results. Schema validation and a no-write preview do not prove source correctness or that all retirement checks will pass at commit time.

An applied batch uses a serializable transaction and a per-institution advisory lock. The original requirement IDs, academic content, course IDs and import history remain unchanged. Source URLs, page-specific titles, check dates and audit hashes are refreshed. Completed replays check requirement content and moved programme provenance before returning unchanged.

With `retirePreviousSource: true`, the batch must review one complete previous URL. The command moves only reviewed programme/profile references, updates programme provenance URLs with their source IDs, archives the entire retired source in the import checkpoint and checks every database foreign key to `sources` before deletion. An unreviewed remaining reference, including a deadline, rolls back the entire transaction. No cascade is used as evidence that deletion is safe. Without retirement, the old source remains available.

Source changes are stored as a separate `official_citation_refresh` import run. Original frozen source artifacts remain intact. For the UTech example, restore/import the original reviewed datasets and the November remaining-programmes batch first, apply the citation refresh, then import the shared-course-links artifact. Preserve the full database archive when restoring the existing site; a Git checkout alone does not recreate database contents.

The dedicated PostgreSQL regression fixture runs in CI's `uniscope_ci` database through `pnpm --filter @urd/api db:test-citations`. It checks rollback with an unreviewed deadline reference, academic/identity preservation, programme provenance updates and repeat safety. The fixture refuses database names outside the explicit CI/test prefixes.

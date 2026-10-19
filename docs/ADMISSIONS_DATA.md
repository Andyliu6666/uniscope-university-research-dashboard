# Reviewed general admissions data

Use a new versioned JSON artifact for each reviewed batch. The importer accepts exact existing institution identifiers, official source URLs, applicant scope and concise requirements. It is append-only: matching facts are skipped, conflicting content requires review, and the whole batch commits in one transaction.

## Programme requirements

`programId: null` without `programKey` means a university-wide profile. To reference an existing catalogue entry, supply its UUID as `programId`. It must belong to the resolved institution and study level.

If a sourced programme is absent from the catalogue, declare it in the optional top-level `programs` array:

```json
{
  "key": "local_batch_course_key",
  "institutionKey": "institution_key",
  "name": "Exact official programme name",
  "level": "undergraduate",
  "field": "Published subject area",
  "source": {
    "url": "https://official.example.edu/course",
    "title": "Official programme page",
    "checkedOn": "2026-10-18"
  }
}
```

The corresponding profile uses `programId: null` and `programKey: "local_batch_course_key"`. The school and level must agree. Supported catalogue levels are `undergraduate` and `graduate`; other admission routes can still be recorded as university-wide profiles where appropriate. The full working example is `data/sources/admissions-facts-botswana-programs-20261018.json`.

Programme names are normalized for case, spacing and Unicode within one exact institution. One matching course with the same field is reused without changing its ownership or metadata. Ambiguous names or changed metadata stop the batch. New programmes receive official source attribution and a stable internal identity independent of the batch key or source URL. The catalogue identity uses `academicYear: "unspecified"`; the admission profile carries the actual published year and intake. Changing a course's name or mapping requires maintainer review.

Do not repeat university rules in every programme. Record only distinct programme conditions, preserving AND/OR subject requirements and qualification systems. BGCSE points must never populate an IB score field. Where one published requirement combines subject grades and a programme cut-off, keep that condition together. Alternative diploma/transfer routes belong in their own profiles, and a source saying "may be considered" must retain that conditional meaning.

## Validate, preview, back up, import

From the repository root:

```sh
pnpm --filter @urd/api run import:admissions-facts ../../data/sources/admissions-facts-botswana-programs-20261018.json --validate-only
docker compose up --build -d api web
docker compose exec -T api pnpm --filter @urd/api run import:admissions-facts /app/data/sources/admissions-facts-botswana-programs-20261018.json --dry-run
```

Validation needs no database. A preview reads the configured database and reports proposed facts, skips and, for programme declarations, `programsCreated`/`programsReused`. It writes no programmes, sources, requirements or ledger rows. Review the preview and create a verified backup before the first import. Existing completed batches should not be imported as new versions merely to refresh a date.

```sh
docker compose exec -T api pnpm --filter @urd/api run import:admissions-facts /app/data/sources/admissions-facts-botswana-programs-20261018.json
pnpm data:check
pnpm data:status
```

Repeat previews should report zero new facts/programmes. A repeat real import of the same completed artifact is a no-op. Existing artifact parsing and checksums remain unchanged when the optional programme fields are absent. Removing local JSON does not delete database rows.

## Review dates and incomplete evidence

The Botswana programme batch was reviewed October 18 from the official PDF downloaded October 9. A fresh October 18 HTTPS retrieval failed. Each profile records that limitation, the historical 2026 cycle and the relevant guide pages. It establishes the preserved guide's requirements, not current availability or the absence of later revisions.

Preserve source retrieval dates separately from content review and deployment dates. Do not infer a current application opening, deadline, IB conversion or guaranteed offer from historical guidance. General requirements, catalogue coverage and reviewed IB coverage are separate measurements. Progress and remaining work are recorded in `ADMISSIONS_PROGRESS.md`.

## All admissions categories, without invented requirements

Academic qualifications (including A-level/AP), subject grades, exams, language, documents/essays, experience/awards, portfolios, interviews and application conditions use the existing fact categories. IB stays in its dedicated structured section. A fact must distinguish a compulsory requirement from conditional, considered or optional evidence. A page silent on competitions, AP or SAT does not establish `not_required`. Preserve alternative qualifications and AND/OR subject combinations rather than making every listed exam compulsory. Only explicitly published current prompts/counts may be presented as current essay instructions; old forms retain their historical year.

The October 18 Ghana/Pacific review is documented in `research/GHANA_PACIFIC_20261018.md`. It does not establish complete coverage of any institution or the global directory.

## Paginated admissions profiles

`GET /api/universities/:slug/admissions` accepts `page` (1–100000) and `pageSize` (1–50), in addition to the existing exact year/level/applicant/entry filters. Omitted pagination defaults to page 1 / 50 profiles for compatibility. Responses include `pagination: { page, pageSize, total, totalPages }` for the same filters; ordering ends with the unique profile ID to prevent tied rows shifting between pages. Empty result sets have one navigable page.

The website requests 20 profiles per page and provides previous/next controls. Counts include IB-only profiles even though their requirements are displayed by the dedicated IB browser; pages containing only IB profiles still expose navigation. An API/network error is not shown as a school with no requirements. Paging does not imply complete research coverage.

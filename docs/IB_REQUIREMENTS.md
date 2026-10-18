# Reviewed IB requirements

IB requirements are stored per university, program, entry year, intake, applicant category and entry route. University-wide policies are deliberately separate from program requirements.

## What a number means

- `minimum_entry`: the official eligibility threshold, not a guarantee or the lowest score of a previously admitted student.
- `typical_offer`: the published offer or offer range, not necessarily a hard minimum.
- `contextual_offer`: a conditional lower offer; retain eligibility in `applicantContext`.
- `guaranteed_entry`: use only if the official source explicitly guarantees entry and preserve all conditions.
- Non-numeric policies distinguish a total absent from the reviewed source, an explicitly stated absence of a fixed minimum, conversion, non-applicability and non-acceptance.
- Unknown is never zero. Recognition of the IB Diploma is not sufficient evidence to invent 24/45.
- A postgraduate degree must not inherit an undergraduate IB threshold. Integrated undergraduate master's courses remain undergraduate.
- An undated page uses `academicYear: "unspecified"`; the review date, site footer or unrelated intake advertisement is not the entry year.

## Data entry

The validated and imported artifacts are:

- `data/sources/ib-requirements-20260910.json`
- `data/sources/ib-requirements-africa-20260911.json`
- `data/sources/ib-requirements-africa-20260915.json`
- `data/sources/ib-requirements-asia-20260915.json`
- `data/sources/ib-requirements-latin-america-20260916.json`
- `data/sources/ib-requirements-ghana-20260929.json`
- `data/sources/ib-requirements-strathmore-20261001.json`

Copy their structure into a **new versioned file**, review each source, then validate and preview it before importing. Filenames retain their initial research date; the artifact's dataset version and source check dates identify the final review.

Each institution needs an exact existing ROR, IPEDS or Taiwan MOE identifier, matching country and a manually reviewed official-domain allowlist. The importer does not create universities or fuzzy-match names.

Each record needs a stable `recordKey`, source URL, brief evidence excerpt, check date and full applicant scope. Use a new key for a different program or intake year. Keep `program: null` for a university-wide rule. Course name matching is exact and rejects ambiguity. An explicit `existingProgramId` must belong to that institution and study level.

Use the actual official `courseCode` when published. Otherwise use `null`; the importer derives a stable internal identity from the reviewed URL, exact program name and study level, and never presents it as an official course code. This keeps multiple courses on one admissions page separate. Changing the canonical URL or name later requires a reviewed explicit program mapping to avoid duplicate identities.

Keep total scores, 42/45 scale, core-point inclusion, HL grades, subject conditions and additional admission conditions separate. A range's upper value is the upper end of the published offer band, not a maximum permitted applicant score. An empty `hlGrades` array means that no numeric HL grade pattern was captured; explanatory subject text remains essential.

## Local validation, preview and import

From the repository root (local Node dependencies must already be installed):

```sh
pnpm --filter @urd/api run import:ib ../../data/sources/ib-requirements-20260910.json --validate-only
pnpm --filter @urd/api run import:ib ../../data/sources/ib-requirements-20260910.json --dry-run
```

The first command needs no database. The second reads the configured database without inserting sources, programs, requirements or import ledgers. It reports candidates and identity rejections; only a real import establishes committed counts.

For the Docker website, rebuild first so the container contains the same files:

```sh
docker compose up --build -d api web
docker compose exec -T api pnpm --filter @urd/api run import:ib /app/data/sources/ib-requirements-20260910.json --validate-only
docker compose exec -T api pnpm --filter @urd/api run import:ib /app/data/sources/ib-requirements-20260910.json --dry-run
```

After a database backup and review of the preview, import each approved artifact:

```sh
docker compose exec -T api pnpm --filter @urd/api run import:ib /app/data/sources/ib-requirements-20260910.json
docker compose exec -T api pnpm --filter @urd/api run import:ib /app/data/sources/ib-requirements-africa-20260911.json
pnpm data:check
pnpm data:status
```

Also validate and preview the Africa artifact before its first import, using the same flags as above. Do not reseed or delete volumes. Removing a local JSON file does not remove database rows.

A batch contains at most 200 input records. Repeat a paused import with the same artifact to continue. Each batch and its checkpoint commit together under an advisory lock. Repeating a completed version/checksum is a no-op. Identity conflicts are quarantined with source-row numbers, not guessed. A later reviewed dataset may update the same key within the same scope; it cannot replace a newer check with an older one or overwrite records owned by other data providers.

## Website and API

Open a university profile and use **Programs & IB entry requirements**. Search and pagination cover the whole stored catalog, with independent year, applicant, study-level and entry-route filters. Institution-wide policies are shown separately. Missing program reviews remain explicitly unverified.

`GET /api/universities/:slug/ib` accepts `q`, `year`, `applicantType`, `level`, `entryType`, `page` and `pageSize`. Defaults: undergraduate, first year, page 1, 20 entries; page size is capped at 50. A selected year does not silently include undated or other-year rules. Coverage counts describe the selected university/level/year/route/applicant scope, not just the current search results.

The importer reuses existing `admission_profiles`, `qualification_requirements`, `programs`, `sources` and import-ledger tables. No new database migration or dependency is needed for this feature; the repository's existing migrations must already be applied.

## Coverage is not completeness

The first two artifacts contained 26 reviewed records across 13 institutions. Following the October 1 Strathmore import, the live database contains **54 reviewed IB records across 25 institutions: 48 program records (37 with published numeric totals) and six university-wide policies**. The seven Strathmore records each cite their own programme's explicit 34/45 total; Law also specifies English 6 without an HL/SL level. Conflicting official sources for other courses are deferred, not combined into an invented offer range. The three Cape Coast records contain published HL/SL subject-grade requirements, not a published IB Diploma total, and apply only to the local-applicant route. This is a small reviewed subset, not comprehensive coverage of the 28,171-institution database. Read `data/import-status.json` → `database.ibCoverage` and `docs/IB_PROGRESS.md` for current measured coverage. School policies never count as reviewed program requirements.

The first-year route is selected by default. Salem and Pan-Atlantic direct-entry records require selecting **Other entry route**; historical and undated requirements remain distinct from current-year rules. Malaysian local-route requirements must not be read as verified international-student thresholds. Faculty-only rules cannot be stored as university-wide policies in the current schema and remain deferred until their scope can be represented safely.

The Kenyan batch cites each program's own official page. Two research candidates remain deferred: Eldoret Disaster Management has an unresolved BA/BSc name conflict; Nairobi Project Planning needs an exact institution identity and has no published numeric total in the reviewed page. Neither is imported as a numerical threshold.

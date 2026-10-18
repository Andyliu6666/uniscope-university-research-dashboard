# UniScope — University Research Dashboard

Current admissions-data work and source gaps are tracked in [the admissions checkpoint](docs/ADMISSIONS_PROGRESS.md). The priority is distinct, source-backed admissions requirements, not filling every field or repeating university rules under each programme. Employment data collection is deferred.

## Reviewed admissions facts

The dedicated IB importer remains separate. General academic, language, document and application requirements use the append-only reviewed-fact importer and existing admissions tables; no new migration is needed. From the repository root:

```sh
pnpm --filter @urd/api run import:admissions-facts ../../data/sources/admissions-facts-namibia-20261002.json --validate-only
pnpm --filter @urd/api run import:admissions-facts ../../data/sources/admissions-facts-namibia-20261002.json --dry-run
```

After reviewing the preview and taking a database backup, omit the flag to apply. A repeat skips existing facts; conflicting contents require review rather than replacement. New university/programme identities are never created by this importer. Do not copy a shared school rule into every course. Facts retain their own official source and checked date; use **Choose admission scope** on the university page to switch between years, qualifications/levels, applicants and entry routes.

If using Docker, rebuild `api` after adding an artifact or importer change and use its `/app/data/sources/...` path:

```sh
docker compose up --build -d api web
docker compose exec -T api pnpm --filter @urd/api run import:admissions-facts /app/data/sources/admissions-facts-namibia-20261002.json --dry-run
```

Dry runs never write. The reviewed dataset has at most 200 facts; an applied batch and its ledger commit in one transaction. This is not an automated web scraper or proof of complete institution coverage. See the checkpoint for deduplication limitations and unresolved sources.

An open-source, non-profit university research website built by students. UniScope helps applicants discover, compare, and verify university information without turning the project into a large application.

## What is included

- Search by university, city, or country; filter by country and institution type
- Paginated research cards, source-backed detail pages, and a three-university comparison
- Programs, deadlines, tuition, IB guidance, student counts, and source dates
- JSON import workflow and a development-only, key-protected data entry form
- Strict TypeScript, shared Zod validation, tests, linting, formatting, and CI
- PostgreSQL schema, checked-in migrations, resumable source imports, and Docker Compose

## Architecture

```text
apps/web       React 19 + Vite + React Query
apps/api       Fastify + Drizzle + PostgreSQL
packages/shared  Shared Zod schemas and TypeScript types
data           Contributor-owned university records
```

The project deliberately uses one web app, one API, and one database. Adding a university changes data only; it does not require a component, route, or schema change.

## Start with Docker (recommended)

Requirements: Docker Desktop with Docker Compose.

```bash
cd /path/to/uniscope-university-research-dashboard
cp .env.example .env
docker compose up --build -d
docker compose cp data/myuniversity.json api:/tmp/myuniversity.json
docker compose exec api pnpm --filter @urd/api run import /tmp/myuniversity.json
```

Open `http://localhost:5173`. The API health endpoint is `http://localhost:3001/health`.

Compose publishes the web app, API, and PostgreSQL on `127.0.0.1` by default. Set `COMPOSE_BIND_ADDRESS` only when another machine must connect, and apply firewall and production authentication controls before using a non-loopback address.

If PostgreSQL already uses port 5432 on your computer, set `POSTGRES_PORT=55432` in `.env`. When running database commands directly on the Mac, also use port `55432` in `DATABASE_URL`; Docker services continue to use `db:5432` internally.

The API container automatically runs the checked-in migrations from `apps/api/drizzle` before starting. Importing the same reviewed JSON again preserves the university UUID and merges new child records instead of deleting contributor data.

Create a database backup at any time with `./scripts/backup-db.sh`. Backups are written to the ignored `backups/` directory, and the latest 14 are retained by default.

## Start locally

Requirements: Node.js 26, pnpm 11.24+, and PostgreSQL 18+.

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm --filter @urd/api run import ../../data/myuniversity.json
pnpm dev
```

The root `.env` is read when commands are started from the repository root. If your shell or editor starts the API inside `apps/api`, copy the same values to `apps/api/.env`.

The `../../data/...` argument is intentional: pnpm runs the filtered API script with `apps/api` as its working directory. Docker commands use absolute container paths such as `/app/data/...` instead.

## Add a university without changing code

1. In VS Code, copy the structure of `data/myuniversity.json` into a clearly named file such as `data/your-university.json`, then replace the values.
2. Use official HTTPS sources. Use `null` instead of guessing unavailable numbers.
3. Import and validate the file:

```bash
pnpm --filter @urd/api run import ../../data/your-university.json
```

When using Docker, copy the file into the API container first:

```bash
docker compose cp data/your-university.json api:/tmp/your-university.json
docker compose exec api pnpm --filter @urd/api run import /tmp/your-university.json
```

The import is an upsert by `slug`, so a reviewed record can be corrected safely. It keeps the same database UUID, preserves existing programs, deadlines, and sources, and validates the same schema used by the API and front end.

Maintainers import active global education institutions from the versioned CC0 Research Organization Registry data dump, never from unstable deep API pagination. The currently reviewed artifact is ROR v2.12 (2026-08-25):

```bash
curl -fL -o /tmp/v2.12-2026-08-25-ror-data.zip \
  'https://zenodo.org/records/22099990/files/v2.12-2026-08-25-ror-data.zip?download=1'
echo '5779c7baf71771fd8ea829201e7bd4343a3c68ff36c595f480b3a00292f78931  /tmp/v2.12-2026-08-25-ror-data.zip' | shasum -a 256 -c -
unzip -o /tmp/v2.12-2026-08-25-ror-data.zip -d /tmp/ror
docker compose cp /tmp/ror/v2.12-2026-08-25-ror-data.csv \
  api:/tmp/v2.12-2026-08-25-ror-data.csv
docker compose exec api pnpm --filter @urd/api import:ror \
  /tmp/v2.12-2026-08-25-ror-data.csv 3000
```

Run the last command again for the next reviewed batch. The import ledger resumes from its committed checkpoint, uses the ROR ID rather than a name guess for deduplication, records rejected rows, and makes a completed dataset a no-op on rerun. Unknown admissions fields remain empty rather than being invented.

### Refresh global core facts from ROR

The baseline importer creates identities; the separate core refresh keeps those exact ROR-backed profiles useful outside the best-known universities. The checked-in `ror-core-v2.12-2026-08-25.jsonl` artifact contains the small, validated projection used by the application: country and continent codes, first-level region, coordinates, HTTPS official and Wikipedia links, establishment year, ROR status, and stored acronyms, aliases, and translated labels. ROR official links that are only available over HTTP are stored as `null`, never silently upgraded to an unverified HTTPS endpoint. Its upstream and artifact checksums, artifact byte and row counts, retrieval time, status counts, and transformation note are recorded in `data/sources/ror-core-artifacts.json`.

To reproduce the reviewed artifact from the verified ROR CSV:

```bash
pnpm --filter @urd/api build:ror-core \
  /tmp/ror/v2.12-2026-08-25-ror-data.csv \
  ../../data/sources \
  'https://zenodo.org/records/22099990/files/v2.12-2026-08-25-ror-data.zip?download=1' \
  '2026-08-31T04:10:00.000Z'
```

Validate or import the checked-in artifact locally:

```bash
pnpm --filter @urd/api import:ror-core \
  ../../data/sources/ror-core-v2.12-2026-08-25.jsonl --dry-run
pnpm --filter @urd/api import:ror-core \
  ../../data/sources/ror-core-v2.12-2026-08-25.jsonl 3000
```

For Docker, rebuild the API image after changing a reviewed artifact, then run the same resumable batch inside the container:

```bash
docker compose up --build -d api
docker compose exec api pnpm --filter @urd/api import:ror-core \
  /app/data/sources/ror-core-v2.12-2026-08-25.jsonl 3000
```

The refresh never creates or merges a university. It requires an exact existing ROR identifier, fills only missing or `unknown` core values, preserves existing safe contributor and government values, and replaces only ROR-owned aliases. As a security cleanup, it replaces any existing non-HTTPS `official_website` on an exact ROR match with the reviewed HTTPS value or `null`; rerunning this artifact therefore removes HTTP values imported by an older ROR core run. Because the safe artifact has a new checksum, that cleanup is recorded as a separate resumable import run. The artifact includes inactive and withdrawn education records so an existing identity can receive the correct ROR status; records absent from the local identity table are counted as skipped rather than name-matched.

### Add current Taiwan institutions and official enrollment

The Taiwan adapter combines two reviewed Ministry of Education datasets under Taiwan's Open Government Data License: the 114-academic-year student file defines the current scope, while the older 108 higher-education directory supplies contact fields only when its school code still has the same current name (or only adds the legal entity wrapper). The deterministic artifact contains 139 current institutions and 737 source rows, producing 638 institution/qualification enrollment snapshots. Its review result is explicit: 105 directory names are exact, 27 are legal-name variants, 5 are stale rename conflicts, and 2 current schools are absent from the older directory.

Rebuild the compact artifact and checksum manifest from the checked-in official downloads:

```bash
pnpm --filter @urd/api build:taiwan-moe
```

After rebuilding the API image, preview the exact identity plan without writing to PostgreSQL, then run a resumable reviewed batch:

```bash
docker compose up --build -d api
docker compose exec api pnpm --filter @urd/api import:taiwan-moe --dry-run
docker compose exec api pnpm --filter @urd/api import:taiwan-moe \
  /app/data/sources/taiwan-moe-114.json 50
```

The dry run reads existing identifiers, domains, and aliases so it can report the real `identifier`/`domain`/`alias`/`create`/`reject` distribution, but it performs no inserts or updates. The importer never fuzzy-matches a name. A `tw_moe` school code is authoritative; otherwise it accepts only one exact, trusted Chinese label or one unique exact official domain from a non-stale directory row. A stale rename/merge domain can never match or create a profile. Unmatched current schools are created only from exact/legal-name directory rows with a valid official website; conflicts are quarantined in `import_rejections`. This dataset adds current identity, location/contact, study-level availability, and official enrollment—not admissions requirements, deadlines, programs, or tuition.

### Add reviewed Taiwan programs and tuition bases

After the base Taiwan identity import completes, the separate enrichment adapter can attach the reviewed 114-academic-year department and tuition artifacts. It joins only one unique existing `tw_moe` school-code identifier. Numeric codes are compared after removing presentation-only leading zeroes (`0001` and `1` are the same official code); alphanumeric codes are otherwise unchanged. The importer never creates an institution and never falls back to a name, domain, or fuzzy match.

Rebuild the two compact artifacts and their manifest only from the byte-for-byte reviewed raw files. The input basenames must remain `programs.json` and `tuition.csv`; the builder verifies their filenames, byte counts, SHA-256 hashes, source row counts, and academic year against `taiwan-moe-enrichment-source-review.json` before writing output:

```bash
pnpm --filter @urd/api build:taiwan-moe-enrichment \
  /tmp/taiwan-moe/programs.json \
  /tmp/taiwan-moe/tuition.csv \
  ../../data/sources
```

After an artifact rebuild, rebuild the API image so Docker receives the same checked-in files. The dry run validates both artifacts and reads the current exact-identifier/program/cost state to print the real insert, update, already-present, skip, and rejection plan; it does not open a write run or mutate the database:

```bash
docker compose up --build -d api

# Read-only validation and an exact plan against the current database
docker compose exec api pnpm --filter @urd/api import:taiwan-moe-enrichment --dry-run

# Full resumable import using the checked-in reviewed artifacts
docker compose exec api pnpm --filter @urd/api import:taiwan-moe-enrichment

# Optional: commit at most 50 combined school records, then rerun to resume
docker compose exec api pnpm --filter @urd/api import:taiwan-moe-enrichment \
  /app/data/sources/taiwan-moe-departments-114.json \
  /app/data/sources/taiwan-moe-tuition-114.json 50
```

The optional final number is a combined-school limit, not a source-row limit. Each school is committed atomically with its checkpoint and cumulative metrics; rerunning the identical command resumes at the next school, and rerunning a completed artifact is a no-op. Missing or ambiguous exact `tw_moe` identifiers produce one source-row-linked `import_rejections` record and do not block later schools.

The department projection contains 7,696 distinct degree-offering candidates. Repeated attendance rows collapse only when the exact institution, department name, program level, MOE unit code, and qualification are identical. The existing concise `programs` table has no truthful place for organization-only rows, so 472 such rows are skipped and counted. Three `X 4+X` rows are also counted but not inserted because the current undergraduate/graduate model cannot represent them without guessing.

The tuition artifact contains 529 positive TWD tuition-and-miscellaneous-fee bases. The official source does not say whether each basis is annual, per semester, or another charge interval, so values are stored as `tuition_and_fees` with `period = 'other'`, category-specific scenarios, and `source_flags.chargePeriod = 'not_specified_by_source'`. UniScope does not annualize, multiply, or present these values as directly comparable annual tuition. The 1,823 source-reported zero cells are retained in the reviewed artifact and cumulative import metrics but are never inserted as zero cost or interpreted as free tuition; blanks are tracked separately. The importer validates both artifact schemas, filenames, byte counts, SHA-256 hashes, and manifest counts before opening a write run; it uses an advisory lock, committed school checkpoint, idempotent program/cost handling, government source rows, and `import_rejections` for missing or ambiguous exact identifiers.

### Add independent OpenAlex research context

The reviewed `openalex-institutions-20260831.jsonl` snapshot contains 27,401 education institutions with an OpenAlex ID and an exact ROR ID. Its companion manifest records the canonical cursor query, source and artifact row counts, retrieval time, CC0 license, identity policy, and SHA-256 (`645206ac9b9eb860a97c1b9f7abeb7fdce8907a19ca30b6fe1b9c480075d90c4`). Build a fresh compact snapshot from the OpenAlex API with:

```bash
pnpm --filter @urd/api build:openalex-research \
  ../../data/sources/openalex-institutions-YYYYMMDD.jsonl
```

Validate the reviewed artifact and preview the exact database plan without writing, or import it in resumable batches:

```bash
pnpm --filter @urd/api import:openalex-research \
  ../../data/sources/openalex-institutions-20260831.jsonl --dry-run
pnpm --filter @urd/api import:openalex-research \
  ../../data/sources/openalex-institutions-20260831.jsonl 3000

# Docker uses the artifacts copied into the rebuilt API image
docker compose up --build -d api
docker compose exec api pnpm --filter @urd/api import:openalex-research \
  /app/data/sources/openalex-institutions-20260831.jsonl 3000
```

The dry run verifies every row and the full artifact checksum, then reads the current ROR/OpenAlex identity state to report exact matches, absent identities, inserts, updates, and conflicts. It confirms that `import_runs`, sources, research profiles, and OpenAlex identifiers have unchanged row counts before it exits. The real importer joins only through `institution_identifiers(provider='ror')`, rejects conflicting identities, uses a dedicated advisory lock, and resumes from a committed source-row checkpoint; repeating a completed artifact is a no-op.

OpenAlex works, citation totals, h-index, i10-index, and two-year mean citedness appear in a separate **Independent research context** section. They depend on OpenAlex affiliation metadata and may change as records are corrected. They are not a university ranking, teaching-quality score, admissions requirement, or evidence that a profile is application-ready; OpenAlex data never upgrades UniScope's coverage level.

After the global ROR baseline, maintainers can add U.S. degree-granting institutions from the official NCES IPEDS directory. The importer accepts only rows marked active (`ACT=A`), degree-granting (`DEGGRANT=1`), non-administrative (`SECTOR!=0`), and in institution categories 1–4. Certificate-only schools and system offices are deliberately excluded from the university count.

```bash
curl -fL -o /tmp/HD2024.zip \
  'https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip'
echo 'd98425c123d7c0e872aec6e83960dfb501884818bf17385c340790f3d1f28345  /tmp/HD2024.zip' \
  | shasum -a 256 -c -
unzip -o /tmp/HD2024.zip -d /tmp/ipeds

docker compose cp /tmp/ipeds/HD2024.csv api:/tmp/HD2024.csv
docker compose exec api pnpm --filter @urd/api import:ipeds \
  /tmp/HD2024.csv \
  /app/data/sources/wikidata-ipeds-ror-20260830.csv 500
```

Run the last command again to resume the next reviewed batch. The IPEDS `UNITID` is the permanent import key. Exact IPEDS↔Wikidata↔ROR identifiers attach a government record to an existing ROR profile; name similarity is never used for automatic merging. A record with no crosswalk becomes a new IPEDS-backed profile with a unique `-ipeds-UNITID` slug. A forward ambiguity, identifier reused by multiple UnitIDs, or disagreement between strong identifiers is instead quarantined in `import_rejections` for manual review and is not published.

The checked-in crosswalk CSV is the reviewed, reproducible snapshot. Its query, source hashes, exact row counts, retrieval time, and line-ending normalization are recorded in `data/sources/`. The importer rejects an unknown filename, checksum, row count, schema, duplicate UnitID, truncated file, or concurrent institution import before publishing data. Each committed checkpoint retains the complete source metadata, and a completed artifact is a no-op on rerun.

The separate IPEDS core refresh fills profile fields that the original identity import intentionally left conservative. It uses only the exact `institution_identifiers(provider='ipeds')` match, so it cannot create or merge a profile by name. It fills `institutionType`, `ownership`, `operatingStatus`, undergraduate/graduate offer flags, and official admissions, financial-aid, net-price, and website links only when those fields are null or unknown. Existing contributor or official values are preserved. The reviewed `HD2024.csv` artifact and manifest are checked in under `data/sources/`:

```bash
# Docker: use the checked-in artifact inside the rebuilt API image
docker compose exec api pnpm --filter @urd/api import:ipeds-core \
  /app/data/sources/HD2024.csv 3000

# Local Node.js run from the repository root
pnpm --filter @urd/api import:ipeds-core \
  ../../data/sources/HD2024.csv 3000

# Optional, safe validation without touching the database
docker compose exec api pnpm --filter @urd/api import:ipeds-core \
  /app/data/sources/HD2024.csv --dry-run
```

The core refresh is resumable by source-row checkpoint, uses a dedicated PostgreSQL advisory lock, records unmatched/invalid rows in the import ledger, and becomes a no-op after completion. The source link is stored as government provenance for every exact IPEDS match.

The reviewed IPEDS enrichment snapshots add institutional characteristics and 2024–25 costs without creating new identities. They update only institutions that already have an IPEDS `UNITID`, preserve imputation flags, and resume from committed checkpoints:

```bash
# From the repository root, with Docker services running
docker compose exec api pnpm --filter @urd/api import:ipeds-cost \
  /app/data/sources/IC2024.csv \
  /app/data/sources/COST1_2024.csv

# Local Node.js run instead
pnpm --filter @urd/api import:ipeds-cost \
  ../../data/sources/IC2024.csv \
  ../../data/sources/COST1_2024.csv
```

The importer records official source metadata, calendar and award-level characteristics, application fees, tuition, required fees, per-credit-hour charges, housing/food, and cost-of-attendance components. It does not infer a total cost or import doctoral-professional-practice charges into a general graduate row; those distinctions remain explicit in the source flags and scenarios.

The reviewed EF2024A snapshot adds official fall enrollment for the 2024–25 academic year. It keeps every IPEDS `EFALEVEL` as a separate fact (all students, undergraduate, graduate, full-time, and part-time views) so overlapping totals are never added together. Rows without a matching IPEDS `UNITID` are skipped and counted in the import ledger; suppressed values remain absent rather than being converted to zero.

```bash
# Docker: use the checked-in, reviewed snapshot inside the API image
docker compose exec api pnpm --filter @urd/api import:ipeds-enrollment \
  /app/data/sources/EF2024A.csv

# Optional: pause after a fixed number of source rows, then rerun to resume
docker compose exec api pnpm --filter @urd/api import:ipeds-enrollment \
  /app/data/sources/EF2024A.csv 3000

# Optional, safe artifact validation without touching the database
docker compose exec api pnpm --filter @urd/api import:ipeds-enrollment \
  /app/data/sources/EF2024A.csv --dry-run
```

The enrollment importer verifies the checked-in SHA-256, row count, column order, EFALEVEL meanings, imputation flags, and duplicate `UNITID`/`EFALEVEL` keys before writing. It stores each value with its source row, attendance status, population, and IPEDS flags. A committed source-row checkpoint makes interruption safe, and a completed artifact is a no-op when rerun.

The reviewed C2024_A snapshot adds official programs and award levels for U.S. IPEDS institutions. It covers the July 1, 2023–June 30, 2024 reporting period and uses the official 2020 Classification of Instructional Programs (CIP) catalog for human-readable program names. The checked-in `C2024_A_programs.csv` is a small, reviewed projection of the official C2024_A download containing only the fields needed to build the catalog; its source, row count, checksum, and transformation note are in `data/sources/ipeds-program-artifacts.json`.

```bash
# Docker: use the checked-in reviewed artifacts inside the API image
docker compose exec api pnpm --filter @urd/api import:ipeds-programs \
  /app/data/sources/C2024_A_programs.csv \
  /app/data/sources/CIPCode2020.csv

# Optional: pause after a fixed number of source rows, then rerun the same command
docker compose exec api pnpm --filter @urd/api import:ipeds-programs \
  /app/data/sources/C2024_A_programs.csv \
  /app/data/sources/CIPCode2020.csv 3000

# Optional, safe validation without touching the database
docker compose exec api pnpm --filter @urd/api import:ipeds-programs \
  /app/data/sources/C2024_A_programs.csv \
  /app/data/sources/CIPCode2020.csv --dry-run
```

The API image copies the reviewed source artifacts at build time. If you replace either CSV or its manifest locally, run `docker compose up --build -d api` before importing so the container uses the same files that are checked into the repository.

The importer only attaches a program to an existing IPEDS `UNITID`; unmatched rows are counted as skipped, never name-matched into a university. Duplicate second-major rows collapse to the same institution/CIP/award-level catalog item. Every run is protected by an advisory lock, records its source-row checkpoint in `import_runs`, and is a no-op after completion. Program names and award levels are sourced facts; C2024_A completion totals are validated but are not presented as current admissions requirements.

The reviewed Wikidata snapshot fills a small set of global profile fields for exact Wikidata IDs already present in the database: student count (`P2196`), establishment year (`P571`), and HTTPS official website (`P856`). It is an enrichment layer, not an admissions authority. Only previously null fields are filled; no Wikidata value replaces a contributor's value or an official IPEDS value.

```bash
# Docker: use the checked-in, reviewed snapshot inside the API image
docker compose exec api pnpm --filter @urd/api import:wikidata-enrichment \
  /app/data/sources/wikidata-institution-facts-20260831.csv

# Optional: pause after a fixed number of rows, then rerun to resume
docker compose exec api pnpm --filter @urd/api import:wikidata-enrichment \
  /app/data/sources/wikidata-institution-facts-20260831.csv 3000

# Optional, safe validation without touching the database
docker compose exec api pnpm --filter @urd/api import:wikidata-enrichment \
  /app/data/sources/wikidata-institution-facts-20260831.csv --dry-run
```

The Wikidata importer matches QIDs only, verifies the reviewed SHA-256, schema, row count, URLs, years, and duplicate QIDs, records a source link for every changed profile, and stores a resumable checkpoint. Community-maintained values should still be checked against the university's current official pages before applying.

The expanded reviewed snapshot links exact, one-to-one ROR identifiers to Wikidata QIDs before applying the same conservative enrichment. It never uses a university name to merge identities. Run the crosswalk first, then its facts companion:

```bash
docker compose exec api pnpm --filter @urd/api import:wikidata-ror-crosswalk \
  /app/data/sources/wikidata-ror-institution-facts-20260831.csv
docker compose exec api pnpm --filter @urd/api import:wikidata-enrichment \
  /app/data/sources/wikidata-ror-qid-facts-20260831.csv
```

Both steps verify the checked-in manifest and SHA-256, keep an independent source-row checkpoint, and become no-ops after completion. Ambiguous ROR/QID mappings are excluded from the reviewed artifact rather than guessed.

The reviewed ADM2024 snapshot adds first-time undergraduate admissions data. It records application, admission, and enrollment counts; the institution's admission considerations (such as GPA, recommendations, English proficiency, essays, and test policies); and reported SAT/ACT submission rates and score percentiles. IPEDS does not publish IB, A-Level, IELTS/TOEFL minimums, essay prompts, or program-specific requirements, so those fields must be added from the university's own official admissions pages.

```bash
# Docker: use the checked-in, reviewed snapshot inside the API image
docker compose exec api pnpm --filter @urd/api import:ipeds-admissions \
  /app/data/sources/ADM2024.csv 3000

# Local Node.js run from the repository root
pnpm --filter @urd/api import:ipeds-admissions \
  ../../data/sources/ADM2024.csv 3000

# Optional, safe validation without touching the database
docker compose exec api pnpm --filter @urd/api import:ipeds-admissions \
  /app/data/sources/ADM2024.csv --dry-run
```

The admissions importer is resumable: rerunning the same command continues from its committed `sourceRow` checkpoint, while a completed artifact becomes a no-op. It only attaches rows to an existing IPEDS `UNITID`; unmatched rows are preserved in `import_rejections` for review instead of being guessed into a university profile. Every imported value keeps its IPEDS reported, imputed, implied-zero, or unavailable flag in `source_flags`.

To propose a newer crosswalk, run the checked-in SPARQL query into a separate candidate file, review all forward and reverse ambiguities, normalize and archive the approved response, and then add its checksum and counts to `ipeds-artifacts.json`. Never replace the reviewed snapshot with a live query during a production import.

IPEDS is published by the U.S. National Center for Education Statistics through its [official data center](https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx); the federal catalog describes IPEDS public-use data as [CC0](https://catalog.data.gov/dataset/integrated-postsecondary-education-data-system-2012-13). The Wikidata crosswalk is CC0 and is used only for identity resolution—not as evidence that an institution is currently active or degree-granting.

Institution coverage is only the first layer. The next data layer uses official IPEDS admissions, institutional-characteristics, enrollment, and student-financial-aid files to add application totals, admissions totals, enrolled students, test policies and score ranges, tuition, fees, and student counts. Requirements that IPEDS does not publish—such as IB course expectations, essays, portfolios, recommendation letters, and program-specific prerequisites—must come from the university's own admissions pages. Missing values remain `null`; UniScope never turns an estimate into a requirement.

Create a backup before and after every batch, then run the automated data gate:

```bash
./scripts/backup-db.sh
pnpm data:check
pnpm data:status
```

`data/import-status.json` is generated from the live database and committed after each reviewed batch so GitHub shows the imported dataset version, checksum, checkpoint, identifier counts by provider, normalized admissions/enrichment fact counts, and quality counters. Do not edit it by hand. The file is a report, not an import input; regenerate it with `pnpm data:status` after a successful batch.

For local maintainer testing, `/contribute` includes a form that can send the same JSON to the API. The write route is absent by default. To opt in, set `ADMIN_WRITES_ENABLED=true` and provide a random `ADMIN_KEY` of at least 16 characters (for example, `openssl rand -hex 32`) before starting the API. Known development placeholder keys are rejected in production. This shared-key form is not production authentication; do not expose it publicly without real identity and authorization. Proxy headers are ignored unless `TRUST_PROXY` is explicitly set to `true` or to a comma-separated trusted IP/CIDR list.

### General and programme-specific admissions requirements

Official requirements can be added through reviewed JSON without changing website code. The importer supports university-wide rules, exact existing programme IDs and sourced declarations for programmes missing from the catalogue. It validates identities and source domains, previews changes without writes, skips existing facts and rejects conflicts. See [ADMISSIONS_DATA.md](docs/ADMISSIONS_DATA.md) for data entry and import commands, and [ADMISSIONS_PROGRESS.md](docs/ADMISSIONS_PROGRESS.md) for the current six-step checkpoint and remaining coverage.

### Program-level IB entry requirements

Reviewed IB requirements now have a separate searchable, paginated section on each university profile. University-wide policies are not copied to every program. Official minima, typical offers, contextual offers, qualification conversion and missing evidence have distinct labels; each reviewed record retains its entry year, applicant route, subject conditions and official source.

See [IB_REQUIREMENTS.md](docs/IB_REQUIREMENTS.md) for the JSON format, safe validation/preview/import commands and coverage definitions. [IB_PROGRESS.md](docs/IB_PROGRESS.md) records the current checkpoint and outstanding work. The reviewed global and Kenyan artifacts are a first batch, not complete global coverage.

## Database commands

| Command            | Purpose                                          | Real path used              |
| ------------------ | ------------------------------------------------ | --------------------------- |
| `pnpm db:generate` | Generate migration files from the Drizzle schema | `apps/api/drizzle`          |
| `pnpm db:migrate`  | Apply checked-in migrations                      | `apps/api/drizzle`          |
| `pnpm db:studio`   | Open Drizzle Studio                              | `apps/api/src/db/schema.ts` |

All database operations require `DATABASE_URL`; `.env.example` includes a working local value.

## Quality checks

```bash
pnpm check
pnpm data:check
```

The first command checks formatting, lint rules, strict types, tests, and production builds. GitHub Actions runs it for pull requests and pushes to `main`. The second checks database provenance invariants plus the live API and website.

## Data responsibility

University information changes frequently. UniScope presents research leads, not admissions advice. Every record must cite at least one official, government, or reputable independent source and include a source or review date. A registry import is source-backed, not a claim that a person manually verified every admissions fact. Contributors should never invent acceptance rates, IB requirements, or costs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution process. Released under the [MIT License](LICENSE).

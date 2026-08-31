# UniScope — University Research Dashboard

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
cp .env.example .env
docker compose up --build -d
docker compose cp data/myuniversity.json api:/tmp/myuniversity.json
docker compose exec api pnpm --filter @urd/api run import /tmp/myuniversity.json
```

Open `http://localhost:5173`. The API health endpoint is `http://localhost:3001/health`.

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

To propose a newer crosswalk, run the checked-in SPARQL query into a separate candidate file, review all forward and reverse ambiguities, normalize and archive the approved response, and then add its checksum and counts to `ipeds-artifacts.json`. Never replace the reviewed snapshot with a live query during a production import.

IPEDS is published by the U.S. National Center for Education Statistics through its [official data center](https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx); the federal catalog describes IPEDS public-use data as [CC0](https://catalog.data.gov/dataset/integrated-postsecondary-education-data-system-2012-13). The Wikidata crosswalk is CC0 and is used only for identity resolution—not as evidence that an institution is currently active or degree-granting.

Institution coverage is only the first layer. The next data layer uses official IPEDS admissions, institutional-characteristics, enrollment, and student-financial-aid files to add application totals, admissions totals, enrolled students, test policies and score ranges, tuition, fees, and student counts. Requirements that IPEDS does not publish—such as IB course expectations, essays, portfolios, recommendation letters, and program-specific prerequisites—must come from the university's own admissions pages. Missing values remain `null`; UniScope never turns an estimate into a requirement.

Create a backup before and after every batch, then run the automated data gate:

```bash
./scripts/backup-db.sh
pnpm data:check
pnpm data:status
```

`data/import-status.json` is generated from the live database and committed after each reviewed batch so GitHub shows the imported dataset version, checksum, checkpoint, identifier counts by provider, and quality counters. Do not edit it by hand.

For local maintainer testing, `/contribute` includes a form that sends the same JSON to the API. It requires `ADMIN_KEY`. This is intentionally a development tool, not production authentication. Do not expose it publicly without replacing the shared key with real identity and authorization.

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

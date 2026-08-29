# UniScope — University Research Dashboard

An open-source, non-profit university research website built by students. UniScope helps applicants discover, compare, and verify university information without turning the project into a large application.

## What is included

- Search by university, city, or country; filter by country and institution type
- Paginated research cards, source-backed detail pages, and a three-university comparison
- Programs, deadlines, tuition, IB guidance, student counts, and verification dates
- JSON import workflow and a development-only, key-protected data entry form
- Strict TypeScript, shared Zod validation, tests, linting, formatting, and CI
- PostgreSQL schema, checked-in migration, seed data, and Docker Compose

## Architecture

```text
apps/web       React 19 + Vite + React Query
apps/api       Fastify + Drizzle + PostgreSQL
packages/shared  Shared Zod schemas and TypeScript types
data           Contributor-friendly import example
```

The project deliberately uses one web app, one API, and one database. Adding a university changes data only; it does not require a component, route, or schema change.

## Start with Docker (recommended)

Requirements: Docker Desktop with Docker Compose.

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec api pnpm --filter @urd/api db:seed
```

Open `http://localhost:5173`. The API health endpoint is `http://localhost:3001/health`.

If PostgreSQL already uses port 5432 on your computer, set `POSTGRES_PORT=55432` in `.env`. When running database commands directly on the Mac, also use port `55432` in `DATABASE_URL`; Docker services continue to use `db:5432` internally.

The API container automatically runs the checked-in migration from `apps/api/drizzle` before starting. Seeding is explicit so restarting the site never replaces contributor data.

Create a database backup at any time with `./scripts/backup-db.sh`. Backups are written to the ignored `backups/` directory, and the latest 14 are retained by default.

## Start locally

Requirements: Node.js 26, pnpm 11.24+, and PostgreSQL 18+.

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The root `.env` is read when commands are started from the repository root. If your shell or editor starts the API inside `apps/api`, copy the same values to `apps/api/.env`.

## Add a university without changing code

1. Copy `data/universities.example.json` and replace its sample values.
2. Use official HTTPS sources. Use `null` instead of guessing unavailable numbers.
3. Import and validate the file:

```bash
pnpm --filter @urd/api import -- ../../data/your-universities.json
```

The import is an upsert by `slug`, so a reviewed record can be corrected safely. It validates exactly the same schema used by the API and front end.

Maintainers can import active global education institutions from the CC0 Research Organization Registry in reviewed batches:

```bash
docker compose exec api pnpm --filter @urd/api import:ror 3000
```

The importer keeps a ROR source on every record, skips matching name/country duplicates, marks unknown ownership honestly, and leaves admissions fields empty rather than inventing values. The public ROR API supports the first 10,000 records; larger synchronization should use the official ROR data dump.

For local maintainer testing, `/contribute` includes a form that sends the same JSON to the API. It requires `ADMIN_KEY`. This is intentionally a development tool, not production authentication. Do not expose it publicly without replacing the shared key with real identity and authorization.

## Database commands

| Command            | Purpose                                          | Real path used              |
| ------------------ | ------------------------------------------------ | --------------------------- |
| `pnpm db:generate` | Generate migration files from the Drizzle schema | `apps/api/drizzle`          |
| `pnpm db:migrate`  | Apply checked-in migrations                      | `apps/api/drizzle`          |
| `pnpm db:seed`     | Load representative university data              | `apps/api/src/db/seed.ts`   |
| `pnpm db:studio`   | Open Drizzle Studio                              | `apps/api/src/db/schema.ts` |

All database operations require `DATABASE_URL`; `.env.example` includes a working local value.

## Quality checks

```bash
pnpm check
```

This checks formatting, lint rules, strict types, tests, and production builds. GitHub Actions runs the same command for pull requests and pushes to `main`.

## Data responsibility

University information changes frequently. UniScope presents research leads, not admissions advice. Every record must cite at least one official, government, or reputable independent source and include a verification timestamp. Contributors should never invent acceptance rates, IB requirements, or costs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution process. Released under the [MIT License](LICENSE).

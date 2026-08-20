import { and, asc, count, eq, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type {
  University,
  UniversityInput,
  UniversityListResponse,
  UniversityQuery,
} from '@urd/shared';
import type { Database } from '../db/client.js';
import { deadlines, programs, sources, universities } from '../db/schema.js';

type UniversityRow = typeof universities.$inferSelect;

const hydrate = async (db: Database, rows: UniversityRow[]): Promise<University[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [programRows, deadlineRows, sourceRows] = await Promise.all([
    db.select().from(programs).where(inArray(programs.universityId, ids)),
    db.select().from(deadlines).where(inArray(deadlines.universityId, ids)),
    db.select().from(sources).where(inArray(sources.universityId, ids)),
  ]);
  return rows.map((row) => ({
    ...row,
    acceptanceRate: row.acceptanceRate === null ? null : Number(row.acceptanceRate),
    updatedAt: row.updatedAt.toISOString(),
    programs: programRows
      .filter((item) => item.universityId === row.id)
      .map(({ name, level, field }) => ({ name, level, field })),
    deadlines: deadlineRows
      .filter((item) => item.universityId === row.id)
      .map(({ label, date, applicantType }) => ({ label, date, applicantType })),
    sources: sourceRows
      .filter((item) => item.universityId === row.id)
      .map(({ title, url, category, verifiedAt }) => ({
        title,
        url,
        category,
        verifiedAt: verifiedAt.toISOString(),
      })),
  }));
};

export const listUniversities = async (
  db: Database,
  query: UniversityQuery,
): Promise<UniversityListResponse> => {
  const filters = [
    query.q
      ? or(
          ilike(universities.name, `%${query.q}%`),
          ilike(universities.city, `%${query.q}%`),
          ilike(universities.country, `%${query.q}%`),
        )
      : undefined,
    query.country ? eq(universities.country, query.country) : undefined,
    query.type ? eq(universities.institutionType, query.type) : undefined,
    query.maxTuition ? lte(universities.annualTuitionUsd, query.maxTuition) : undefined,
  ].filter((filter) => filter !== undefined);
  const where = filters.length ? and(...filters) : undefined;
  const offset = (query.page - 1) * query.pageSize;
  const [rows, totals, countryRows] = await Promise.all([
    db
      .select()
      .from(universities)
      .where(where)
      .orderBy(asc(universities.name))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ value: count() }).from(universities).where(where),
    db
      .selectDistinct({ country: universities.country })
      .from(universities)
      .orderBy(asc(universities.country)),
  ]);
  const total = totals[0]?.value ?? 0;
  return {
    items: await hydrate(db, rows),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    countries: countryRows.map((row) => row.country),
  };
};

export const getUniversity = async (db: Database, slug: string) => {
  const rows = await db.select().from(universities).where(eq(universities.slug, slug)).limit(1);
  return (await hydrate(db, rows))[0] ?? null;
};

export const createUniversity = async (db: Database, input: UniversityInput) =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .insert(universities)
      .values({
        ...input,
        acceptanceRate: input.acceptanceRate?.toString(),
        programs: undefined,
        deadlines: undefined,
        sources: undefined,
      } as never)
      .returning();
    if (!row) throw new Error('University insert failed');
    await Promise.all([
      input.programs.length
        ? tx
            .insert(programs)
            .values(input.programs.map((item) => ({ ...item, universityId: row.id })))
        : Promise.resolve(),
      input.deadlines.length
        ? tx
            .insert(deadlines)
            .values(input.deadlines.map((item) => ({ ...item, universityId: row.id })))
        : Promise.resolve(),
      tx.insert(sources).values(
        input.sources.map((item) => ({
          ...item,
          universityId: row.id,
          verifiedAt: new Date(item.verifiedAt),
        })),
      ),
    ]);
    return row.slug;
  });

export const upsertUniversity = async (db: Database, input: UniversityInput) => {
  await db.delete(universities).where(eq(universities.slug, input.slug));
  return createUniversity(db, input);
};

export const healthcheck = async (db: Database) => db.execute(sql`select 1`);

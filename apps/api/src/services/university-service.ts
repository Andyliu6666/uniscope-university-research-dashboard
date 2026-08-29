import { and, asc, count, eq, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type {
  University,
  UniversityInput,
  UniversityListResponse,
  UniversityQuery,
} from '@urd/shared';
import type { Database } from '../db/client.js';
import {
  deadlines,
  institutionIdentifiers,
  programs,
  sources,
  universities,
} from '../db/schema.js';

type UniversityRow = typeof universities.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

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
          ilike(universities.name, `%${escapeLike(query.q)}%`),
          ilike(universities.city, `%${escapeLike(query.q)}%`),
          ilike(universities.country, `%${escapeLike(query.q)}%`),
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

const insertChildren = async (tx: Tx, universityId: string, input: UniversityInput) => {
  const [existingPrograms, existingDeadlines, existingSources] = await Promise.all([
    tx.select().from(programs).where(eq(programs.universityId, universityId)),
    tx.select().from(deadlines).where(eq(deadlines.universityId, universityId)),
    tx.select().from(sources).where(eq(sources.universityId, universityId)),
  ]);
  const programKeys = new Set(
    existingPrograms.map((item) => `${item.name}\u0000${item.level}\u0000${item.field}`),
  );
  const deadlineKeys = new Set(
    existingDeadlines.map((item) => `${item.label}\u0000${item.date}\u0000${item.applicantType}`),
  );
  const sourceUrls = new Set(existingSources.map((item) => item.url));
  const newPrograms = input.programs.filter(
    (item) => !programKeys.has(`${item.name}\u0000${item.level}\u0000${item.field}`),
  );
  const newDeadlines = input.deadlines.filter(
    (item) => !deadlineKeys.has(`${item.label}\u0000${item.date}\u0000${item.applicantType}`),
  );
  const newSources = input.sources.filter((item) => !sourceUrls.has(item.url));
  const rorIdentifiers = input.sources.flatMap((item) => {
    const match = /^https:\/\/ror[.]org\/([^/?#]+)/u.exec(item.url);
    return match?.[1]
      ? [{ universityId, provider: 'ror', externalId: match[1].toLowerCase() }]
      : [];
  });

  await Promise.all([
    newPrograms.length
      ? tx.insert(programs).values(newPrograms.map((item) => ({ ...item, universityId })))
      : Promise.resolve(),
    newDeadlines.length
      ? tx.insert(deadlines).values(newDeadlines.map((item) => ({ ...item, universityId })))
      : Promise.resolve(),
    newSources.length
      ? tx.insert(sources).values(
          newSources.map((item) => ({
            ...item,
            universityId,
            verifiedAt: new Date(item.verifiedAt),
          })),
        )
      : Promise.resolve(),
    rorIdentifiers.length
      ? tx.insert(institutionIdentifiers).values(rorIdentifiers).onConflictDoNothing()
      : Promise.resolve(),
  ]);
};

const insertUniversity = async (tx: Tx, input: UniversityInput) => {
  const {
    programs: programInputs,
    deadlines: deadlineInputs,
    sources: sourceInputs,
    ...core
  } = input;
  const [row] = await tx
    .insert(universities)
    .values({ ...core, acceptanceRate: input.acceptanceRate?.toString() })
    .returning();
  if (!row) throw new Error('University insert failed');
  await insertChildren(tx, row.id, {
    ...input,
    programs: programInputs,
    deadlines: deadlineInputs,
    sources: sourceInputs,
  });
  return row.slug;
};

export const createUniversity = async (db: Database, input: UniversityInput) =>
  db.transaction((tx) => insertUniversity(tx, input));

export const upsertUniversity = async (db: Database, input: UniversityInput) =>
  db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(universities)
      .where(eq(universities.slug, input.slug))
      .limit(1);
    if (!existing) return insertUniversity(tx, input);

    const {
      programs: _programInputs,
      deadlines: _deadlineInputs,
      sources: _sourceInputs,
      ...core
    } = input;
    await tx
      .update(universities)
      .set({
        ...core,
        institutionType:
          input.institutionType === 'unknown' ? existing.institutionType : input.institutionType,
        studentCount: input.studentCount ?? existing.studentCount,
        acceptanceRate:
          input.acceptanceRate === null ? existing.acceptanceRate : input.acceptanceRate.toString(),
        annualTuitionUsd: input.annualTuitionUsd ?? existing.annualTuitionUsd,
        ibTypicalMin: input.ibTypicalMin ?? existing.ibTypicalMin,
        featured: input.featured || existing.featured,
        updatedAt: new Date(),
      })
      .where(eq(universities.id, existing.id));
    await insertChildren(tx, existing.id, input);
    return input.slug;
  });

export const healthcheck = async (db: Database) => db.execute(sql`select 1`);

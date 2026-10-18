import { and, asc, count, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  ibRequirementSchema,
  type IbQuery,
  type IbRequirement,
  type UniversityIbResponse,
} from '@urd/shared';
import type { Database } from '../db/client.js';
import {
  admissionProfiles,
  programs,
  qualificationRequirements,
  sources,
  universities,
} from '../db/schema.js';

export const IB_PROVIDER = 'official_ib';

export const ibMatchesQuery = (requirement: IbRequirement, query: IbQuery) =>
  (!query.year || requirement.academicYear === query.year) &&
  requirement.entryType === query.entryType &&
  (!query.applicantType ||
    requirement.applicantType === 'all' ||
    requirement.applicantType === query.applicantType);

/** Institution-wide policies stay separate. A university floor is never copied to every course. */
export const getUniversityIb = async (
  db: Database,
  slug: string,
  query: IbQuery,
): Promise<UniversityIbResponse | null> => {
  const [university] = await db
    .select({ id: universities.id, name: universities.name, slug: universities.slug })
    .from(universities)
    .where(eq(universities.slug, slug))
    .limit(1);
  if (!university) return null;
  const levelFilter = and(
    eq(programs.universityId, university.id),
    eq(programs.level, query.level),
  );
  const text = query.q.replace(/[\\%_]/gu, (character) => `\\${character}`);
  const catalogFilter = and(levelFilter, query.q ? ilike(programs.name, `%${text}%`) : undefined);
  const [pageRows, [totalRow], [catalogRow], factRows] = await Promise.all([
    db
      .select()
      .from(programs)
      .where(catalogFilter)
      .orderBy(asc(programs.name), asc(programs.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ value: count() }).from(programs).where(catalogFilter),
    db.select({ value: count() }).from(programs).where(levelFilter),
    db
      .select({
        payload: qualificationRequirements.sourceFlags,
        profile: admissionProfiles,
        sourceUrl: sources.url,
      })
      .from(qualificationRequirements)
      .innerJoin(
        admissionProfiles,
        eq(qualificationRequirements.admissionProfileId, admissionProfiles.id),
      )
      .innerJoin(
        sources,
        and(
          eq(qualificationRequirements.sourceId, sources.id),
          eq(sources.universityId, admissionProfiles.universityId),
        ),
      )
      .leftJoin(programs, eq(admissionProfiles.programId, programs.id))
      .where(
        and(
          eq(admissionProfiles.universityId, university.id),
          eq(admissionProfiles.level, query.level),
          eq(qualificationRequirements.qualificationSystem, 'IB'),
          eq(sources.category, 'official'),
          sql`${qualificationRequirements.sourceFlags}->>'provider' = ${IB_PROVIDER}`,
          or(
            isNull(admissionProfiles.programId),
            and(eq(programs.universityId, university.id), eq(programs.level, query.level)),
          ),
        ),
      ),
  ]);
  const facts = factRows.map(({ payload, profile, sourceUrl }) => {
    const requirement = ibRequirementSchema.parse(payload.ib);
    if (
      requirement.academicYear !== profile.academicYear ||
      requirement.applicantType !== profile.applicantType ||
      requirement.entryType !== profile.entryType ||
      requirement.intakeTerm !== profile.intakeTerm ||
      requirement.source.url !== sourceUrl
    )
      throw new Error('IB requirement scope does not match its admission profile.');
    return { requirement, programId: profile.programId };
  });
  const selected = facts.filter(({ requirement }) => ibMatchesQuery(requirement, query));
  const byProgram = new Map<string, IbRequirement[]>();
  for (const { programId, requirement } of selected) {
    if (programId) byProgram.set(programId, [...(byProgram.get(programId) ?? []), requirement]);
  }
  for (const values of byProgram.values())
    values.sort(
      (a, b) =>
        b.academicYear.localeCompare(a.academicYear) || a.recordKey.localeCompare(b.recordKey),
    );
  const total = Number(totalRow?.value ?? 0);
  return {
    university,
    institutionPolicies: selected.filter((f) => f.programId === null).map((f) => f.requirement),
    programs: pageRows.map((p) => ({
      id: p.id,
      name: p.name,
      field: p.field,
      level: p.level,
      catalogYear: p.academicYear,
      requirements: byProgram.get(p.id) ?? [],
    })),
    years: [...new Set(facts.map((f) => f.requirement.academicYear))].sort().reverse(),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
    coverage: {
      catalogPrograms: Number(catalogRow?.value ?? 0),
      programsWithReviewedIb: byProgram.size,
      programsWithPublishedTotals: [...byProgram.values()].filter((items) =>
        items.some((r) => r.status === 'published'),
      ).length,
    },
  };
};

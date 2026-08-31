import { and, asc, count, desc, eq, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type {
  AdmissionsQuery,
  UniversityAdmissionsResponse,
  University,
  UniversityInput,
  UniversityListResponse,
  UniversityQuery,
} from '@urd/shared';
import type { Database } from '../db/client.js';
import {
  admissionCounts,
  admissionProfiles,
  admissionRequirements,
  admissionTestScores,
  costSnapshots,
  deadlines,
  enrollmentSnapshots,
  financialAidSnapshots,
  institutionIdentifiers,
  programs,
  qualificationRequirements,
  sources,
  universities,
} from '../db/schema.js';

type UniversityRow = typeof universities.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
const numberOrNull = (value: string | number | null) => (value === null ? null : Number(value));

const sourceForApi = (source: typeof sources.$inferSelect) => ({
  title: source.title,
  url: source.url,
  category: source.category,
  publisher: source.publisher,
  datasetVersion: source.datasetVersion,
  publishedAt: source.publishedAt?.toISOString() ?? null,
  verifiedAt: source.verifiedAt.toISOString(),
});

type CostSnapshotRow = typeof costSnapshots.$inferSelect;

const costSummaryOrder = [
  {
    level: 'undergraduate',
    residency: 'out_of_state',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'undergraduate',
    residency: 'in_state',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'undergraduate',
    residency: 'in_district',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'graduate',
    residency: 'out_of_state',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'graduate',
    residency: 'in_state',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'graduate',
    residency: 'in_district',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'undergraduate',
    residency: 'out_of_state',
    category: 'tuition',
    period: 'academic_year',
    scenario: 'average_full_time',
  },
  {
    level: 'undergraduate',
    residency: 'in_state',
    category: 'tuition',
    period: 'academic_year',
    scenario: 'average_full_time',
  },
] as const;

const costSummaryRank = (row: CostSnapshotRow) => {
  const rank = costSummaryOrder.findIndex(
    (preferred) =>
      row.level === preferred.level &&
      row.residency === preferred.residency &&
      row.category === preferred.category &&
      row.period === preferred.period &&
      row.scenario === preferred.scenario,
  );
  return rank === -1 ? costSummaryOrder.length : rank;
};

const selectCostSummaries = (rows: CostSnapshotRow[]) =>
  rows
    .filter((row) => row.programId === null)
    .sort((left, right) => {
      const rankDifference = costSummaryRank(left) - costSummaryRank(right);
      if (rankDifference !== 0) return rankDifference;
      const yearDifference = right.academicYear.localeCompare(left.academicYear);
      if (yearDifference !== 0) return yearDifference;
      return left.id.localeCompare(right.id);
    })
    .slice(0, 6);

const costForApi = (row: CostSnapshotRow, source: typeof sources.$inferSelect) => ({
  academicYear: row.academicYear,
  level: row.level,
  applicantType: row.applicantType,
  residency: row.residency,
  category: row.category,
  period: row.period,
  scenario: row.scenario,
  amount: Number(row.amount),
  currency: row.currency,
  sourceFlags: row.sourceFlags,
  source: sourceForApi(source),
});

export const resolveStudentCount = (
  profileStudentCount: number | null,
  officialEnrollment: number | undefined,
) => officialEnrollment ?? profileStudentCount ?? null;

const hydrate = async (db: Database, rows: UniversityRow[]): Promise<University[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [programRows, deadlineRows, sourceRows, enrollmentRows, costRows] = await Promise.all([
    db.select().from(programs).where(inArray(programs.universityId, ids)),
    db.select().from(deadlines).where(inArray(deadlines.universityId, ids)),
    db.select().from(sources).where(inArray(sources.universityId, ids)),
    db
      .select({
        universityId: enrollmentSnapshots.universityId,
        academicYear: enrollmentSnapshots.academicYear,
        attendanceStatus: enrollmentSnapshots.attendanceStatus,
        population: enrollmentSnapshots.population,
        studentCount: enrollmentSnapshots.studentCount,
      })
      .from(enrollmentSnapshots)
      .where(inArray(enrollmentSnapshots.universityId, ids)),
    db.select().from(costSnapshots).where(inArray(costSnapshots.universityId, ids)),
  ]);
  const officialEnrollment = new Map(
    enrollmentRows
      .filter((item) => item.population === 'total' && item.attendanceStatus === 'all')
      .sort((left, right) => right.academicYear.localeCompare(left.academicYear))
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.universityId === item.universityId) === index,
      )
      .map((item) => [item.universityId, item.studentCount]),
  );
  return rows.map((row) => ({
    ...row,
    studentCount: resolveStudentCount(row.studentCount, officialEnrollment.get(row.id)),
    acceptanceRate: row.acceptanceRate === null ? null : Number(row.acceptanceRate),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    updatedAt: row.updatedAt.toISOString(),
    programs: programRows
      .filter((item) => item.universityId === row.id)
      .map(({ name, level, field }) => ({ name, level, field })),
    deadlines: deadlineRows
      .filter((item) => item.universityId === row.id)
      .map(({ label, date, applicantType, entryType, academicYear }) => ({
        label,
        date,
        applicantType,
        entryType,
        academicYear,
      })),
    sources: sourceRows
      .filter((item) => item.universityId === row.id)
      .map(({ title, url, category, publisher, datasetVersion, publishedAt, verifiedAt }) => ({
        title,
        url,
        category,
        publisher,
        datasetVersion,
        publishedAt: publishedAt?.toISOString() ?? null,
        verifiedAt: verifiedAt.toISOString(),
      })),
    costs: selectCostSummaries(costRows.filter((item) => item.universityId === row.id)).map(
      (item) => {
        const source = sourceRows.find((candidate) => candidate.id === item.sourceId);
        if (!source) throw new Error(`Missing source ${item.sourceId} for cost snapshot`);
        return costForApi(item, source);
      },
    ),
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

export const getUniversityAdmissions = async (
  db: Database,
  slug: string,
  query: AdmissionsQuery,
): Promise<UniversityAdmissionsResponse | null> => {
  const [university] = await db
    .select({ id: universities.id, name: universities.name, slug: universities.slug })
    .from(universities)
    .where(eq(universities.slug, slug))
    .limit(1);
  if (!university) return null;

  const profileFilters = [
    eq(admissionProfiles.universityId, university.id),
    query.year ? eq(admissionProfiles.academicYear, query.year) : undefined,
    query.level ? eq(admissionProfiles.level, query.level) : undefined,
    query.applicantType ? eq(admissionProfiles.applicantType, query.applicantType) : undefined,
    query.entryType ? eq(admissionProfiles.entryType, query.entryType) : undefined,
  ].filter((filter): filter is Exclude<typeof filter, undefined> => filter !== undefined);
  const profiles = await db
    .select()
    .from(admissionProfiles)
    .where(and(...profileFilters))
    .orderBy(desc(admissionProfiles.academicYear), asc(admissionProfiles.intakeTerm))
    .limit(50);
  const profileIds = profiles.map((profile) => profile.id);
  const [countRows, requirementRows, qualificationRows, testRows] = profileIds.length
    ? await Promise.all([
        db
          .select()
          .from(admissionCounts)
          .where(inArray(admissionCounts.admissionProfileId, profileIds)),
        db
          .select()
          .from(admissionRequirements)
          .where(inArray(admissionRequirements.admissionProfileId, profileIds)),
        db
          .select()
          .from(qualificationRequirements)
          .where(inArray(qualificationRequirements.admissionProfileId, profileIds)),
        db
          .select()
          .from(admissionTestScores)
          .where(inArray(admissionTestScores.admissionProfileId, profileIds)),
      ])
    : [[], [], [], []];

  const costFilters = [
    eq(costSnapshots.universityId, university.id),
    query.year ? eq(costSnapshots.academicYear, query.year) : undefined,
    query.level ? eq(costSnapshots.level, query.level) : undefined,
    query.applicantType ? eq(costSnapshots.applicantType, query.applicantType) : undefined,
  ].filter((filter): filter is Exclude<typeof filter, undefined> => filter !== undefined);
  const enrollmentFilters = [
    eq(enrollmentSnapshots.universityId, university.id),
    query.year ? eq(enrollmentSnapshots.academicYear, query.year) : undefined,
    query.level ? eq(enrollmentSnapshots.level, query.level) : undefined,
    query.applicantType ? eq(enrollmentSnapshots.applicantType, query.applicantType) : undefined,
  ].filter((filter): filter is Exclude<typeof filter, undefined> => filter !== undefined);
  const aidFilters = [
    eq(financialAidSnapshots.universityId, university.id),
    query.year ? eq(financialAidSnapshots.academicYear, query.year) : undefined,
    query.level ? eq(financialAidSnapshots.level, query.level) : undefined,
    query.applicantType ? eq(financialAidSnapshots.applicantType, query.applicantType) : undefined,
  ].filter((filter): filter is Exclude<typeof filter, undefined> => filter !== undefined);
  const [costRows, enrollmentRows, aidRows] = await Promise.all([
    db
      .select()
      .from(costSnapshots)
      .where(and(...costFilters)),
    db
      .select()
      .from(enrollmentSnapshots)
      .where(and(...enrollmentFilters)),
    db
      .select()
      .from(financialAidSnapshots)
      .where(and(...aidFilters)),
  ]);

  const sourceIds = [
    ...profiles.map((profile) => profile.sourceId),
    ...countRows.map((row) => row.sourceId),
    ...requirementRows.map((row) => row.sourceId),
    ...qualificationRows.map((row) => row.sourceId),
    ...testRows.map((row) => row.sourceId),
    ...costRows.map((row) => row.sourceId),
    ...enrollmentRows.map((row) => row.sourceId),
    ...aidRows.map((row) => row.sourceId),
  ];
  const sourceRows = sourceIds.length
    ? await db
        .select()
        .from(sources)
        .where(inArray(sources.id, [...new Set(sourceIds)]))
    : [];
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const sourceFor = (sourceId: string) => {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error(`Missing source ${sourceId} for university ${university.slug}`);
    return sourceForApi(source);
  };

  const profileResponses = profiles.map((profile) => ({
    id: profile.id,
    academicYear: profile.academicYear,
    intakeTerm: profile.intakeTerm,
    entryType: profile.entryType,
    level: profile.level,
    applicantType: profile.applicantType,
    openAdmission: profile.openAdmission,
    applicationUrl: profile.applicationUrl,
    notes: profile.notes,
    counts: countRows
      .filter((row) => row.admissionProfileId === profile.id)
      .map((row) => ({
        metric: row.metric,
        population: row.population,
        value: row.value,
        sourceFlags: row.sourceFlags,
      })),
    requirements: requirementRows
      .filter((row) => row.admissionProfileId === profile.id)
      .map((row) => ({
        category: row.category,
        requirementKey: row.requirementKey,
        label: row.label,
        status: row.status,
        details: row.details,
        sourceFlags: row.sourceFlags,
        verifiedAt: row.verifiedAt.toISOString(),
      })),
    qualifications: qualificationRows
      .filter((row) => row.admissionProfileId === profile.id)
      .map((row) => ({
        qualificationSystem: row.qualificationSystem,
        qualificationName: row.qualificationName,
        kind: row.kind,
        subject: row.subject,
        operator: row.operator,
        minimumValue: numberOrNull(row.minimumValue),
        maximumValue: numberOrNull(row.maximumValue),
        valueText: row.valueText,
        scale: row.scale,
        notes: row.notes,
        sourceFlags: row.sourceFlags,
      })),
    testScores: testRows
      .filter((row) => row.admissionProfileId === profile.id)
      .map((row) => ({
        testName: row.testName,
        section: row.section,
        context: row.context,
        submittersCount: row.submittersCount,
        submittersPercent: numberOrNull(row.submittersPercent),
        minimumScore: numberOrNull(row.minimumScore),
        maximumScore: numberOrNull(row.maximumScore),
        averageScore: numberOrNull(row.averageScore),
        percentile25: numberOrNull(row.percentile25),
        percentile50: numberOrNull(row.percentile50),
        percentile75: numberOrNull(row.percentile75),
        scoreScale: row.scoreScale,
        sourceFlags: row.sourceFlags,
      })),
    source: sourceFor(profile.sourceId),
  }));

  return {
    university,
    profiles: profileResponses,
    costs: costRows.map((row) => ({
      academicYear: row.academicYear,
      level: row.level,
      applicantType: row.applicantType,
      residency: row.residency,
      category: row.category,
      period: row.period,
      scenario: row.scenario,
      amount: Number(row.amount),
      currency: row.currency,
      sourceFlags: row.sourceFlags,
      source: sourceFor(row.sourceId),
    })),
    enrollment: enrollmentRows.map((row) => ({
      academicYear: row.academicYear,
      level: row.level,
      attendanceStatus: row.attendanceStatus,
      applicantType: row.applicantType,
      population: row.population,
      studentCount: row.studentCount,
      sourceFlags: row.sourceFlags,
    })),
    financialAid: aidRows.map((row) => ({
      academicYear: row.academicYear,
      level: row.level,
      applicantType: row.applicantType,
      population: row.population,
      category: row.category,
      recipientCount: row.recipientCount,
      recipientPercent: numberOrNull(row.recipientPercent),
      averageAmount: numberOrNull(row.averageAmount),
      totalAmount: numberOrNull(row.totalAmount),
      currency: row.currency,
      sourceFlags: row.sourceFlags,
    })),
    sources: sourceRows.map(sourceForApi),
  };
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
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined,
            verifiedAt: new Date(item.verifiedAt),
          })),
        )
      : Promise.resolve(),
    rorIdentifiers.length
      ? tx.insert(institutionIdentifiers).values(rorIdentifiers).onConflictDoNothing()
      : Promise.resolve(),
  ]);
};

const toDbUniversityCore = (core: Omit<UniversityInput, 'programs' | 'deadlines' | 'sources'>) => ({
  ...core,
  acceptanceRate:
    core.acceptanceRate === null || core.acceptanceRate === undefined
      ? core.acceptanceRate
      : core.acceptanceRate.toString(),
  latitude:
    core.latitude === null || core.latitude === undefined
      ? core.latitude
      : core.latitude.toString(),
  longitude:
    core.longitude === null || core.longitude === undefined
      ? core.longitude
      : core.longitude.toString(),
});

const insertUniversity = async (tx: Tx, input: UniversityInput) => {
  const {
    programs: programInputs,
    deadlines: deadlineInputs,
    sources: sourceInputs,
    ...core
  } = input;
  const [row] = await tx.insert(universities).values(toDbUniversityCore(core)).returning();
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
    const dbCore = toDbUniversityCore(core);
    await tx
      .update(universities)
      .set({
        ...dbCore,
        institutionType:
          input.institutionType === 'unknown' ? existing.institutionType : input.institutionType,
        studentCount: input.studentCount ?? existing.studentCount,
        acceptanceRate:
          input.acceptanceRate === null
            ? existing.acceptanceRate
            : (dbCore.acceptanceRate ?? existing.acceptanceRate),
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

import { and, asc, count, desc, eq, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type {
  AdmissionsQuery,
  CoverageDimension,
  CoverageSourceTier,
  UniversityAdmissionsResponse,
  University,
  UniversityCoverage,
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
  institutionAliases,
  institutionIdentifiers,
  programs,
  qualificationRequirements,
  researchProfiles,
  sources,
  universities,
} from '../db/schema.js';

type UniversityRow = typeof universities.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
const numberOrNull = (value: string | number | null) => (value === null ? null : Number(value));

export const universitySearchFilter = (query: string) => {
  const escapedQuery = escapeLike(query);
  const containsQuery = `%${escapedQuery}%`;
  const filter = or(
    ilike(universities.name, containsQuery),
    ilike(universities.city, containsQuery),
    ilike(universities.country, containsQuery),
    sql<boolean>`exists (
      select 1
      from ${institutionAliases}
      where ${institutionAliases.universityId} = ${universities.id}
        and ${institutionAliases.name} ilike ${containsQuery} escape '\\'
    )`,
  );
  if (!filter) throw new Error('University search filter requires at least one condition');
  return filter;
};

export const universitySearchRelevance = (query: string) => {
  const escapedQuery = escapeLike(query);
  const prefixQuery = `${escapedQuery}%`;
  const containsQuery = `%${escapedQuery}%`;
  return sql<number>`case
    when lower(${universities.name}) = lower(${query}) then 0
    when lower(${universities.name}) = lower(${`${query} university`}) then 1
    when exists (
      select 1
      from ${institutionAliases}
      where ${institutionAliases.universityId} = ${universities.id}
        and lower(${institutionAliases.name}) = lower(${query})
    ) then 2
    when lower(${universities.name}) like lower(${prefixQuery}) escape '\\' then 3
    when exists (
      select 1
      from ${institutionAliases}
      where ${institutionAliases.universityId} = ${universities.id}
        and lower(${institutionAliases.name}) like lower(${prefixQuery}) escape '\\'
    ) then 4
    when lower(${universities.name}) like lower(${containsQuery}) escape '\\' then 5
    when exists (
      select 1
      from ${institutionAliases}
      where ${institutionAliases.universityId} = ${universities.id}
        and lower(${institutionAliases.name}) like lower(${containsQuery}) escape '\\'
    ) then 6
    when lower(${universities.city}) = lower(${query}) then 7
    when lower(${universities.country}) = lower(${query}) then 8
    else 9
  end`;
};

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
type SourceRow = typeof sources.$inferSelect;

export interface UniversityCoverageFacts {
  sources: Array<
    Pick<SourceRow, 'id' | 'title' | 'url' | 'category' | 'publisher' | 'datasetVersion'>
  >;
  identifierProviders: string[];
  programCount: number;
  programSourceIds: string[];
  admissionProfileCount: number;
  admissionRequirementCount: number;
  qualificationCount: number;
  admissionTestCount: number;
  deadlineCount: number;
  costCount: number;
  enrollmentCount: number;
  financialAidCount: number;
  admissionSourceIds: string[];
  deadlineSourceIds: string[];
  costSourceIds: string[];
  enrollmentSourceIds: string[];
  financialAidSourceIds: string[];
  hasApplicationUrl: boolean;
}

type CoverageUniversityCore = Pick<
  UniversityRow,
  | 'name'
  | 'country'
  | 'countryCode'
  | 'city'
  | 'officialWebsite'
  | 'admissionsUrl'
  | 'financialAidUrl'
  | 'institutionType'
  | 'ownership'
  | 'operatingStatus'
  | 'highestAwardLevel'
  | 'offersUndergraduate'
  | 'offersGraduate'
  | 'studentCount'
>;

const identityRegistryPattern =
  /(?:ror\.org|wikidata\.org|research organization registry|wikidata)/iu;

const isIdentityRegistrySource = (source: UniversityCoverageFacts['sources'][number]) =>
  identityRegistryPattern.test(
    [source.title, source.url, source.publisher, source.datasetVersion].filter(Boolean).join(' '),
  );

const isOpenAlexResearchSource = (source: UniversityCoverageFacts['sources'][number]) =>
  source.publisher?.toLowerCase() === 'openalex' ||
  /(?:^|[/.])openalex[.]org(?:[/]|$)/iu.test(source.url);

const strongestSourceTier = (
  sourceRows: UniversityCoverageFacts['sources'],
  identityProviders: string[] = [],
): CoverageSourceTier => {
  if (
    sourceRows.some((source) => source.category === 'official' || source.category === 'government')
  )
    return 'official';
  if (sourceRows.some((source) => !isIdentityRegistrySource(source))) return 'independent';
  if (
    sourceRows.some(isIdentityRegistrySource) ||
    identityProviders.some((provider) => ['ror', 'wikidata'].includes(provider.toLowerCase()))
  )
    return 'identity_registry';
  return 'none';
};

const dimension = (
  factCount: number,
  sourceTier: CoverageSourceTier,
  verified: boolean,
  hasReference = false,
): CoverageDimension => ({
  status: verified ? 'verified' : factCount > 0 || hasReference ? 'partial' : 'missing',
  factCount,
  sourceTier,
});

const relevantSources = (allSources: UniversityCoverageFacts['sources'], sourceIds: string[]) => {
  const ids = new Set(sourceIds);
  return allSources.filter((source) => ids.has(source.id));
};

const coreSources = (sourceRows: UniversityCoverageFacts['sources']) =>
  sourceRows.filter((source) =>
    /(?:directory|institution(?:al)? (?:profile|data)|college navigator|hd20[0-9]{2})/iu.test(
      [source.title, source.publisher, source.datasetVersion].filter(Boolean).join(' '),
    ),
  );

/**
 * Coverage is deliberately stricter than "has a source". ROR and Wikidata can
 * verify that an institution exists, but they cannot make a profile complete
 * or application-ready. Those levels require structured facts backed by an
 * official institution or government source.
 */
export const deriveUniversityCoverage = (
  university: CoverageUniversityCore,
  facts: UniversityCoverageFacts,
): UniversityCoverage => {
  // Bibliometrics are useful context but must never upgrade identity, core, or
  // admissions coverage. Ignore both the OpenAlex source and identifier here.
  const coverageSources = facts.sources.filter((source) => !isOpenAlexResearchSource(source));
  const coverageIdentifierProviders = facts.identifierProviders.filter(
    (provider) => provider.toLowerCase() !== 'openalex',
  );
  const officialOrGovernmentSourceCount = coverageSources.filter(
    (source) => source.category === 'official' || source.category === 'government',
  ).length;
  const identityTier = strongestSourceTier(coverageSources, coverageIdentifierProviders);
  const identityFactCount = [
    university.name.trim().length > 0,
    university.country.trim().length > 0,
    university.city.trim().length > 0 && university.city.toLowerCase() !== 'unknown',
    coverageIdentifierProviders.length > 0,
  ].filter(Boolean).length;
  const identityVerified = identityFactCount >= 3 && identityTier !== 'none';

  const coreChecks = [
    Boolean(university.countryCode),
    university.city.trim().length > 0 && university.city.toLowerCase() !== 'unknown',
    Boolean(university.officialWebsite),
    university.institutionType !== 'unknown',
    Boolean(university.ownership && university.ownership !== 'unknown'),
    Boolean(university.operatingStatus && university.operatingStatus !== 'unknown'),
    university.studentCount !== null,
    Boolean(
      university.highestAwardLevel ||
      university.offersUndergraduate !== null ||
      university.offersGraduate !== null,
    ),
  ];
  const coreFactCount = coreChecks.filter(Boolean).length;
  const coreTier = strongestSourceTier(coreSources(coverageSources));
  const coreComplete =
    identityVerified && coreFactCount === coreChecks.length && coreTier === 'official';

  const sourceTierFor = (sourceIds: string[]) =>
    strongestSourceTier(relevantSources(coverageSources, sourceIds));
  const programsTier = sourceTierFor(facts.programSourceIds);
  const admissionsTier = sourceTierFor(facts.admissionSourceIds);
  const deadlinesTier = sourceTierFor(facts.deadlineSourceIds);
  const costsTier = sourceTierFor(facts.costSourceIds);
  const enrollmentTier = sourceTierFor(facts.enrollmentSourceIds);
  const financialAidTier = sourceTierFor(facts.financialAidSourceIds);
  const admissionsFactCount =
    facts.admissionProfileCount +
    facts.admissionRequirementCount +
    facts.qualificationCount +
    facts.admissionTestCount;
  const programsVerified = facts.programCount > 0 && programsTier === 'official';
  const admissionsVerified =
    facts.admissionProfileCount > 0 &&
    facts.admissionRequirementCount + facts.qualificationCount > 0 &&
    admissionsTier === 'official';
  const deadlinesVerified = facts.deadlineCount > 0 && deadlinesTier === 'official';
  const costsVerified = facts.costCount > 0 && costsTier === 'official';
  const enrollmentVerified = facts.enrollmentCount > 0 && enrollmentTier === 'official';
  const financialAidVerified = facts.financialAidCount > 0 && financialAidTier === 'official';
  const hasApplicationReference = Boolean(university.admissionsUrl || facts.hasApplicationUrl);
  const applicationReady =
    coreComplete &&
    programsVerified &&
    admissionsVerified &&
    deadlinesVerified &&
    costsVerified &&
    hasApplicationReference;

  return {
    level: applicationReady
      ? 'application_ready'
      : coreComplete
        ? 'core_complete'
        : identityVerified
          ? 'identity_verified'
          : 'identity_unverified',
    identityVerified,
    coreComplete,
    applicationReady,
    officialOrGovernmentSourceCount,
    dimensions: {
      identity: dimension(identityFactCount, identityTier, identityVerified),
      core: dimension(coreFactCount, coreTier, coreComplete),
      programs: dimension(facts.programCount, programsTier, programsVerified),
      admissions: dimension(
        admissionsFactCount,
        admissionsTier,
        admissionsVerified,
        hasApplicationReference,
      ),
      deadlines: dimension(facts.deadlineCount, deadlinesTier, deadlinesVerified),
      costs: dimension(facts.costCount, costsTier, costsVerified),
      enrollment: dimension(facts.enrollmentCount, enrollmentTier, enrollmentVerified),
      financialAid: dimension(
        facts.financialAidCount,
        financialAidTier,
        financialAidVerified,
        Boolean(university.financialAidUrl),
      ),
    },
  };
};

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

/**
 * Keep the legacy denormalized tuition filter useful after cost snapshots are
 * imported. Most IPEDS records intentionally leave annualTuitionUsd null
 * because tuition varies by level and residency; the normalized snapshot is
 * the authoritative fallback and must be compared without currency
 * conversion or combining scenarios.
 */
const maxTuitionFilter = (maximum: number) =>
  or(
    lte(universities.annualTuitionUsd, maximum),
    sql`exists (
      select 1
      from ${costSnapshots}
      where ${costSnapshots.universityId} = ${universities.id}
        and ${costSnapshots.programId} is null
        and ${costSnapshots.currency} = 'USD'
        and ${costSnapshots.period} = 'academic_year'
        and ${costSnapshots.category} in ('tuition', 'tuition_and_fees')
        and ${costSnapshots.amount} <= ${maximum}
    )`,
  );

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
  const [
    programRows,
    deadlineRows,
    sourceRows,
    enrollmentRows,
    costRows,
    researchRows,
    identifierRows,
    profileRows,
    requirementRows,
    qualificationRows,
    testRows,
    aidRows,
  ] = await Promise.all([
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
        sourceId: enrollmentSnapshots.sourceId,
      })
      .from(enrollmentSnapshots)
      .where(inArray(enrollmentSnapshots.universityId, ids)),
    db.select().from(costSnapshots).where(inArray(costSnapshots.universityId, ids)),
    db.select().from(researchProfiles).where(inArray(researchProfiles.universityId, ids)),
    db
      .select({
        universityId: institutionIdentifiers.universityId,
        provider: institutionIdentifiers.provider,
      })
      .from(institutionIdentifiers)
      .where(inArray(institutionIdentifiers.universityId, ids)),
    db
      .select({
        universityId: admissionProfiles.universityId,
        sourceId: admissionProfiles.sourceId,
        applicationUrl: admissionProfiles.applicationUrl,
      })
      .from(admissionProfiles)
      .where(inArray(admissionProfiles.universityId, ids)),
    db
      .select({
        universityId: admissionProfiles.universityId,
        sourceId: admissionRequirements.sourceId,
      })
      .from(admissionRequirements)
      .innerJoin(
        admissionProfiles,
        eq(admissionRequirements.admissionProfileId, admissionProfiles.id),
      )
      .where(inArray(admissionProfiles.universityId, ids)),
    db
      .select({
        universityId: admissionProfiles.universityId,
        sourceId: qualificationRequirements.sourceId,
      })
      .from(qualificationRequirements)
      .innerJoin(
        admissionProfiles,
        eq(qualificationRequirements.admissionProfileId, admissionProfiles.id),
      )
      .where(inArray(admissionProfiles.universityId, ids)),
    db
      .select({
        universityId: admissionProfiles.universityId,
        sourceId: admissionTestScores.sourceId,
      })
      .from(admissionTestScores)
      .innerJoin(
        admissionProfiles,
        eq(admissionTestScores.admissionProfileId, admissionProfiles.id),
      )
      .where(inArray(admissionProfiles.universityId, ids)),
    db
      .select({
        universityId: financialAidSnapshots.universityId,
        sourceId: financialAidSnapshots.sourceId,
      })
      .from(financialAidSnapshots)
      .where(inArray(financialAidSnapshots.universityId, ids)),
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
  return rows.map((row) => {
    const universityPrograms = programRows.filter((item) => item.universityId === row.id);
    const universityDeadlines = deadlineRows.filter((item) => item.universityId === row.id);
    const universitySources = sourceRows.filter((item) => item.universityId === row.id);
    const universityEnrollment = enrollmentRows.filter((item) => item.universityId === row.id);
    const universityCosts = costRows.filter((item) => item.universityId === row.id);
    const universityResearch = researchRows.find((item) => item.universityId === row.id);
    const universityProfiles = profileRows.filter((item) => item.universityId === row.id);
    const universityRequirements = requirementRows.filter((item) => item.universityId === row.id);
    const universityQualifications = qualificationRows.filter(
      (item) => item.universityId === row.id,
    );
    const universityTests = testRows.filter((item) => item.universityId === row.id);
    const universityAid = aidRows.filter((item) => item.universityId === row.id);
    const resolvedStudentCount = resolveStudentCount(
      row.studentCount,
      officialEnrollment.get(row.id),
    );
    const coverage = deriveUniversityCoverage(
      { ...row, studentCount: resolvedStudentCount },
      {
        sources: universitySources,
        identifierProviders: identifierRows
          .filter((item) => item.universityId === row.id)
          .map((item) => item.provider),
        programCount: universityPrograms.length,
        programSourceIds: universityPrograms.flatMap((item) =>
          item.sourceId ? [item.sourceId] : [],
        ),
        admissionProfileCount: universityProfiles.length,
        admissionRequirementCount: universityRequirements.length,
        qualificationCount: universityQualifications.length,
        admissionTestCount: universityTests.length,
        deadlineCount: universityDeadlines.length,
        costCount: universityCosts.length,
        enrollmentCount: universityEnrollment.length,
        financialAidCount: universityAid.length,
        admissionSourceIds: [
          ...universityProfiles,
          ...universityRequirements,
          ...universityQualifications,
          ...universityTests,
        ].map((item) => item.sourceId),
        deadlineSourceIds: universityDeadlines.flatMap((item) =>
          item.sourceId ? [item.sourceId] : [],
        ),
        costSourceIds: universityCosts.map((item) => item.sourceId),
        enrollmentSourceIds: universityEnrollment.map((item) => item.sourceId),
        financialAidSourceIds: universityAid.map((item) => item.sourceId),
        hasApplicationUrl: universityProfiles.some((item) => Boolean(item.applicationUrl)),
      },
    );
    return {
      ...row,
      studentCount: resolvedStudentCount,
      acceptanceRate: row.acceptanceRate === null ? null : Number(row.acceptanceRate),
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      updatedAt: row.updatedAt.toISOString(),
      programs: universityPrograms.map(({ name, level, field }) => ({ name, level, field })),
      deadlines: universityDeadlines.map(
        ({ label, date, applicantType, entryType, academicYear }) => ({
          label,
          date,
          applicantType,
          entryType,
          academicYear,
        }),
      ),
      sources: universitySources.map(
        ({ title, url, category, publisher, datasetVersion, publishedAt, verifiedAt }) => ({
          title,
          url,
          category,
          publisher,
          datasetVersion,
          publishedAt: publishedAt?.toISOString() ?? null,
          verifiedAt: verifiedAt.toISOString(),
        }),
      ),
      costs: selectCostSummaries(universityCosts).map((item) => {
        const source = sourceRows.find((candidate) => candidate.id === item.sourceId);
        if (!source) throw new Error(`Missing source ${item.sourceId} for cost snapshot`);
        return costForApi(item, source);
      }),
      researchProfile: universityResearch
        ? (() => {
            const source = sourceRows.find(
              (candidate) => candidate.id === universityResearch.sourceId,
            );
            if (!source) {
              throw new Error(`Missing source ${universityResearch.sourceId} for research profile`);
            }
            return {
              openAlexId: universityResearch.openAlexId,
              profileUrl: `https://openalex.org/${universityResearch.openAlexId}`,
              worksCount: universityResearch.worksCount,
              citedByCount: universityResearch.citedByCount,
              hIndex: universityResearch.hIndex,
              i10Index: universityResearch.i10Index,
              twoYearMeanCitedness:
                universityResearch.twoYearMeanCitedness === null
                  ? null
                  : Number(universityResearch.twoYearMeanCitedness),
              status: universityResearch.status as 'active' | 'inactive' | 'withdrawn',
              sourceUpdatedAt: universityResearch.sourceUpdatedAt.toISOString(),
              source: sourceForApi(source),
            };
          })()
        : null,
      coverage,
    };
  });
};

export const listUniversities = async (
  db: Database,
  query: UniversityQuery,
): Promise<UniversityListResponse> => {
  const filters = [
    query.q ? universitySearchFilter(query.q) : undefined,
    query.country ? eq(universities.country, query.country) : undefined,
    query.type ? eq(universities.institutionType, query.type) : undefined,
    query.maxTuition ? maxTuitionFilter(query.maxTuition) : undefined,
  ].filter((filter) => filter !== undefined);
  const where = filters.length ? and(...filters) : undefined;
  const offset = (query.page - 1) * query.pageSize;
  const relevanceOrder = query.q ? universitySearchRelevance(query.q) : undefined;
  const orderBy = relevanceOrder
    ? [relevanceOrder, asc(universities.name)]
    : [asc(universities.name)];
  const [rows, totals, countryRows] = await Promise.all([
    db
      .select()
      .from(universities)
      .where(where)
      .orderBy(...orderBy)
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

export const admissionsPageBounds = (query: AdmissionsQuery) => {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  return { page, pageSize, offset: (page - 1) * pageSize };
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

  const { page, pageSize, offset } = admissionsPageBounds(query);

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
    .orderBy(
      sql`${admissionProfiles.programId} is null desc`,
      desc(admissionProfiles.academicYear),
      asc(admissionProfiles.intakeTerm),
      asc(admissionProfiles.id),
    )
    .limit(pageSize)
    .offset(offset);
  const [profileCount] = await db
    .select({ value: count() })
    .from(admissionProfiles)
    .where(and(...profileFilters));
  const totalProfiles = Number(profileCount?.value ?? 0);
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

  const scopedProgramIds = profiles.flatMap((profile) =>
    profile.programId ? [profile.programId] : [],
  );
  const scopedPrograms = scopedProgramIds.length
    ? await db
        .select({ id: programs.id, name: programs.name })
        .from(programs)
        .where(inArray(programs.id, scopedProgramIds))
    : [];
  const programNames = new Map(scopedPrograms.map((program) => [program.id, program.name]));
  const profileResponses = profiles.map((profile) => ({
    id: profile.id,
    programId: profile.programId,
    programName: profile.programId ? (programNames.get(profile.programId) ?? null) : null,
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
        source: sourceFor(row.sourceId),
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
    pagination: {
      page,
      pageSize,
      total: totalProfiles,
      totalPages: Math.max(1, Math.ceil(totalProfiles / pageSize)),
    },
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

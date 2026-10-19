import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  deriveUniversityCoverage,
  admissionsPageBounds,
  resolveStudentCount,
  type UniversityCoverageFacts,
  universitySearchFilter,
  universitySearchRelevance,
} from './university-service.js';

const dialect = new PgDialect();

const emptyCoverageFacts: UniversityCoverageFacts = {
  sources: [],
  identifierProviders: [],
  programCount: 0,
  programSourceIds: [],
  admissionProfileCount: 0,
  admissionRequirementCount: 0,
  qualificationCount: 0,
  admissionTestCount: 0,
  deadlineCount: 0,
  costCount: 0,
  enrollmentCount: 0,
  financialAidCount: 0,
  admissionSourceIds: [],
  deadlineSourceIds: [],
  costSourceIds: [],
  enrollmentSourceIds: [],
  financialAidSourceIds: [],
  hasApplicationUrl: false,
};

const sparseUniversity = {
  name: 'Sparse College',
  country: 'Kenya',
  countryCode: 'KE',
  city: 'Nairobi',
  officialWebsite: null,
  admissionsUrl: null,
  financialAidUrl: null,
  institutionType: 'unknown' as const,
  ownership: 'unknown' as const,
  operatingStatus: 'unknown' as const,
  highestAwardLevel: null,
  offersUndergraduate: null,
  offersGraduate: null,
  studentCount: null,
};

describe('university profile hydration', () => {
  it('keeps admissions pages bounded and computes a non-overlapping offset', () => {
    expect(admissionsPageBounds({})).toEqual({ page: 1, pageSize: 50, offset: 0 });
    expect(admissionsPageBounds({ page: 3, pageSize: 10 })).toEqual({
      page: 3,
      pageSize: 10,
      offset: 20,
    });
  });
  it('prefers official enrollment over a community profile count', () => {
    expect(resolveStudentCount(21_189, 30_259)).toBe(30_259);
  });

  it('keeps the profile count when no official enrollment exists', () => {
    expect(resolveStudentCount(21_189, undefined)).toBe(21_189);
  });

  it('returns null when neither source publishes a count', () => {
    expect(resolveStudentCount(null, undefined)).toBeNull();
  });

  it('keeps a ROR-only record at identity verified instead of calling it complete', () => {
    const coverage = deriveUniversityCoverage(sparseUniversity, {
      ...emptyCoverageFacts,
      identifierProviders: ['ror'],
      sources: [
        {
          id: 'ror-source',
          title: 'Research Organization Registry',
          url: 'https://ror.org/12345',
          category: 'independent',
          publisher: 'ROR',
          datasetVersion: 'v2',
        },
      ],
    });

    expect(coverage.level).toBe('identity_verified');
    expect(coverage.coreComplete).toBe(false);
    expect(coverage.applicationReady).toBe(false);
    expect(coverage.dimensions.core.status).toBe('partial');
    expect(coverage.dimensions.admissions.status).toBe('missing');
  });

  it('does not let OpenAlex bibliometrics upgrade university coverage', () => {
    const coverage = deriveUniversityCoverage(sparseUniversity, {
      ...emptyCoverageFacts,
      identifierProviders: ['openalex'],
      sources: [
        {
          id: 'openalex-source',
          title: 'OpenAlex research metrics (2026-08-31)',
          url: 'https://openalex.org/I123456',
          category: 'independent',
          publisher: 'OpenAlex',
          datasetVersion: '2026-08-31',
        },
      ],
    });

    expect(coverage.level).toBe('identity_unverified');
    expect(coverage.identityVerified).toBe(false);
    expect(coverage.dimensions.identity.sourceTier).toBe('none');
    expect(coverage.officialOrGovernmentSourceCount).toBe(0);
  });

  it('requires official structured application facts before marking a profile application-ready', () => {
    const officialSource = {
      id: 'official-source',
      title: 'National education institution directory and program catalog',
      url: 'https://education.example.edu/data',
      category: 'government' as const,
      publisher: 'Ministry of Education',
      datasetVersion: 'C2024_A',
    };
    const coverage = deriveUniversityCoverage(
      {
        ...sparseUniversity,
        officialWebsite: 'https://college.example.edu',
        admissionsUrl: 'https://college.example.edu/apply',
        financialAidUrl: 'https://college.example.edu/aid',
        institutionType: 'public',
        ownership: 'public',
        operatingStatus: 'active',
        highestAwardLevel: 'Bachelor degree',
        offersUndergraduate: true,
        studentCount: 4_200,
      },
      {
        ...emptyCoverageFacts,
        sources: [officialSource],
        identifierProviders: ['government_id'],
        programCount: 24,
        programSourceIds: [officialSource.id],
        admissionProfileCount: 1,
        admissionRequirementCount: 5,
        deadlineCount: 2,
        costCount: 3,
        enrollmentCount: 4,
        admissionSourceIds: [officialSource.id],
        deadlineSourceIds: [officialSource.id],
        costSourceIds: [officialSource.id],
        enrollmentSourceIds: [officialSource.id],
        hasApplicationUrl: true,
      },
    );

    expect(coverage.level).toBe('application_ready');
    expect(coverage.applicationReady).toBe(true);
    expect(coverage.dimensions.admissions.status).toBe('verified');
    expect(coverage.dimensions.costs.status).toBe('verified');
  });

  it('verifies Taiwan MOE programs through their linked government source', () => {
    const departmentSource = {
      id: 'taiwan-moe-department-source',
      title: 'Taiwan MOE department overview (academic year 2025-26)',
      url: 'https://data.gov.tw/dataset/6231',
      category: 'government' as const,
      publisher: 'Ministry of Education, Taiwan',
      datasetVersion: '114',
    };
    const coverage = deriveUniversityCoverage(sparseUniversity, {
      ...emptyCoverageFacts,
      sources: [departmentSource],
      identifierProviders: ['tw_moe'],
      programCount: 42,
      programSourceIds: [departmentSource.id],
    });

    expect(coverage.dimensions.programs).toEqual({
      status: 'verified',
      factCount: 42,
      sourceTier: 'official',
    });
  });

  it('does not verify unlinked programs from an unrelated program-like source title', () => {
    const coverage = deriveUniversityCoverage(sparseUniversity, {
      ...emptyCoverageFacts,
      sources: [
        {
          id: 'unlinked-source',
          title: 'Program catalog',
          url: 'https://example.edu/catalog',
          category: 'official',
          publisher: 'Example University',
          datasetVersion: '2025',
        },
      ],
      programCount: 2,
      programSourceIds: [],
    });

    expect(coverage.dimensions.programs).toEqual({
      status: 'partial',
      factCount: 2,
      sourceTier: 'none',
    });
  });
});

describe('university search', () => {
  it('matches institution aliases while preserving escaped literal wildcard characters', () => {
    const query = dialect.sqlToQuery(universitySearchFilter('UCL%_'));

    expect(query.sql).toContain('from "institution_aliases"');
    expect(query.sql).toContain('"institution_aliases"."university_id" = "universities"."id"');
    expect(query.sql).toContain('escape');
    expect(query.params).toContain('%UCL\\%\\_%');
  });

  it('ranks exact and prefix aliases before broad canonical or alias matches', () => {
    const query = dialect.sqlToQuery(universitySearchRelevance('UCL'));
    const exactAlias = query.sql.indexOf('"institution_aliases"."name") = lower(');
    const canonicalPrefix = query.sql.indexOf('"universities"."name") like lower(');
    const aliasPrefix = query.sql.indexOf(
      '"institution_aliases"."name") like lower(',
      exactAlias + 1,
    );
    const canonicalContains = query.sql.indexOf(
      '"universities"."name") like lower(',
      canonicalPrefix + 1,
    );
    const aliasContains = query.sql.indexOf(
      '"institution_aliases"."name") like lower(',
      aliasPrefix + 1,
    );

    expect(exactAlias).toBeGreaterThan(-1);
    expect(canonicalPrefix).toBeGreaterThan(exactAlias);
    expect(aliasPrefix).toBeGreaterThan(canonicalPrefix);
    expect(canonicalContains).toBeGreaterThan(aliasPrefix);
    expect(aliasContains).toBeGreaterThan(canonicalContains);
    expect(query.params).toContain('UCL%');
    expect(query.params).toContain('%UCL%');
  });
});

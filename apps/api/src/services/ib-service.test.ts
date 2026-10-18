import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { ibQuerySchema, type IbRequirement } from '@urd/shared';
import type { Database } from '../db/client.js';
import type { admissionProfiles, programs } from '../db/schema.js';
import { getUniversityIb, ibMatchesQuery } from './ib-service.js';

const university = { id: 'school-one', name: 'Example University', slug: 'example-university' };
const requirement = (overrides: Partial<IbRequirement> = {}): IbRequirement => ({
  recordKey: 'computing-2027-all',
  academicYear: '2027',
  intakeTerm: 'autumn',
  entryType: 'first_year',
  applicantType: 'all',
  applicantContext: 'All diploma applicants',
  status: 'published',
  scoreKind: 'minimum_entry',
  totalMin: 30,
  totalMax: null,
  scoreScale: 45,
  includesCorePoints: true,
  hlGrades: [6, 5, 5],
  subjectNotes: 'Higher Level mathematics is required.',
  conditions: 'Applicants must also satisfy the published subject and language requirements.',
  source: {
    title: 'Official computing entry requirements',
    url: 'https://example.edu/computing',
    checkedOn: '2026-09-10',
    evidence: 'IB Diploma: 30 points.',
  },
  ...overrides,
});
const program = (id: string, name = 'Computing'): typeof programs.$inferSelect => ({
  id,
  universityId: university.id,
  name,
  level: 'undergraduate',
  field: 'Computing',
  academicYear: '2027',
  sourceId: null,
  sourceProvider: null,
  sourceExternalId: null,
  sourceFlags: {},
});
const fact = (value: IbRequirement, programId: string | null = 'computing') => ({
  payload: { provider: 'official_ib', ib: value },
  profile: {
    id: `profile-${value.recordKey}`,
    universityId: university.id,
    programId,
    academicYear: value.academicYear,
    intakeTerm: value.intakeTerm,
    entryType: value.entryType,
    applicantType: value.applicantType,
    level: 'undergraduate',
    openAdmission: null,
    applicationUrl: null,
    notes: null,
    sourceId: 'source',
    sourceFlags: {},
    updatedAt: new Date('2026-09-10'),
  } satisfies typeof admissionProfiles.$inferSelect,
  sourceUrl: value.source.url,
});
type Fact = ReturnType<typeof fact>;
type QueryCall = {
  where?: SQL | undefined;
  joins: Array<{ kind: string; on?: SQL | undefined }>;
  limit?: number;
  offset?: number;
  order?: unknown[];
};
type MockQuery = Promise<unknown[]> & {
  from: (table: unknown) => MockQuery;
  where: (condition?: SQL) => MockQuery;
  innerJoin: (table: unknown, condition?: SQL) => MockQuery;
  leftJoin: (table: unknown, condition?: SQL) => MockQuery;
  orderBy: (...columns: unknown[]) => MockQuery;
  limit: (value: number) => MockQuery;
  offset: (value: number) => MockQuery;
};

// Capture query construction while returning deliberately scoped fixtures. These are
// unit tests, not a replacement for the PostgreSQL integration smoke test.
const database = (
  options: {
    facts?: Fact[];
    page?: ReturnType<typeof program>[];
    total?: number;
    catalog?: number;
    found?: boolean;
  } = {},
) => {
  const calls: QueryCall[] = [];
  const resultSets: unknown[][] = [
    options.found === false ? [] : [university],
    options.page ?? [program('computing')],
    [{ value: options.total ?? 1 }],
    [{ value: options.catalog ?? 1 }],
    options.facts ?? [],
  ];
  const select = vi.fn(() => {
    const rows = resultSets[calls.length];
    if (!rows) throw new Error('Unexpected extra database query.');
    const call: QueryCall = { joins: [] };
    calls.push(call);
    const query: MockQuery = Object.assign(Promise.resolve(rows), {
      from: () => query,
      where: (condition?: SQL) => {
        call.where = condition;
        return query;
      },
      innerJoin: (_table: unknown, on?: SQL) => {
        call.joins.push({ kind: 'inner', on });
        return query;
      },
      leftJoin: (_table: unknown, on?: SQL) => {
        call.joins.push({ kind: 'left', on });
        return query;
      },
      orderBy: (...columns: unknown[]) => {
        call.order = columns;
        return query;
      },
      limit: (value: number) => {
        call.limit = value;
        return query;
      },
      offset: (value: number) => {
        call.offset = value;
        return query;
      },
    });
    return query;
  });
  return { db: { select } as unknown as Database, calls, select };
};
const dialect = new PgDialect();
const compiled = (value?: SQL) => {
  if (!value) throw new Error('Expected a scoped SQL predicate.');
  return dialect.sqlToQuery(value);
};

describe('IB requirement filters', () => {
  it('does not substitute another year or an undated policy for a requested year', () => {
    const query = ibQuerySchema.parse({ year: '2027' });
    expect(ibMatchesQuery(requirement(), query)).toBe(true);
    expect(ibMatchesQuery(requirement({ academicYear: '2026' }), query)).toBe(false);
    expect(ibMatchesQuery(requirement({ academicYear: 'unspecified' }), query)).toBe(false);
    expect(
      ibMatchesQuery(
        requirement({ academicYear: 'unspecified' }),
        ibQuerySchema.parse({ year: 'unspecified' }),
      ),
    ).toBe(true);
  });

  it('includes common policies but never substitutes domestic requirements for international applicants', () => {
    const query = ibQuerySchema.parse({ applicantType: 'international' });
    expect(ibMatchesQuery(requirement(), query)).toBe(true);
    expect(ibMatchesQuery(requirement({ applicantType: 'international' }), query)).toBe(true);
    expect(ibMatchesQuery(requirement({ applicantType: 'domestic' }), query)).toBe(false);
    expect(
      ibMatchesQuery(
        requirement({ applicantType: 'international' }),
        ibQuerySchema.parse({ applicantType: 'domestic' }),
      ),
    ).toBe(false);
  });

  it('keeps transfer and other entry routes out of the first-year result', () => {
    const query = ibQuerySchema.parse({});
    expect(ibMatchesQuery(requirement({ entryType: 'transfer' }), query)).toBe(false);
    expect(ibMatchesQuery(requirement({ entryType: 'other' }), query)).toBe(false);
    expect(
      ibMatchesQuery(
        requirement({ entryType: 'transfer' }),
        ibQuerySchema.parse({ entryType: 'transfer' }),
      ),
    ).toBe(true);
  });
});

describe('IB university service', () => {
  it('returns an unknown university without querying unrelated program records', async () => {
    const mock = database({ found: false });
    expect(await getUniversityIb(mock.db, 'missing', ibQuerySchema.parse({}))).toBeNull();
    expect(mock.select).toHaveBeenCalledTimes(1);
    expect(compiled(mock.calls[0]?.where).params).toContain('missing');
  });

  it('keeps a university floor separate and never inherits it into an unreviewed program', async () => {
    const floor = requirement({ recordKey: 'general-2027', totalMin: 24 });
    const course = requirement();
    const mock = database({
      facts: [fact(floor, null), fact(course)],
      page: [program('computing'), program('history', 'History')],
      total: 2,
      catalog: 2,
    });
    const result = await getUniversityIb(mock.db, university.slug, ibQuerySchema.parse({}));
    expect(result?.institutionPolicies).toEqual([floor]);
    expect(result?.programs[0]?.requirements).toEqual([course]);
    expect(result?.programs[1]?.requirements).toEqual([]);
    expect(result?.coverage).toEqual({
      catalogPrograms: 2,
      programsWithReviewedIb: 1,
      programsWithPublishedTotals: 1,
    });
  });

  it('does not count a university policy as a program with reviewed or published IB data', async () => {
    const mock = database({ facts: [fact(requirement(), null)] });
    const result = await getUniversityIb(mock.db, university.slug, ibQuerySchema.parse({}));
    expect(result?.coverage.programsWithReviewedIb).toBe(0);
    expect(result?.coverage.programsWithPublishedTotals).toBe(0);
    expect(result?.programs[0]?.requirements).toEqual([]);
  });

  it('filters facts by exact intake year, applicant group, and entry route together', async () => {
    const all = requirement();
    const international = requirement({
      recordKey: 'international-2027',
      applicantType: 'international',
      totalMin: 32,
    });
    const mock = database({
      facts: [
        fact(all),
        fact(international),
        fact(requirement({ recordKey: 'domestic-2027', applicantType: 'domestic' })),
        fact(requirement({ recordKey: 'old-2026', academicYear: '2026' })),
        fact(requirement({ recordKey: 'transfer-2027', entryType: 'transfer' })),
        fact(requirement({ recordKey: 'undated', academicYear: 'unspecified' }), null),
      ],
    });
    const result = await getUniversityIb(
      mock.db,
      university.slug,
      ibQuerySchema.parse({ year: '2027', applicantType: 'international' }),
    );
    expect(result?.programs[0]?.requirements).toEqual([all, international]);
    expect(result?.institutionPolicies).toEqual([]);
    expect(result?.years).toEqual(['unspecified', '2027', '2026']);
    expect(result?.coverage.programsWithReviewedIb).toBe(1);
  });

  it('distinguishes a reviewed non-numeric policy from a published numeric total', async () => {
    const descriptive = requirement({
      recordKey: 'no-total',
      status: 'not_stated_in_source',
      totalMin: null,
      scoreKind: null,
      scoreScale: null,
      includesCorePoints: null,
    });
    const mock = database({ facts: [fact(descriptive)] });
    const result = await getUniversityIb(mock.db, university.slug, ibQuerySchema.parse({}));
    expect(result?.programs[0]?.requirements).toEqual([descriptive]);
    expect(result?.coverage).toMatchObject({
      programsWithReviewedIb: 1,
      programsWithPublishedTotals: 0,
    });
  });

  it('pages the filtered catalogue with stable ordering without shrinking global review coverage', async () => {
    const mock = database({
      facts: [fact(requirement(), 'off-page')],
      page: [program('page-two')],
      total: 21,
      catalog: 80,
    });
    const result = await getUniversityIb(
      mock.db,
      university.slug,
      ibQuerySchema.parse({ page: 2, pageSize: 20, q: 'Computing%_' }),
    );
    expect(result?.pagination).toEqual({ page: 2, pageSize: 20, total: 21, totalPages: 2 });
    expect(result?.coverage).toMatchObject({ catalogPrograms: 80, programsWithReviewedIb: 1 });
    expect(result?.programs[0]?.requirements).toEqual([]);
    expect(mock.calls[1]).toMatchObject({ limit: 20, offset: 20 });
    expect(mock.calls[1]?.order).toHaveLength(2);
    const pagePredicate = compiled(mock.calls[1]?.where);
    expect(pagePredicate.sql).toContain('"programs"."university_id"');
    expect(pagePredicate.params).toContain(university.id);
    expect(pagePredicate.params).toContain('undergraduate');
    expect(pagePredicate.params).toContain('%Computing\\%\\_%');
    expect(compiled(mock.calls[2]?.where)).toEqual(pagePredicate);
    expect(compiled(mock.calls[3]?.where).params).not.toContain('%Computing\\%\\_%');
  });

  it('constrains SQL facts to official same-university sources and owned programs at the selected level', async () => {
    const mock = database();
    await getUniversityIb(mock.db, university.slug, ibQuerySchema.parse({ level: 'graduate' }));
    const query = mock.calls[4];
    const where = compiled(query?.where);
    expect(where.sql).toContain('"admission_profiles"."university_id"');
    expect(where.sql).toContain('"admission_profiles"."program_id" is null');
    expect(where.sql).toContain('"programs"."university_id"');
    expect(where.sql).toContain('"programs"."level"');
    expect(where.sql).toContain('"admission_profiles"."level"');
    expect(where.params).toEqual(
      expect.arrayContaining([university.id, 'graduate', 'official', 'official_ib', 'IB']),
    );
    const sourceJoin = compiled(query?.joins[1]?.on);
    expect(sourceJoin.sql).toContain(
      '"sources"."university_id" = "admission_profiles"."university_id"',
    );
  });

  it.each(['academicYear', 'applicantType', 'entryType', 'intakeTerm'] as const)(
    'refuses a payload that disagrees with its parent %s',
    async (field) => {
      const row = fact(requirement());
      const profile = {
        ...row.profile,
        [field]: {
          academicYear: '2026',
          applicantType: 'domestic',
          entryType: 'transfer',
          intakeTerm: 'spring',
        }[field],
      };
      const mock = database({ facts: [{ ...row, profile } as Fact] });
      await expect(
        getUniversityIb(mock.db, university.slug, ibQuerySchema.parse({})),
      ).rejects.toThrow(/scope does not match/);
    },
  );

  it('refuses a payload source URL that disagrees with its linked evidence source', async () => {
    const row = { ...fact(requirement()), sourceUrl: 'https://example.edu/another-course' };
    const mock = database({ facts: [row] });
    await expect(
      getUniversityIb(mock.db, university.slug, ibQuerySchema.parse({})),
    ).rejects.toThrow(/scope does not match/);
  });
});

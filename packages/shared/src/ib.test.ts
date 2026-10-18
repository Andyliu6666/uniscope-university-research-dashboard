import { describe, expect, it } from 'vitest';
import {
  formatIbTotal,
  ibDatasetSchema,
  ibQuerySchema,
  ibRequirementSchema,
  type IbDataset,
  type IbRequirement,
} from './ib.js';

const requirement: IbRequirement = {
  recordKey: 'computing-2026-standard',
  academicYear: '2026',
  intakeTerm: 'September',
  entryType: 'first_year',
  applicantType: 'all',
  applicantContext: 'Standard first-year applicants',
  status: 'published',
  scoreKind: 'typical_offer',
  totalMin: 28,
  totalMax: 30,
  scoreScale: 45,
  includesCorePoints: null,
  hlGrades: [5, 5, 5],
  subjectNotes: 'HL mathematics 5.',
  conditions: 'Synthetic test record; not a real admissions policy.',
  source: {
    title: 'Test course requirements',
    url: 'https://www.example.edu/course',
    checkedOn: '2026-09-01',
    evidence: 'Synthetic test evidence only',
  },
};
const dataset: IbDataset = {
  schemaVersion: 1,
  datasetVersion: 'test-1',
  reviewedOn: '2026-09-01',
  institutions: [
    {
      key: 'test',
      name: 'Test University',
      provider: 'ror',
      externalId: 'test-id',
      countryCode: 'GB',
      officialDomains: ['example.edu'],
    },
  ],
  records: [
    {
      institutionKey: 'test',
      program: {
        name: 'Computing',
        level: 'undergraduate',
        field: 'Computing',
        courseCode: 'G400',
        url: 'https://www.example.edu/course',
      },
      requirement,
    },
  ],
};

describe('reviewed IB requirements', () => {
  it('keeps a typical offer range distinct from a minimum cutoff', () => {
    expect(ibRequirementSchema.parse(requirement)).toEqual(requirement);
    expect(formatIbTotal(requirement)).toBe('28–30/45 · Typical offer');
  });
  it.each([null, 0, 46])('rejects a missing or impossible published total: %s', (totalMin) => {
    expect(ibRequirementSchema.safeParse({ ...requirement, totalMin }).success).toBe(false);
  });
  it('does not turn missing evidence into zero or no minimum', () => {
    const missing = {
      ...requirement,
      status: 'not_stated_in_source' as const,
      scoreKind: null,
      totalMin: null,
      totalMax: null,
      scoreScale: null,
    };
    expect(ibRequirementSchema.parse(missing).totalMin).toBeNull();
    expect(formatIbTotal(missing)).toBe('IB total not stated in the reviewed source');
    expect(ibRequirementSchema.safeParse({ ...missing, totalMin: 24 }).success).toBe(false);
  });
  it('preserves subject requirements even when there is no published total', () => {
    const value = {
      ...requirement,
      status: 'not_stated_in_source' as const,
      totalMin: null,
      totalMax: null,
      scoreScale: null,
      scoreKind: null,
    };
    expect(ibRequirementSchema.parse(value).hlGrades).toEqual([5, 5, 5]);
  });
  it('rejects reversed ranges and scores above the stated scale', () => {
    expect(ibRequirementSchema.safeParse({ ...requirement, totalMax: 26 }).success).toBe(false);
    expect(
      ibRequirementSchema.safeParse({
        ...requirement,
        totalMin: 43,
        totalMax: null,
        scoreScale: 42,
        includesCorePoints: false,
      }).success,
    ).toBe(false);
  });
  it('does not count core points in a 42-point score', () => {
    expect(ibRequirementSchema.safeParse({ ...requirement, scoreScale: 42 }).success).toBe(false);
    expect(
      ibRequirementSchema.safeParse({ ...requirement, scoreScale: 42, includesCorePoints: false })
        .success,
    ).toBe(true);
  });
  it('requires contextual-offer eligibility information', () => {
    expect(
      ibRequirementSchema.safeParse({
        ...requirement,
        scoreKind: 'contextual_offer',
        applicantContext: 'Everyone',
      }).success,
    ).toBe(false);
  });
  it('allows only reviewed official domains, not suffix spoofs or credentialed links', () => {
    expect(ibDatasetSchema.safeParse(dataset).success).toBe(true);
    for (const url of [
      'https://example.edu.evil.test/course',
      'https://notexample.edu/course',
      'https://password@www.example.edu/course',
      'http://www.example.edu/course',
    ]) {
      const copy = structuredClone(dataset);
      const record = copy.records[0];
      if (!record) throw new Error('Missing test record');
      record.requirement.source.url = url;
      expect(ibDatasetSchema.safeParse(copy).success).toBe(false);
    }
  });
  it('rejects duplicate identities and duplicate requirement keys', () => {
    expect(
      ibDatasetSchema.safeParse({
        ...dataset,
        institutions: [...dataset.institutions, ...dataset.institutions],
      }).success,
    ).toBe(false);
    expect(
      ibDatasetSchema.safeParse({ ...dataset, records: [...dataset.records, ...dataset.records] })
        .success,
    ).toBe(false);
  });
  it('does not label undergraduate IB totals as postgraduate requirements', () => {
    const copy = structuredClone(dataset);
    const program = copy.records[0]?.program;
    if (!program) throw new Error('Missing test program');
    program.level = 'graduate';
    expect(ibDatasetSchema.safeParse(copy).success).toBe(false);
  });
  it('rejects source check dates later than review, and future reviews', () => {
    expect(ibDatasetSchema.safeParse({ ...dataset, reviewedOn: '2026-08-31' }).success).toBe(false);
    expect(ibDatasetSchema.safeParse({ ...dataset, reviewedOn: '2099-01-01' }).success).toBe(false);
  });
  it('bounds the public catalog query and retains explicit unknown years', () => {
    expect(ibQuerySchema.parse({ year: 'unspecified' })).toMatchObject({
      year: 'unspecified',
      page: 1,
      pageSize: 20,
      level: 'undergraduate',
      entryType: 'first_year',
    });
    for (const input of [{ page: 0 }, { pageSize: 51 }, { year: '202x' }, { q: 'a'.repeat(101) }])
      expect(ibQuerySchema.safeParse(input).success).toBe(false);
  });
});

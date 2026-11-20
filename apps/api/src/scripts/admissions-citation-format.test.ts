import { describe, expect, it } from 'vitest';
import {
  assertCitationContent,
  citationContentHash,
  citationRefreshSchema,
} from './admissions-citation-format.js';

const source = {
  url: 'https://example.edu/old.pdf',
  title: 'Original requirements',
  checkedOn: '2026-01-01',
};
const replacement = {
  url: 'https://example.edu/new.pdf',
  title: 'Reviewed requirements page 4',
  checkedOn: '2026-02-01',
  sha256: 'a'.repeat(64),
};
const record = {
  originalDatasetVersion: 'original-v1',
  programName: 'Engineering',
  scope: {
    academicYear: '2027',
    intakeTerm: 'unspecified',
    deliveryMode: 'unspecified',
    entryType: 'first_year',
    level: 'undergraduate',
    applicantType: 'all',
  },
  fact: {
    key: 'grades',
    category: 'academic' as const,
    label: 'A-level grades',
    status: 'required' as const,
    details: 'Mathematics and Physics at grade C.',
    source,
  },
  replacement,
};
const dataset = {
  datasetVersion: 'citation-review-v1',
  reviewedOn: '2026-02-01',
  institution: { ror: 'example', countryCode: 'JM', officialDomains: ['example.edu'] },
  retirePreviousSource: true,
  canonicalSource: replacement,
  records: [record],
};
const actual = () => ({
  originalDatasetVersion: record.originalDatasetVersion,
  programName: record.programName,
  scope: { ...record.scope },
  fact: { ...record.fact },
});

describe('reviewed admissions citation safeguards', () => {
  it('accepts an independently reviewed official replacement without changing academic content', () => {
    expect(citationRefreshSchema.parse(dataset).records).toHaveLength(1);
    expect(() => assertCitationContent(record, actual())).not.toThrow();
    expect(citationContentHash(record)).toMatch(/^[a-f0-9]{64}$/u);
  });
  it('rejects a changed grade, status or original dataset even when the requirement key still matches', () => {
    const changed = actual();
    changed.fact.details = 'Mathematics and Physics at grade B.';
    expect(() => assertCitationContent(record, changed)).toThrow('content or scope');
    expect(() =>
      assertCitationContent(record, { ...actual(), originalDatasetVersion: 'unreviewed-v2' }),
    ).toThrow();
    expect(() =>
      assertCitationContent(record, { ...actual(), fact: { ...record.fact, status: 'unknown' } }),
    ).toThrow();
  });
  it('keeps programmes, years, delivery modes, entry routes and applicant cohorts separate', () => {
    for (const difference of [
      { academicYear: '2028' },
      { entryType: 'transfer' },
      { applicantType: 'domestic' },
      { deliveryMode: 'online' },
    ])
      expect(() =>
        assertCitationContent(record, { ...actual(), scope: { ...record.scope, ...difference } }),
      ).toThrow();
    expect(() =>
      assertCitationContent(record, { ...actual(), programName: 'Different Engineering' }),
    ).toThrow();
  });
  it('rejects third-party replacements, duplicate targets and backdated reviews', () => {
    expect(() => citationRefreshSchema.parse({ ...dataset, records: [record, record] })).toThrow(
      'Duplicate',
    );
    expect(() =>
      citationRefreshSchema.parse({
        ...dataset,
        records: [
          { ...record, replacement: { ...replacement, url: 'https://unrelated.example/offer' } },
        ],
      }),
    ).toThrow('official domains');
    expect(() => citationRefreshSchema.parse({ ...dataset, reviewedOn: '2025-02-01' })).toThrow();
  });
  it('requires one completely reviewed old URL before source retirement', () => {
    expect(() =>
      citationRefreshSchema.parse({
        ...dataset,
        records: [
          record,
          {
            ...record,
            programName: 'Other course',
            fact: { ...record.fact, source: { ...source, url: 'https://example.edu/second.pdf' } },
          },
        ],
      }),
    ).toThrow('one fully reviewed');
    expect(() =>
      citationRefreshSchema.parse({
        ...dataset,
        canonicalSource: { ...replacement, url: 'https://example.edu/unreviewed.pdf' },
      }),
    ).toThrow('Canonical source');
  });
});

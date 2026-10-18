import { describe, expect, it } from 'vitest';
import {
  openAlexResearchManifestSchema,
  openAlexResearchRowSchema,
  sourceTimestamp,
} from './openalex-research-format.js';

const row = {
  openAlexId: 'I136199984',
  rorId: '03vek6s52',
  displayName: 'Harvard University',
  countryCode: 'US',
  homepageUrl: 'https://www.harvard.edu',
  worksCount: 713_850,
  citedByCount: 146_284_069,
  twoYearMeanCitedness: 7.580769059593218,
  hIndex: 2_801,
  i10Index: 1_114_157,
  status: 'active',
  sourceUpdatedAt: '2026-08-31T05:59:24',
} as const;

describe('OpenAlex research artifact format', () => {
  it('accepts a reviewed row and treats the timezone-less OpenAlex date as UTC', () => {
    expect(openAlexResearchRowSchema.parse(row)).toEqual(row);
    expect(sourceTimestamp(row.sourceUpdatedAt).toISOString()).toBe('2026-08-31T05:59:24.000Z');
  });

  it('rejects invalid identifiers and values that cannot fit PostgreSQL integer columns', () => {
    expect(
      openAlexResearchRowSchema.safeParse({
        ...row,
        openAlexId: 'https://openalex.org/I136199984',
        citedByCount: 3_000_000_000,
      }).success,
    ).toBe(false);
  });

  it('requires the reviewed provider, license, counts, and checksum in the manifest', () => {
    const parsed = openAlexResearchManifestSchema.safeParse({
      schemaVersion: 1,
      provider: 'openalex',
      datasetVersion: '2026-08-31',
      artifactFile: 'openalex-institutions-20260831.jsonl',
      artifactSha256: 'a'.repeat(64),
      artifactRows: 27_401,
      sourceUrl: 'https://api.openalex.org/institutions?filter=type:education,has_ror:true',
      sourceRecordCount: 27_401,
      retrievedAt: '2026-08-31T09:07:52.885Z',
      license: 'CC0 1.0',
      licenseUrl: 'https://help.openalex.org/access/pricing/',
      identityRule: 'Exact ROR ID only; names and domains are never automatic merge keys.',
    });
    expect(parsed.success).toBe(true);
    expect(
      openAlexResearchManifestSchema.safeParse({ ...parsed.data, license: 'unknown' }).success,
    ).toBe(false);
  });
});

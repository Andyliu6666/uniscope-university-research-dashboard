import { describe, expect, it } from 'vitest';
import { admissionsQuerySchema, universityInputSchema, universityQuerySchema } from './index.js';

describe('shared validation', () => {
  it('applies safe pagination defaults', () => {
    expect(universityQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 9 });
  });

  it('parses bounded admissions pagination without changing legacy filter defaults', () => {
    expect(admissionsQuerySchema.parse({})).toEqual({});
    expect(admissionsQuerySchema.parse({ page: '2', pageSize: '10' })).toEqual({
      page: 2,
      pageSize: 10,
    });
    for (const value of [0, -1, 1.5, 100001, 'NaN'])
      expect(admissionsQuerySchema.safeParse({ page: value }).success).toBe(false);
    for (const value of [0, -1, 1.5, 51])
      expect(admissionsQuerySchema.safeParse({ pageSize: value }).success).toBe(false);
  });

  it('rejects non-https evidence links', () => {
    const result = universityInputSchema.safeParse({
      name: 'Example University',
      slug: 'example-university',
      country: 'Canada',
      city: 'Toronto',
      website: 'https://example.edu',
      summary: 'A sufficiently detailed summary of this example institution.',
      institutionType: 'public',
      studentCount: null,
      acceptanceRate: null,
      annualTuitionUsd: null,
      ibTypicalMin: null,
      programs: [],
      deadlines: [],
      sources: [
        {
          title: 'Source',
          url: 'http://example.edu',
          category: 'official',
          verifiedAt: new Date().toISOString(),
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

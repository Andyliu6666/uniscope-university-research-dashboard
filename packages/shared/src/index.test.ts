import { describe, expect, it } from 'vitest';
import { universityInputSchema, universityQuerySchema } from './index.js';

describe('shared validation', () => {
  it('applies safe pagination defaults', () => {
    expect(universityQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 9 });
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

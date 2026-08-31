import type { CostSnapshot } from '@urd/shared';
import { describe, expect, it } from 'vitest';
import { formatCostContext, primaryCost } from './costs.js';

const source = {
  title: 'NCES IPEDS COST1_2024 (2024)',
  url: 'https://nces.ed.gov/ipeds/',
  category: 'government' as const,
  publisher: 'NCES',
  datasetVersion: 'COST1_2024',
  publishedAt: null,
  verifiedAt: '2026-08-31T00:00:00.000Z',
};

const cost = (overrides: Partial<CostSnapshot>): CostSnapshot => ({
  academicYear: '2024-25',
  level: 'undergraduate',
  applicantType: 'all',
  residency: 'out_of_state',
  category: 'tuition_and_fees',
  period: 'academic_year',
  scenario: 'published_2024_25',
  amount: 55_000,
  currency: 'USD',
  sourceFlags: {},
  source,
  ...overrides,
});

describe('cost display helpers', () => {
  it('selects a preferred annual undergraduate snapshot regardless of API order', () => {
    const preferred = cost({ amount: 55_000 });
    const lessSpecific = cost({
      category: 'tuition',
      scenario: 'average_full_time',
      amount: 50_000,
    });
    expect(primaryCost([lessSpecific, preferred])).toBe(preferred);
  });

  it('keeps the source, year, residency, and scenario in the display context', () => {
    const value = formatCostContext(cost({}));
    expect(value).toContain('out of state');
    expect(value).toContain('published 2024–25');
    expect(value).toContain('2024-25');
    expect(value).toContain('COST1_2024');
  });
});

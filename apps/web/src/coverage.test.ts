import { describe, expect, it } from 'vitest';
import {
  coverageDimensionSummary,
  coverageLevelCopy,
  coverageSourceTierLabel,
} from './coverage.js';

describe('coverage copy', () => {
  it('does not describe identity-only evidence as a complete profile', () => {
    expect(coverageLevelCopy.identity_verified.label).toBe('Identity verified only');
    expect(coverageSourceTierLabel.identity_registry).toBe('Identity registry only');
  });

  it('reports zero structured facts explicitly', () => {
    expect(
      coverageDimensionSummary({
        status: 'partial',
        factCount: 0,
        sourceTier: 'identity_registry',
      }),
    ).toBe('Partial · 0 structured facts · Identity registry only');
  });
});

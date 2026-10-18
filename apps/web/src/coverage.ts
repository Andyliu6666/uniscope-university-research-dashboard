import type {
  CoverageDimension,
  CoverageSourceTier,
  CoverageStatus,
  UniversityCoverage,
} from '@urd/shared';

export const coverageLevelCopy: Record<
  UniversityCoverage['level'],
  { label: string; detail: string }
> = {
  identity_unverified: {
    label: 'Identity not verified',
    detail: 'This record does not yet have enough source evidence to verify the institution.',
  },
  identity_verified: {
    label: 'Identity verified only',
    detail:
      'The institution identity is source-backed, but its core and application information is incomplete.',
  },
  core_complete: {
    label: 'Core profile complete',
    detail:
      'Core institutional facts are backed by an official or government source; application details remain incomplete.',
  },
  application_ready: {
    label: 'Application-ready profile',
    detail:
      'Core facts, programs, admissions requirements, deadlines, and costs have structured official evidence.',
  },
};

export const coverageStatusLabel: Record<CoverageStatus, string> = {
  missing: 'Not researched',
  partial: 'Partial',
  verified: 'Verified',
};

export const coverageSourceTierLabel: Record<CoverageSourceTier, string> = {
  none: 'No linked evidence',
  identity_registry: 'Identity registry only',
  independent: 'Independent source',
  official: 'Official / government',
};

export const coverageDimensionSummary = (dimension: CoverageDimension) => {
  const facts = `${dimension.factCount} structured fact${dimension.factCount === 1 ? '' : 's'}`;
  return `${coverageStatusLabel[dimension.status]} · ${facts} · ${coverageSourceTierLabel[dimension.sourceTier]}`;
};

import { describe, expect, it } from 'vitest';
import { assertNoIdentifierOwnershipConflicts } from './institution-identifier-ownership.js';

describe('institution identifier ownership gate', () => {
  it('accepts an unambiguous provider mapping', () => {
    expect(() => assertNoIdentifierOwnershipConflicts([], 'OpenAlex import')).not.toThrow();
  });

  it('reports legacy conflicts in deterministic provider, university, and identifier order', () => {
    expect(() =>
      assertNoIdentifierOwnershipConflicts(
        [
          {
            provider: 'ror',
            universityId: 'university-b',
            externalIds: ['02', '01'],
          },
          {
            provider: 'openalex',
            universityId: 'university-a',
            externalIds: ['I20', 'I10'],
          },
        ],
        'OpenAlex import',
      ),
    ).toThrow(
      'OpenAlex import refused: this provider requires at most one identifier per university. ' +
        'Resolve these institution_identifiers conflicts first: ' +
        'openalex/university-a=[I10, I20]; ror/university-b=[01, 02].',
    );
  });
});

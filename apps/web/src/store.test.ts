import { describe, expect, it } from 'vitest';
import { readStoredComparison } from './store.js';

describe('comparison storage', () => {
  it('recovers from invalid browser data', () => {
    expect(readStoredComparison('{broken')).toEqual([]);
    expect(readStoredComparison('{"slug":"not-an-array"}')).toEqual([]);
  });

  it('keeps at most three valid slugs', () => {
    expect(readStoredComparison('["one",42,"two","three","four"]')).toEqual([
      'one',
      'two',
      'three',
    ]);
  });
});

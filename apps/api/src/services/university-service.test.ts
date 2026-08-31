import { describe, expect, it } from 'vitest';
import { resolveStudentCount } from './university-service.js';

describe('university profile hydration', () => {
  it('prefers official enrollment over a community profile count', () => {
    expect(resolveStudentCount(21_189, 30_259)).toBe(30_259);
  });

  it('keeps the profile count when no official enrollment exists', () => {
    expect(resolveStudentCount(21_189, undefined)).toBe(21_189);
  });

  it('returns null when neither source publishes a count', () => {
    expect(resolveStudentCount(null, undefined)).toBeNull();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from './config.js';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe('configuration', () => {
  it('requires DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    process.env.ADMIN_KEY = 'a-secure-enough-test-key';
    expect(() => getConfig()).toThrow();
  });

  it('parses a valid environment', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.ADMIN_KEY = 'a-secure-enough-test-key';
    expect(getConfig().PORT).toBe(3001);
  });
});

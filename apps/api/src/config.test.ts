import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from './config.js';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe('configuration', () => {
  it('requires DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    expect(() => getConfig()).toThrow();
  });

  it('keeps admin writes and proxy trust disabled by default', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    delete process.env.ADMIN_WRITES_ENABLED;
    delete process.env.ADMIN_KEY;
    delete process.env.TRUST_PROXY;
    delete process.env.HOST;
    const config = getConfig();
    expect(config.PORT).toBe(3001);
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.ADMIN_WRITES_ENABLED).toBe(false);
    expect(config.ADMIN_KEY).toBeUndefined();
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('requires a key when admin writes are explicitly enabled', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.ADMIN_WRITES_ENABLED = 'true';
    delete process.env.ADMIN_KEY;
    expect(() => getConfig()).toThrow(/ADMIN_KEY is required/);
  });

  it('refuses a known development key for production writes', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_WRITES_ENABLED = 'true';
    process.env.ADMIN_KEY = 'local-development-only';
    expect(() => getConfig()).toThrow(/Refusing a known development ADMIN_KEY/);
  });

  it('allows production startup without a key when writes are disabled', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_WRITES_ENABLED = 'false';
    delete process.env.ADMIN_KEY;
    expect(getConfig().ADMIN_WRITES_ENABLED).toBe(false);
  });

  it('parses an explicit proxy allowlist', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.TRUST_PROXY = '127.0.0.1, 10.0.0.0/8';
    expect(getConfig().TRUST_PROXY).toEqual(['127.0.0.1', '10.0.0.0/8']);
  });
});

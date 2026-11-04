import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { buildApp } from './app.js';

const config = (overrides: Partial<Config> = {}): Config => ({
  DATABASE_URL: 'postgresql://localhost/test',
  PORT: 3001,
  HOST: '127.0.0.1',
  WEB_ORIGIN: 'http://localhost:5173',
  ADMIN_WRITES_ENABLED: false,
  ADMIN_KEY: undefined,
  TRUST_PROXY: false,
  NODE_ENV: 'test',
  ...overrides,
});

describe('admin write route', () => {
  it('is absent unless explicitly enabled', async () => {
    const app = await buildApp(config(), {} as Database);
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/universities',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('rejects an invalid key when the route is enabled', async () => {
    const app = await buildApp(
      config({ ADMIN_WRITES_ENABLED: true, ADMIN_KEY: 'a-secure-enough-test-key' }),
      {} as Database,
    );
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/universities',
        headers: { 'x-admin-key': 'wrong-key' },
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('HTTP error responses', () => {
  it('returns 429 and retry headers when the configured request limit is reached', async () => {
    const app = await buildApp(config(), {} as Database);
    try {
      for (let i = 0; i < 120; i++) {
        const response = await app.inject('/api/universities/missing/admissions?pageSize=0');
        expect(response.statusCode).toBe(400);
      }
      const limited = await app.inject('/api/universities/missing/admissions?pageSize=0');
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.headers['x-ratelimit-remaining']).toBe('0');
      expect(limited.json().error).toBe('Too Many Requests');
    } finally {
      await app.close();
    }
  });

  it('keeps malformed JSON and oversized-body errors as client errors', async () => {
    const app = await buildApp(
      config({ ADMIN_WRITES_ENABLED: true, ADMIN_KEY: 'a-secure-enough-test-key' }),
      {} as Database,
    );
    try {
      const request = {
        method: 'PUT' as const,
        url: '/api/admin/universities',
        headers: { 'content-type': 'application/json', 'x-admin-key': 'a-secure-enough-test-key' },
      };
      const malformed = await app.inject({ ...request, payload: '{"name":' });
      expect(malformed.statusCode).toBe(400);
      const oversized = await app.inject({
        ...request,
        payload: JSON.stringify({ description: 'x'.repeat(1_000_001) }),
      });
      expect(oversized.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });

  it('keeps unexpected server error details private', async () => {
    const app = await buildApp(config(), {} as Database);
    app.get('/test-unexpected-error', async () => {
      throw new Error('private database connection details');
    });
    try {
      const response = await app.inject('/test-unexpected-error');
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Unexpected server error' });
      expect(response.body).not.toContain('private database');
    } finally {
      await app.close();
    }
  });
});

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

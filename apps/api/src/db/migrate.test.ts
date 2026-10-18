import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  migrate: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
}));
vi.mock('../load-env.js', () => ({}));
vi.mock('../config.js', () => ({ getConfig: () => ({}) }));
vi.mock('./client.js', () => ({ createDb: () => ({ db: {}, close: mocks.close }) }));
vi.mock('drizzle-orm/postgres-js/migrator', () => ({ migrate: mocks.migrate }));

beforeEach(() => {
  vi.resetModules();
  mocks.migrate.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('database migration lifecycle', () => {
  it('closes the database connection after a successful migration', async () => {
    await import('./migrate.js');
    expect(mocks.migrate).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it('closes the connection and preserves a migration failure', async () => {
    const failure = new Error('Invalid migration SQL');
    mocks.migrate.mockRejectedValue(failure);
    await expect(import('./migrate.js')).rejects.toBe(failure);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });
});

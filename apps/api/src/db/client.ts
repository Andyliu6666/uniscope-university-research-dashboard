import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Config } from '../config.js';

export const createDb = (config: Config) => {
  const client = postgres(config.DATABASE_URL, { max: 10 });
  return { db: drizzle(client), close: () => client.end() };
};

export type Database = ReturnType<typeof createDb>['db'];

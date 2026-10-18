import '../load-env.js';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getConfig } from '../config.js';
import { createDb } from './client.js';

const connection = createDb(getConfig());
try {
  await migrate(connection.db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
} finally {
  await connection.close();
}
console.log('Database migrations completed.');

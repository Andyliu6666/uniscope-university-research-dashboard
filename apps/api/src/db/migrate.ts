import '../load-env.js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getConfig } from '../config.js';
import { createDb } from './client.js';

const connection = createDb(getConfig());
await migrate(connection.db, {
  migrationsFolder: new URL('../../drizzle', import.meta.url).pathname,
});
await connection.close();
console.log('Database migrations completed.');

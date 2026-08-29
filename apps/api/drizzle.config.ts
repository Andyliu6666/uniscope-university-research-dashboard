import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: ['.env', '../../.env'], quiet: true });

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
});

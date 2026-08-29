import '../load-env.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { universityInputSchema } from '@urd/shared';
import { getConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { upsertUniversity } from '../services/university-service.js';

const file = process.argv[2];
if (!file) throw new Error('Usage: pnpm --filter @urd/api import -- path/to/universities.json');
const payload: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
const universities = z.array(universityInputSchema).parse(payload);
const connection = createDb(getConfig());
for (const university of universities) await upsertUniversity(connection.db, university);
await connection.close();
console.log(`Imported ${universities.length} universities.`);

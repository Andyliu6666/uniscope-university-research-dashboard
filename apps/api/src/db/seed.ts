import 'dotenv/config';
import { universityInputSchema } from '@urd/shared';
import { getConfig } from '../config.js';
import { upsertUniversity } from '../services/university-service.js';
import { createDb } from './client.js';
import { seedUniversities } from './seed-data.js';

const connection = createDb(getConfig());
for (const candidate of seedUniversities) {
  const input = universityInputSchema.parse(candidate);
  await upsertUniversity(connection.db, input);
  console.log(`Seeded ${input.name}`);
}
await connection.close();

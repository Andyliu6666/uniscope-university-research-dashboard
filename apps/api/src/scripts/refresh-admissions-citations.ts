import '../load-env.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb } from '../db/client.js';
import { getConfig } from '../config.js';
import { citationRefreshSchema } from './admissions-citation-format.js';
import { refreshAdmissionsCitations } from './admissions-citation-refresh.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const files = args.filter((arg) => !arg.startsWith('--'));
const flags = args.filter((arg) => arg.startsWith('--'));
if (
  files.length !== 1 ||
  flags.length > 1 ||
  flags.some((f) => !['--validate-only', '--dry-run'].includes(f))
)
  throw new Error('Usage: refresh:citations reviewed.json [--validate-only | --dry-run]');
const file = files[0];
if (!file) throw new Error('Missing reviewed citation file.');
const dataset = citationRefreshSchema.parse(JSON.parse(await readFile(resolve(file), 'utf8')));
if (flags.includes('--validate-only'))
  console.log(
    JSON.stringify({ mode: 'validation-only', records: dataset.records.length, databaseWrites: 0 }),
  );
else {
  const connection = createDb(getConfig());
  try {
    console.log(
      JSON.stringify(
        await refreshAdmissionsCitations(connection.db, dataset, flags.includes('--dry-run')),
      ),
    );
  } finally {
    await connection.close();
  }
}

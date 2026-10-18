import '../load-env.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb } from '../db/client.js';
import { getConfig } from '../config.js';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';
import { importAdmissionsFacts } from './admissions-facts-import.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const files = args.filter((arg) => !arg.startsWith('--'));
const flags = args.filter((arg) => arg.startsWith('--'));
if (
  files.length !== 1 ||
  flags.length > 1 ||
  flags.some((flag) => !['--dry-run', '--validate-only'].includes(flag))
)
  throw new Error('Usage: import:admissions-facts reviewed.json [--validate-only | --dry-run]');
const file = files[0];
if (!file) throw new Error('A reviewed dataset path is required.');
const dataset = admissionFactsDatasetSchema.parse(
  JSON.parse(await readFile(resolve(file), 'utf8')),
);
if (flags.includes('--validate-only')) {
  console.log(
    JSON.stringify({
      mode: 'validation-only',
      profiles: dataset.profiles.length,
      facts: dataset.profiles.reduce((sum, p) => sum + p.requirements.length, 0),
      databaseWrites: 0,
    }),
  );
} else {
  const connection = createDb(getConfig());
  try {
    console.log(
      JSON.stringify(
        await importAdmissionsFacts(connection.db, dataset, flags.includes('--dry-run')),
      ),
    );
  } finally {
    await connection.close();
  }
}

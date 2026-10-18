import '../load-env.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ibDatasetSchema } from '@urd/shared';
import { createDb } from '../db/client.js';
import { getConfig } from '../config.js';
import { importIbDataset } from './ib-import.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const dryRun = args.includes('--dry-run');
const validateOnly = args.includes('--validate-only');
const unknownFlags = args.filter(
  (arg) => arg.startsWith('--') && !['--dry-run', '--validate-only'].includes(arg),
);
const positional = args.filter((arg) => !arg.startsWith('--'));
if (unknownFlags.length || positional.length !== 1 || (dryRun && validateOnly))
  throw new Error(
    'Usage: pnpm --filter @urd/api import:ib path/to/reviewed-ib.json [--validate-only | --dry-run]',
  );
const file = positional[0];
if (!file) throw new Error('An IB dataset path is required.');
const dataset = ibDatasetSchema.parse(JSON.parse(await readFile(resolve(file), 'utf8')));
if (validateOnly) {
  console.log(
    JSON.stringify(
      {
        mode: 'validation-only',
        institutions: dataset.institutions.length,
        records: dataset.records.length,
        programRecords: dataset.records.filter((r) => r.program !== null).length,
        publishedTotals: dataset.records.filter((r) => r.requirement.status === 'published').length,
        databaseWrites: 0,
      },
      null,
      2,
    ),
  );
} else {
  const connection = createDb(getConfig());
  try {
    console.log(JSON.stringify(await importIbDataset(connection.db, dataset, { dryRun }), null, 2));
  } finally {
    await connection.close();
  }
}

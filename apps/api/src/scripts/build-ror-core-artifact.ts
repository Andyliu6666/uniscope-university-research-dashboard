import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { once } from 'node:events';
import { parse } from 'csv-parse';
import { z } from 'zod';
import {
  assertRorCoreColumns,
  transformRorCoreCsvRow,
  type RorCoreRow,
} from './ror-core-format.js';

const rawArguments = process.argv.slice(2);
if (rawArguments[0] === '--') rawArguments.shift();
const [inputArgument, outputArgument, sourceUrlArgument, retrievedAtArgument] = rawArguments;
if (!inputArgument || rawArguments.length > 4) {
  throw new Error(
    'Usage: pnpm --filter @urd/api build:ror-core <ror.csv> [output-directory] [source-url] [retrieved-at]',
  );
}

const inputPath = resolve(inputArgument);
const outputDirectory = resolve(outputArgument ?? 'data/sources');
const sourceName = basename(inputPath);
const versionMatch = /^(v[^-]+-\d{4}-\d{2}-\d{2})-ror-data[.]csv$/u.exec(sourceName);
if (!versionMatch?.[1]) {
  throw new Error('The ROR input filename must look like v2.12-2026-08-25-ror-data.csv.');
}
const datasetVersion = versionMatch[1];
const datasetFile = `ror-core-${datasetVersion}.jsonl`;
const datasetPath = resolve(outputDirectory, datasetFile);
const temporaryPath = `${datasetPath}.tmp`;
const manifestPath = resolve(outputDirectory, 'ror-core-artifacts.json');
const sourceUrl = z
  .url()
  .startsWith('https://')
  .parse(
    sourceUrlArgument ??
      'https://zenodo.org/records/22099990/files/v2.12-2026-08-25-ror-data.zip?download=1',
  );
const retrievedAt = z.iso.datetime().parse(retrievedAtArgument ?? new Date().toISOString());

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const writeLine = async (stream: ReturnType<typeof createWriteStream>, row: RorCoreRow) => {
  if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, 'drain');
};

await mkdir(outputDirectory, { recursive: true });
await rm(temporaryPath, { force: true });

let columns: string[] = [];
let sourceRows = 0;
let datasetRows = 0;
let aliasRows = 0;
const statusCounts = { active: 0, inactive: 0, withdrawn: 0 };
const rorIds = new Set<string>();
const output = createWriteStream(temporaryPath, { encoding: 'utf8', flags: 'wx' });

try {
  const parser = createReadStream(inputPath).pipe(
    parse({
      columns: (header: string[]) => {
        columns = header;
        assertRorCoreColumns(header);
        return header;
      },
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }),
  );

  for await (const value of parser) {
    sourceRows += 1;
    let row: RorCoreRow | null;
    try {
      row = transformRorCoreCsvRow(value as Record<string, unknown>);
    } catch (error) {
      throw new Error(`Invalid ROR source row ${sourceRows}: ${String(error)}`, { cause: error });
    }
    if (!row) continue;
    if (rorIds.has(row.rorId)) throw new Error(`Duplicate ROR identifier: ${row.rorId}`);
    rorIds.add(row.rorId);
    statusCounts[row.status] += 1;
    aliasRows += row.aliases.length;
    datasetRows += 1;
    await writeLine(output, row);
  }
  assertRorCoreColumns(columns);
  if (!sourceRows || !datasetRows) throw new Error('ROR source contains no education records.');
  output.end();
  await once(output, 'close');
  await rename(temporaryPath, datasetPath);
} catch (error) {
  output.destroy();
  await rm(temporaryPath, { force: true });
  throw error;
}

const sourceSha256 = await sha256File(inputPath);
const datasetSha256 = await sha256File(datasetPath);
const datasetBytes = (await stat(datasetPath)).size;
const manifest = {
  schemaVersion: 1,
  artifact: {
    datasetVersion,
    datasetFile,
    datasetSha256,
    datasetBytes,
    datasetRows,
    sourceFile: sourceName,
    sourceSha256,
    sourceRows,
    sourceUrl,
    publisher: 'Research Organization Registry (ROR)',
    license: 'CC0 1.0',
    retrievedAt,
    statusCounts,
    aliasRows,
    transformation:
      'Exact ROR education records projected to stable identity-linked core fields and stored names; insecure official website links are omitted rather than upgraded or guessed; no name matching, estimates, or inferred admissions data.',
  },
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(
  `Built ${datasetFile}: ${datasetRows} education records, ${aliasRows} aliases, SHA-256 ${datasetSha256}.`,
);

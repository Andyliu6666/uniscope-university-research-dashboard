import '../load-env.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { createDb, type Database } from '../db/client.js';
import { importRuns, institutionIdentifiers, programs, sources } from '../db/schema.js';

/**
 * Import the reviewed NCES IPEDS C2024_A program catalog.
 *
 * C2024_A reports the programs and award levels an institution submitted for
 * the July 1, 2023–June 30, 2024 reporting period. The source rows are
 * identity-only: a row is accepted only when its six-digit UNITID already
 * exists in institution_identifiers(provider = 'ipeds'). The importer never
 * creates an institution from a name match.
 *
 * The application currently models programs as a concise catalog item rather
 * than a second fact table. Each distinct institution/CIP/award-level pair is
 * added as one program; duplicate second-major rows collapse to the same
 * catalog item. The official C2024_A total is validated, while the university
 * profile links to the source row for provenance.
 *
 * Usage:
 *   pnpm --filter @urd/api import:ipeds-programs
 *   pnpm --filter @urd/api import:ipeds-programs [program-csv] [cip-csv] [record-limit]
 *   pnpm --filter @urd/api import:ipeds-programs --dry-run
 *
 * The record limit applies to source rows for one invocation. A checkpoint is
 * committed after every batch, so rerunning the same command resumes safely.
 * Re-running a completed artifact is idempotent.
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDataDirectory = resolve(scriptDirectory, '../../../../data/sources');
const defaultProgramsCsvPath = resolve(repositoryDataDirectory, 'C2024_A_programs.csv');
const defaultCipCsvPath = resolve(repositoryDataDirectory, 'CIPCode2020.csv');
const sourceManifestPath = resolve(repositoryDataDirectory, 'ipeds-program-artifacts.json');

const rawArguments = process.argv.slice(2);
if (rawArguments[0] === '--') rawArguments.shift();
const dryRun = rawArguments.includes('--dry-run');
const unsupportedOptions = rawArguments.filter(
  (argument) => argument.startsWith('--') && argument !== '--dry-run',
);
if (unsupportedOptions.length) {
  throw new Error(`Unsupported option(s): ${unsupportedOptions.join(', ')}`);
}
const positionalArguments = rawArguments.filter((argument) => argument !== '--dry-run');
const programsCsvPath = resolve(positionalArguments[0] ?? defaultProgramsCsvPath);
const cipCsvPath = resolve(positionalArguments[1] ?? defaultCipCsvPath);
const requestedLimitArgument = positionalArguments[2];
const requestedLimit =
  requestedLimitArgument === undefined ? Number.MAX_SAFE_INTEGER : Number(requestedLimitArgument);
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('record-limit must be a positive base-10 safe integer.');
}

const provider = 'ipeds-programs';
const datasetVersion = basename(programsCsvPath).replace(/\.csv$/iu, '');
const chunkSize = 500;
const programInsertChunkSize = 1000;
const importLockName = 'uniscope:programs-import:v1';
const expectedProgramColumns = [
  'UNITID',
  'CIPCODE',
  'MAJORNUM',
  'AWLEVEL',
  'XCTOTALT',
  'CTOTALT',
] as const;
const expectedCipColumns = [
  'CIPFamily',
  'CIPCode',
  'Action',
  'TextChange',
  'CIPTitle',
  'CIPDefinition',
  'CrossReferences',
  'Examples',
] as const;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type RawRow = Record<string, unknown>;
type ProgramLevel = 'undergraduate' | 'graduate';

const reviewedArtifactSchema = z.object({
  datasetFile: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetRows: z.number().int().positive(),
  sourceUrl: z.url().startsWith('https://'),
  publisher: z.string().min(1),
  retrievedAt: z.iso.datetime(),
  notes: z.string().min(1),
});
const programArtifactSchema = reviewedArtifactSchema.extend({
  reportedAcademicYear: z.string().regex(/^\d{4}$/u),
  reportingPeriod: z.string().regex(/^\d{4}-\d{2}$/u),
});
const sourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifacts: z.object({
    programs: programArtifactSchema,
    cipCatalog: reviewedArtifactSchema,
  }),
});
type ProgramArtifact = z.infer<typeof programArtifactSchema>;
type CipArtifact = z.infer<typeof reviewedArtifactSchema>;

type AwardLevelDefinition = {
  level: ProgramLevel;
  label: string;
};

/**
 * IPEDS award-level codes used by C2024_A. Codes 20 and 21 are the 1a and 1b
 * sub-baccalaureate certificate categories introduced for the 2020 CIP cycle.
 */
const awardLevelDefinitions: Record<string, AwardLevelDefinition> = {
  '1': { level: 'undergraduate', label: 'less than one-year award' },
  '2': { level: 'undergraduate', label: 'one-to-two-year award' },
  '3': { level: 'undergraduate', label: "associate's degree" },
  '4': { level: 'undergraduate', label: 'two-to-four-year award' },
  '5': { level: 'undergraduate', label: "bachelor's degree" },
  '6': { level: 'graduate', label: 'postbaccalaureate certificate' },
  '7': { level: 'graduate', label: "master's degree" },
  '8': { level: 'graduate', label: "post-master's certificate" },
  '17': { level: 'graduate', label: "doctor's degree, research/scholarship" },
  '18': { level: 'graduate', label: "doctor's degree, professional practice" },
  '19': { level: 'graduate', label: "doctor's degree, other" },
  '20': { level: 'undergraduate', label: 'less-than-300-hour award (1a)' },
  '21': { level: 'undergraduate', label: '300-to-899-hour award (1b)' },
};

const allowedTotalFlags = new Set([
  'A',
  'B',
  'C',
  'D',
  'G',
  'H',
  'J',
  'K',
  'L',
  'N',
  'P',
  'R',
  'S',
  'Z',
]);
const missingSentinels = new Set(['-1', '-2', '-3']);

type CipCatalog = {
  rowCount: number;
  titleByCode: Map<string, string>;
};

type ValidatedProgramRow = {
  unitId: string;
  cipCode: string;
  majorNumber: '1' | '2';
  awardLevel: string;
  awardDefinition: AwardLevelDefinition;
  sourceTotal: number | null;
  sourceTotalFlag: string | null;
};

type ProgramCandidate = ValidatedProgramRow & {
  universityId: string;
  name: string;
  level: ProgramLevel;
  field: string;
};

type CheckpointMetadata = {
  schemaVersion: 1;
  sourceFile: string;
  sourceSha256: string;
  sourceRows: number;
  cipFile: string;
  cipSha256: string;
  cipRows: number;
  sourceUrl: string;
  sourceRetrievedAt: string;
  reportedAcademicYear: string;
  reportingPeriod: string;
  sourceRow: number;
};

const checkpointSchema = z.object({
  schemaVersion: z.literal(1),
  sourceFile: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRows: z.number().int().nonnegative(),
  cipFile: z.string().min(1),
  cipSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  cipRows: z.number().int().positive(),
  sourceUrl: z.url().startsWith('https://'),
  sourceRetrievedAt: z.iso.datetime(),
  reportedAcademicYear: z.string().regex(/^\d{4}$/u),
  reportingPeriod: z.string().regex(/^\d{4}-\d{2}$/u),
  sourceRow: z.number().int().nonnegative(),
});

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const sha256Text = (value: string) => createHash('sha256').update(value).digest('hex');
const asTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const normalizeSpreadsheetCode = (value: string) =>
  value.trim().replace(/^="?/u, '').replace(/"$/u, '');

const assertColumns = (columns: string[], expected: readonly string[], label: string) => {
  const duplicateColumns = [
    ...new Set(columns.filter((column, index) => columns.indexOf(column) !== index)),
  ];
  if (duplicateColumns.length) {
    throw new Error(`${label} has duplicate columns: ${duplicateColumns.join(', ')}`);
  }
  if (
    columns.length !== expected.length ||
    columns.some((column, index) => column !== expected[index])
  ) {
    throw new Error(`${label} schema mismatch; expected the reviewed column order.`);
  }
};

const parseNonNegativeTotal = (row: RawRow, sourceRow: number) => {
  const rawFlag = asTrimmedString(row.XCTOTALT).toUpperCase();
  if (rawFlag && !allowedTotalFlags.has(rawFlag)) {
    throw new Error(`C2024_A row ${sourceRow} contains an unknown XCTOTALT flag: ${rawFlag}`);
  }
  const rawValue = asTrimmedString(row.CTOTALT);
  if (!rawValue || missingSentinels.has(rawValue)) {
    return { value: null, flag: rawFlag || null };
  }
  if (!/^\d+$/u.test(rawValue)) {
    throw new Error(`C2024_A row ${sourceRow} has an invalid CTOTALT value: ${rawValue}`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value > 2_147_483_647) {
    throw new Error(`C2024_A row ${sourceRow} has an out-of-range CTOTALT value.`);
  }
  return { value, flag: rawFlag || null };
};

const validateProgramRow = (
  value: RawRow,
  sourceRow: number,
  titleByCode: Map<string, string>,
): ValidatedProgramRow => {
  const unitId = asTrimmedString(value.UNITID);
  if (!/^\d{6}$/u.test(unitId)) {
    throw new Error(`Invalid C2024_A UNITID at source row ${sourceRow}: ${unitId}`);
  }
  const cipCode = normalizeSpreadsheetCode(asTrimmedString(value.CIPCODE));
  if (!/^(?:\d{2}\.\d{4}|99)$/u.test(cipCode)) {
    throw new Error(`Invalid C2024_A CIPCODE at source row ${sourceRow}: ${cipCode}`);
  }
  const majorNumber = asTrimmedString(value.MAJORNUM);
  if (majorNumber !== '1' && majorNumber !== '2') {
    throw new Error(`Invalid C2024_A MAJORNUM at source row ${sourceRow}: ${majorNumber}`);
  }
  const awardLevel = asTrimmedString(value.AWLEVEL);
  const awardDefinition = awardLevelDefinitions[awardLevel];
  if (!awardDefinition) {
    throw new Error(`Unsupported C2024_A AWLEVEL at source row ${sourceRow}: ${awardLevel}`);
  }
  const total = parseNonNegativeTotal(value, sourceRow);
  if (cipCode !== '99' && !titleByCode.has(cipCode)) {
    throw new Error(`CIPCode2020 has no six-digit title for C2024_A code ${cipCode}.`);
  }
  return {
    unitId,
    cipCode,
    majorNumber,
    awardLevel,
    awardDefinition,
    sourceTotal: total.value,
    sourceTotalFlag: total.flag,
  };
};

const parseCipCatalog = async (file: string): Promise<CipCatalog> => {
  let columns: string[] = [];
  let rowCount = 0;
  const titleByCode = new Map<string, string>();
  const parser = createReadStream(file).pipe(
    parse({
      columns: (header: string[]) => {
        columns = header;
        assertColumns(columns, expectedCipColumns, 'CIPCode2020');
        return header;
      },
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      relax_quotes: true,
    }),
  );
  for await (const value of parser) {
    rowCount += 1;
    const row = value as RawRow;
    const code = normalizeSpreadsheetCode(asTrimmedString(row.CIPCode));
    if (!/^\d{2}\.\d{4}$/u.test(code)) continue;
    const title = asTrimmedString(row.CIPTitle).replace(/\s+/gu, ' ');
    if (!title) throw new Error(`CIPCode2020 code ${code} has an empty title.`);
    const previous = titleByCode.get(code);
    if (previous && previous !== title) {
      throw new Error(`CIPCode2020 contains conflicting titles for ${code}.`);
    }
    titleByCode.set(code, title);
  }
  if (!columns.length) throw new Error('CIPCode2020 artifact is missing its header.');
  if (!rowCount) throw new Error('CIPCode2020 artifact contains no records.');
  return { rowCount, titleByCode };
};

const inspectProgramsArtifact = async (
  file: string,
  titleByCode: Map<string, string>,
): Promise<number> => {
  let columns: string[] = [];
  let rowCount = 0;
  const seenKeys = new Set<string>();
  const parser = createReadStream(file).pipe(
    parse({
      columns: (header: string[]) => {
        columns = header;
        assertColumns(columns, expectedProgramColumns, 'C2024_A_programs');
        return header;
      },
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }),
  );
  for await (const value of parser) {
    rowCount += 1;
    const validated = validateProgramRow(value as RawRow, rowCount, titleByCode);
    const key = `${validated.unitId}:${validated.cipCode}:${validated.majorNumber}:${validated.awardLevel}`;
    if (seenKeys.has(key)) {
      throw new Error(`C2024_A contains a duplicate program key at source row ${rowCount}: ${key}`);
    }
    seenKeys.add(key);
  }
  if (!columns.length) throw new Error('C2024_A_programs artifact is missing its header.');
  if (!rowCount) throw new Error('C2024_A_programs artifact contains no records.');
  return rowCount;
};

const loadReviewedArtifacts = async (): Promise<{
  programs: ProgramArtifact;
  cipCatalog: CipArtifact;
}> => {
  const raw = await readFile(sourceManifestPath, 'utf8');
  const parsed = sourceManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error(`Invalid IPEDS program manifest: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data.artifacts;
};

const readUniversityIds = async (db: Database) => {
  const rows = await db
    .select({
      externalId: institutionIdentifiers.externalId,
      universityId: institutionIdentifiers.universityId,
    })
    .from(institutionIdentifiers)
    .where(eq(institutionIdentifiers.provider, 'ipeds'));
  return new Map(rows.map((row) => [row.externalId, row.universityId]));
};

const programKey = (universityId: string, name: string, level: ProgramLevel, field: string) =>
  `${universityId}\u0000${name}\u0000${level}\u0000${field}`;

const readExistingProgramKeys = async (db: Database) => {
  const rows = await db
    .select({
      universityId: programs.universityId,
      name: programs.name,
      level: programs.level,
      field: programs.field,
    })
    .from(programs);
  return new Set(rows.map((row) => programKey(row.universityId, row.name, row.level, row.field)));
};

const upsertSourceRows = async (
  tx: Tx,
  universityIds: string[],
  artifact: ProgramArtifact,
  runId: string,
) => {
  const uniqueUniversityIds = [...new Set(universityIds)];
  if (!uniqueUniversityIds.length) return;
  await tx
    .insert(sources)
    .values(
      uniqueUniversityIds.map((universityId) => ({
        universityId,
        title: `NCES IPEDS C2024_A programs (${artifact.reportingPeriod})`,
        url: artifact.sourceUrl,
        category: 'government' as const,
        publisher: artifact.publisher,
        datasetVersion,
        importRunId: runId,
        verifiedAt: new Date(artifact.retrievedAt),
      })),
    )
    .onConflictDoUpdate({
      target: [sources.universityId, sources.url],
      set: {
        title: sql`excluded.title`,
        category: sql`excluded.category`,
        publisher: sql`excluded.publisher`,
        datasetVersion: sql`excluded.dataset_version`,
        importRunId: sql`excluded.import_run_id`,
        verifiedAt: sql`excluded.verified_at`,
      },
    });
};

const checkpointFor = (
  metadata: Omit<CheckpointMetadata, 'sourceRow'>,
  sourceRow: number,
): CheckpointMetadata => ({ ...metadata, sourceRow });

const getCheckpoint = (
  value: unknown,
  metadata: Omit<CheckpointMetadata, 'sourceRow'>,
  maximumSourceRow: number,
): CheckpointMetadata => {
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Existing IPEDS program run has an invalid checkpoint: ${z.prettifyError(parsed.error)}`,
    );
  }
  const checkpoint = parsed.data;
  for (const key of [
    'schemaVersion',
    'sourceFile',
    'sourceSha256',
    'sourceRows',
    'cipFile',
    'cipSha256',
    'cipRows',
    'sourceUrl',
    'sourceRetrievedAt',
    'reportedAcademicYear',
    'reportingPeriod',
  ] as const) {
    if (checkpoint[key] !== metadata[key]) {
      throw new Error(`Existing IPEDS program checkpoint metadata does not match ${key}.`);
    }
  }
  if (checkpoint.sourceRows !== maximumSourceRow || checkpoint.sourceRow > maximumSourceRow) {
    throw new Error('Existing IPEDS program run has a source-row checkpoint outside the artifact.');
  }
  return checkpoint;
};

const assertRunCounters = (
  run: {
    processedCount: number;
    insertedCount: number;
    updatedCount: number;
    skippedCount: number;
    rejectedCount: number;
  },
  expectedProcessedCount?: number,
) => {
  const accounted = run.insertedCount + run.updatedCount + run.skippedCount + run.rejectedCount;
  if (run.processedCount !== accounted) {
    throw new Error(
      `IPEDS program ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expectedProcessedCount !== undefined && run.processedCount !== expectedProcessedCount) {
    throw new Error(
      `IPEDS program import is incomplete: processed ${run.processedCount}, expected ${expectedProcessedCount}.`,
    );
  }
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  candidates: ProgramCandidate[],
  existingCount: number,
  skippedCount: number,
  matchedUniversityIds: string[],
  checkpoint: CheckpointMetadata,
  artifact: ProgramArtifact,
) => {
  await upsertSourceRows(tx, matchedUniversityIds, artifact, runId);
  let insertedCount = 0;
  for (let offset = 0; offset < candidates.length; offset += programInsertChunkSize) {
    const rows = candidates.slice(offset, offset + programInsertChunkSize).map((candidate) => ({
      universityId: candidate.universityId,
      name: candidate.name,
      level: candidate.level,
      field: candidate.field,
    }));
    const inserted = await tx.insert(programs).values(rows).returning({ id: programs.id });
    insertedCount += inserted.length;
  }
  const processedCount = candidates.length + existingCount + skippedCount;
  await tx
    .update(importRuns)
    .set({
      checkpoint,
      processedCount: sql`${importRuns.processedCount} + ${processedCount}`,
      insertedCount: sql`${importRuns.insertedCount} + ${insertedCount}`,
      updatedCount: sql`${importRuns.updatedCount} + ${existingCount}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skippedCount}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
  return { processedCount, insertedCount, updatedCount: existingCount, skippedCount };
};

const run = async () => {
  const [programHash, cipHash, reviewedArtifacts, cipCatalog] = await Promise.all([
    sha256File(programsCsvPath),
    sha256File(cipCsvPath),
    loadReviewedArtifacts(),
    parseCipCatalog(cipCsvPath),
  ]);
  const programRows = await inspectProgramsArtifact(programsCsvPath, cipCatalog.titleByCode);
  const programArtifact = reviewedArtifacts.programs;
  const cipArtifact = reviewedArtifacts.cipCatalog;
  const artifactProblems = [
    basename(programsCsvPath) === programArtifact.datasetFile
      ? null
      : `program file name is ${basename(programsCsvPath)}, expected ${programArtifact.datasetFile}`,
    programHash === programArtifact.datasetSha256
      ? null
      : 'C2024_A_programs SHA-256 does not match the reviewed manifest',
    programRows === programArtifact.datasetRows
      ? null
      : `C2024_A_programs row count is ${programRows}, expected ${programArtifact.datasetRows}`,
    basename(cipCsvPath) === cipArtifact.datasetFile
      ? null
      : `CIP file name is ${basename(cipCsvPath)}, expected ${cipArtifact.datasetFile}`,
    cipHash === cipArtifact.datasetSha256
      ? null
      : 'CIPCode2020 SHA-256 does not match the reviewed manifest',
    cipCatalog.rowCount === cipArtifact.datasetRows
      ? null
      : `CIPCode2020 row count is ${cipCatalog.rowCount}, expected ${cipArtifact.datasetRows}`,
  ].filter((problem): problem is string => problem !== null);
  if (artifactProblems.length) {
    throw new Error(`Refusing unreviewed IPEDS program artifacts: ${artifactProblems.join('; ')}.`);
  }

  const checkpointMetadata: Omit<CheckpointMetadata, 'sourceRow'> = {
    schemaVersion: 1,
    sourceFile: programArtifact.datasetFile,
    sourceSha256: programHash,
    sourceRows: programRows,
    cipFile: cipArtifact.datasetFile,
    cipSha256: cipHash,
    cipRows: cipCatalog.rowCount,
    sourceUrl: programArtifact.sourceUrl,
    sourceRetrievedAt: programArtifact.retrievedAt,
    reportedAcademicYear: programArtifact.reportedAcademicYear,
    reportingPeriod: programArtifact.reportingPeriod,
  };

  if (dryRun) {
    console.log(
      `IPEDS program dry run: ${programRows} valid source rows, ${cipCatalog.titleByCode.size} six-digit CIP titles, and no database changes.`,
    );
    return;
  }

  const artifactHash = sha256Text(`${provider}:${programHash}:${cipHash}\n`);
  const connection = createDb(getConfig(), { max: 1 });
  let runId: string | undefined;
  let lockHeld = false;
  try {
    const lockResult = await connection.db.execute(sql`
      select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
    `);
    const lockRow = lockResult[0] as { acquired?: unknown } | undefined;
    if (lockRow?.acquired !== true)
      throw new Error('Another IPEDS program import is already running.');
    lockHeld = true;

    const universityIdByIpeds = await readUniversityIds(connection.db);
    const existingProgramKeys = await readExistingProgramKeys(connection.db);
    const existingRuns = await connection.db
      .select()
      .from(importRuns)
      .where(
        and(
          eq(importRuns.provider, provider),
          eq(importRuns.datasetVersion, datasetVersion),
          eq(importRuns.artifactHash, artifactHash),
        ),
      )
      .limit(1);
    const existingRun = existingRuns[0];
    let checkpoint: CheckpointMetadata;
    if (existingRun) {
      assertRunCounters(existingRun);
      checkpoint = getCheckpoint(existingRun.checkpoint, checkpointMetadata, programRows);
      if (existingRun.processedCount !== checkpoint.sourceRow) {
        throw new Error(
          `IPEDS program ledger/checkpoint mismatch: processed ${existingRun.processedCount}, checkpoint ${checkpoint.sourceRow}.`,
        );
      }
      if (existingRun.status === 'completed') {
        assertRunCounters(existingRun, programRows);
        console.log(
          `IPEDS program dataset ${datasetVersion} (${artifactHash.slice(0, 12)}) is already fully imported.`,
        );
        return;
      }
      runId = existingRun.id;
      await connection.db
        .update(importRuns)
        .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
    } else {
      checkpoint = checkpointFor(checkpointMetadata, 0);
      const [createdRun] = await connection.db
        .insert(importRuns)
        .values({ provider, datasetVersion, artifactHash, status: 'running', checkpoint })
        .returning({ id: importRuns.id });
      if (!createdRun) throw new Error('Failed to create the IPEDS program import run.');
      runId = createdRun.id;
    }

    const parser = createReadStream(programsCsvPath).pipe(
      parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }),
    );
    let sourceRow = 0;
    let processedThisRun = 0;
    let insertedThisRun = 0;
    let updatedThisRun = 0;
    let skippedThisRun = 0;
    let candidates: ProgramCandidate[] = [];
    let existingCount = 0;
    let skippedCount = 0;
    const matchedUniversityIds = new Set<string>();
    const resumeAfterRow = checkpoint.sourceRow;
    let exhausted = true;
    let lastLoggedSourceRow = resumeAfterRow;

    const flush = async () => {
      if (!runId || (!candidates.length && !existingCount && !skippedCount)) return;
      const result = await connection.db.transaction((tx) =>
        flushChunk(
          tx,
          runId as string,
          candidates,
          existingCount,
          skippedCount,
          [...matchedUniversityIds],
          checkpointFor(checkpointMetadata, sourceRow),
          programArtifact,
        ),
      );
      processedThisRun += result.processedCount;
      insertedThisRun += result.insertedCount;
      updatedThisRun += result.updatedCount;
      skippedThisRun += result.skippedCount;
      checkpoint = checkpointFor(checkpointMetadata, sourceRow);
      candidates = [];
      existingCount = 0;
      skippedCount = 0;
      matchedUniversityIds.clear();
      if (
        checkpoint.sourceRow === programRows ||
        checkpoint.sourceRow - lastLoggedSourceRow >= 5000 ||
        processedThisRun >= requestedLimit
      ) {
        lastLoggedSourceRow = checkpoint.sourceRow;
        console.log(
          `IPEDS program progress: ${checkpoint.sourceRow}/${programRows} source rows; ${insertedThisRun} inserted, ${updatedThisRun} already present, ${skippedThisRun} identities skipped.`,
        );
      }
    };

    for await (const value of parser) {
      sourceRow += 1;
      if (sourceRow <= resumeAfterRow) continue;
      const validated = validateProgramRow(value as RawRow, sourceRow, cipCatalog.titleByCode);
      const universityId = universityIdByIpeds.get(validated.unitId);
      if (!universityId) {
        skippedCount += 1;
      } else {
        matchedUniversityIds.add(universityId);
        const title =
          cipCatalog.titleByCode.get(validated.cipCode) ??
          'Other / unspecified instructional programs (CIP 99)';
        const field = `CIP ${validated.cipCode} · ${validated.awardDefinition.label}`;
        const candidate: ProgramCandidate = {
          ...validated,
          universityId,
          name: title,
          level: validated.awardDefinition.level,
          field,
        };
        const key = programKey(universityId, candidate.name, candidate.level, candidate.field);
        if (existingProgramKeys.has(key)) existingCount += 1;
        else {
          existingProgramKeys.add(key);
          candidates.push(candidate);
        }
      }
      const bufferedRows = candidates.length + existingCount + skippedCount;
      if (bufferedRows >= chunkSize || processedThisRun + bufferedRows >= requestedLimit) {
        await flush();
        if (processedThisRun >= requestedLimit) {
          exhausted = false;
          break;
        }
      }
    }
    if (exhausted) await flush();
    if (exhausted && sourceRow !== programRows) {
      throw new Error(
        `C2024_A parser stopped at source row ${sourceRow}, expected ${programRows}.`,
      );
    }
    if (!runId) throw new Error('IPEDS program import run disappeared before finalization.');
    const [currentRun] = await connection.db
      .select({
        processedCount: importRuns.processedCount,
        insertedCount: importRuns.insertedCount,
        updatedCount: importRuns.updatedCount,
        skippedCount: importRuns.skippedCount,
        rejectedCount: importRuns.rejectedCount,
      })
      .from(importRuns)
      .where(eq(importRuns.id, runId))
      .limit(1);
    if (!currentRun) throw new Error('IPEDS program import run disappeared before finalization.');
    assertRunCounters(currentRun, exhausted ? programRows : undefined);
    await connection.db
      .update(importRuns)
      .set({
        checkpoint: checkpointFor(checkpointMetadata, sourceRow),
        status: exhausted ? 'completed' : 'paused',
        finishedAt: exhausted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));
    console.log(
      exhausted
        ? `IPEDS programs complete: ${currentRun.insertedCount} inserted, ${currentRun.updatedCount} already present, ${currentRun.skippedCount} identities skipped.`
        : `IPEDS program batch paused cleanly at source row ${sourceRow}; rerun the same command to resume.`,
    );
  } catch (error) {
    if (runId) {
      try {
        await connection.db
          .update(importRuns)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } catch (statusError) {
        console.error('Failed to record the IPEDS program import error state:', statusError);
      }
    }
    throw error;
  } finally {
    try {
      if (lockHeld) {
        await connection.db.execute(sql`
          select pg_advisory_unlock(hashtextextended(${importLockName}, 0))
        `);
      }
    } catch (unlockError) {
      console.error('Failed to release the IPEDS program import lock:', unlockError);
    } finally {
      await connection.close();
    }
  }
};

await run();

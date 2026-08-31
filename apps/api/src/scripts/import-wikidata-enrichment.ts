import '../load-env.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { createDb, type Database } from '../db/client.js';
import {
  importRejections,
  importRuns,
  institutionIdentifiers,
  sources,
  universities,
} from '../db/schema.js';

/**
 * Fill missing high-level facts from a reviewed Wikidata snapshot.
 *
 * This is deliberately an enrichment importer, not an identity importer:
 * every row must match an existing institution_identifiers row with the exact
 * Wikidata QID. It never creates a university and never replaces a non-null
 * student count, founding year, or official website. The source row points to
 * the exact Wikidata entity used for the update.
 *
 * Usage:
 *   pnpm --filter @urd/api import:wikidata-enrichment [csv] [record-limit]
 *   pnpm --filter @urd/api import:wikidata-enrichment [csv] --dry-run
 *
 * The record limit is a source-row limit for this invocation. A checkpoint is
 * committed after every batch, so rerunning the same command resumes safely.
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDataDirectory = resolve(scriptDirectory, '../../../../data/sources');
const defaultCsvPath = resolve(repositoryDataDirectory, 'wikidata-institution-facts-20260831.csv');
const sourceManifestPath = resolve(repositoryDataDirectory, 'wikidata-enrichment-artifacts.json');

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
const csvPath = resolve(positionalArguments[0] ?? defaultCsvPath);
const requestedLimitArgument = positionalArguments[1];
const requestedLimit =
  requestedLimitArgument === undefined ? Number.MAX_SAFE_INTEGER : Number(requestedLimitArgument);
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('record-limit must be a positive base-10 safe integer.');
}

const provider = 'wikidata-enrichment';
const datasetVersion = basename(csvPath).replace(/\.csv$/iu, '');
const chunkSize = 250;
const importLockName = 'uniscope:wikidata-enrichment-import:v1';
const expectedColumns = [
  'wikidata',
  'studentCount',
  'studentYear',
  'establishedYear',
  'officialWebsite',
] as const;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const reviewedArtifactSchema = z.object({
  datasetFile: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetRows: z.number().int().positive(),
  sourceUrl: z.url().startsWith('https://'),
  publisher: z.string().min(1),
  retrievedAt: z.iso.datetime(),
  notes: z.string().min(1),
});
const sourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifacts: z.array(reviewedArtifactSchema).min(1),
});
type ReviewedArtifact = z.infer<typeof reviewedArtifactSchema>;

const rowSchema = z.object({
  wikidata: z.string().regex(/^Q\d+$/u),
  studentCount: z.string(),
  studentYear: z.string(),
  establishedYear: z.string(),
  officialWebsite: z.string(),
});
type Rejection = {
  sourceRow: number;
  externalId: string | null;
  reason: string;
  payloadHash: string;
  payload: unknown;
};
type Candidate = {
  sourceRow: number;
  wikidataId: string;
  studentCount: number | null;
  studentYear: number | null;
  establishedYear: number | null;
  officialWebsite: string | null;
};
type CheckpointMetadata = {
  schemaVersion: 1;
  sourceFile: string;
  sourceSha256: string;
  sourceRows: number;
  sourceUrl: string;
  sourceRetrievedAt: string;
  sourceRow: number;
};

const checkpointSchema = z.object({
  schemaVersion: z.literal(1),
  sourceFile: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRows: z.number().int().nonnegative(),
  sourceUrl: z.url().startsWith('https://'),
  sourceRetrievedAt: z.iso.datetime(),
  sourceRow: z.number().int().nonnegative(),
});

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const payloadHash = (payload: unknown) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const assertCsvColumns = (columns: string[]) => {
  const duplicateColumns = [
    ...new Set(columns.filter((column, index) => columns.indexOf(column) !== index)),
  ];
  if (duplicateColumns.length) {
    throw new Error(`Wikidata artifact has duplicate columns: ${duplicateColumns.join(', ')}`);
  }
  if (
    columns.length !== expectedColumns.length ||
    columns.some((column, index) => column !== expectedColumns[index])
  ) {
    const mismatchIndex = columns.findIndex((column, index) => column !== expectedColumns[index]);
    const position = mismatchIndex < 0 ? columns.length : mismatchIndex;
    throw new Error(
      `Wikidata artifact schema mismatch at column ${position + 1}: expected ${expectedColumns[position] ?? '(end of file)'}, received ${columns[position] ?? '(end of file)'}.`,
    );
  }
};

const parseOptionalInteger = (
  rawValue: string,
  field: string,
  minimum: number,
  maximum: number,
) => {
  const raw = rawValue.trim();
  if (!raw) return null;
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${field} must be a positive base-10 integer or blank.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is outside the supported range ${minimum}-${maximum}.`);
  }
  return value;
};

const parseOfficialWebsite = (rawValue: string) => {
  const raw = rawValue.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('officialWebsite must be a valid HTTPS URL or blank.');
  }
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error('officialWebsite must use HTTPS.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
};

const toCandidate = (
  raw: Record<string, unknown>,
  sourceRow: number,
): { candidate: Candidate } | { rejection: Rejection } => {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      rejection: {
        sourceRow,
        externalId: typeof raw.wikidata === 'string' ? raw.wikidata : null,
        reason: z.prettifyError(parsed.error),
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }
  try {
    const row = parsed.data;
    return {
      candidate: {
        sourceRow,
        wikidataId: row.wikidata,
        studentCount: parseOptionalInteger(row.studentCount, 'studentCount', 1, 2_147_483_647),
        studentYear: parseOptionalInteger(row.studentYear, 'studentYear', 1000, 2100),
        establishedYear: parseOptionalInteger(row.establishedYear, 'establishedYear', 1000, 2100),
        officialWebsite: parseOfficialWebsite(row.officialWebsite),
      },
    };
  } catch (error) {
    return {
      rejection: {
        sourceRow,
        externalId: parsed.data.wikidata,
        reason: error instanceof Error ? error.message : String(error),
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }
};

const inspectArtifact = async () => {
  let columns: string[] = [];
  const parser = createReadStream(csvPath).pipe(
    parse({
      columns: (header: string[]) => {
        columns = header;
        return header;
      },
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }),
  );
  const qids = new Set<string>();
  let rowCount = 0;
  let usableRows = 0;
  for await (const value of parser) {
    rowCount += 1;
    const raw = value as Record<string, unknown>;
    const transformed = toCandidate(raw, rowCount);
    if ('rejection' in transformed) {
      throw new Error(`Invalid Wikidata artifact row ${rowCount}: ${transformed.rejection.reason}`);
    }
    const qid = transformed.candidate.wikidataId;
    if (qids.has(qid)) throw new Error(`Duplicate Wikidata QID in artifact: ${qid}.`);
    qids.add(qid);
    if (
      transformed.candidate.studentCount !== null ||
      transformed.candidate.establishedYear !== null ||
      transformed.candidate.officialWebsite !== null
    ) {
      usableRows += 1;
    }
  }
  assertCsvColumns(columns);
  if (!rowCount) throw new Error('Wikidata artifact contains no records.');
  return { rowCount, usableRows };
};

const loadReviewedArtifact = async (): Promise<ReviewedArtifact> => {
  const raw = await readFile(sourceManifestPath, 'utf8');
  const parsed = sourceManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error(`Invalid Wikidata enrichment manifest: ${z.prettifyError(parsed.error)}`);
  }
  const artifact = parsed.data.artifacts.find((item) => item.datasetFile === basename(csvPath));
  if (!artifact) {
    throw new Error(
      `Wikidata artifact is not reviewed in ${basename(sourceManifestPath)}: ${basename(csvPath)}`,
    );
  }
  return artifact;
};

const existingRunFor = async (db: Database, artifactHash: string) => {
  const [run] = await db
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
  return run;
};

const getCheckpoint = (
  value: unknown,
  metadata: Omit<CheckpointMetadata, 'sourceRow'>,
  maximumSourceRow: number,
): CheckpointMetadata => {
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Existing Wikidata run has an invalid checkpoint: ${z.prettifyError(parsed.error)}`,
    );
  }
  const checkpoint = parsed.data;
  for (const key of [
    'schemaVersion',
    'sourceFile',
    'sourceSha256',
    'sourceRows',
    'sourceUrl',
    'sourceRetrievedAt',
  ] as const) {
    if (checkpoint[key] !== metadata[key]) {
      throw new Error(
        `Existing Wikidata checkpoint metadata does not match the reviewed artifact (${key}).`,
      );
    }
  }
  if (checkpoint.sourceRows !== maximumSourceRow || checkpoint.sourceRow > maximumSourceRow) {
    throw new Error(
      'Existing Wikidata run has a source-row checkpoint outside the reviewed artifact.',
    );
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
      `Wikidata import ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expectedProcessedCount !== undefined && run.processedCount !== expectedProcessedCount) {
    throw new Error(
      `Wikidata import is incomplete: processed ${run.processedCount}, expected ${expectedProcessedCount}.`,
    );
  }
};

const sourceKey = (universityId: string, wikidataId: string) => `${universityId}\t${wikidataId}`;

const upsertSourceRows = async (
  tx: Tx,
  candidates: Array<{ universityId: string; wikidataId: string }>,
  artifact: ReviewedArtifact,
  runId: string,
) => {
  const rows = candidates.map((candidate) => ({
    universityId: candidate.universityId,
    title: `Wikidata institution facts (${datasetVersion})`,
    url: `https://www.wikidata.org/entity/${candidate.wikidataId}`,
    category: 'independent' as const,
    publisher: artifact.publisher,
    datasetVersion,
    importRunId: runId,
    verifiedAt: new Date(artifact.retrievedAt),
  }));
  if (!rows.length) return new Map<string, string>();
  const inserted = await tx
    .insert(sources)
    .values(rows)
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
    })
    .returning({ id: sources.id, universityId: sources.universityId, url: sources.url });
  return new Map(
    inserted.map((row) => [
      sourceKey(row.universityId, row.url.split('/').filter(Boolean).at(-1) ?? ''),
      row.id,
    ]),
  );
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  candidates: Candidate[],
  preSkipped: number,
  rejections: Rejection[],
  checkpointRow: number,
  checkpointMetadata: Omit<CheckpointMetadata, 'sourceRow'>,
  artifact: ReviewedArtifact,
) => {
  const qids = candidates.map((candidate) => candidate.wikidataId);
  const identifierRows = qids.length
    ? await tx
        .select({
          externalId: institutionIdentifiers.externalId,
          universityId: institutionIdentifiers.universityId,
        })
        .from(institutionIdentifiers)
        .where(
          and(
            eq(institutionIdentifiers.provider, 'wikidata'),
            inArray(institutionIdentifiers.externalId, qids),
          ),
        )
    : [];
  const universityIdByQid = new Map(
    identifierRows.map((row) => [row.externalId, row.universityId]),
  );
  const universityIds = [...new Set(identifierRows.map((row) => row.universityId))];
  const currentRows = universityIds.length
    ? await tx
        .select({
          id: universities.id,
          studentCount: universities.studentCount,
          establishedYear: universities.establishedYear,
          officialWebsite: universities.officialWebsite,
        })
        .from(universities)
        .where(inArray(universities.id, universityIds))
    : [];
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  type Update = { candidate: Candidate; universityId: string; patch: Record<string, unknown> };
  const updates: Update[] = [];
  let skipped = preSkipped;
  for (const candidate of candidates) {
    const universityId = universityIdByQid.get(candidate.wikidataId);
    const current = universityId ? currentById.get(universityId) : undefined;
    if (!universityId || !current) {
      skipped += 1;
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (current.studentCount === null && candidate.studentCount !== null) {
      patch.studentCount = candidate.studentCount;
    }
    if (current.establishedYear === null && candidate.establishedYear !== null) {
      patch.establishedYear = candidate.establishedYear;
    }
    if (current.officialWebsite === null && candidate.officialWebsite !== null) {
      patch.officialWebsite = candidate.officialWebsite;
    }
    if (!Object.keys(patch).length) {
      skipped += 1;
      continue;
    }
    updates.push({ candidate, universityId, patch });
  }

  const sourceByKey = await upsertSourceRows(
    tx,
    updates.map((item) => ({
      universityId: item.universityId,
      wikidataId: item.candidate.wikidataId,
    })),
    artifact,
    runId,
  );
  for (const update of updates) {
    const sourceId = sourceByKey.get(sourceKey(update.universityId, update.candidate.wikidataId));
    if (!sourceId) {
      throw new Error(`Failed to create Wikidata source for ${update.candidate.wikidataId}.`);
    }
    // The source row is the auditable evidence. The values themselves live on
    // universities for the small summary cards and are guarded by null checks
    // both here and in the transaction's current-row snapshot above.
    await tx
      .update(universities)
      .set({ ...update.patch, updatedAt: new Date() })
      .where(eq(universities.id, update.universityId));
    void sourceId;
  }
  if (rejections.length) {
    await tx.insert(importRejections).values(
      rejections.map((item) => ({
        runId,
        sourceRow: item.sourceRow,
        externalId: item.externalId,
        reason: item.reason,
        payloadHash: item.payloadHash,
        payload: item.payload,
      })),
    );
  }
  const processedDelta =
    candidates.length + preSkipped + (skipped - preSkipped) + rejections.length;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpointMetadata, sourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${processedDelta}`,
      updatedCount: sql`${importRuns.updatedCount} + ${updates.length}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skipped}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${rejections.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
  return { processedDelta, updatedCount: updates.length, skippedCount: skipped };
};

const run = async () => {
  const [artifact, artifactHash, inspection] = await Promise.all([
    loadReviewedArtifact(),
    sha256File(csvPath),
    inspectArtifact(),
  ]);
  const problems = [
    artifactHash === artifact.datasetSha256
      ? null
      : 'Wikidata SHA-256 does not match the reviewed manifest',
    inspection.rowCount === artifact.datasetRows
      ? null
      : `Wikidata row count is ${inspection.rowCount}, expected ${artifact.datasetRows}`,
  ].filter((problem): problem is string => problem !== null);
  if (problems.length)
    throw new Error(`Refusing unreviewed Wikidata artifact: ${problems.join('; ')}`);
  const metadata: Omit<CheckpointMetadata, 'sourceRow'> = {
    schemaVersion: 1,
    sourceFile: basename(csvPath),
    sourceSha256: artifactHash,
    sourceRows: inspection.rowCount,
    sourceUrl: artifact.sourceUrl,
    sourceRetrievedAt: artifact.retrievedAt,
  };
  if (dryRun) {
    console.log(
      `Wikidata artifact ${datasetVersion} is valid: ${inspection.rowCount} rows; ${inspection.usableRows} contain at least one enrichment value; SHA-256 ${artifactHash}.`,
    );
    return;
  }

  const connection = createDb(getConfig(), { max: 1 });
  let runId: string | undefined;
  let lockHeld = false;
  try {
    const lockResult = await connection.db.execute(sql`
      select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
    `);
    const lockRow = lockResult[0] as { acquired?: unknown } | undefined;
    if (lockRow?.acquired !== true)
      throw new Error('Another Wikidata enrichment import is already running.');
    lockHeld = true;

    const existingRun = await existingRunFor(connection.db, artifactHash);
    let checkpoint: CheckpointMetadata;
    if (existingRun) {
      assertRunCounters(existingRun);
      checkpoint = getCheckpoint(existingRun.checkpoint, metadata, inspection.rowCount);
      if (existingRun.status === 'completed') {
        if (checkpoint.sourceRow !== inspection.rowCount) {
          throw new Error('Completed Wikidata run has an incomplete source-row checkpoint.');
        }
        assertRunCounters(existingRun, inspection.rowCount);
        console.log(`Wikidata enrichment ${datasetVersion} is already fully imported.`);
        return;
      }
      runId = existingRun.id;
      await connection.db
        .update(importRuns)
        .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
    } else {
      checkpoint = { ...metadata, sourceRow: 0 };
      const [createdRun] = await connection.db
        .insert(importRuns)
        .values({
          provider,
          datasetVersion,
          artifactHash,
          status: 'running',
          checkpoint,
        })
        .returning({ id: importRuns.id });
      if (!createdRun) throw new Error('Failed to create the Wikidata enrichment run.');
      runId = createdRun.id;
    }

    const resumeAfterRow = checkpoint.sourceRow;
    const parser = createReadStream(csvPath).pipe(
      parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }),
    );
    let sourceRow = 0;
    let consumedRows = 0;
    let candidates: Candidate[] = [];
    let rejections: Rejection[] = [];
    let preSkipped = 0;
    let exhausted = true;
    let updatedThisRun = 0;
    let skippedThisRun = 0;

    const flush = async () => {
      if (!runId || (!candidates.length && !rejections.length && !preSkipped)) return;
      const checkpointRow = Math.max(
        sourceRow,
        ...candidates.map((item) => item.sourceRow),
        ...rejections.map((item) => item.sourceRow),
      );
      const result = await connection.db.transaction((tx) =>
        flushChunk(
          tx,
          runId as string,
          candidates,
          preSkipped,
          rejections,
          checkpointRow,
          metadata,
          artifact,
        ),
      );
      updatedThisRun += result.updatedCount;
      skippedThisRun += result.skippedCount;
      candidates = [];
      rejections = [];
      preSkipped = 0;
      console.log(
        `Wikidata batch progress: ${updatedThisRun} fields updated, ${skippedThisRun} rows skipped this run.`,
      );
    };

    for await (const value of parser) {
      sourceRow += 1;
      if (sourceRow <= resumeAfterRow) continue;
      consumedRows += 1;
      const raw = value as Record<string, unknown>;
      const transformed = toCandidate(raw, sourceRow);
      if ('candidate' in transformed) {
        const candidate = transformed.candidate;
        if (
          candidate.studentCount === null &&
          candidate.establishedYear === null &&
          candidate.officialWebsite === null
        ) {
          preSkipped += 1;
        } else {
          candidates.push(candidate);
        }
      } else {
        rejections.push(transformed.rejection);
      }
      if (consumedRows >= requestedLimit) {
        exhausted = sourceRow === inspection.rowCount;
        await flush();
        break;
      }
      if (
        candidates.length >= chunkSize ||
        rejections.length >= chunkSize ||
        preSkipped >= chunkSize
      ) {
        await flush();
      }
    }
    if (consumedRows < requestedLimit && sourceRow === inspection.rowCount) exhausted = true;
    if (sourceRow === inspection.rowCount) await flush();
    const [currentRun] = await connection.db
      .select({
        processedCount: importRuns.processedCount,
        insertedCount: importRuns.insertedCount,
        updatedCount: importRuns.updatedCount,
        skippedCount: importRuns.skippedCount,
        rejectedCount: importRuns.rejectedCount,
      })
      .from(importRuns)
      .where(eq(importRuns.id, runId));
    if (!currentRun) throw new Error('Wikidata import run disappeared before finalization.');
    assertRunCounters(currentRun, exhausted ? inspection.rowCount : undefined);
    await connection.db
      .update(importRuns)
      .set({
        checkpoint: { ...metadata, sourceRow },
        status: exhausted ? 'completed' : 'paused',
        finishedAt: exhausted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));
    console.log(
      exhausted
        ? `Wikidata enrichment exhausted: ${updatedThisRun} rows updated, ${skippedThisRun} rows skipped this run.`
        : `Wikidata enrichment paused at source row ${sourceRow}; rerun the same command to resume.`,
    );
  } catch (error) {
    if (runId) {
      try {
        await connection.db
          .update(importRuns)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } catch (statusError) {
        console.error('Failed to record the Wikidata import error state:', statusError);
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
      console.error('Failed to release the Wikidata import lock:', unlockError);
    } finally {
      await connection.close();
    }
  }
};

await run();

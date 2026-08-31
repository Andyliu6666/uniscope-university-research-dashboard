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
import { importRejections, importRuns, institutionIdentifiers, sources } from '../db/schema.js';

/**
 * Add reviewed ROR-to-Wikidata links to existing institution identities.
 *
 * This importer only creates identifiers and source rows. It never creates a
 * university and never guesses an identity. The companion
 * import-wikidata-enrichment importer applies the facts after this link exists.
 * A checkpoint is committed after each batch, so rerunning the same command is
 * safe after an interruption.
 *
 * Usage:
 *   pnpm --filter @urd/api import:wikidata-ror-crosswalk [csv] [record-limit]
 *   pnpm --filter @urd/api import:wikidata-ror-crosswalk [csv] --dry-run
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDataDirectory = resolve(scriptDirectory, '../../../../data/sources');
const defaultCsvPath = resolve(
  repositoryDataDirectory,
  'wikidata-ror-institution-facts-20260831.csv',
);
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

const provider = 'wikidata-ror-crosswalk';
const datasetVersion = basename(csvPath).replace(/\.csv$/iu, '');
const chunkSize = 500;
const importLockName = 'uniscope:wikidata-ror-crosswalk-import:v1';
const expectedColumns = [
  'ror',
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
  ror: z.string().regex(/^[a-z0-9]{9}$/u),
  wikidata: z.string().regex(/^Q\d+$/u),
  studentCount: z.string(),
  studentYear: z.string(),
  establishedYear: z.string(),
  officialWebsite: z.string(),
});
type Candidate = {
  sourceRow: number;
  rorId: string;
  wikidataId: string;
};
type Rejection = {
  sourceRow: number;
  externalId: string | null;
  reason: string;
  payloadHash: string;
  payload: unknown;
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
    throw new Error(`Wikidata ROR artifact has duplicate columns: ${duplicateColumns.join(', ')}`);
  }
  if (
    columns.length !== expectedColumns.length ||
    columns.some((column, index) => column !== expectedColumns[index])
  ) {
    const mismatchIndex = columns.findIndex((column, index) => column !== expectedColumns[index]);
    const position = mismatchIndex < 0 ? columns.length : mismatchIndex;
    throw new Error(
      `Wikidata ROR artifact schema mismatch at column ${position + 1}: expected ${expectedColumns[position] ?? '(end of file)'}, received ${columns[position] ?? '(end of file)'}.`,
    );
  }
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
        externalId: typeof raw.ror === 'string' ? raw.ror : null,
        reason: z.prettifyError(parsed.error),
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }
  return {
    candidate: {
      sourceRow,
      rorId: parsed.data.ror,
      wikidataId: parsed.data.wikidata,
    },
  };
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
  const rorIds = new Set<string>();
  const wikidataIds = new Set<string>();
  let rowCount = 0;
  for await (const value of parser) {
    rowCount += 1;
    const transformed = toCandidate(value as Record<string, unknown>, rowCount);
    if ('rejection' in transformed) {
      throw new Error(
        `Invalid Wikidata ROR artifact row ${rowCount}: ${transformed.rejection.reason}`,
      );
    }
    if (rorIds.has(transformed.candidate.rorId)) {
      throw new Error(`Duplicate ROR identifier in artifact: ${transformed.candidate.rorId}.`);
    }
    if (wikidataIds.has(transformed.candidate.wikidataId)) {
      throw new Error(`Duplicate Wikidata QID in artifact: ${transformed.candidate.wikidataId}.`);
    }
    rorIds.add(transformed.candidate.rorId);
    wikidataIds.add(transformed.candidate.wikidataId);
  }
  assertCsvColumns(columns);
  if (!rowCount) throw new Error('Wikidata ROR artifact contains no records.');
  return { rowCount };
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
      `Wikidata ROR artifact is not reviewed in ${basename(sourceManifestPath)}: ${basename(csvPath)}`,
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
      `Existing Wikidata ROR crosswalk run has an invalid checkpoint: ${z.prettifyError(parsed.error)}`,
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
        `Existing crosswalk checkpoint metadata does not match the reviewed artifact (${key}).`,
      );
    }
  }
  if (checkpoint.sourceRows !== maximumSourceRow || checkpoint.sourceRow > maximumSourceRow) {
    throw new Error(
      'Existing crosswalk run has a source-row checkpoint outside the reviewed artifact.',
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
      `Wikidata ROR crosswalk ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expectedProcessedCount !== undefined && run.processedCount !== expectedProcessedCount) {
    throw new Error(
      `Wikidata ROR crosswalk is incomplete: processed ${run.processedCount}, expected ${expectedProcessedCount}.`,
    );
  }
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  candidates: Candidate[],
  rejections: Rejection[],
  checkpointRow: number,
  checkpointMetadata: Omit<CheckpointMetadata, 'sourceRow'>,
  artifact: ReviewedArtifact,
) => {
  const rorIds = candidates.map((candidate) => candidate.rorId);
  const qids = candidates.map((candidate) => candidate.wikidataId);
  const [rorRows, qidRows] = await Promise.all([
    rorIds.length
      ? tx
          .select({
            externalId: institutionIdentifiers.externalId,
            universityId: institutionIdentifiers.universityId,
          })
          .from(institutionIdentifiers)
          .where(
            and(
              eq(institutionIdentifiers.provider, 'ror'),
              inArray(institutionIdentifiers.externalId, rorIds),
            ),
          )
      : Promise.resolve([]),
    qids.length
      ? tx
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
      : Promise.resolve([]),
  ]);
  const universityIdByRor = new Map(rorRows.map((row) => [row.externalId, row.universityId]));
  const universityIdByQid = new Map(qidRows.map((row) => [row.externalId, row.universityId]));
  const accepted: Array<{ candidate: Candidate; universityId: string }> = [];
  const identityRejections: Rejection[] = [];
  let missingRor = 0;
  for (const candidate of candidates) {
    const universityId = universityIdByRor.get(candidate.rorId);
    if (!universityId) {
      missingRor += 1;
      continue;
    }
    const existingUniversityId = universityIdByQid.get(candidate.wikidataId);
    if (existingUniversityId && existingUniversityId !== universityId) {
      identityRejections.push({
        sourceRow: candidate.sourceRow,
        externalId: candidate.rorId,
        reason:
          'Identity conflict: existing Wikidata QID resolves to a different university profile.',
        payloadHash: payloadHash(candidate),
        payload: candidate,
      });
      continue;
    }
    accepted.push({ candidate, universityId });
  }

  const newIdentifiers = accepted.filter(
    (item) => !universityIdByQid.has(item.candidate.wikidataId),
  );
  if (newIdentifiers.length) {
    const seenAt = new Date();
    await tx
      .insert(institutionIdentifiers)
      .values(
        newIdentifiers.map(({ candidate, universityId }) => ({
          universityId,
          provider: 'wikidata',
          externalId: candidate.wikidataId,
          sourceModifiedAt: new Date(artifact.retrievedAt),
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        })),
      )
      .onConflictDoNothing();
  }

  if (accepted.length) {
    await tx
      .insert(sources)
      .values(
        accepted.map(({ candidate, universityId }) => ({
          universityId,
          title: `Wikidata institution facts (${datasetVersion})`,
          url: `https://www.wikidata.org/entity/${candidate.wikidataId}`,
          category: 'independent' as const,
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
  }

  const allRejections = [...rejections, ...identityRejections];
  if (allRejections.length) {
    await tx.insert(importRejections).values(
      allRejections.map((item) => ({
        runId,
        sourceRow: item.sourceRow,
        externalId: item.externalId,
        reason: item.reason,
        payloadHash: item.payloadHash,
        payload: item.payload,
      })),
    );
  }

  const insertedCount = newIdentifiers.length;
  const rejectedCount = allRejections.length;
  const skippedCount = accepted.length - insertedCount + missingRor;
  const processedDelta = candidates.length + rejections.length;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpointMetadata, sourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${processedDelta}`,
      insertedCount: sql`${importRuns.insertedCount} + ${insertedCount}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skippedCount}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${rejectedCount}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
  return { insertedCount, skippedCount, rejectedCount };
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
      : 'Wikidata ROR SHA-256 does not match the reviewed manifest',
    inspection.rowCount === artifact.datasetRows
      ? null
      : `Wikidata ROR row count is ${inspection.rowCount}, expected ${artifact.datasetRows}`,
  ].filter((problem): problem is string => problem !== null);
  if (problems.length)
    throw new Error(`Refusing unreviewed Wikidata ROR artifact: ${problems.join('; ')}`);
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
      `Wikidata ROR artifact ${datasetVersion} is valid: ${inspection.rowCount} one-to-one rows; SHA-256 ${artifactHash}.`,
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
    if (lockRow?.acquired !== true) {
      throw new Error('Another Wikidata ROR crosswalk import is already running.');
    }
    lockHeld = true;

    const existingRun = await existingRunFor(connection.db, artifactHash);
    let checkpoint: CheckpointMetadata;
    if (existingRun) {
      assertRunCounters(existingRun);
      checkpoint = getCheckpoint(existingRun.checkpoint, metadata, inspection.rowCount);
      if (existingRun.status === 'completed') {
        if (checkpoint.sourceRow !== inspection.rowCount) {
          throw new Error('Completed crosswalk run has an incomplete source-row checkpoint.');
        }
        assertRunCounters(existingRun, inspection.rowCount);
        console.log(`Wikidata ROR crosswalk ${datasetVersion} is already fully imported.`);
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
      if (!createdRun) throw new Error('Failed to create the Wikidata ROR crosswalk run.');
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
    let exhausted = true;
    let insertedThisRun = 0;
    let skippedThisRun = 0;

    const flush = async () => {
      if (!runId || (!candidates.length && !rejections.length)) return;
      const checkpointRow = Math.max(
        sourceRow,
        ...candidates.map((item) => item.sourceRow),
        ...rejections.map((item) => item.sourceRow),
      );
      const result = await connection.db.transaction((tx) =>
        flushChunk(tx, runId as string, candidates, rejections, checkpointRow, metadata, artifact),
      );
      insertedThisRun += result.insertedCount;
      skippedThisRun += result.skippedCount;
      candidates = [];
      rejections = [];
      console.log(
        `Wikidata ROR crosswalk progress: ${insertedThisRun} identifiers added, ${skippedThisRun} rows skipped this run.`,
      );
    };

    for await (const value of parser) {
      sourceRow += 1;
      if (sourceRow <= resumeAfterRow) continue;
      consumedRows += 1;
      const transformed = toCandidate(value as Record<string, unknown>, sourceRow);
      if ('candidate' in transformed) candidates.push(transformed.candidate);
      else rejections.push(transformed.rejection);
      if (consumedRows >= requestedLimit) {
        exhausted = sourceRow === inspection.rowCount;
        await flush();
        break;
      }
      if (candidates.length >= chunkSize || rejections.length >= chunkSize) await flush();
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
    if (!currentRun) throw new Error('Wikidata ROR crosswalk run disappeared before finalization.');
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
        ? `Wikidata ROR crosswalk exhausted: ${insertedThisRun} identifiers added, ${skippedThisRun} rows skipped this run.`
        : `Wikidata ROR crosswalk paused at source row ${sourceRow}; rerun the same command to resume.`,
    );
  } catch (error) {
    if (runId) {
      try {
        await connection.db
          .update(importRuns)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } catch (statusError) {
        console.error('Failed to record the Wikidata ROR crosswalk error state:', statusError);
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
      console.error('Failed to release the Wikidata ROR crosswalk lock:', unlockError);
    } finally {
      await connection.close();
    }
  }
};

await run();

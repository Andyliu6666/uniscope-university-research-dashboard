import '../load-env.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { createDb, type Database } from '../db/client.js';
import {
  importRejections,
  importRuns,
  institutionIdentifiers,
  researchProfiles,
  sources,
} from '../db/schema.js';
import {
  openAlexResearchManifestSchema,
  openAlexResearchRowSchema,
  sourceTimestamp,
  type OpenAlexResearchManifest,
  type OpenAlexResearchRow,
} from './openalex-research-format.js';
import { assertProviderIdentifierOwnership } from './institution-identifier-ownership.js';

/**
 * Import independent institution-level research metrics from a reviewed
 * OpenAlex snapshot. Every match requires an exact, existing ROR identifier;
 * names, countries, and website domains are never identity keys.
 *
 * Usage:
 *   pnpm --filter @urd/api import:openalex-research [artifact.jsonl] [record-limit]
 *   pnpm --filter @urd/api import:openalex-research [artifact.jsonl] --dry-run
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(scriptDirectory, '../../../../data/sources');
const defaultArtifactPath = resolve(sourceDirectory, 'openalex-institutions-20260831.jsonl');

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
if (positionalArguments.length > 2) {
  throw new Error('Usage: import:openalex-research [artifact.jsonl] [record-limit] [--dry-run]');
}
const artifactPath = resolve(positionalArguments[0] ?? defaultArtifactPath);
if (!artifactPath.endsWith('.jsonl')) throw new Error('OpenAlex artifact must be a .jsonl file.');
const manifestPath = artifactPath.replace(/\.jsonl$/u, '.manifest.json');
const requestedLimitArgument = positionalArguments[1];
const requestedLimit =
  requestedLimitArgument === undefined ? Number.MAX_SAFE_INTEGER : Number(requestedLimitArgument);
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('record-limit must be a positive base-10 safe integer.');
}

const provider = 'openalex-research';
const chunkSize = 250;
const importLockName = 'uniscope:openalex-research-import:v1';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceFile: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceRows: z.number().int().positive(),
    sourceUrl: z.url().startsWith('https://api.openalex.org/institutions'),
    sourceRetrievedAt: z.iso.datetime(),
    sourceRow: z.number().int().nonnegative(),
  })
  .strict();
type Checkpoint = z.infer<typeof checkpointSchema>;

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const payloadHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const readJsonLines = async function* (file: string) {
  const input = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of input) {
    lineNumber += 1;
    if (!line.trim()) throw new Error(`Blank line in OpenAlex artifact at line ${lineNumber}.`);
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`Invalid JSON in OpenAlex artifact at line ${lineNumber}.`, {
        cause: error,
      });
    }
    const parsed = openAlexResearchRowSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Invalid OpenAlex artifact line ${lineNumber}: ${z.prettifyError(parsed.error)}`,
      );
    }
    yield { lineNumber, row: parsed.data };
  }
};

const loadManifest = async (): Promise<OpenAlexResearchManifest> => {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Cannot read OpenAlex manifest ${manifestPath}.`, { cause: error });
  }
  const parsed = openAlexResearchManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid OpenAlex manifest: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.artifactFile !== basename(artifactPath)) {
    throw new Error(
      `OpenAlex manifest reviews ${parsed.data.artifactFile}, not ${basename(artifactPath)}.`,
    );
  }
  if (parsed.data.sourceRecordCount !== parsed.data.artifactRows) {
    throw new Error('OpenAlex source and artifact row counts do not match.');
  }
  const sourceUrl = new URL(parsed.data.sourceUrl);
  if (
    sourceUrl.searchParams.get('filter') !== 'type:education,has_ror:true' ||
    sourceUrl.searchParams.get('cursor') !== '*'
  ) {
    throw new Error('OpenAlex manifest must describe the reviewed education + ROR cursor query.');
  }
  return parsed.data;
};

const inspectArtifact = async (manifest: OpenAlexResearchManifest, artifactHash: string) => {
  if (artifactHash !== manifest.artifactSha256) {
    throw new Error(
      `OpenAlex artifact SHA-256 mismatch: expected ${manifest.artifactSha256}, received ${artifactHash}.`,
    );
  }
  const openAlexIds = new Set<string>();
  const rorIds = new Set<string>();
  let rows = 0;
  for await (const { row } of readJsonLines(artifactPath)) {
    rows += 1;
    if (openAlexIds.has(row.openAlexId)) {
      throw new Error(`Duplicate OpenAlex identifier ${row.openAlexId}.`);
    }
    if (rorIds.has(row.rorId)) throw new Error(`Duplicate OpenAlex ROR identifier ${row.rorId}.`);
    openAlexIds.add(row.openAlexId);
    rorIds.add(row.rorId);
  }
  if (rows !== manifest.artifactRows) {
    throw new Error(
      `OpenAlex artifact row mismatch: expected ${manifest.artifactRows}, received ${rows}.`,
    );
  }
};

const existingRunFor = async (db: Database, version: string, hash: string) => {
  const [run] = await db
    .select()
    .from(importRuns)
    .where(
      and(
        eq(importRuns.provider, provider),
        eq(importRuns.datasetVersion, version),
        eq(importRuns.artifactHash, hash),
      ),
    )
    .limit(1);
  return run;
};

const checkpointFor = (
  value: unknown,
  manifest: OpenAlexResearchManifest,
  hash: string,
): Checkpoint => {
  const initial: Checkpoint = {
    schemaVersion: 1,
    sourceFile: manifest.artifactFile,
    sourceSha256: hash,
    sourceRows: manifest.artifactRows,
    sourceUrl: manifest.sourceUrl,
    sourceRetrievedAt: manifest.retrievedAt,
    sourceRow: 0,
  };
  if (value === undefined) return initial;
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid existing OpenAlex checkpoint: ${z.prettifyError(parsed.error)}`);
  }
  const expected = { ...initial, sourceRow: parsed.data.sourceRow };
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) {
    throw new Error('Existing OpenAlex checkpoint does not match the reviewed artifact.');
  }
  if (parsed.data.sourceRow > manifest.artifactRows) {
    throw new Error('Existing OpenAlex checkpoint is past the artifact end.');
  }
  return parsed.data;
};

type MatchedRow = {
  lineNumber: number;
  row: OpenAlexResearchRow;
  universityId: string;
};

const rejectionFor = (runId: string, item: MatchedRow, reason: string) => ({
  runId,
  sourceRow: item.lineNumber,
  externalId: item.row.openAlexId,
  reason,
  payloadHash: payloadHash(item.row),
  payload: item.row,
});

const conflictReason = (
  item: MatchedRow,
  identifierByUniversity: Map<string, { universityId: string; externalId: string }>,
  identifierByOpenAlex: Map<string, { universityId: string; externalId: string }>,
  profileByUniversity: Map<string, { universityId: string; openAlexId: string }>,
  profileByOpenAlex: Map<string, { universityId: string; openAlexId: string }>,
) => {
  const identifierForUniversity = identifierByUniversity.get(item.universityId);
  const identifierForOpenAlex = identifierByOpenAlex.get(item.row.openAlexId);
  const profileForUniversity = profileByUniversity.get(item.universityId);
  const profileForOpenAlex = profileByOpenAlex.get(item.row.openAlexId);
  if (identifierForUniversity && identifierForUniversity.externalId !== item.row.openAlexId) {
    return `University already has OpenAlex identifier ${identifierForUniversity.externalId}.`;
  }
  if (identifierForOpenAlex && identifierForOpenAlex.universityId !== item.universityId) {
    return `OpenAlex identifier is attached to another university ${identifierForOpenAlex.universityId}.`;
  }
  if (profileForUniversity && profileForUniversity.openAlexId !== item.row.openAlexId) {
    return `University research profile already uses ${profileForUniversity.openAlexId}.`;
  }
  if (profileForOpenAlex && profileForOpenAlex.universityId !== item.universityId) {
    return `OpenAlex research profile belongs to another university ${profileForOpenAlex.universityId}.`;
  }
  return undefined;
};

const researchTableExists = async (db: Database) => {
  const result = await db.execute(sql`
    select to_regclass('public.research_profiles') is not null as present
  `);
  return (result[0] as { present?: unknown } | undefined)?.present === true;
};

const mutationCounts = async (db: Database, hasResearchTable: boolean) => {
  const [runRows, sourceRows, identifierRows, profileRows] = await Promise.all([
    db.select({ value: count() }).from(importRuns).where(eq(importRuns.provider, provider)),
    db.select({ value: count() }).from(sources).where(eq(sources.publisher, 'OpenAlex')),
    db
      .select({ value: count() })
      .from(institutionIdentifiers)
      .where(eq(institutionIdentifiers.provider, 'openalex')),
    hasResearchTable
      ? db.select({ value: count() }).from(researchProfiles)
      : Promise.resolve([{ value: 0 }]),
  ]);
  return {
    importRuns: runRows[0]?.value ?? 0,
    sources: sourceRows[0]?.value ?? 0,
    researchProfiles: profileRows[0]?.value ?? 0,
    openAlexIdentifiers: identifierRows[0]?.value ?? 0,
  };
};

const planDryRun = async (db: Database, hasResearchTable: boolean) => {
  const totals = { matched: 0, absent: 0, insert: 0, update: 0, conflicts: 0 };
  const plannedOpenAlexByUniversity = new Map<string, string>();
  let chunk: Array<{ lineNumber: number; row: OpenAlexResearchRow }> = [];

  const inspectChunk = async () => {
    if (chunk.length === 0) return;
    const items = chunk;
    chunk = [];
    const rorMatches = await db
      .select({
        rorId: institutionIdentifiers.externalId,
        universityId: institutionIdentifiers.universityId,
      })
      .from(institutionIdentifiers)
      .where(
        and(
          eq(institutionIdentifiers.provider, 'ror'),
          inArray(
            institutionIdentifiers.externalId,
            items.map(({ row }) => row.rorId),
          ),
        ),
      );
    const universityByRor = new Map(rorMatches.map((row) => [row.rorId, row.universityId]));
    const matched = items.flatMap((item) => {
      const universityId = universityByRor.get(item.row.rorId);
      return universityId ? [{ ...item, universityId }] : [];
    });
    totals.matched += matched.length;
    totals.absent += items.length - matched.length;
    if (matched.length === 0) return;
    const universityIds = [...new Set(matched.map((item) => item.universityId))];
    const openAlexIds = matched.map((item) => item.row.openAlexId);
    const identifierRows = await db
      .select({
        universityId: institutionIdentifiers.universityId,
        externalId: institutionIdentifiers.externalId,
      })
      .from(institutionIdentifiers)
      .where(
        and(
          eq(institutionIdentifiers.provider, 'openalex'),
          or(
            inArray(institutionIdentifiers.universityId, universityIds),
            inArray(institutionIdentifiers.externalId, openAlexIds),
          ),
        ),
      );
    const profileRows = hasResearchTable
      ? await db
          .select({
            universityId: researchProfiles.universityId,
            openAlexId: researchProfiles.openAlexId,
          })
          .from(researchProfiles)
          .where(
            or(
              inArray(researchProfiles.universityId, universityIds),
              inArray(researchProfiles.openAlexId, openAlexIds),
            ),
          )
      : [];
    const identifierByUniversity = new Map(identifierRows.map((row) => [row.universityId, row]));
    const identifierByOpenAlex = new Map(identifierRows.map((row) => [row.externalId, row]));
    const profileByUniversity = new Map(profileRows.map((row) => [row.universityId, row]));
    const profileByOpenAlex = new Map(profileRows.map((row) => [row.openAlexId, row]));
    for (const item of matched) {
      const reason = conflictReason(
        item,
        identifierByUniversity,
        identifierByOpenAlex,
        profileByUniversity,
        profileByOpenAlex,
      );
      const plannedOpenAlexId = plannedOpenAlexByUniversity.get(item.universityId);
      if (reason || (plannedOpenAlexId && plannedOpenAlexId !== item.row.openAlexId)) {
        totals.conflicts += 1;
      } else if (profileByUniversity.has(item.universityId)) {
        totals.update += 1;
        plannedOpenAlexByUniversity.set(item.universityId, item.row.openAlexId);
      } else {
        totals.insert += 1;
        plannedOpenAlexByUniversity.set(item.universityId, item.row.openAlexId);
      }
    }
  };

  for await (const item of readJsonLines(artifactPath)) {
    chunk.push(item);
    if (chunk.length >= chunkSize) await inspectChunk();
  }
  await inspectChunk();
  return totals;
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  items: Array<{ lineNumber: number; row: OpenAlexResearchRow }>,
  checkpoint: Omit<Checkpoint, 'sourceRow'>,
  manifest: OpenAlexResearchManifest,
) => {
  const rorIds = items.map(({ row }) => row.rorId);
  const rorMatches = await tx
    .select({
      rorId: institutionIdentifiers.externalId,
      universityId: institutionIdentifiers.universityId,
    })
    .from(institutionIdentifiers)
    .where(
      and(
        eq(institutionIdentifiers.provider, 'ror'),
        inArray(institutionIdentifiers.externalId, rorIds),
      ),
    );
  const universityByRor = new Map(rorMatches.map((row) => [row.rorId, row.universityId]));
  const matched = items.flatMap((item) => {
    const universityId = universityByRor.get(item.row.rorId);
    return universityId ? [{ ...item, universityId }] : [];
  });
  const universityIds = [...new Set(matched.map((item) => item.universityId))];
  const openAlexIds = matched.map((item) => item.row.openAlexId);
  const [identifierRows, profileRows] = universityIds.length
    ? await Promise.all([
        tx
          .select({
            universityId: institutionIdentifiers.universityId,
            externalId: institutionIdentifiers.externalId,
          })
          .from(institutionIdentifiers)
          .where(
            and(
              eq(institutionIdentifiers.provider, 'openalex'),
              or(
                inArray(institutionIdentifiers.universityId, universityIds),
                inArray(institutionIdentifiers.externalId, openAlexIds),
              ),
            ),
          ),
        tx
          .select({
            id: researchProfiles.id,
            universityId: researchProfiles.universityId,
            openAlexId: researchProfiles.openAlexId,
          })
          .from(researchProfiles)
          .where(
            or(
              inArray(researchProfiles.universityId, universityIds),
              inArray(researchProfiles.openAlexId, openAlexIds),
            ),
          ),
      ])
    : [[], []];
  const identifierByUniversity = new Map(identifierRows.map((row) => [row.universityId, row]));
  const identifierByOpenAlex = new Map(identifierRows.map((row) => [row.externalId, row]));
  const profileByUniversity = new Map(profileRows.map((row) => [row.universityId, row]));
  const profileByOpenAlex = new Map(profileRows.map((row) => [row.openAlexId, row]));
  const rejected: ReturnType<typeof rejectionFor>[] = [];
  const accepted: MatchedRow[] = [];
  const acceptedOpenAlexByUniversity = new Map<string, string>();

  for (const item of matched) {
    let reason = conflictReason(
      item,
      identifierByUniversity,
      identifierByOpenAlex,
      profileByUniversity,
      profileByOpenAlex,
    );
    const acceptedOpenAlexId = acceptedOpenAlexByUniversity.get(item.universityId);
    if (!reason && acceptedOpenAlexId && acceptedOpenAlexId !== item.row.openAlexId) {
      reason = `Multiple ROR identifiers in this batch resolve to university ${item.universityId}.`;
    }
    if (reason) rejected.push(rejectionFor(runId, item, reason));
    else {
      accepted.push(item);
      acceptedOpenAlexByUniversity.set(item.universityId, item.row.openAlexId);
    }
  }

  if (rejected.length) await tx.insert(importRejections).values(rejected);
  let inserted = 0;
  let updated = 0;
  const verifiedAt = new Date(manifest.retrievedAt);
  for (const item of accepted) {
    const openAlexUrl = `https://openalex.org/${item.row.openAlexId}`;
    const updatedAt = sourceTimestamp(item.row.sourceUpdatedAt);
    const [source] = await tx
      .insert(sources)
      .values({
        universityId: item.universityId,
        title: `OpenAlex research metrics (${manifest.datasetVersion})`,
        url: openAlexUrl,
        category: 'independent',
        publisher: 'OpenAlex',
        datasetVersion: manifest.datasetVersion,
        publishedAt: updatedAt,
        importRunId: runId,
        verifiedAt,
      })
      .onConflictDoUpdate({
        target: [sources.universityId, sources.url],
        set: {
          title: `OpenAlex research metrics (${manifest.datasetVersion})`,
          category: 'independent',
          publisher: 'OpenAlex',
          datasetVersion: manifest.datasetVersion,
          publishedAt: updatedAt,
          importRunId: runId,
          verifiedAt,
        },
      })
      .returning({ id: sources.id });
    if (!source) throw new Error(`Failed to store OpenAlex source ${item.row.openAlexId}.`);

    await tx
      .insert(institutionIdentifiers)
      .values({
        universityId: item.universityId,
        provider: 'openalex',
        externalId: item.row.openAlexId,
        sourceModifiedAt: updatedAt,
        lastSeenAt: verifiedAt,
      })
      .onConflictDoUpdate({
        target: [institutionIdentifiers.provider, institutionIdentifiers.externalId],
        set: { sourceModifiedAt: updatedAt, lastSeenAt: verifiedAt },
      });

    const profileValues = {
      universityId: item.universityId,
      openAlexId: item.row.openAlexId,
      worksCount: item.row.worksCount,
      citedByCount: item.row.citedByCount,
      hIndex: item.row.hIndex,
      i10Index: item.row.i10Index,
      twoYearMeanCitedness:
        item.row.twoYearMeanCitedness === null ? null : String(item.row.twoYearMeanCitedness),
      status: item.row.status,
      sourceId: source.id,
      sourceUpdatedAt: updatedAt,
      updatedAt: verifiedAt,
    };
    const existing = profileByUniversity.get(item.universityId);
    if (existing) {
      await tx
        .update(researchProfiles)
        .set(profileValues)
        .where(eq(researchProfiles.id, existing.id));
      updated += 1;
    } else {
      await tx.insert(researchProfiles).values(profileValues);
      inserted += 1;
    }
  }

  const skipped = items.length - matched.length;
  const sourceRow = items.at(-1)?.lineNumber ?? 0;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpoint, sourceRow },
      processedCount: sql`${importRuns.processedCount} + ${items.length}`,
      insertedCount: sql`${importRuns.insertedCount} + ${inserted}`,
      updatedCount: sql`${importRuns.updatedCount} + ${updated}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skipped}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${rejected.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
  return { inserted, updated, skipped, rejected: rejected.length };
};

const manifest = await loadManifest();
const artifactHash = await sha256File(artifactPath);
await inspectArtifact(manifest, artifactHash);
console.log(
  `Validated ${manifest.artifactFile}: ${manifest.artifactRows} exact-ROR research rows, SHA-256 ${artifactHash}.`,
);

if (dryRun) {
  const connection = createDb(getConfig(), { max: 1 });
  try {
    await assertProviderIdentifierOwnership(
      connection.db,
      ['ror', 'openalex'],
      'OpenAlex research dry run',
    );
    const hasResearchTable = await researchTableExists(connection.db);
    const before = await mutationCounts(connection.db, hasResearchTable);
    const plan = await planDryRun(connection.db, hasResearchTable);
    const after = await mutationCounts(connection.db, hasResearchTable);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('OpenAlex dry run changed database row counts; refusing to continue.');
    }
    console.log(
      `OpenAlex dry-run plan: ${plan.matched} exact ROR matches, ${plan.absent} absent identities, ${plan.insert} profile inserts, ${plan.update} profile updates, ${plan.conflicts} identity conflicts.`,
    );
    console.log(
      `Dry run wrote nothing: import_runs=${after.importRuns}, sources=${after.sources}, research_profiles=${after.researchProfiles}, openalex identifiers=${after.openAlexIdentifiers}.`,
    );
  } finally {
    await connection.close();
  }
} else {
  const connection = createDb(getConfig(), { max: 1 });
  let runId: string | undefined;
  let lockHeld = false;
  try {
    const lockResult = await connection.db.execute(sql`
      select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
    `);
    if ((lockResult[0] as { acquired?: unknown } | undefined)?.acquired !== true) {
      throw new Error('Another OpenAlex research import is already running.');
    }
    lockHeld = true;

    await assertProviderIdentifierOwnership(
      connection.db,
      ['ror', 'openalex'],
      'OpenAlex research import',
    );

    const existingRun = await existingRunFor(connection.db, manifest.datasetVersion, artifactHash);
    if (existingRun?.status === 'completed') {
      console.log(`OpenAlex research ${manifest.datasetVersion} is already fully imported.`);
    } else {
      const checkpoint = checkpointFor(existingRun?.checkpoint, manifest, artifactHash);
      if (existingRun) {
        runId = existingRun.id;
        await connection.db
          .update(importRuns)
          .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } else {
        const [created] = await connection.db
          .insert(importRuns)
          .values({
            provider,
            datasetVersion: manifest.datasetVersion,
            artifactHash,
            status: 'running',
            checkpoint,
          })
          .returning({ id: importRuns.id });
        if (!created) throw new Error('Failed to create OpenAlex research import run.');
        runId = created.id;
      }

      const checkpointMetadata = {
        schemaVersion: checkpoint.schemaVersion,
        sourceFile: checkpoint.sourceFile,
        sourceSha256: checkpoint.sourceSha256,
        sourceRows: checkpoint.sourceRows,
        sourceUrl: checkpoint.sourceUrl,
        sourceRetrievedAt: checkpoint.sourceRetrievedAt,
      } as const;
      let chunk: Array<{ lineNumber: number; row: OpenAlexResearchRow }> = [];
      let processedThisRun = 0;
      let insertedThisRun = 0;
      let updatedThisRun = 0;
      let skippedThisRun = 0;
      let rejectedThisRun = 0;
      const progressTarget = Math.min(requestedLimit, manifest.artifactRows - checkpoint.sourceRow);

      const flush = async () => {
        if (!runId || chunk.length === 0) return;
        const rows = chunk;
        chunk = [];
        const result = await connection.db.transaction((tx) =>
          flushChunk(tx, runId as string, rows, checkpointMetadata, manifest),
        );
        processedThisRun += rows.length;
        insertedThisRun += result.inserted;
        updatedThisRun += result.updated;
        skippedThisRun += result.skipped;
        rejectedThisRun += result.rejected;
        console.log(
          `OpenAlex research progress: ${processedThisRun}/${progressTarget} processed, ${insertedThisRun} inserted, ${updatedThisRun} updated, ${skippedThisRun} absent ROR identities, ${rejectedThisRun} conflicts.`,
        );
      };

      for await (const item of readJsonLines(artifactPath)) {
        if (item.lineNumber <= checkpoint.sourceRow) continue;
        chunk.push(item);
        const remaining = requestedLimit - processedThisRun;
        if (chunk.length >= Math.min(chunkSize, remaining)) await flush();
        if (processedThisRun >= requestedLimit) break;
      }
      if (chunk.length) await flush();
      const finalSourceRow = checkpoint.sourceRow + processedThisRun;
      const exhausted = finalSourceRow >= manifest.artifactRows;
      await connection.db
        .update(importRuns)
        .set({
          checkpoint: { ...checkpointMetadata, sourceRow: finalSourceRow },
          status: exhausted ? 'completed' : 'paused',
          finishedAt: exhausted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(importRuns.id, runId));
      console.log(
        exhausted
          ? `OpenAlex research import completed: ${insertedThisRun} inserted, ${updatedThisRun} updated, ${skippedThisRun} absent ROR identities, ${rejectedThisRun} conflicts.`
          : `OpenAlex research import paused safely after ${processedThisRun} records; rerun the same command to continue.`,
      );
    }
  } catch (error) {
    if (runId) {
      try {
        await connection.db
          .update(importRuns)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } catch (statusError) {
        console.error('Failed to record OpenAlex research import failure:', statusError);
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
    } finally {
      await connection.close();
    }
  }
}

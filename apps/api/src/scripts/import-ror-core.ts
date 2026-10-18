import '../load-env.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { createDb, type Database } from '../db/client.js';
import {
  importRuns,
  institutionAliases,
  institutionIdentifiers,
  sources,
  universities,
} from '../db/schema.js';
import { rorCoreRowSchema, toRorCoreDatabasePatch, type RorCoreRow } from './ror-core-format.js';
import { assertProviderIdentifierOwnership } from './institution-identifier-ownership.js';

/**
 * Refresh global institution core fields from a reviewed ROR artifact.
 *
 * Identity is always the exact institution_identifiers(provider='ror') key.
 * The importer never creates universities, never matches names, and only fills
 * fields that do not already contain a more authoritative value.
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDataDirectory = resolve(scriptDirectory, '../../../../data/sources');
const defaultArtifactPath = resolve(repositoryDataDirectory, 'ror-core-v2.12-2026-08-25.jsonl');
const manifestPath = resolve(repositoryDataDirectory, 'ror-core-artifacts.json');

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
  throw new Error('Usage: import:ror-core [artifact.jsonl] [record-limit] [--dry-run]');
}
const artifactPath = resolve(positionalArguments[0] ?? defaultArtifactPath);
const requestedLimitArgument = positionalArguments[1];
const requestedLimit =
  requestedLimitArgument === undefined ? Number.MAX_SAFE_INTEGER : Number(requestedLimitArgument);
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('record-limit must be a positive base-10 safe integer.');
}

const provider = 'ror-core';
const chunkSize = 250;
const importLockName = 'uniscope:ror-core-import:v1';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const artifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifact: z.object({
    datasetVersion: z.string().min(1),
    datasetFile: z.string().min(1),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    datasetBytes: z.number().int().positive(),
    datasetRows: z.number().int().positive(),
    sourceFile: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceRows: z.number().int().positive(),
    sourceUrl: z.url().startsWith('https://'),
    publisher: z.string().min(1),
    license: z.literal('CC0 1.0'),
    retrievedAt: z.iso.datetime(),
    statusCounts: z.object({
      active: z.number().int().nonnegative(),
      inactive: z.number().int().nonnegative(),
      withdrawn: z.number().int().nonnegative(),
    }),
    aliasRows: z.number().int().nonnegative(),
    transformation: z.string().min(1),
  }),
});
type ReviewedArtifact = z.infer<typeof artifactManifestSchema>['artifact'];

const checkpointSchema = z.object({
  schemaVersion: z.literal(1),
  sourceFile: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRows: z.number().int().positive(),
  sourceUrl: z.url().startsWith('https://'),
  sourceRetrievedAt: z.iso.datetime(),
  sourceRow: z.number().int().nonnegative(),
});
type Checkpoint = z.infer<typeof checkpointSchema>;

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const readJsonLines = async function* (file: string) {
  const input = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of input) {
    lineNumber += 1;
    if (!line.trim()) throw new Error(`Blank line in ROR core artifact at line ${lineNumber}.`);
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`Invalid JSON at ROR core artifact line ${lineNumber}.`, { cause: error });
    }
    const parsed = rorCoreRowSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Invalid ROR core artifact line ${lineNumber}: ${z.prettifyError(parsed.error)}`,
      );
    }
    yield { lineNumber, row: parsed.data };
  }
};

const loadManifest = async () => {
  const parsed = artifactManifestSchema.safeParse(
    JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(`Invalid ROR core manifest: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.artifact.datasetFile !== basename(artifactPath)) {
    throw new Error(
      `ROR artifact is not reviewed in ${basename(manifestPath)}: ${basename(artifactPath)}.`,
    );
  }
  return parsed.data.artifact;
};

const inspectArtifact = async (artifact: ReviewedArtifact, hash: string, bytes: number) => {
  if (hash !== artifact.datasetSha256) {
    throw new Error(
      `ROR artifact SHA-256 mismatch: expected ${artifact.datasetSha256}, received ${hash}.`,
    );
  }
  if (bytes !== artifact.datasetBytes) {
    throw new Error(
      `ROR artifact byte mismatch: expected ${artifact.datasetBytes}, received ${bytes}.`,
    );
  }
  const ids = new Set<string>();
  const counts = { active: 0, inactive: 0, withdrawn: 0 };
  let aliases = 0;
  let rows = 0;
  for await (const { row } of readJsonLines(artifactPath)) {
    rows += 1;
    if (ids.has(row.rorId)) throw new Error(`Duplicate ROR identifier: ${row.rorId}.`);
    ids.add(row.rorId);
    counts[row.status] += 1;
    aliases += row.aliases.length;
  }
  if (rows !== artifact.datasetRows) {
    throw new Error(
      `ROR artifact row mismatch: expected ${artifact.datasetRows}, received ${rows}.`,
    );
  }
  if (aliases !== artifact.aliasRows) {
    throw new Error(
      `ROR artifact alias mismatch: expected ${artifact.aliasRows}, received ${aliases}.`,
    );
  }
  for (const status of ['active', 'inactive', 'withdrawn'] as const) {
    if (counts[status] !== artifact.statusCounts[status]) {
      throw new Error(
        `ROR artifact ${status} count mismatch: expected ${artifact.statusCounts[status]}, received ${counts[status]}.`,
      );
    }
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

const checkpointFor = (value: unknown, artifact: ReviewedArtifact, hash: string): Checkpoint => {
  const initial: Checkpoint = {
    schemaVersion: 1,
    sourceFile: artifact.datasetFile,
    sourceSha256: hash,
    sourceRows: artifact.datasetRows,
    sourceUrl: artifact.sourceUrl,
    sourceRetrievedAt: artifact.retrievedAt,
    sourceRow: 0,
  };
  if (value === undefined) return initial;
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid existing ROR core checkpoint: ${z.prettifyError(parsed.error)}`);
  }
  const expected = { ...initial, sourceRow: parsed.data.sourceRow };
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) {
    throw new Error('Existing ROR core checkpoint does not match the reviewed artifact.');
  }
  if (parsed.data.sourceRow > artifact.datasetRows) {
    throw new Error('Existing ROR core checkpoint is past the artifact end.');
  }
  return parsed.data;
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  rows: Array<{ lineNumber: number; row: RorCoreRow }>,
  checkpoint: Omit<Checkpoint, 'sourceRow'>,
  artifact: ReviewedArtifact,
) => {
  const rorIds = rows.map(({ row }) => row.rorId);
  const matches = await tx
    .select({
      universityId: universities.id,
      rorId: institutionIdentifiers.externalId,
    })
    .from(institutionIdentifiers)
    .innerJoin(universities, eq(institutionIdentifiers.universityId, universities.id))
    .where(
      and(
        eq(institutionIdentifiers.provider, 'ror'),
        inArray(institutionIdentifiers.externalId, rorIds),
      ),
    );
  const existingByRor = new Map(matches.map((match) => [match.rorId, match]));
  const matchedRows = rows.flatMap((item) => {
    const existing = existingByRor.get(item.row.rorId);
    return existing ? [{ ...item, existing }] : [];
  });

  const universityIds = matchedRows.map(({ existing }) => existing.universityId);
  if (universityIds.length) {
    const corePatches = matchedRows.map(({ existing, row }) =>
      toRorCoreDatabasePatch(existing.universityId, row),
    );
    await tx.execute(sql`
      with patches as (
        select *
        from jsonb_to_recordset(${JSON.stringify(corePatches)}::jsonb) as patch(
          university_id uuid,
          country_code text,
          continent_code text,
          region text,
          latitude numeric,
          longitude numeric,
          official_website text,
          wikipedia_url text,
          established_year integer,
          operating_status text,
          source_modified_at timestamptz
        )
      )
      update ${universities} as university
      set
        country_code = coalesce(university.country_code, patch.country_code),
        continent_code = coalesce(university.continent_code, patch.continent_code),
        region = coalesce(university.region, patch.region),
        latitude = coalesce(university.latitude, patch.latitude),
        longitude = coalesce(university.longitude, patch.longitude),
        official_website = case
          when university.official_website is null or university.official_website !~ '^https://'
            then patch.official_website
          else university.official_website
        end,
        wikipedia_url = coalesce(university.wikipedia_url, patch.wikipedia_url),
        established_year = coalesce(university.established_year, patch.established_year),
        operating_status = case
          when university.operating_status is null or university.operating_status = 'unknown'
            then patch.operating_status::operating_status
          else university.operating_status
        end,
        updated_at = case
          when
            (university.country_code is null and patch.country_code is not null)
            or (university.continent_code is null and patch.continent_code is not null)
            or (university.region is null and patch.region is not null)
            or (university.latitude is null and patch.latitude is not null)
            or (university.longitude is null and patch.longitude is not null)
            or (university.official_website is null and patch.official_website is not null)
            or (university.official_website is not null and university.official_website !~ '^https://')
            or (university.wikipedia_url is null and patch.wikipedia_url is not null)
            or (university.established_year is null and patch.established_year is not null)
            or university.operating_status is null
            or university.operating_status = 'unknown'
          then now()
          else university.updated_at
        end
      from patches as patch
      where university.id = patch.university_id
    `);

    await tx
      .delete(institutionAliases)
      .where(
        and(
          eq(institutionAliases.provider, 'ror'),
          inArray(institutionAliases.universityId, universityIds),
        ),
      );
    const aliases = matchedRows.flatMap(({ existing, row }) =>
      row.aliases.map((alias) => ({
        universityId: existing.universityId,
        name: alias.name,
        kind: alias.kind,
        languageCode: alias.languageCode,
        provider: 'ror',
      })),
    );
    if (aliases.length) await tx.insert(institutionAliases).values(aliases).onConflictDoNothing();

    const identifierPatches = matchedRows.map(({ row }) => ({
      ror_id: row.rorId,
      source_modified_at: row.sourceModifiedAt,
    }));
    await tx.execute(sql`
      with patches as (
        select *
        from jsonb_to_recordset(${JSON.stringify(identifierPatches)}::jsonb) as patch(
          ror_id text,
          source_modified_at timestamptz
        )
      )
      update ${institutionIdentifiers} as identifier
      set source_modified_at = patch.source_modified_at, last_seen_at = now()
      from patches as patch
      where identifier.provider = 'ror' and identifier.external_id = patch.ror_id
    `);
    await tx
      .insert(sources)
      .values(
        matchedRows.map(({ existing, row }) => ({
          universityId: existing.universityId,
          title: `Research Organization Registry (${basename(artifactPath, '.jsonl')})`,
          url: `https://ror.org/${row.rorId}`,
          category: 'independent' as const,
          publisher: artifact.publisher,
          datasetVersion: artifact.datasetVersion,
          publishedAt: new Date(row.sourceModifiedAt),
          importRunId: runId,
          verifiedAt: new Date(artifact.retrievedAt),
        })),
      )
      .onConflictDoUpdate({
        target: [sources.universityId, sources.url],
        set: {
          title: sql`excluded.title`,
          category: 'independent',
          publisher: artifact.publisher,
          datasetVersion: artifact.datasetVersion,
          publishedAt: sql`excluded.published_at`,
          importRunId: runId,
          verifiedAt: new Date(artifact.retrievedAt),
        },
      });
  }

  const sourceRow = rows.at(-1)?.lineNumber ?? 0;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpoint, sourceRow },
      processedCount: sql`${importRuns.processedCount} + ${rows.length}`,
      updatedCount: sql`${importRuns.updatedCount} + ${matchedRows.length}`,
      skippedCount: sql`${importRuns.skippedCount} + ${rows.length - matchedRows.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
  return { updated: matchedRows.length, skipped: rows.length - matchedRows.length };
};

const artifact = await loadManifest();
const artifactHash = await sha256File(artifactPath);
const artifactBytes = (await stat(artifactPath)).size;
await inspectArtifact(artifact, artifactHash, artifactBytes);
console.log(
  `Validated ${artifact.datasetFile}: ${artifact.datasetRows} records, ${artifact.aliasRows} aliases, SHA-256 ${artifactHash}.`,
);
if (dryRun) process.exit(0);

const connection = createDb(getConfig(), { max: 1 });
let runId: string | undefined;
let lockHeld = false;
try {
  const lockResult = await connection.db.execute(sql`
    select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
  `);
  if ((lockResult[0] as { acquired?: unknown } | undefined)?.acquired !== true) {
    throw new Error('Another ROR core import is already running.');
  }
  lockHeld = true;

  await assertProviderIdentifierOwnership(connection.db, ['ror'], 'ROR core import');

  const existingRun = await existingRunFor(connection.db, artifact.datasetVersion, artifactHash);
  if (existingRun?.status === 'completed') {
    console.log(`ROR core ${artifact.datasetVersion} is already fully imported.`);
  } else {
    const checkpoint = checkpointFor(existingRun?.checkpoint, artifact, artifactHash);
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
          datasetVersion: artifact.datasetVersion,
          artifactHash,
          status: 'running',
          checkpoint,
        })
        .returning({ id: importRuns.id });
      if (!created) throw new Error('Failed to create ROR core import run.');
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
    let chunk: Array<{ lineNumber: number; row: RorCoreRow }> = [];
    let processedThisRun = 0;
    let updatedThisRun = 0;
    let skippedThisRun = 0;
    let exhausted = true;
    const progressTarget = Math.min(requestedLimit, artifact.datasetRows - checkpoint.sourceRow);

    const flush = async () => {
      if (!runId || !chunk.length) return;
      const result = await connection.db.transaction((tx) =>
        flushChunk(tx, runId as string, chunk, checkpointMetadata, artifact),
      );
      processedThisRun += chunk.length;
      updatedThisRun += result.updated;
      skippedThisRun += result.skipped;
      chunk = [];
      console.log(
        `ROR core progress: ${processedThisRun}/${progressTarget} processed, ${updatedThisRun} exact matches, ${skippedThisRun} absent identities.`,
      );
    };

    for await (const item of readJsonLines(artifactPath)) {
      if (item.lineNumber <= checkpoint.sourceRow) continue;
      chunk.push(item);
      if (chunk.length >= Math.min(chunkSize, requestedLimit - processedThisRun)) await flush();
      if (processedThisRun >= requestedLimit) {
        exhausted = item.lineNumber >= artifact.datasetRows;
        break;
      }
    }
    if (chunk.length) await flush();
    const finalSourceRow = checkpoint.sourceRow + processedThisRun;
    exhausted = exhausted && finalSourceRow >= artifact.datasetRows;
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
        ? `ROR core refresh completed: ${updatedThisRun} exact matches, ${skippedThisRun} absent identities.`
        : `ROR core refresh paused safely after ${processedThisRun} records; rerun the same command to continue.`,
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
      console.error('Failed to record ROR core import failure:', statusError);
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

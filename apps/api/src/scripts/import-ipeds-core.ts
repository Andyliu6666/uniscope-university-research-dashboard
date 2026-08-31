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
 * Refresh core university fields from the official NCES IPEDS HD directory.
 *
 * This is deliberately a refresh, not an identity importer. Every row must
 * match an existing institution_identifiers row with provider=ipeds and the
 * exact six-digit UNITID. It never creates a university and never merges by
 * name. Existing non-null/non-unknown values are preserved.
 *
 * Usage:
 *   pnpm --filter @urd/api import:ipeds-core [csv] [record-limit]
 *   pnpm --filter @urd/api import:ipeds-core [csv] --dry-run
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDataDirectory = resolve(scriptDirectory, '../../../../data/sources');
const defaultCsvPath = resolve(repositoryDataDirectory, 'HD2024.csv');
const sourceManifestPath = resolve(repositoryDataDirectory, 'ipeds-core-artifacts.json');

const rawArguments = process.argv.slice(2);
if (rawArguments[0] === '--') rawArguments.shift();
const dryRun = rawArguments.includes('--dry-run');
const positionalArguments = rawArguments.filter((argument) => argument !== '--dry-run');
const csvPath = resolve(positionalArguments[0] ?? defaultCsvPath);
const requestedLimitArgument = positionalArguments[1];
const requestedLimit =
  requestedLimitArgument === undefined ? Number.MAX_SAFE_INTEGER : Number(requestedLimitArgument);
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('record-limit must be a positive base-10 safe integer.');
}

const provider = 'ipeds-core';
const datasetVersion = basename(csvPath).replace(/\.csv$/iu, '');
const chunkSize = 250;
const importLockName = 'uniscope:ipeds-core-import:v2';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const requiredColumns = [
  'UNITID',
  'ADDR',
  'CITY',
  'STABBR',
  'ZIP',
  'GENTELE',
  'WEBADDR',
  'ADMINURL',
  'APPLURL',
  'FAIDURL',
  'NPRICURL',
  'CONTROL',
  'HLOFFER',
  'UGOFFER',
  'GROFFER',
  'ACT',
  'LONGITUD',
  'LATITUDE',
] as const;

const rowSchema = z
  .object({
    UNITID: z.string().regex(/^\d{6}$/u),
    ADDR: z.string(),
    CITY: z.string(),
    STABBR: z.string(),
    ZIP: z.string(),
    GENTELE: z.string(),
    WEBADDR: z.string(),
    ADMINURL: z.string(),
    APPLURL: z.string(),
    FAIDURL: z.string(),
    NPRICURL: z.string(),
    CONTROL: z.string(),
    HLOFFER: z.string(),
    UGOFFER: z.string(),
    GROFFER: z.string(),
    ACT: z.string(),
    LONGITUD: z.string(),
    LATITUDE: z.string(),
  })
  .passthrough();

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
type RawRow = Record<string, unknown>;

type CorePatch = {
  countryCode?: string;
  region?: string;
  addressLine?: string;
  postalCode?: string;
  phone?: string;
  latitude?: string;
  longitude?: string;
  institutionType?: 'public' | 'private';
  ownership?: 'public' | 'private_nonprofit' | 'private_forprofit';
  operatingStatus?: 'active' | 'inactive';
  offersUndergraduate?: boolean;
  offersGraduate?: boolean;
  highestAwardLevel?: string;
  officialWebsite?: string;
  admissionsUrl?: string;
  financialAidUrl?: string;
  netPriceUrl?: string;
};

type Candidate = {
  sourceRow: number;
  unitId: string;
  universityId: string;
  patch: CorePatch;
};

type Rejection = {
  sourceRow: number;
  externalId: string | null;
  reason: string;
  payloadHash: string;
  payload: unknown;
};

type CheckpointMetadata = {
  schemaVersion: 2;
  sourceFile: string;
  sourceSha256: string;
  sourceRows: number;
  sourceUrl: string;
  sourceRetrievedAt: string;
  sourceRow: number;
};

const checkpointSchema = z.object({
  schemaVersion: z.literal(2),
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

const sha256Text = (value: string) => createHash('sha256').update(value).digest('hex');
const payloadHash = (payload: unknown) => sha256Text(JSON.stringify(payload));
const trimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const missingSentinels = new Set(['', '-1', '-2', '-3']);

const normaliseUrl = (value: unknown) => {
  const raw = trimmed(value);
  if (missingSentinels.has(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.protocol = 'https:';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return null;
  }
};

const booleanCode = (value: unknown): boolean | null => {
  const code = trimmed(value);
  if (code === '1') return true;
  if (code === '2') return false;
  return null;
};

const operatingStatusFor = (value: unknown): 'active' | 'inactive' | null => {
  const code = trimmed(value).toUpperCase();
  if (code === 'A') return 'active';
  if (code === 'D' || code === 'M' || code === 'N') return 'inactive';
  return null;
};

const clippedText = (value: unknown, maximum: number) => {
  const text = trimmed(value);
  return missingSentinels.has(text) ? null : text.slice(0, maximum) || null;
};

const coordinate = (value: unknown, minimum: number, maximum: number) => {
  const raw = trimmed(value);
  if (missingSentinels.has(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return null;
  return parsed.toFixed(6);
};

const highestAwardLevels: Record<string, string> = {
  '0': 'no postsecondary award',
  '1': 'certificate under one year',
  '2': 'certificate of one to two years',
  '3': "associate's degree",
  '4': 'certificate of two to four years',
  '5': "bachelor's degree",
  '6': 'post-baccalaureate certificate',
  '7': "master's degree",
  '8': "post-master's certificate",
  '9': 'doctoral degree',
};

const assertColumns = (columns: string[]) => {
  const duplicateColumns = [
    ...new Set(columns.filter((column, index) => columns.indexOf(column) !== index)),
  ];
  if (duplicateColumns.length) {
    throw new Error(`IPEDS HD artifact has duplicate columns: ${duplicateColumns.join(', ')}`);
  }
  const available = new Set(columns);
  const missing = requiredColumns.filter((column) => !available.has(column));
  if (missing.length) {
    throw new Error(`IPEDS HD artifact is missing required columns: ${missing.join(', ')}`);
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
  const unitIds = new Set<string>();
  let rowCount = 0;
  for await (const value of parser) {
    rowCount += 1;
    const raw = value as RawRow;
    const unitId = raw.UNITID;
    if (typeof unitId !== 'string' || !/^\d{6}$/u.test(unitId)) {
      throw new Error(`Invalid IPEDS UNITID at source row ${rowCount}: ${String(unitId)}`);
    }
    if (unitIds.has(unitId)) throw new Error(`Duplicate IPEDS UNITID in artifact: ${unitId}`);
    unitIds.add(unitId);
  }
  assertColumns(columns);
  if (!rowCount) throw new Error('IPEDS HD artifact contains no records.');
  return { rowCount };
};

const loadReviewedArtifact = async (): Promise<ReviewedArtifact> => {
  const raw = await readFile(sourceManifestPath, 'utf8');
  const parsed = sourceManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error(`Invalid IPEDS core manifest: ${z.prettifyError(parsed.error)}`);
  }
  const artifact = parsed.data.artifacts.find((item) => item.datasetFile === basename(csvPath));
  if (!artifact) {
    throw new Error(
      `IPEDS HD artifact is not reviewed in ${basename(sourceManifestPath)}: ${basename(csvPath)}`,
    );
  }
  return artifact;
};

const toCandidate = (
  raw: RawRow,
  sourceRow: number,
  universityId: string,
): { candidate: Candidate } | { rejection: Rejection } => {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      rejection: {
        sourceRow,
        externalId: typeof raw.UNITID === 'string' ? raw.UNITID : null,
        reason: z.prettifyError(parsed.error),
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }

  const row = parsed.data;
  const control = trimmed(row.CONTROL);
  if (!['1', '2', '3'].includes(control) && !missingSentinels.has(control)) {
    return {
      rejection: {
        sourceRow,
        externalId: row.UNITID,
        reason: `Unsupported IPEDS CONTROL code: ${control}`,
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }

  const patch: CorePatch = {};
  patch.countryCode = 'US';
  const region = clippedText(row.STABBR, 120);
  const addressLine = clippedText(row.ADDR, 500);
  const postalCode = clippedText(row.ZIP, 32);
  const phone = clippedText(row.GENTELE, 40);
  const latitude = coordinate(row.LATITUDE, -90, 90);
  const longitude = coordinate(row.LONGITUD, -180, 180);
  const highestAwardLevel = highestAwardLevels[trimmed(row.HLOFFER)];
  if (region) patch.region = region;
  if (addressLine) patch.addressLine = addressLine;
  if (postalCode) patch.postalCode = postalCode;
  if (phone) patch.phone = phone;
  if (latitude) patch.latitude = latitude;
  if (longitude) patch.longitude = longitude;
  if (highestAwardLevel) patch.highestAwardLevel = highestAwardLevel;
  if (control === '1' || control === '2' || control === '3') {
    patch.institutionType = control === '1' ? 'public' : 'private';
    patch.ownership =
      control === '1' ? 'public' : control === '2' ? 'private_nonprofit' : 'private_forprofit';
  }
  const status = operatingStatusFor(row.ACT);
  if (status) patch.operatingStatus = status;
  const offersUndergraduate = booleanCode(row.UGOFFER);
  const offersGraduate = booleanCode(row.GROFFER);
  if (offersUndergraduate !== null) patch.offersUndergraduate = offersUndergraduate;
  if (offersGraduate !== null) patch.offersGraduate = offersGraduate;

  const officialWebsite = normaliseUrl(row.WEBADDR);
  const admissionsUrl = normaliseUrl(row.ADMINURL) ?? normaliseUrl(row.APPLURL);
  const financialAidUrl = normaliseUrl(row.FAIDURL);
  const netPriceUrl = normaliseUrl(row.NPRICURL);
  if (officialWebsite) patch.officialWebsite = officialWebsite;
  if (admissionsUrl) patch.admissionsUrl = admissionsUrl;
  if (financialAidUrl) patch.financialAidUrl = financialAidUrl;
  if (netPriceUrl) patch.netPriceUrl = netPriceUrl;

  return { candidate: { sourceRow, unitId: row.UNITID, universityId, patch } };
};

const readIndexes = async (db: Database) => {
  const rows = await db
    .select({
      externalId: institutionIdentifiers.externalId,
      universityId: institutionIdentifiers.universityId,
    })
    .from(institutionIdentifiers)
    .where(eq(institutionIdentifiers.provider, 'ipeds'));
  return new Map(rows.map((row) => [row.externalId, row.universityId]));
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

const checkpointFor = (
  value: unknown,
  metadata: Omit<CheckpointMetadata, 'sourceRow'>,
  maximumSourceRow: number,
) => {
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Existing IPEDS core run has an invalid checkpoint: ${z.prettifyError(parsed.error)}`,
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
        `Existing IPEDS core checkpoint metadata does not match the reviewed artifact (${key}).`,
      );
    }
  }
  if (checkpoint.sourceRows !== maximumSourceRow || checkpoint.sourceRow > maximumSourceRow) {
    throw new Error(
      'Existing IPEDS core run has a source-row checkpoint outside the reviewed artifact.',
    );
  }
  return checkpoint;
};

const assertCounters = (
  run: {
    processedCount: number;
    insertedCount: number;
    updatedCount: number;
    skippedCount: number;
    rejectedCount: number;
  },
  expected?: number,
) => {
  const accounted = run.insertedCount + run.updatedCount + run.skippedCount + run.rejectedCount;
  if (run.processedCount !== accounted) {
    throw new Error(
      `IPEDS core ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expected !== undefined && run.processedCount !== expected) {
    throw new Error(
      `IPEDS core import is incomplete: processed ${run.processedCount}, expected ${expected}.`,
    );
  }
};

const hasValue = (value: string | null | undefined) => Boolean(value?.trim());

const buildSafePatch = (
  candidate: CorePatch,
  current: {
    countryCode: string | null;
    region: string | null;
    addressLine: string | null;
    postalCode: string | null;
    phone: string | null;
    latitude: string | null;
    longitude: string | null;
    institutionType: 'public' | 'private' | 'unknown';
    ownership: 'public' | 'private_nonprofit' | 'private_forprofit' | 'unknown' | null;
    operatingStatus: 'active' | 'inactive' | 'unknown' | null;
    offersUndergraduate: boolean | null;
    offersGraduate: boolean | null;
    highestAwardLevel: string | null;
    officialWebsite: string | null;
    admissionsUrl: string | null;
    financialAidUrl: string | null;
    netPriceUrl: string | null;
  },
) => {
  const patch: CorePatch = {};
  if (!hasValue(current.countryCode) && candidate.countryCode) {
    patch.countryCode = candidate.countryCode;
  }
  if (!hasValue(current.region) && candidate.region) patch.region = candidate.region;
  if (!hasValue(current.addressLine) && candidate.addressLine) {
    patch.addressLine = candidate.addressLine;
  }
  if (!hasValue(current.postalCode) && candidate.postalCode) {
    patch.postalCode = candidate.postalCode;
  }
  if (!hasValue(current.phone) && candidate.phone) patch.phone = candidate.phone;
  if (current.latitude === null && candidate.latitude) patch.latitude = candidate.latitude;
  if (current.longitude === null && candidate.longitude) patch.longitude = candidate.longitude;
  if (current.institutionType === 'unknown' && candidate.institutionType) {
    patch.institutionType = candidate.institutionType;
  }
  if ((!current.ownership || current.ownership === 'unknown') && candidate.ownership) {
    patch.ownership = candidate.ownership;
  }
  if (
    (!current.operatingStatus || current.operatingStatus === 'unknown') &&
    candidate.operatingStatus
  ) {
    patch.operatingStatus = candidate.operatingStatus;
  }
  if (current.offersUndergraduate === null && candidate.offersUndergraduate !== undefined) {
    patch.offersUndergraduate = candidate.offersUndergraduate;
  }
  if (current.offersGraduate === null && candidate.offersGraduate !== undefined) {
    patch.offersGraduate = candidate.offersGraduate;
  }
  if (!hasValue(current.highestAwardLevel) && candidate.highestAwardLevel) {
    patch.highestAwardLevel = candidate.highestAwardLevel;
  }
  if (!hasValue(current.officialWebsite) && candidate.officialWebsite) {
    patch.officialWebsite = candidate.officialWebsite;
  }
  if (!hasValue(current.admissionsUrl) && candidate.admissionsUrl) {
    patch.admissionsUrl = candidate.admissionsUrl;
  }
  if (!hasValue(current.financialAidUrl) && candidate.financialAidUrl) {
    patch.financialAidUrl = candidate.financialAidUrl;
  }
  if (!hasValue(current.netPriceUrl) && candidate.netPriceUrl) {
    patch.netPriceUrl = candidate.netPriceUrl;
  }
  return patch;
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  candidates: Candidate[],
  skipped: number,
  rejections: Rejection[],
  checkpointRow: number,
  checkpointMetadata: Omit<CheckpointMetadata, 'sourceRow'>,
  artifact: ReviewedArtifact,
) => {
  const universityIds = [...new Set(candidates.map((candidate) => candidate.universityId))];
  const currentRows = universityIds.length
    ? await tx
        .select({
          id: universities.id,
          countryCode: universities.countryCode,
          region: universities.region,
          addressLine: universities.addressLine,
          postalCode: universities.postalCode,
          phone: universities.phone,
          latitude: universities.latitude,
          longitude: universities.longitude,
          institutionType: universities.institutionType,
          ownership: universities.ownership,
          operatingStatus: universities.operatingStatus,
          offersUndergraduate: universities.offersUndergraduate,
          offersGraduate: universities.offersGraduate,
          highestAwardLevel: universities.highestAwardLevel,
          officialWebsite: universities.officialWebsite,
          admissionsUrl: universities.admissionsUrl,
          financialAidUrl: universities.financialAidUrl,
          netPriceUrl: universities.netPriceUrl,
        })
        .from(universities)
        .where(inArray(universities.id, universityIds))
    : [];
  const currentById = new Map(currentRows.map((row) => [row.id, row]));

  const verifiedAt = new Date(artifact.retrievedAt);
  if (candidates.length) {
    const sourceCandidates = [
      ...new Map(candidates.map((candidate) => [candidate.universityId, candidate])).values(),
    ];
    await tx
      .insert(sources)
      .values(
        sourceCandidates.map((candidate) => ({
          universityId: candidate.universityId,
          title: `NCES IPEDS Directory (${datasetVersion})`,
          url: artifact.sourceUrl,
          category: 'government' as const,
          publisher: artifact.publisher,
          datasetVersion,
          importRunId: runId,
          verifiedAt,
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

  let updatedCount = 0;
  for (const candidate of candidates) {
    const current = currentById.get(candidate.universityId);
    if (!current) {
      throw new Error(`IPEDS core university ${candidate.universityId} disappeared during import.`);
    }
    const patch = buildSafePatch(candidate.patch, current);
    if (!Object.keys(patch).length) continue;
    await tx
      .update(universities)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(universities.id, candidate.universityId));
    updatedCount += 1;
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

  const skippedCount = skipped + candidates.length - updatedCount;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpointMetadata, sourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${candidates.length + skipped + rejections.length}`,
      updatedCount: sql`${importRuns.updatedCount} + ${updatedCount}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skippedCount}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${rejections.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));

  return { updatedCount, skippedCount, rejectedCount: rejections.length };
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
      : 'IPEDS HD SHA-256 does not match the reviewed manifest',
    inspection.rowCount === artifact.datasetRows
      ? null
      : `IPEDS HD row count is ${inspection.rowCount}, expected ${artifact.datasetRows}`,
  ].filter((problem): problem is string => problem !== null);
  if (problems.length)
    throw new Error(`Refusing unreviewed IPEDS core artifact: ${problems.join('; ')}`);

  const metadata: Omit<CheckpointMetadata, 'sourceRow'> = {
    schemaVersion: 2,
    sourceFile: basename(csvPath),
    sourceSha256: artifactHash,
    sourceRows: inspection.rowCount,
    sourceUrl: artifact.sourceUrl,
    sourceRetrievedAt: artifact.retrievedAt,
  };
  if (dryRun) {
    console.log(
      `IPEDS core artifact ${datasetVersion} is valid: ${inspection.rowCount} rows; SHA-256 ${artifactHash}.`,
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
      throw new Error('Another IPEDS core import is already running.');
    lockHeld = true;

    const universityIdByIpeds = await readIndexes(connection.db);
    const artifactRunHash = sha256Text(`ipeds-core:v2:${artifactHash}\n`);
    const existingRun = await existingRunFor(connection.db, artifactRunHash);
    let checkpoint: CheckpointMetadata;
    if (existingRun) {
      assertCounters(existingRun);
      checkpoint = checkpointFor(existingRun.checkpoint, metadata, inspection.rowCount);
      if (existingRun.status === 'completed') {
        assertCounters(existingRun, inspection.rowCount);
        console.log(`IPEDS core ${datasetVersion} is already fully imported.`);
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
          artifactHash: artifactRunHash,
          status: 'running',
          checkpoint,
        })
        .returning({ id: importRuns.id });
      if (!createdRun) throw new Error('Failed to create the IPEDS core import run.');
      runId = createdRun.id;
    }

    const resumeAfterRow = checkpoint.sourceRow;
    const parser = createReadStream(csvPath).pipe(
      parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }),
    );
    let sourceRow = 0;
    let consumedRows = 0;
    let candidates: Candidate[] = [];
    let skipped = 0;
    let rejections: Rejection[] = [];
    let exhausted = true;
    let updatedThisRun = 0;
    let skippedThisRun = 0;
    let rejectedThisRun = 0;

    const flush = async () => {
      if (!runId || (!candidates.length && !skipped && !rejections.length)) return;
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
          skipped,
          rejections,
          checkpointRow,
          metadata,
          artifact,
        ),
      );
      updatedThisRun += result.updatedCount;
      skippedThisRun += result.skippedCount;
      rejectedThisRun += result.rejectedCount;
      candidates = [];
      skipped = 0;
      rejections = [];
      console.log(
        `IPEDS core progress: ${updatedThisRun} fields refreshed, ${skippedThisRun} rows skipped, ${rejectedThisRun} rejected.`,
      );
    };

    for await (const value of parser) {
      sourceRow += 1;
      if (sourceRow <= resumeAfterRow) continue;
      consumedRows += 1;
      const raw = value as RawRow;
      const unitId = typeof raw.UNITID === 'string' ? raw.UNITID : null;
      const universityId = unitId ? universityIdByIpeds.get(unitId) : undefined;
      if (!universityId) {
        skipped += 1;
      } else {
        const transformed = toCandidate(raw, sourceRow, universityId);
        if ('candidate' in transformed) candidates.push(transformed.candidate);
        else rejections.push(transformed.rejection);
      }

      if (candidates.length + skipped + rejections.length >= chunkSize) await flush();
      if (consumedRows >= requestedLimit) {
        exhausted = sourceRow === inspection.rowCount;
        await flush();
        break;
      }
    }
    if (consumedRows < requestedLimit && sourceRow === inspection.rowCount) exhausted = true;
    await flush();
    if (exhausted && sourceRow !== inspection.rowCount) {
      throw new Error(
        `IPEDS HD parser stopped at row ${sourceRow}, expected ${inspection.rowCount}.`,
      );
    }

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
    if (!currentRun) throw new Error('IPEDS core run disappeared before finalization.');
    assertCounters(currentRun, exhausted ? inspection.rowCount : undefined);
    if (currentRun.processedCount > inspection.rowCount) {
      throw new Error(
        `IPEDS core ledger exceeds the reviewed artifact: ${currentRun.processedCount} processed, ${inspection.rowCount} rows.`,
      );
    }
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
        ? `IPEDS core exhausted: ${updatedThisRun} rows refreshed, ${skippedThisRun} skipped, ${rejectedThisRun} rejected in this run.`
        : `IPEDS core paused at source row ${sourceRow}; rerun the same command to resume.`,
    );
  } catch (error) {
    if (runId) {
      try {
        await connection.db
          .update(importRuns)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } catch (statusError) {
        console.error('Failed to record the IPEDS core import error state:', statusError);
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
      console.error('Failed to release the IPEDS core import lock:', unlockError);
    } finally {
      await connection.close();
    }
  }
};

await run();

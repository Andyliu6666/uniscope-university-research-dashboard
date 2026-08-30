import '../load-env.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
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

const csvPathArgument = process.argv[2];
const crosswalkPathArgument = process.argv[3];
const requestedLimitArgument = process.argv[4] ?? '3000';
const requestedLimit = /^\d+$/u.test(requestedLimitArgument)
  ? Number(requestedLimitArgument)
  : Number.NaN;
if (!csvPathArgument || !crosswalkPathArgument) {
  throw new Error(
    'Usage: pnpm --filter @urd/api import:ipeds path/to/HDyyyy.csv path/to/versioned-ipeds-ror-crosswalk.csv [new-record-limit]',
  );
}
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('new-record-limit must be a positive base-10 safe integer.');
}

const provider = 'ipeds';
const csvPath = resolve(csvPathArgument);
const crosswalkPath = resolve(crosswalkPathArgument);
const ipedsVersion = basename(csvPath).replace(/\.csv$/iu, '');
const crosswalkVersion = basename(crosswalkPath).replace(/\.csv$/iu, '');
const datasetVersion = `${ipedsVersion}+${crosswalkVersion}`;
const sourceDownloadUrl = `https://nces.ed.gov/ipeds/datacenter/data/${ipedsVersion}.zip`;
const sourceManifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../data/sources/ipeds-artifacts.json',
);
const chunkSize = 500;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const requiredColumns = [
  'UNITID',
  'INSTNM',
  'CITY',
  'STABBR',
  'WEBADDR',
  'SECTOR',
  'CONTROL',
  'DEGGRANT',
  'ACT',
  'INSTCAT',
] as const;

const ipedsRowSchema = z
  .object({
    UNITID: z.string().regex(/^\d{6}$/u),
    INSTNM: z.string().min(2),
    CITY: z.string().min(1),
    STABBR: z.string().regex(/^[A-Z]{2}$/u),
    WEBADDR: z.string(),
    SECTOR: z.string(),
    CONTROL: z.enum(['1', '2', '3']),
    DEGGRANT: z.string(),
    ACT: z.string(),
    INSTCAT: z.string(),
  })
  .passthrough();

const crosswalkRowSchema = z.object({
  ipeds: z.string().regex(/^\d{6}$/u),
  wikidata: z.string().regex(/^Q\d+$/u),
  ror: z.union([z.string().regex(/^[a-z0-9]{9}$/u), z.literal('')]),
});

const reviewedArtifactSchema = z.object({
  datasetFile: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetRows: z.number().int().positive(),
  eligibleRows: z.number().int().positive(),
  datasetModifiedAt: z.iso.datetime(),
  crosswalkFile: z.string().min(1),
  crosswalkSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  crosswalkRawSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  crosswalkNormalization: z.string().min(1).optional(),
  crosswalkRows: z.number().int().positive(),
  crosswalkRetrievedAt: z.iso.datetime(),
});

const sourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifacts: z.array(reviewedArtifactSchema).min(1),
});

type CrosswalkIds = {
  rorIds: string[];
  wikidataIds: string[];
  ambiguous: boolean;
  ambiguityReason: string | null;
};

type Candidate = {
  sourceRow: number;
  unitId: string;
  crosswalkRorIds: string[];
  crosswalkWikidataIds: string[];
  sourceModifiedAt: Date;
  university: {
    name: string;
    slug: string;
    country: string;
    city: string;
    website: string;
    summary: string;
    institutionType: 'public' | 'private';
  };
};

type Rejection = {
  sourceRow: number;
  externalId: string | null;
  reason: string;
  payloadHash: string;
  payload: unknown;
};

type IdentityIndexes = {
  universityIdByRorId: Map<string, string>;
  universityIdByWikidataId: Map<string, string>;
};

type IdentityResolution =
  { kind: 'match'; universityId: string } | { kind: 'new' } | { kind: 'conflict'; reason: string };

type CheckpointMetadata = {
  sourceDownloadUrl: string;
  sourceSha256: string;
  sourceRows: number;
  eligibleRows: number;
  sourceModifiedAt: string;
  crosswalkSha256: string;
  crosswalkRows: number;
  crosswalkRetrievedAt: string;
};

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const sha256Text = (value: string) => createHash('sha256').update(value).digest('hex');
const payloadHash = (payload: unknown) => sha256Text(JSON.stringify(payload));
const clipped = (value: string, max: number) => value.trim().slice(0, max);
const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
const territoryNames: Record<string, string> = {
  AS: 'American Samoa',
  FM: 'Micronesia',
  GU: 'Guam',
  MH: 'Marshall Islands',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  PW: 'Palau',
  VI: 'U.S. Virgin Islands',
};

const countryFor = (stateCode: string) => territoryNames[stateCode] ?? 'United States';
const officialProfileUrl = (unitId: string) => `https://nces.ed.gov/collegenavigator/?id=${unitId}`;
const websiteFor = (value: string, unitId: string) => {
  const trimmed = value.trim();
  if (!trimmed || ['-1', '-2', '-3'].includes(trimmed)) return officialProfileUrl(unitId);
  try {
    const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
    url.protocol = 'https:';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return officialProfileUrl(unitId);
  }
};
const isEligibleInstitution = (row: Record<string, unknown>) =>
  row.ACT === 'A' &&
  row.DEGGRANT === '1' &&
  row.SECTOR !== '0' &&
  typeof row.INSTCAT === 'string' &&
  ['1', '2', '3', '4'].includes(row.INSTCAT);

const assertRequiredColumns = (columns: string[], label: string) => {
  const duplicateColumns = [
    ...new Set(columns.filter((column, index) => columns.indexOf(column) !== index)),
  ];
  if (duplicateColumns.length) {
    throw new Error(`${label} schema mismatch; duplicate columns: ${duplicateColumns.join(', ')}`);
  }
  const available = new Set(columns);
  const missing = requiredColumns.filter((column) => !available.has(column));
  if (missing.length) {
    throw new Error(`${label} schema mismatch; missing columns: ${missing.join(', ')}`);
  }
};

const inspectIpedsArtifact = async () => {
  let columns: string[] = [];
  const parser = createReadStream(csvPath).pipe(
    parse({
      columns: (header: string[]) => {
        columns = header;
        return header;
      },
      bom: true,
      skip_empty_lines: true,
    }),
  );
  const unitIds = new Set<string>();
  let rowCount = 0;
  let eligibleRows = 0;
  for await (const value of parser) {
    rowCount += 1;
    const row = value as Record<string, unknown>;
    const unitId = row.UNITID;
    if (typeof unitId !== 'string' || !/^\d{6}$/u.test(unitId)) {
      throw new Error(`Invalid IPEDS UNITID at data row ${rowCount}: ${String(unitId)}`);
    }
    if (unitIds.has(unitId)) throw new Error(`Duplicate IPEDS UNITID in artifact: ${unitId}`);
    unitIds.add(unitId);
    if (isEligibleInstitution(row)) eligibleRows += 1;
  }
  assertRequiredColumns(columns, 'IPEDS');
  if (!rowCount || !eligibleRows) throw new Error('IPEDS artifact contains no usable records.');
  return { rowCount, eligibleRows };
};

const loadCrosswalk = async () => {
  const byIpeds = new Map<string, { rorIds: Set<string>; wikidataIds: Set<string> }>();
  let columns: string[] = [];
  const parser = createReadStream(crosswalkPath).pipe(
    parse({
      columns: (header: string[]) => {
        columns = header;
        return header;
      },
      bom: true,
      skip_empty_lines: true,
    }),
  );
  let sourceRow = 1;
  let rowCount = 0;
  const seenRows = new Set<string>();
  for await (const value of parser) {
    sourceRow += 1;
    rowCount += 1;
    const parsed = crosswalkRowSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Invalid IPEDS/ROR crosswalk row ${sourceRow}: ${z.prettifyError(parsed.error)}`,
      );
    }
    const rowKey = `${parsed.data.ipeds}\t${parsed.data.wikidata}\t${parsed.data.ror}`;
    if (seenRows.has(rowKey)) {
      throw new Error(`Duplicate IPEDS/ROR crosswalk row ${sourceRow}: ${rowKey}`);
    }
    seenRows.add(rowKey);
    const ids = byIpeds.get(parsed.data.ipeds) ?? {
      rorIds: new Set<string>(),
      wikidataIds: new Set<string>(),
    };
    if (parsed.data.ror) ids.rorIds.add(parsed.data.ror.toLowerCase());
    ids.wikidataIds.add(parsed.data.wikidata);
    byIpeds.set(parsed.data.ipeds, ids);
  }
  const expectedColumns = ['ipeds', 'wikidata', 'ror'];
  if (columns.join(',') !== expectedColumns.join(',')) {
    throw new Error(
      `IPEDS/ROR crosswalk schema mismatch; expected ${expectedColumns.join(',')}, received ${columns.join(',') || '(none)'}`,
    );
  }
  if (!rowCount) throw new Error('IPEDS/ROR crosswalk contains no records.');

  const ipedsIdsByRorId = new Map<string, Set<string>>();
  const ipedsIdsByWikidataId = new Map<string, Set<string>>();
  for (const [unitId, ids] of byIpeds) {
    for (const rorId of ids.rorIds) {
      const unitIds = ipedsIdsByRorId.get(rorId) ?? new Set<string>();
      unitIds.add(unitId);
      ipedsIdsByRorId.set(rorId, unitIds);
    }
    for (const wikidataId of ids.wikidataIds) {
      const unitIds = ipedsIdsByWikidataId.get(wikidataId) ?? new Set<string>();
      unitIds.add(unitId);
      ipedsIdsByWikidataId.set(wikidataId, unitIds);
    }
  }

  const crosswalk = new Map<string, CrosswalkIds>();
  for (const [unitId, ids] of byIpeds) {
    const rorIds = [...ids.rorIds].sort();
    const wikidataIds = [...ids.wikidataIds].sort();
    const reasons: string[] = [];
    if (wikidataIds.length !== 1) {
      reasons.push(`expected one Wikidata ID, found ${wikidataIds.length}`);
    }
    if (rorIds.length > 1) reasons.push(`found ${rorIds.length} ROR IDs`);
    const sharedWikidataIds = wikidataIds.filter(
      (id) => (ipedsIdsByWikidataId.get(id)?.size ?? 0) > 1,
    );
    const sharedRorIds = rorIds.filter((id) => (ipedsIdsByRorId.get(id)?.size ?? 0) > 1);
    if (sharedWikidataIds.length) {
      reasons.push(`Wikidata IDs shared by multiple UnitIDs: ${sharedWikidataIds.join(', ')}`);
    }
    if (sharedRorIds.length) {
      reasons.push(`ROR IDs shared by multiple UnitIDs: ${sharedRorIds.join(', ')}`);
    }
    crosswalk.set(unitId, {
      rorIds,
      wikidataIds,
      ambiguous: reasons.length > 0,
      ambiguityReason: reasons.length ? reasons.join('; ') : null,
    });
  }
  return { crosswalk, rowCount };
};

const loadReviewedArtifact = async () => {
  const raw = await readFile(sourceManifestPath, 'utf8');
  const parsed = sourceManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error(`Invalid IPEDS source manifest: ${z.prettifyError(parsed.error)}`);
  }
  const artifact = parsed.data.artifacts.find(
    (item) =>
      item.datasetFile === basename(csvPath) && item.crosswalkFile === basename(crosswalkPath),
  );
  if (!artifact) {
    throw new Error(
      `IPEDS artifacts are not reviewed in ${basename(sourceManifestPath)}: ${basename(csvPath)} + ${basename(crosswalkPath)}`,
    );
  }
  return artifact;
};

const buildIdentityIndexes = async (db: Database): Promise<IdentityIndexes> => {
  const rows = await db
    .select({
      universityId: universities.id,
      provider: institutionIdentifiers.provider,
      externalId: institutionIdentifiers.externalId,
    })
    .from(institutionIdentifiers)
    .innerJoin(universities, eq(universities.id, institutionIdentifiers.universityId))
    .where(inArray(institutionIdentifiers.provider, ['ror', 'wikidata']));

  const universityIdByRorId = new Map<string, string>();
  const universityIdByWikidataId = new Map<string, string>();
  for (const row of rows) {
    if (row.provider === 'ror') universityIdByRorId.set(row.externalId, row.universityId);
    else universityIdByWikidataId.set(row.externalId, row.universityId);
  }
  return { universityIdByRorId, universityIdByWikidataId };
};

const resolveExistingUniversityId = (
  candidate: Candidate,
  indexes: IdentityIndexes,
): IdentityResolution => {
  if (!candidate.crosswalkRorIds.length && !candidate.crosswalkWikidataIds.length) {
    return { kind: 'new' };
  }
  if (candidate.crosswalkRorIds.length > 1 || candidate.crosswalkWikidataIds.length !== 1) {
    return { kind: 'conflict', reason: 'Ambiguous crosswalk reached identity resolution.' };
  }

  const matches = new Set<string>();
  const wikidataMatch = indexes.universityIdByWikidataId.get(
    candidate.crosswalkWikidataIds[0] as string,
  );
  if (wikidataMatch) matches.add(wikidataMatch);
  const rorId = candidate.crosswalkRorIds[0];
  const rorMatch = rorId ? indexes.universityIdByRorId.get(rorId) : null;
  if (rorMatch) matches.add(rorMatch);
  if (matches.size > 1) {
    return {
      kind: 'conflict',
      reason: `Wikidata and ROR identifiers resolve to ${matches.size} different university profiles.`,
    };
  }
  if (matches.size === 1) return { kind: 'match', universityId: [...matches][0] as string };
  return { kind: 'new' };
};

const assertCompletedRorBaseline = async (db: Database) => {
  const [[latestRun], [identifierCount]] = await Promise.all([
    db
      .select({ status: importRuns.status })
      .from(importRuns)
      .where(eq(importRuns.provider, 'ror'))
      .orderBy(desc(importRuns.updatedAt))
      .limit(1),
    db
      .select({ value: count() })
      .from(institutionIdentifiers)
      .where(eq(institutionIdentifiers.provider, 'ror')),
  ]);
  if (latestRun?.status !== 'completed' || !identifierCount || identifierCount.value < 1) {
    throw new Error('Complete the reviewed ROR baseline before importing IPEDS records.');
  }
};

const toCandidate = (
  raw: Record<string, unknown>,
  sourceRow: number,
  crosswalk: Map<string, CrosswalkIds>,
  sourceModifiedAt: Date,
): { candidate: Candidate } | { rejection: Rejection } => {
  const parsed = ipedsRowSchema.safeParse(raw);
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
  const name = clipped(row.INSTNM, 160);
  const city = clipped(row.CITY, 80);
  const country = countryFor(row.STABBR);
  const baseSlug = clipped(slugify(name), 155) || 'institution';
  const crosswalkIds = crosswalk.get(row.UNITID) ?? {
    rorIds: [],
    wikidataIds: [],
    ambiguous: false,
    ambiguityReason: null,
  };
  if (crosswalkIds.ambiguous) {
    return {
      rejection: {
        sourceRow,
        externalId: row.UNITID,
        reason: `Ambiguous IPEDS identity crosswalk: ${crosswalkIds.ambiguityReason ?? 'manual review required'}`,
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }
  return {
    candidate: {
      sourceRow,
      unitId: row.UNITID,
      crosswalkRorIds: crosswalkIds.rorIds,
      crosswalkWikidataIds: crosswalkIds.wikidataIds,
      sourceModifiedAt,
      university: {
        name,
        slug: `${baseSlug}-ipeds-${row.UNITID}`,
        country,
        city,
        website: websiteFor(row.WEBADDR, row.UNITID),
        summary: `${name} is an active, degree-granting postsecondary institution in ${city}, ${country}. Its institution identity and status are sourced from the U.S. National Center for Education Statistics IPEDS ${ipedsVersion} directory under UnitID ${row.UNITID}. Admissions, tuition, and program details require additional official sources.`,
        institutionType: row.CONTROL === '1' ? 'public' : 'private',
      },
    },
  };
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

const sourceRowFromCheckpoint = (
  checkpoint: unknown,
  maximumSourceRow: number,
  required: boolean,
) => {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    if (required) throw new Error('Existing IPEDS run has an invalid checkpoint object.');
    return 0;
  }
  const sourceRow = (checkpoint as Record<string, unknown>).sourceRow;
  if (
    typeof sourceRow !== 'number' ||
    !Number.isInteger(sourceRow) ||
    sourceRow < 0 ||
    sourceRow > maximumSourceRow
  ) {
    if (required) {
      throw new Error(
        `Existing IPEDS run has an invalid sourceRow checkpoint: ${String(sourceRow)}.`,
      );
    }
    return 0;
  }
  return sourceRow;
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
      `IPEDS import ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expectedProcessedCount !== undefined && run.processedCount !== expectedProcessedCount) {
    throw new Error(
      `IPEDS import is incomplete: processed ${run.processedCount}, expected ${expectedProcessedCount}.`,
    );
  }
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  candidates: Candidate[],
  rejections: Rejection[],
  checkpointRow: number,
  indexes: IdentityIndexes,
  checkpointMetadata: CheckpointMetadata,
) => {
  const unitIds = candidates.map((item) => item.unitId);
  const existingIdentifiers = unitIds.length
    ? await tx
        .select({
          externalId: institutionIdentifiers.externalId,
          universityId: institutionIdentifiers.universityId,
        })
        .from(institutionIdentifiers)
        .where(
          and(
            eq(institutionIdentifiers.provider, provider),
            inArray(institutionIdentifiers.externalId, unitIds),
          ),
        )
    : [];
  const universityIds = new Map(
    existingIdentifiers.map((item) => [item.externalId, item.universityId]),
  );
  const acceptedCandidates: Candidate[] = [];
  const identityRejections: Rejection[] = [];
  for (const candidate of candidates) {
    const existingUniversityId = universityIds.get(candidate.unitId);
    const resolution = resolveExistingUniversityId(candidate, indexes);
    let conflictReason: string | null = null;
    if (resolution.kind === 'conflict') {
      conflictReason = resolution.reason;
    } else if (
      existingUniversityId &&
      resolution.kind === 'match' &&
      resolution.universityId !== existingUniversityId
    ) {
      conflictReason =
        'The existing IPEDS identifier and reviewed crosswalk resolve to different university profiles.';
    }
    if (conflictReason) {
      identityRejections.push({
        sourceRow: candidate.sourceRow,
        externalId: candidate.unitId,
        reason: `Identity conflict: ${conflictReason}`,
        payloadHash: payloadHash(candidate),
        payload: candidate,
      });
      universityIds.delete(candidate.unitId);
      continue;
    }
    if (!existingUniversityId && resolution.kind === 'match') {
      universityIds.set(candidate.unitId, resolution.universityId);
    }
    acceptedCandidates.push(candidate);
  }
  const allRejections = [...rejections, ...identityRejections];
  const newCandidates = acceptedCandidates.filter((item) => !universityIds.has(item.unitId));

  if (newCandidates.length) {
    const inserted = await tx
      .insert(universities)
      .values(
        newCandidates.map((item) => ({
          ...item.university,
          studentCount: null,
          acceptanceRate: null,
          annualTuitionUsd: null,
          ibTypicalMin: null,
          featured: false,
          updatedAt: item.sourceModifiedAt,
        })),
      )
      .returning({ id: universities.id, slug: universities.slug });
    const insertedBySlug = new Map(inserted.map((item) => [item.slug, item.id]));
    for (const item of newCandidates) {
      const universityId = insertedBySlug.get(item.university.slug);
      if (!universityId) throw new Error(`Failed to insert IPEDS record ${item.unitId}`);
      universityIds.set(item.unitId, universityId);
    }
  }

  if (acceptedCandidates.length) {
    const seenAt = new Date();
    await tx
      .insert(institutionIdentifiers)
      .values(
        acceptedCandidates.map((item) => ({
          universityId: universityIds.get(item.unitId) as string,
          provider,
          externalId: item.unitId,
          sourceModifiedAt: item.sourceModifiedAt,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        })),
      )
      .onConflictDoUpdate({
        target: [institutionIdentifiers.provider, institutionIdentifiers.externalId],
        set: {
          sourceModifiedAt: sql`excluded.source_modified_at`,
          lastSeenAt: seenAt,
        },
      });

    const crosswalkIdentifiers = acceptedCandidates.flatMap((item) => {
      if (item.crosswalkRorIds.length > 1 || item.crosswalkWikidataIds.length !== 1) {
        return [];
      }
      const universityId = universityIds.get(item.unitId) as string;
      const identifiers = [
        {
          universityId,
          provider: 'wikidata',
          externalId: item.crosswalkWikidataIds[0] as string,
          sourceModifiedAt: item.sourceModifiedAt,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        },
      ];
      const rorId = item.crosswalkRorIds[0];
      if (rorId) {
        identifiers.push({
          universityId,
          provider: 'ror',
          externalId: rorId,
          sourceModifiedAt: item.sourceModifiedAt,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        });
      }
      return identifiers;
    });
    if (crosswalkIdentifiers.length) {
      await tx.insert(institutionIdentifiers).values(crosswalkIdentifiers).onConflictDoNothing();
    }

    await tx
      .insert(sources)
      .values(
        acceptedCandidates.map((item) => ({
          universityId: universityIds.get(item.unitId) as string,
          title: `NCES IPEDS Directory (${ipedsVersion})`,
          url: officialProfileUrl(item.unitId),
          category: 'government' as const,
          verifiedAt: item.sourceModifiedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [sources.universityId, sources.url],
        set: {
          title: `NCES IPEDS Directory (${ipedsVersion})`,
          category: 'government',
          verifiedAt: sql`excluded.verified_at`,
        },
      });
  }

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

  const insertedCount = newCandidates.length;
  const skippedCount = acceptedCandidates.length - insertedCount;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpointMetadata, sourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${acceptedCandidates.length + allRejections.length}`,
      insertedCount: sql`${importRuns.insertedCount} + ${insertedCount}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skippedCount}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${allRejections.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));

  return { insertedCount, skippedCount, rejectedCount: allRejections.length };
};

const [csvHash, crosswalkHash, ipedsInspection, crosswalkInspection, reviewedArtifact] =
  await Promise.all([
    sha256File(csvPath),
    sha256File(crosswalkPath),
    inspectIpedsArtifact(),
    loadCrosswalk(),
    loadReviewedArtifact(),
  ]);
const artifactProblems = [
  csvHash === reviewedArtifact.datasetSha256 ? null : 'IPEDS SHA-256 does not match',
  crosswalkHash === reviewedArtifact.crosswalkSha256 ? null : 'crosswalk SHA-256 does not match',
  ipedsInspection.rowCount === reviewedArtifact.datasetRows
    ? null
    : `IPEDS row count is ${ipedsInspection.rowCount}, expected ${reviewedArtifact.datasetRows}`,
  ipedsInspection.eligibleRows === reviewedArtifact.eligibleRows
    ? null
    : `IPEDS eligible row count is ${ipedsInspection.eligibleRows}, expected ${reviewedArtifact.eligibleRows}`,
  crosswalkInspection.rowCount === reviewedArtifact.crosswalkRows
    ? null
    : `crosswalk row count is ${crosswalkInspection.rowCount}, expected ${reviewedArtifact.crosswalkRows}`,
].filter((problem): problem is string => problem !== null);
if (artifactProblems.length) {
  throw new Error(`Refusing unreviewed IPEDS artifacts: ${artifactProblems.join('; ')}`);
}
const crosswalk = crosswalkInspection.crosswalk;
const sourceModifiedAt = new Date(reviewedArtifact.datasetModifiedAt);
const artifactHash = sha256Text(`ipeds:${csvHash}\nror-crosswalk:${crosswalkHash}\n`);
const checkpointMetadata: CheckpointMetadata = {
  sourceDownloadUrl,
  sourceSha256: csvHash,
  sourceRows: ipedsInspection.rowCount,
  eligibleRows: ipedsInspection.eligibleRows,
  sourceModifiedAt: reviewedArtifact.datasetModifiedAt,
  crosswalkSha256: crosswalkHash,
  crosswalkRows: crosswalkInspection.rowCount,
  crosswalkRetrievedAt: reviewedArtifact.crosswalkRetrievedAt,
};
const connection = createDb(getConfig(), { max: 1 });
const importLockName = 'uniscope:institution-import:v1';
let runId: string | undefined;
let lockHeld = false;

try {
  const lockResult = await connection.db.execute(sql`
    select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
  `);
  const lockRow = lockResult[0] as { acquired?: unknown } | undefined;
  if (lockRow?.acquired !== true) throw new Error('Another institution import is already running.');
  lockHeld = true;

  await assertCompletedRorBaseline(connection.db);
  const indexes = await buildIdentityIndexes(connection.db);
  const ambiguousCrosswalkRows = [...crosswalk.values()].filter((ids) => ids.ambiguous).length;
  console.log(
    `IPEDS source ${ipedsVersion}: ${csvHash.slice(0, 12)}; crosswalk ${crosswalkHash.slice(0, 12)} (${ambiguousCrosswalkRows} ambiguous UnitID mappings quarantined).`,
  );

  const existingRun = await existingRunFor(connection.db, artifactHash);
  const resumeAfterRow = existingRun
    ? sourceRowFromCheckpoint(existingRun.checkpoint, ipedsInspection.rowCount, true)
    : 0;
  if (existingRun) {
    assertRunCounters(existingRun);
    if (existingRun.processedCount > ipedsInspection.eligibleRows) {
      throw new Error(
        `IPEDS import ledger exceeds the reviewed artifact: ${existingRun.processedCount} processed, ${ipedsInspection.eligibleRows} eligible.`,
      );
    }
  }
  if (existingRun?.status === 'completed') {
    if (resumeAfterRow !== ipedsInspection.rowCount) {
      throw new Error(
        `Completed IPEDS run stops at source row ${resumeAfterRow}, expected ${ipedsInspection.rowCount}.`,
      );
    }
    assertRunCounters(existingRun, ipedsInspection.eligibleRows);
    console.log(
      `IPEDS dataset ${datasetVersion} (${artifactHash.slice(0, 12)}) is already fully imported.`,
    );
  } else {
    if (existingRun) {
      runId = existingRun.id;
      await connection.db
        .update(importRuns)
        .set({
          checkpoint: { ...checkpointMetadata, sourceRow: resumeAfterRow },
          status: 'running',
          finishedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(importRuns.id, runId));
    } else {
      const [createdRun] = await connection.db
        .insert(importRuns)
        .values({
          provider,
          datasetVersion,
          artifactHash,
          status: 'running',
          checkpoint: { ...checkpointMetadata, sourceRow: 0 },
        })
        .returning({ id: importRuns.id });
      if (!createdRun) throw new Error('Failed to create the IPEDS import run');
      runId = createdRun.id;
    }

    const parser = createReadStream(csvPath).pipe(
      parse({ columns: true, bom: true, skip_empty_lines: true }),
    );
    let sourceRow = 0;
    let insertedThisRun = 0;
    let skippedThisRun = 0;
    let rejectedThisRun = 0;
    let candidates: Candidate[] = [];
    let rejections: Rejection[] = [];
    let exhausted = true;

    const flush = async () => {
      if (!runId || (!candidates.length && !rejections.length)) return;
      const checkpointRow = Math.max(
        ...candidates.map((item) => item.sourceRow),
        ...rejections.map((item) => item.sourceRow),
      );
      const result = await connection.db.transaction((tx) =>
        flushChunk(
          tx,
          runId as string,
          candidates,
          rejections,
          checkpointRow,
          indexes,
          checkpointMetadata,
        ),
      );
      insertedThisRun += result.insertedCount;
      skippedThisRun += result.skippedCount;
      rejectedThisRun += result.rejectedCount;
      candidates = [];
      rejections = [];
      console.log(
        `IPEDS batch progress: ${insertedThisRun}/${requestedLimit} new, ${skippedThisRun} matched, ${rejectedThisRun} rejected.`,
      );
    };

    for await (const value of parser) {
      sourceRow += 1;
      const raw = value as Record<string, unknown>;
      if (sourceRow <= resumeAfterRow || !isEligibleInstitution(raw)) continue;
      const transformed = toCandidate(raw, sourceRow, crosswalk, sourceModifiedAt);
      if ('candidate' in transformed) candidates.push(transformed.candidate);
      else rejections.push(transformed.rejection);

      const remaining = requestedLimit - insertedThisRun;
      const targetChunkSize = Math.min(chunkSize, Math.max(1, remaining));
      if (candidates.length >= targetChunkSize || rejections.length >= chunkSize) await flush();
      if (insertedThisRun >= requestedLimit) {
        exhausted = false;
        break;
      }
    }

    if (exhausted) await flush();
    if (exhausted && sourceRow !== ipedsInspection.rowCount) {
      throw new Error(
        `IPEDS parser stopped at source row ${sourceRow}, expected ${ipedsInspection.rowCount}.`,
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
      .where(eq(importRuns.id, runId))
      .limit(1);
    if (!currentRun) throw new Error('IPEDS import run disappeared before finalization.');
    assertRunCounters(currentRun, exhausted ? ipedsInspection.eligibleRows : undefined);
    if (currentRun.processedCount > ipedsInspection.eligibleRows) {
      throw new Error(
        `IPEDS import ledger exceeds the reviewed artifact: ${currentRun.processedCount} processed, ${ipedsInspection.eligibleRows} eligible.`,
      );
    }
    await connection.db
      .update(importRuns)
      .set({
        checkpoint: {
          ...checkpointMetadata,
          sourceRow,
        },
        status: exhausted ? 'completed' : 'paused',
        finishedAt: exhausted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));

    console.log(
      exhausted
        ? `IPEDS dataset exhausted: ${insertedThisRun} new, ${skippedThisRun} matched, ${rejectedThisRun} rejected in this run.`
        : `IPEDS batch paused cleanly: ${insertedThisRun} new, ${skippedThisRun} matched, ${rejectedThisRun} rejected. Run the same command to resume.`,
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
      console.error('Failed to record the IPEDS import error state:', statusError);
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
    console.error('Failed to release the institution import lock:', unlockError);
  } finally {
    await connection.close();
  }
}

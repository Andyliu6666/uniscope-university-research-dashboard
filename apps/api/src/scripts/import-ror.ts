import '../load-env.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, resolve } from 'node:path';
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

const csvPathArgument = process.argv[2];
const requestedLimit = Number.parseInt(process.argv[3] ?? '3000', 10);
if (!csvPathArgument || !Number.isInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error(
    'Usage: pnpm --filter @urd/api import:ror path/to/versioned-ror-data.csv [new-record-limit]',
  );
}

const provider = 'ror';
const csvPath = resolve(csvPathArgument);
const datasetVersion = basename(csvPath).replace(/-ror-data\.csv$/u, '');
const chunkSize = 500;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const rorRowSchema = z
  .object({
    id: z.string().url().startsWith('https://ror.org/'),
    'admin.last_modified.date': z.iso.date(),
    'links.type.website': z.string(),
    'locations.geonames_details.country_name': z.string().min(2),
    'locations.geonames_details.name': z.string().min(1),
    'names.types.ror_display': z.string().min(2),
    'external_ids.type.wikidata.preferred': z.string(),
    status: z.string(),
    types: z.string(),
  })
  .passthrough();

type Candidate = {
  sourceRow: number;
  rorId: string;
  wikidataId: string | null;
  sourceModifiedAt: Date;
  university: {
    name: string;
    slug: string;
    country: string;
    city: string;
    website: string;
    summary: string;
  };
};

type Rejection = {
  sourceRow: number;
  externalId: string | null;
  reason: string;
  payloadHash: string;
  payload: unknown;
};

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const payloadHash = (payload: unknown) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const clipped = (value: string, max: number) => value.trim().slice(0, max);
const externalIdFromUrl = (url: string) => url.split('/').filter(Boolean).at(-1)?.toLowerCase();
const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
const splitValues = (value: string) =>
  value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
const isActiveEducation = (row: Record<string, unknown>) =>
  row.status === 'active' &&
  typeof row.types === 'string' &&
  splitValues(row.types).includes('education');

const toCandidate = (
  raw: Record<string, unknown>,
  sourceRow: number,
): { candidate: Candidate } | { rejection: Rejection } => {
  const parsed = rorRowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      rejection: {
        sourceRow,
        externalId: typeof raw.id === 'string' ? (externalIdFromUrl(raw.id) ?? null) : null,
        reason: z.prettifyError(parsed.error),
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }

  const row = parsed.data;
  const rorId = externalIdFromUrl(row.id);
  if (!rorId || !/^[a-z0-9]{9}$/u.test(rorId)) {
    return {
      rejection: {
        sourceRow,
        externalId: rorId ?? null,
        reason: 'Invalid ROR identifier',
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }

  const name = clipped(row['names.types.ror_display'], 160);
  const country = clipped(row['locations.geonames_details.country_name'], 80);
  const city = clipped(row['locations.geonames_details.name'], 80);
  const officialWebsite = splitValues(row['links.type.website']).find((url) =>
    url.startsWith('https://'),
  );
  const sourceModifiedAt = new Date(`${row['admin.last_modified.date']}T00:00:00.000Z`);
  const baseSlug = clipped(slugify(name), 160) || 'institution';

  return {
    candidate: {
      sourceRow,
      rorId,
      wikidataId: row['external_ids.type.wikidata.preferred'].trim() || null,
      sourceModifiedAt,
      university: {
        name,
        slug: `${baseSlug}-${rorId}`,
        country,
        city,
        website: officialWebsite ?? row.id,
        summary: `${name} is an education institution in ${city}, ${country}. This profile is sourced from the Research Organization Registry (ROR); contributors can add admissions, tuition, program, and deadline details from official institutional sources.`,
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

const backfillRorIdentifiers = async (db: Database) =>
  db.execute(sql`
    with normalized_ror_sources as (
      select
        university_id,
        lower(substring(url from '^https://ror[.]org/([^/?#]+)')) as external_id,
        row_number() over (
          partition by lower(substring(url from '^https://ror[.]org/([^/?#]+)'))
          order by verified_at desc, id
        ) as source_rank
      from ${sources}
      where url like 'https://ror.org/%'
    )
    insert into ${institutionIdentifiers} (university_id, provider, external_id)
    select university_id, 'ror', external_id
    from normalized_ror_sources
    where source_rank = 1 and external_id is not null and external_id <> ''
    on conflict (provider, external_id) do nothing
  `);

const flushChunk = async (
  tx: Tx,
  runId: string,
  candidates: Candidate[],
  rejections: Rejection[],
  checkpointRow: number,
) => {
  const rorIds = candidates.map((item) => item.rorId);
  const existing = rorIds.length
    ? await tx
        .select({
          externalId: institutionIdentifiers.externalId,
          universityId: institutionIdentifiers.universityId,
        })
        .from(institutionIdentifiers)
        .where(
          and(
            eq(institutionIdentifiers.provider, provider),
            inArray(institutionIdentifiers.externalId, rorIds),
          ),
        )
    : [];
  const universityIds = new Map(existing.map((item) => [item.externalId, item.universityId]));
  const newCandidates = candidates.filter((item) => !universityIds.has(item.rorId));

  if (newCandidates.length) {
    const inserted = await tx
      .insert(universities)
      .values(
        newCandidates.map((item) => ({
          ...item.university,
          institutionType: 'unknown' as const,
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
      if (!universityId) throw new Error(`Failed to insert ROR record ${item.rorId}`);
      universityIds.set(item.rorId, universityId);
    }
  }

  if (candidates.length) {
    const seenAt = new Date();
    await tx
      .insert(institutionIdentifiers)
      .values(
        candidates.map((item) => ({
          universityId: universityIds.get(item.rorId) as string,
          provider,
          externalId: item.rorId,
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

    const wikidataIdentifiers = candidates.flatMap((item) => {
      const universityId = universityIds.get(item.rorId);
      return item.wikidataId && universityId
        ? [
            {
              universityId,
              provider: 'wikidata',
              externalId: item.wikidataId,
              sourceModifiedAt: item.sourceModifiedAt,
              firstSeenAt: seenAt,
              lastSeenAt: seenAt,
            },
          ]
        : [];
    });
    if (wikidataIdentifiers.length) {
      await tx.insert(institutionIdentifiers).values(wikidataIdentifiers).onConflictDoNothing();
    }

    await tx
      .insert(sources)
      .values(
        candidates.map((item) => ({
          universityId: universityIds.get(item.rorId) as string,
          title: `Research Organization Registry (${datasetVersion})`,
          url: `https://ror.org/${item.rorId}`,
          category: 'independent' as const,
          verifiedAt: item.sourceModifiedAt,
        })),
      )
      .onConflictDoNothing();
  }

  if (rejections.length) {
    await tx.insert(importRejections).values(
      rejections.map((item) => ({
        runId,
        externalId: item.externalId,
        reason: item.reason,
        payloadHash: item.payloadHash,
        payload: item.payload,
      })),
    );
  }

  const insertedCount = newCandidates.length;
  const skippedCount = candidates.length - insertedCount;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { sourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${candidates.length + rejections.length}`,
      insertedCount: sql`${importRuns.insertedCount} + ${insertedCount}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skippedCount}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${rejections.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));

  return { insertedCount, skippedCount, rejectedCount: rejections.length };
};

const artifactHash = await sha256File(csvPath);
const connection = createDb(getConfig());
let runId: string | undefined;

try {
  await backfillRorIdentifiers(connection.db);
  const existingRun = await existingRunFor(connection.db, artifactHash);
  if (existingRun?.status === 'completed') {
    console.log(
      `ROR dataset ${datasetVersion} (${artifactHash.slice(0, 12)}) is already fully imported.`,
    );
  } else {
    if (existingRun) {
      runId = existingRun.id;
      await connection.db
        .update(importRuns)
        .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
    } else {
      const [createdRun] = await connection.db
        .insert(importRuns)
        .values({ provider, datasetVersion, artifactHash, status: 'running' })
        .returning({ id: importRuns.id });
      if (!createdRun) throw new Error('Failed to create the ROR import run');
      runId = createdRun.id;
    }

    const checkpoint = existingRun?.checkpoint as { sourceRow?: unknown } | undefined;
    const resumeAfterRow =
      typeof checkpoint?.sourceRow === 'number' && Number.isInteger(checkpoint.sourceRow)
        ? checkpoint.sourceRow
        : 0;
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
        flushChunk(tx, runId as string, candidates, rejections, checkpointRow),
      );
      insertedThisRun += result.insertedCount;
      skippedThisRun += result.skippedCount;
      rejectedThisRun += result.rejectedCount;
      candidates = [];
      rejections = [];
      console.log(
        `ROR batch progress: ${insertedThisRun}/${requestedLimit} new, ${skippedThisRun} existing, ${rejectedThisRun} rejected.`,
      );
    };

    for await (const value of parser) {
      sourceRow += 1;
      if (sourceRow <= resumeAfterRow) continue;
      const raw = value as Record<string, unknown>;
      if (!isActiveEducation(raw)) continue;
      const transformed = toCandidate(raw, sourceRow);
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
    await connection.db
      .update(importRuns)
      .set({
        checkpoint: { sourceRow },
        status: exhausted ? 'completed' : 'paused',
        finishedAt: exhausted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));

    console.log(
      exhausted
        ? `ROR dataset exhausted: ${insertedThisRun} new, ${skippedThisRun} existing, ${rejectedThisRun} rejected in this run.`
        : `ROR batch paused cleanly: ${insertedThisRun} new, ${skippedThisRun} existing, ${rejectedThisRun} rejected. Run the same command to resume.`,
    );
  }
} catch (error) {
  if (runId) {
    await connection.db
      .update(importRuns)
      .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(importRuns.id, runId));
  }
  throw error;
} finally {
  await connection.close();
}

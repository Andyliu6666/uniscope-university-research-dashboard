import { createHash } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

/**
 * Build a compact, reviewable snapshot of OpenAlex education institutions.
 * OpenAlex data is CC0. Records are matched downstream only by their exact ROR
 * identifier; display names and domains are never used as identity keys.
 *
 * Usage:
 *   pnpm --filter @urd/api exec tsx src/scripts/build-openalex-institution-artifact.ts \
 *     ../../data/sources/openalex-institutions-YYYYMMDD.jsonl
 */

const outputArgument = process.argv[2];
if (!outputArgument) throw new Error('An output .jsonl path is required.');
const outputPath = resolve(outputArgument);
if (!outputPath.endsWith('.jsonl')) throw new Error('OpenAlex artifact must use a .jsonl suffix.');
const manifestPath = outputPath.replace(/\.jsonl$/u, '.manifest.json');
const temporaryOutputPath = `${outputPath}.tmp`;
const temporaryManifestPath = `${manifestPath}.tmp`;

const openAlexId = z.string().regex(/^https:\/\/openalex[.]org\/I[1-9][0-9]*$/u);
const rorId = z.string().regex(/^https:\/\/ror[.]org\/[a-z0-9]{9}$/u);
const summaryStatsSchema = z.object({
  '2yr_mean_citedness': z.number().nonnegative().nullable(),
  h_index: z.number().int().nonnegative(),
  i10_index: z.number().int().nonnegative(),
});
const sourceRowSchema = z.object({
  id: openAlexId,
  ror: rorId,
  display_name: z.string().min(1),
  country_code: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .nullable(),
  homepage_url: z.url().nullable(),
  works_count: z.number().int().nonnegative(),
  cited_by_count: z.number().int().nonnegative(),
  summary_stats: summaryStatsSchema,
  status: z.enum(['active', 'inactive', 'withdrawn']),
  updated_date: z.string().min(10),
});
const responseSchema = z.object({
  meta: z.object({
    count: z.number().int().nonnegative(),
    next_cursor: z.string().nullable(),
  }),
  results: z.array(sourceRowSchema),
});

type ArtifactRow = {
  openAlexId: string;
  rorId: string;
  displayName: string;
  countryCode: string | null;
  homepageUrl: string | null;
  worksCount: number;
  citedByCount: number;
  twoYearMeanCitedness: number | null;
  hIndex: number;
  i10Index: number;
  status: 'active' | 'inactive' | 'withdrawn';
  sourceUpdatedAt: string;
};

const baseUrl = 'https://api.openalex.org/institutions';
const select = [
  'id',
  'ror',
  'display_name',
  'country_code',
  'homepage_url',
  'works_count',
  'cited_by_count',
  'summary_stats',
  'status',
  'updated_date',
].join(',');
const canonicalQuery = `${baseUrl}?filter=type:education,has_ror:true&per-page=100&cursor=*&select=${select}`;

const fetchPage = async (cursor: string) => {
  const url = new URL(baseUrl);
  url.searchParams.set('filter', 'type:education,has_ror:true');
  url.searchParams.set('per-page', '100');
  url.searchParams.set('cursor', cursor);
  url.searchParams.set('select', select);
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  const mailto = process.env.OPENALEX_MAILTO?.trim();
  if (apiKey) url.searchParams.set('api_key', apiKey);
  if (mailto) url.searchParams.set('mailto', mailto);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'UniScope/1.0 (open-source university research project)' },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        if ((response.status === 429 || response.status >= 500) && attempt < 6) {
          await delay(Math.max(retryAfter * 1000, attempt * attempt * 750));
          continue;
        }
        throw new Error(`OpenAlex returned HTTP ${response.status}.`);
      }
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error(`OpenAlex response schema mismatch: ${z.prettifyError(parsed.error)}`);
      }
      return parsed.data;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await delay(attempt * attempt * 750);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const rows: ArtifactRow[] = [];
const seenOpenAlexIds = new Set<string>();
const seenRorIds = new Set<string>();
let cursor = '*';
let expectedCount: number | null = null;
let page = 0;

while (cursor) {
  const response = await fetchPage(cursor);
  page += 1;
  expectedCount ??= response.meta.count;
  if (response.meta.count !== expectedCount) {
    throw new Error(
      'OpenAlex result count changed during cursor pagination; retry a fresh snapshot.',
    );
  }
  for (const source of response.results) {
    const shortOpenAlexId = source.id.split('/').at(-1) as string;
    const shortRorId = source.ror.split('/').at(-1) as string;
    if (seenOpenAlexIds.has(shortOpenAlexId)) {
      throw new Error(`Duplicate OpenAlex ID in snapshot: ${shortOpenAlexId}`);
    }
    if (seenRorIds.has(shortRorId)) {
      throw new Error(`Duplicate ROR ID in OpenAlex snapshot: ${shortRorId}`);
    }
    seenOpenAlexIds.add(shortOpenAlexId);
    seenRorIds.add(shortRorId);
    rows.push({
      openAlexId: shortOpenAlexId,
      rorId: shortRorId,
      displayName: source.display_name,
      countryCode: source.country_code,
      homepageUrl: source.homepage_url,
      worksCount: source.works_count,
      citedByCount: source.cited_by_count,
      twoYearMeanCitedness: source.summary_stats['2yr_mean_citedness'],
      hIndex: source.summary_stats.h_index,
      i10Index: source.summary_stats.i10_index,
      status: source.status,
      sourceUpdatedAt: source.updated_date,
    });
  }
  cursor = response.meta.next_cursor ?? '';
  if (page % 25 === 0 || !cursor) {
    console.log(`OpenAlex snapshot progress: ${rows.length}/${expectedCount ?? '?'} records.`);
  }
  if (cursor) await delay(100);
}

if (rows.length !== expectedCount) {
  throw new Error(`OpenAlex snapshot has ${rows.length} rows; API declared ${expectedCount ?? 0}.`);
}
const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
const artifactSha256 = createHash('sha256').update(content).digest('hex');
const retrievedAt = new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  provider: 'openalex',
  datasetVersion: retrievedAt.slice(0, 10),
  artifactFile: basename(outputPath),
  artifactSha256,
  artifactRows: rows.length,
  sourceUrl: canonicalQuery,
  sourceRecordCount: expectedCount,
  retrievedAt,
  license: 'CC0 1.0',
  licenseUrl: 'https://help.openalex.org/access/pricing/',
  identityRule: 'Exact ROR ID only; names and domains are never automatic merge keys.',
};

await writeFile(temporaryOutputPath, content, 'utf8');
await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await rename(temporaryOutputPath, outputPath);
await rename(temporaryManifestPath, manifestPath);
console.log(
  `Wrote ${rows.length} OpenAlex institutions to ${outputPath}; SHA-256 ${artifactSha256}.`,
);

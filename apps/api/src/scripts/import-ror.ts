import '../load-env.js';
import type { UniversityInput } from '@urd/shared';
import { getConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { universities } from '../db/schema.js';
import { upsertUniversity } from '../services/university-service.js';

const requestedLimit = Number.parseInt(process.argv[2] ?? '3000', 10);
if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 10_000) {
  throw new Error('Usage: pnpm --filter @urd/api import:ror -- <limit from 1 to 10000>');
}

type RorRecord = {
  id: string;
  names: Array<{ value: string; types: string[] }>;
  links: Array<{ type: string; value: string }>;
  locations: Array<{
    geonames_details: { country_name: string; name: string };
  }>;
};

type RorResponse = { items: RorRecord[]; number_of_results: number };

const clipped = (value: string, max: number) => value.trim().slice(0, max);
const keyFor = (name: string, country: string) => `${name.trim().toLowerCase()}\u0000${country}`;
const rorSuffix = (id: string) => id.split('/').at(-1) ?? id;
const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const toUniversity = (record: RorRecord, usedSlugs: Set<string>): UniversityInput | null => {
  const displayName = record.names.find((name) => name.types.includes('ror_display'))?.value;
  const location = record.locations[0]?.geonames_details;
  if (!displayName || !location?.country_name || !location.name) return null;

  const name = clipped(displayName, 160);
  const country = clipped(location.country_name, 80);
  const city = clipped(location.name, 80);
  const baseSlug = slugify(name) || `institution-${rorSuffix(record.id)}`;
  const slug = usedSlugs.has(baseSlug) ? `${baseSlug}-${rorSuffix(record.id)}` : baseSlug;
  usedSlugs.add(slug);
  const officialWebsite = record.links.find(
    (link) => link.type === 'website' && link.value.startsWith('https://'),
  )?.value;

  return {
    name,
    slug,
    country,
    city,
    website: officialWebsite ?? record.id,
    summary: `${name} is an active higher-education or research institution located in ${city}, ${country}. This profile was imported from the Research Organization Registry and should be expanded with official admissions, program, tuition, and deadline information by contributors.`,
    institutionType: 'unknown',
    studentCount: null,
    acceptanceRate: null,
    annualTuitionUsd: null,
    ibTypicalMin: null,
    featured: false,
    programs: [],
    deadlines: [],
    sources: [
      {
        title: 'Research Organization Registry (ROR)',
        url: record.id,
        category: 'independent',
        verifiedAt: new Date().toISOString(),
      },
    ],
  };
};

const fetchPage = async (page: number) => {
  const url = new URL('https://api.ror.org/v2/organizations');
  url.searchParams.set('filter', 'types:education');
  url.searchParams.set('page', String(page));
  const response = await fetch(url, {
    headers: { 'user-agent': 'UniScope/1.0 (open-source import)' },
  });
  if (!response.ok) throw new Error(`ROR page ${page} failed with HTTP ${response.status}`);
  return (await response.json()) as RorResponse;
};

const connection = createDb(getConfig());
try {
  const existing = await connection.db
    .select({ name: universities.name, country: universities.country, slug: universities.slug })
    .from(universities);
  const existingKeys = new Set(existing.map((item) => keyFor(item.name, item.country)));
  const usedSlugs = new Set(existing.map((item) => item.slug));
  let imported = 0;
  let skipped = 0;
  let page = 1;

  while (imported < requestedLimit) {
    const result = await fetchPage(page);
    if (result.items.length === 0) break;
    const candidates = result.items
      .map((record) => toUniversity(record, usedSlugs))
      .filter((item): item is UniversityInput => item !== null)
      .filter((item) => {
        const key = keyFor(item.name, item.country);
        if (existingKeys.has(key)) {
          skipped += 1;
          return false;
        }
        existingKeys.add(key);
        return true;
      })
      .slice(0, requestedLimit - imported);

    for (let start = 0; start < candidates.length; start += 10) {
      const batch = candidates.slice(start, start + 10);
      await Promise.all(batch.map((item) => upsertUniversity(connection.db, item)));
      imported += batch.length;
      if (imported % 100 === 0 || imported === requestedLimit) {
        console.log(`Imported ${imported}/${requestedLimit} ROR institutions...`);
      }
    }
    page += 1;
  }

  console.log(`ROR import complete: ${imported} added, ${skipped} duplicates skipped.`);
} finally {
  await connection.close();
}

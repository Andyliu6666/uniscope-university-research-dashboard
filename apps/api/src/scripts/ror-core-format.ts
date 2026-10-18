import { z } from 'zod';

export const ROR_CORE_COLUMNS = [
  'id',
  'admin.last_modified.date',
  'established',
  'links.type.website',
  'links.type.wikipedia',
  'locations.geonames_details.continent_code',
  'locations.geonames_details.country_code',
  'locations.geonames_details.country_subdivision_name',
  'locations.geonames_details.lat',
  'locations.geonames_details.lng',
  'names.types.acronym',
  'names.types.alias',
  'names.types.label',
  'names.types.ror_display',
  'status',
  'types',
] as const;

const continentCodeSchema = z.enum(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']);
const statusSchema = z.enum(['active', 'inactive', 'withdrawn']);
const aliasKindSchema = z.enum(['acronym', 'alias', 'label']);
const safeHttpsUrlSchema = z
  .url()
  .startsWith('https://')
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }, 'URL credentials are not allowed.');

export const rorCoreAliasSchema = z.object({
  name: z.string().trim().min(1).max(1000),
  kind: aliasKindSchema,
  languageCode: z.string().regex(/^(?:und|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/u),
});

export const rorCoreRowSchema = z.object({
  rorId: z.string().regex(/^[a-z0-9]{9}$/u),
  sourceModifiedAt: z.iso.datetime(),
  status: statusSchema,
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .nullable(),
  continentCode: continentCodeSchema.nullable(),
  region: z.string().trim().min(1).max(120).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  officialWebsite: safeHttpsUrlSchema.nullable(),
  wikipediaUrl: safeHttpsUrlSchema.nullable(),
  establishedYear: z.number().int().min(1).max(2100).nullable(),
  aliases: z.array(rorCoreAliasSchema).max(250),
});

export type RorCoreAlias = z.infer<typeof rorCoreAliasSchema>;
export type RorCoreRow = z.infer<typeof rorCoreRowSchema>;

export const toRorCoreDatabasePatch = (universityId: string, row: RorCoreRow) => ({
  university_id: universityId,
  country_code: row.countryCode,
  continent_code: row.continentCode,
  region: row.region,
  latitude: row.latitude,
  longitude: row.longitude,
  official_website: row.officialWebsite,
  wikipedia_url: row.wikipediaUrl,
  established_year: row.establishedYear,
  operating_status: row.status === 'active' ? ('active' as const) : ('inactive' as const),
  source_modified_at: row.sourceModifiedAt,
});

const trimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const splitRorValues = (value: unknown) =>
  trimmed(value)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

export const rorIdFromUrl = (value: unknown) => {
  const match = /^https:\/\/ror[.]org\/([a-z0-9]{9})\/?$/u.exec(trimmed(value));
  return match?.[1] ?? null;
};

export const normalizeHttpsUrl = (value: unknown, wikipediaOnly = false) => {
  for (const candidate of splitRorValues(value)) {
    try {
      const url = new URL(candidate);
      if (wikipediaOnly && !/(^|[.])wikipedia[.]org$/iu.test(url.hostname)) continue;
      // Wikipedia supports HTTPS and its legacy HTTP links have one canonical,
      // semantics-preserving upgrade. Arbitrary institution sites do not have
      // that guarantee, so an HTTP official link is omitted rather than guessed.
      if (wikipediaOnly && url.protocol === 'http:') url.protocol = 'https:';
      if (url.protocol !== 'https:') continue;
      if (url.username || url.password) continue;
      url.hash = '';
      return url.toString();
    } catch {
      // A later semicolon-delimited ROR link can still be a valid HTTPS URL.
    }
  }
  return null;
};

const languageGroup = (value: string) => {
  const match = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*|no_lang_code):\s*(.+)$/u.exec(value);
  const language = match?.[1];
  const values = match?.[2];
  return language && values
    ? { languageCode: language === 'no_lang_code' ? 'und' : language.toLowerCase(), values }
    : { languageCode: 'und', values: value };
};

export const parseRorAliases = (
  value: unknown,
  kind: RorCoreAlias['kind'],
  displayName: string,
): RorCoreAlias[] => {
  const displayKey = displayName.trim().toLocaleLowerCase();
  const aliases: RorCoreAlias[] = [];
  for (const groupValue of splitRorValues(value)) {
    const group = languageGroup(groupValue);
    // ROR's CSV projection groups same-language names with a comma. The
    // canonical JSON is richer, but this deterministic split retains every
    // searchable value present in the reviewed CSV artifact.
    for (const rawName of group.values.split(/,\s+/u)) {
      const name = rawName.trim();
      if (!name || name.toLocaleLowerCase() === displayKey) continue;
      aliases.push({ name, kind, languageCode: group.languageCode });
    }
  }
  return aliases;
};

const nullableText = (value: unknown, maximum: number) => {
  const text = trimmed(value);
  return text ? text.slice(0, maximum) : null;
};

const coordinate = (value: unknown, minimum: number, maximum: number) => {
  const raw = trimmed(value);
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
};

const establishedYear = (value: unknown) => {
  const raw = trimmed(value);
  if (!/^\d{1,4}$/u.test(raw)) return null;
  const year = Number(raw);
  return year >= 1 && year <= 2100 ? year : null;
};

export const transformRorCoreCsvRow = (raw: Record<string, unknown>): RorCoreRow | null => {
  if (!splitRorValues(raw.types).includes('education')) return null;

  const rorId = rorIdFromUrl(raw.id);
  if (!rorId) throw new Error(`Invalid ROR identifier: ${trimmed(raw.id) || '(blank)'}`);
  const status = statusSchema.parse(trimmed(raw.status));
  const modifiedDate = z.iso.date().parse(trimmed(raw['admin.last_modified.date']));
  const displayName = trimmed(raw['names.types.ror_display']);
  if (!displayName) throw new Error(`ROR ${rorId} has no display name.`);

  const aliases = [
    ...parseRorAliases(raw['names.types.acronym'], 'acronym', displayName),
    ...parseRorAliases(raw['names.types.alias'], 'alias', displayName),
    ...parseRorAliases(raw['names.types.label'], 'label', displayName),
  ];
  const seenAliases = new Set<string>();
  const uniqueAliases = aliases.filter((alias) => {
    const key = `${alias.kind}\u0000${alias.languageCode}\u0000${alias.name.toLocaleLowerCase()}`;
    if (seenAliases.has(key)) return false;
    seenAliases.add(key);
    return true;
  });

  return rorCoreRowSchema.parse({
    rorId,
    sourceModifiedAt: `${modifiedDate}T00:00:00.000Z`,
    status,
    countryCode: /^([A-Z]{2})$/u.test(trimmed(raw['locations.geonames_details.country_code']))
      ? trimmed(raw['locations.geonames_details.country_code'])
      : null,
    continentCode: continentCodeSchema
      .nullable()
      .parse(trimmed(raw['locations.geonames_details.continent_code']) || null),
    region: nullableText(raw['locations.geonames_details.country_subdivision_name'], 120),
    latitude: coordinate(raw['locations.geonames_details.lat'], -90, 90),
    longitude: coordinate(raw['locations.geonames_details.lng'], -180, 180),
    officialWebsite: normalizeHttpsUrl(raw['links.type.website']),
    wikipediaUrl: normalizeHttpsUrl(raw['links.type.wikipedia'], true),
    establishedYear: establishedYear(raw.established),
    aliases: uniqueAliases,
  });
};

export const assertRorCoreColumns = (columns: string[]) => {
  const duplicates = [
    ...new Set(columns.filter((column, index) => columns.indexOf(column) !== index)),
  ];
  if (duplicates.length) throw new Error(`ROR CSV has duplicate columns: ${duplicates.join(', ')}`);
  const available = new Set(columns);
  const missing = ROR_CORE_COLUMNS.filter((column) => !available.has(column));
  if (missing.length) throw new Error(`ROR CSV is missing required columns: ${missing.join(', ')}`);
};

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
  costSnapshots,
  importRejections,
  importRuns,
  institutionIdentifiers,
  sources,
  universities,
} from '../db/schema.js';

/**
 * Import the reviewed IPEDS IC2024 and COST1_2024 snapshots.
 *
 * This importer intentionally enriches existing IPEDS identities only. It never
 * creates a university from a cost or characteristics file, because those files
 * do not provide the crosswalk guarantees used by import-ipeds.ts.
 *
 * Usage:
 *   pnpm --filter @urd/api import:ipeds-cost path/to/IC2024.csv path/to/COST1_2024.csv
 */

const icCsvArgument = process.argv[2];
const costCsvArgument = process.argv[3];
if (!icCsvArgument || !costCsvArgument) {
  throw new Error(
    'Usage: pnpm --filter @urd/api import:ipeds-cost path/to/IC2024.csv path/to/COST1_2024.csv',
  );
}

const icCsvPath = resolve(icCsvArgument);
const costCsvPath = resolve(costCsvArgument);
const sourceManifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../data/sources/ipeds-enrichment-artifacts.json',
);
const provider = 'ipeds-enrichment';
const datasetVersion = `${basename(icCsvPath, '.csv')}+${basename(costCsvPath, '.csv')}`;
const chunkSize = 250;
const academicYear = '2024-25';
const currency = 'USD';
const importLockName = 'uniscope:institution-import:v1';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const reviewedArtifactSchema = z.object({
  datasetFile: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetRows: z.number().int().positive(),
  academicYear: z.string().min(1),
  sourceUrl: z.string().url().startsWith('https://'),
  publisher: z.string().min(1),
  retrievedAt: z.iso.datetime(),
});

const sourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifacts: z.array(reviewedArtifactSchema).min(1),
});

const unitIdSchema = z.string().regex(/^\d{6}$/u);
const rowSchema = z.object({ UNITID: unitIdSchema }).passthrough();

const icRequiredColumns = [
  'UNITID',
  'LEVEL1',
  'LEVEL1A',
  'LEVEL1B',
  'LEVEL2',
  'LEVEL3',
  'LEVEL4',
  'LEVEL5',
  'LEVEL6',
  'LEVEL7',
  'LEVEL8',
  'LEVEL12',
  'LEVEL17',
  'LEVEL18',
  'LEVEL19',
  'CALSYS',
  'FT_UG',
  'FT_FTUG',
  'FTGDNIDP',
  'PT_UG',
  'PT_FTUG',
  'PTGDNIDP',
  'OPENADMP',
  'DISTNCED',
] as const;

const costRequiredColumns = [
  'UNITID',
  'XAPPFEEU',
  'APPLFEEU',
  'APPFEEUW',
  'XAPPFEEG',
  'APPLFEEG',
  'APPFEEGW',
  'FAFQ2URL',
  'XROOMAMT',
  'ROOMAMT',
  'XBORDAMT',
  'BOARDAMT',
  'XRMBDAMT',
  'RMBRDAMT',
  'XTUIT1',
  'TUITION1',
  'XFEE1',
  'FEE1',
  'XHRCHG1',
  'HRCHG1',
  'XHRCHF1',
  'HRCHF1',
  'XTUIT2',
  'TUITION2',
  'XFEE2',
  'FEE2',
  'XHRCHG2',
  'HRCHG2',
  'XHRCHF2',
  'HRCHF2',
  'XTUIT3',
  'TUITION3',
  'XFEE3',
  'FEE3',
  'XHRCHG3',
  'HRCHG3',
  'XHRCHF3',
  'HRCHF3',
  'XTUIT5',
  'TUITION5',
  'XFEE5',
  'FEE5',
  'XHRCHG5',
  'HRCHG5',
  'XHRCHF5',
  'HRCHF5',
  'XTUIT6',
  'TUITION6',
  'XFEE6',
  'FEE6',
  'XHRCHG6',
  'HRCHG6',
  'XHRCHF6',
  'HRCHF6',
  'XTUIT7',
  'TUITION7',
  'XFEE7',
  'FEE7',
  'XHRCHG7',
  'HRCHG7',
  'XHRCHF7',
  'HRCHF7',
  'CHG1AY3',
  'CHG2AY3',
  'CHG3AY3',
  'CHG4AY3',
  'CHG5AY3',
  'CHG6AY3',
  'CHG7AY3',
  'CHG8AY3',
  'CHG9AY3',
  'CHG10AY3',
] as const;

type RawRow = Record<string, unknown>;
type SourceFlags = Record<string, unknown>;

type EnrichmentCheckpoint = Record<string, unknown> & {
  phase: 'characteristics' | 'costs' | 'completed';
  characteristicsSourceRow: number;
  costsSourceRow: number;
};

type Rejection = {
  sourceRow: number;
  externalId: string | null;
  reason: string;
  payloadHash: string;
  payload: unknown;
};

type DatasetInspection = {
  rowCount: number;
  unitIds: Set<string>;
};

type ReviewedArtifact = z.infer<typeof reviewedArtifactSchema>;

type CharacteristicPatch = {
  academicCalendar?: string;
  offersUndergraduate?: boolean;
  offersGraduate?: boolean;
  highestAwardLevel?: string;
};

type CharacteristicCandidate = {
  sourceRow: number;
  unitId: string;
  universityId: string;
  patch: CharacteristicPatch;
  sourceFlags: SourceFlags;
};

type Residency = 'all' | 'in_district' | 'in_state' | 'out_of_state';
type CostLevel = 'undergraduate' | 'graduate';
type CostCategory =
  | 'tuition'
  | 'fees'
  | 'tuition_and_fees'
  | 'application_fee'
  | 'housing'
  | 'meals'
  | 'housing_and_meals'
  | 'books_and_supplies'
  | 'other';
type CostPeriod = 'academic_year' | 'per_credit_hour' | 'one_time';

type CostFact = {
  level: CostLevel;
  applicantType: 'all';
  residency: Residency;
  category: CostCategory;
  period: CostPeriod;
  scenario: string;
  amount: string;
  sourceFlags: SourceFlags;
};

type CostCandidate = {
  sourceRow: number;
  unitId: string;
  universityId: string;
  facts: CostFact[];
  financialAidUrl: string | null;
};

const unavailableFlags = new Set(['A', 'B', 'D', 'H', 'S']);
const missingSentinels = new Set(['-1', '-2', '-3']);

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const sha256Text = (value: string) => createHash('sha256').update(value).digest('hex');

const payloadHash = (payload: unknown) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const assertColumns = (columns: string[], required: readonly string[], label: string) => {
  const duplicateColumns = [
    ...new Set(columns.filter((column, index) => columns.indexOf(column) !== index)),
  ];
  if (duplicateColumns.length) {
    throw new Error(`${label} schema mismatch; duplicate columns: ${duplicateColumns.join(', ')}`);
  }
  const available = new Set(columns);
  const missing = required.filter((column) => !available.has(column));
  if (missing.length) {
    throw new Error(`${label} schema mismatch; missing columns: ${missing.join(', ')}`);
  }
};

const inspectArtifact = async (
  file: string,
  required: readonly string[],
  label: string,
): Promise<DatasetInspection> => {
  let columns: string[] = [];
  const parser = createReadStream(file).pipe(
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
  for await (const value of parser) {
    rowCount += 1;
    const row = value as RawRow;
    const unitId = row.UNITID;
    if (typeof unitId !== 'string' || !unitIdSchema.safeParse(unitId).success) {
      throw new Error(`Invalid ${label} UNITID at data row ${rowCount}: ${String(unitId)}`);
    }
    if (unitIds.has(unitId)) throw new Error(`Duplicate ${label} UNITID in artifact: ${unitId}`);
    unitIds.add(unitId);
  }
  assertColumns(columns, required, label);
  if (!rowCount) throw new Error(`${label} artifact contains no records.`);
  return { rowCount, unitIds };
};

const loadReviewedArtifact = async (file: string): Promise<ReviewedArtifact> => {
  const raw = await readFile(sourceManifestPath, 'utf8');
  const parsed = sourceManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error(`Invalid IPEDS enrichment manifest: ${z.prettifyError(parsed.error)}`);
  }
  const artifact = parsed.data.artifacts.find((item) => item.datasetFile === basename(file));
  if (!artifact) {
    throw new Error(
      `Artifact is not reviewed in ${basename(sourceManifestPath)}: ${basename(file)}`,
    );
  }
  return artifact;
};

const asTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const parseNumeric = (
  row: RawRow,
  valueColumn: string,
  flagColumn: string,
): { value: string | null; flag: string | null } => {
  const raw = asTrimmedString(row[valueColumn]);
  const flagRaw = asTrimmedString(row[flagColumn]).toUpperCase();
  const flag = flagRaw || null;
  if (!raw || missingSentinels.has(raw) || (flag && unavailableFlags.has(flag))) {
    return { value: null, flag };
  }
  if (!/^\d+(?:\.\d+)?$/u.test(raw)) {
    throw new Error(`${valueColumn} contains a non-negative numeric value expected by COST1`);
  }
  const numericValue = Number(raw);
  if (!Number.isFinite(numericValue) || numericValue > 999_999_999_999.99) {
    throw new Error(`${valueColumn} is outside the supported monetary range`);
  }
  return { value: raw, flag };
};

const parseIcCode = (row: RawRow, column: string): number | null => {
  const raw = asTrimmedString(row[column]);
  if (!raw || missingSentinels.has(raw)) return null;
  if (!/^(?:0|1|2|3|4|5|6|7)$/u.test(raw)) {
    throw new Error(`${column} contains an unknown IC2024 code: ${raw}`);
  }
  return Number(raw);
};

const calendarLabels: Record<number, string> = {
  1: 'Semester',
  2: 'Quarter',
  3: 'Trimester',
  4: 'Four-one-four plan',
  5: 'Other academic year',
  6: 'Differs by program',
  7: 'Continuous',
};

const awardLabels: Array<{ column: string; label: string; group: 'undergraduate' | 'graduate' }> = [
  { column: 'LEVEL19', label: "Doctor's degree - other", group: 'graduate' },
  { column: 'LEVEL18', label: "Doctor's degree - professional practice", group: 'graduate' },
  { column: 'LEVEL17', label: "Doctor's degree - research/scholarship", group: 'graduate' },
  { column: 'LEVEL8', label: "Post-master's certificate", group: 'graduate' },
  { column: 'LEVEL7', label: "Master's degree", group: 'graduate' },
  { column: 'LEVEL6', label: 'Postbaccalaureate certificate', group: 'graduate' },
  { column: 'LEVEL5', label: "Bachelor's degree", group: 'undergraduate' },
  {
    column: 'LEVEL4',
    label: 'Certificate of at least 2 years, but less than 4 years',
    group: 'undergraduate',
  },
  { column: 'LEVEL3', label: "Associate's degree", group: 'undergraduate' },
  {
    column: 'LEVEL2',
    label: 'Certificate of at least 1 year, but less than 2 years',
    group: 'undergraduate',
  },
  {
    column: 'LEVEL1B',
    label: 'Certificate of at least 12 weeks, but less than 1 year',
    group: 'undergraduate',
  },
  { column: 'LEVEL1A', label: 'Certificate of less than 12 weeks', group: 'undergraduate' },
  { column: 'LEVEL1', label: 'Certificate of less than 1 year', group: 'undergraduate' },
];

const toCharacteristicCandidate = (
  row: RawRow,
  sourceRow: number,
  universityId: string,
): CharacteristicCandidate => {
  const parsed = rowSchema.parse(row);
  const calendarCode = parseIcCode(parsed, 'CALSYS');
  const levelValues = new Map(
    awardLabels.map((item) => [item.column, parseIcCode(parsed, item.column)]),
  );
  const knownUndergraduate = awardLabels
    .filter((item) => item.group === 'undergraduate')
    .map((item) => levelValues.get(item.column))
    .filter((value): value is number => value !== null);
  const knownGraduate = awardLabels
    .filter((item) => item.group === 'graduate')
    .map((item) => levelValues.get(item.column))
    .filter((value): value is number => value !== null);
  const hasUndergraduate = knownUndergraduate.some((value) => value === 1);
  const hasGraduate = knownGraduate.some((value) => value === 1);
  const patch: CharacteristicPatch = {};
  if (calendarCode !== null) {
    const calendarLabel = calendarLabels[calendarCode];
    if (calendarLabel) patch.academicCalendar = calendarLabel;
  }
  if (knownUndergraduate.length) {
    patch.offersUndergraduate = hasUndergraduate
      ? true
      : knownUndergraduate.every((value) => value === 0);
  }
  if (knownGraduate.length) {
    patch.offersGraduate = hasGraduate ? true : knownGraduate.every((value) => value === 0);
  }
  const highest = awardLabels.find((item) => levelValues.get(item.column) === 1);
  if (highest) patch.highestAwardLevel = highest.label;

  const missingFields = [
    ...['CALSYS', ...awardLabels.map((item) => item.column)].filter(
      (field) =>
        asTrimmedString(parsed[field]) === '' ||
        missingSentinels.has(asTrimmedString(parsed[field])),
    ),
  ];
  return {
    sourceRow,
    unitId: parsed.UNITID,
    universityId,
    patch,
    sourceFlags: {
      datasetFile: 'IC2024.csv',
      sourceRow,
      ipedsUnitId: parsed.UNITID,
      missingFields,
      codeSemantics: '1=yes; 0=no or implied no; -2=not applicable',
    },
  };
};

type CostMapping = {
  level: CostLevel;
  residency: Residency;
  tuition: string;
  tuitionFlag: string;
  fee: string;
  feeFlag: string;
  hourlyTuition: string;
  hourlyTuitionFlag: string;
  hourlyFee: string;
  hourlyFeeFlag: string;
};

const costMappings: CostMapping[] = [
  {
    level: 'undergraduate',
    residency: 'in_district',
    tuition: 'TUITION1',
    tuitionFlag: 'XTUIT1',
    fee: 'FEE1',
    feeFlag: 'XFEE1',
    hourlyTuition: 'HRCHG1',
    hourlyTuitionFlag: 'XHRCHG1',
    hourlyFee: 'HRCHF1',
    hourlyFeeFlag: 'XHRCHF1',
  },
  {
    level: 'undergraduate',
    residency: 'in_state',
    tuition: 'TUITION2',
    tuitionFlag: 'XTUIT2',
    fee: 'FEE2',
    feeFlag: 'XFEE2',
    hourlyTuition: 'HRCHG2',
    hourlyTuitionFlag: 'XHRCHG2',
    hourlyFee: 'HRCHF2',
    hourlyFeeFlag: 'XHRCHF2',
  },
  {
    level: 'undergraduate',
    residency: 'out_of_state',
    tuition: 'TUITION3',
    tuitionFlag: 'XTUIT3',
    fee: 'FEE3',
    feeFlag: 'XFEE3',
    hourlyTuition: 'HRCHG3',
    hourlyTuitionFlag: 'XHRCHG3',
    hourlyFee: 'HRCHF3',
    hourlyFeeFlag: 'XHRCHF3',
  },
  {
    level: 'graduate',
    residency: 'in_district',
    tuition: 'TUITION5',
    tuitionFlag: 'XTUIT5',
    fee: 'FEE5',
    feeFlag: 'XFEE5',
    hourlyTuition: 'HRCHG5',
    hourlyTuitionFlag: 'XHRCHG5',
    hourlyFee: 'HRCHF5',
    hourlyFeeFlag: 'XHRCHF5',
  },
  {
    level: 'graduate',
    residency: 'in_state',
    tuition: 'TUITION6',
    tuitionFlag: 'XTUIT6',
    fee: 'FEE6',
    feeFlag: 'XFEE6',
    hourlyTuition: 'HRCHG6',
    hourlyTuitionFlag: 'XHRCHG6',
    hourlyFee: 'HRCHF6',
    hourlyFeeFlag: 'XHRCHF6',
  },
  {
    level: 'graduate',
    residency: 'out_of_state',
    tuition: 'TUITION7',
    tuitionFlag: 'XTUIT7',
    fee: 'FEE7',
    feeFlag: 'XFEE7',
    hourlyTuition: 'HRCHG7',
    hourlyTuitionFlag: 'XHRCHG7',
    hourlyFee: 'HRCHF7',
    hourlyFeeFlag: 'XHRCHF7',
  },
];

const normaliseUrl = (value: unknown) => {
  const raw = asTrimmedString(value);
  if (!raw || missingSentinels.has(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return null;
  }
};

const addFact = (
  facts: CostFact[],
  row: RawRow,
  sourceRow: number,
  level: CostLevel,
  residency: Residency,
  category: CostCategory,
  period: CostPeriod,
  scenario: string,
  valueColumn: string,
  flagColumn: string,
) => {
  const parsed = parseNumeric(row, valueColumn, flagColumn);
  if (parsed.value === null) return;
  facts.push({
    level,
    applicantType: 'all',
    residency,
    category,
    period,
    scenario,
    amount: parsed.value,
    sourceFlags: {
      datasetFile: 'COST1_2024.csv',
      sourceRow,
      field: valueColumn,
      imputationFlag: parsed.flag,
    },
  });
};

const toCostCandidate = (row: RawRow, sourceRow: number, universityId: string): CostCandidate => {
  const parsed = rowSchema.parse(row);
  const facts: CostFact[] = [];
  addFact(
    facts,
    parsed,
    sourceRow,
    'undergraduate',
    'all',
    'application_fee',
    'one_time',
    'application',
    'APPLFEEU',
    'XAPPFEEU',
  );
  addFact(
    facts,
    parsed,
    sourceRow,
    'graduate',
    'all',
    'application_fee',
    'one_time',
    'application',
    'APPLFEEG',
    'XAPPFEEG',
  );
  addFact(
    facts,
    parsed,
    sourceRow,
    'undergraduate',
    'all',
    'housing',
    'academic_year',
    'standard',
    'ROOMAMT',
    'XROOMAMT',
  );
  addFact(
    facts,
    parsed,
    sourceRow,
    'undergraduate',
    'all',
    'meals',
    'academic_year',
    'standard',
    'BOARDAMT',
    'XBORDAMT',
  );
  addFact(
    facts,
    parsed,
    sourceRow,
    'undergraduate',
    'all',
    'housing_and_meals',
    'academic_year',
    'standard',
    'RMBRDAMT',
    'XRMBDAMT',
  );

  for (const mapping of costMappings) {
    addFact(
      facts,
      parsed,
      sourceRow,
      mapping.level,
      mapping.residency,
      'tuition',
      'academic_year',
      'average_full_time',
      mapping.tuition,
      mapping.tuitionFlag,
    );
    addFact(
      facts,
      parsed,
      sourceRow,
      mapping.level,
      mapping.residency,
      'fees',
      'academic_year',
      'average_full_time',
      mapping.fee,
      mapping.feeFlag,
    );
    addFact(
      facts,
      parsed,
      sourceRow,
      mapping.level,
      mapping.residency,
      'tuition',
      'per_credit_hour',
      'average_part_time',
      mapping.hourlyTuition,
      mapping.hourlyTuitionFlag,
    );
    addFact(
      facts,
      parsed,
      sourceRow,
      mapping.level,
      mapping.residency,
      'fees',
      'per_credit_hour',
      'average_part_time',
      mapping.hourlyFee,
      mapping.hourlyFeeFlag,
    );
  }

  const publishedTuitionAndFees: Array<{
    residency: Residency;
    field: string;
  }> = [
    { residency: 'in_district', field: 'CHG1AY3' },
    { residency: 'in_state', field: 'CHG2AY3' },
    { residency: 'out_of_state', field: 'CHG3AY3' },
  ];
  for (const item of publishedTuitionAndFees) {
    addFact(
      facts,
      parsed,
      sourceRow,
      'undergraduate',
      item.residency,
      'tuition_and_fees',
      'academic_year',
      'published_2024_25',
      item.field,
      `X${item.field}`,
    );
  }

  const costOfAttendanceComponents: Array<{
    field: string;
    category: CostCategory;
    scenario: string;
  }> = [
    { field: 'CHG4AY3', category: 'books_and_supplies', scenario: 'on_campus' },
    { field: 'CHG5AY3', category: 'housing_and_meals', scenario: 'on_campus' },
    { field: 'CHG6AY3', category: 'other', scenario: 'on_campus' },
    {
      field: 'CHG7AY3',
      category: 'housing_and_meals',
      scenario: 'off_campus_not_with_family',
    },
    { field: 'CHG8AY3', category: 'other', scenario: 'off_campus_not_with_family' },
    { field: 'CHG10AY3', category: 'housing_and_meals', scenario: 'off_campus_with_family' },
    { field: 'CHG9AY3', category: 'other', scenario: 'off_campus_with_family' },
  ];
  for (const item of costOfAttendanceComponents) {
    addFact(
      facts,
      parsed,
      sourceRow,
      'undergraduate',
      'all',
      item.category,
      'academic_year',
      `cost_of_attendance_${item.scenario}`,
      item.field,
      `X${item.field}`,
    );
  }

  return {
    sourceRow,
    unitId: parsed.UNITID,
    universityId,
    facts,
    financialAidUrl: normaliseUrl(parsed.FAFQ2URL),
  };
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

const upsertSourceRows = async (
  tx: Tx,
  candidates: Array<{ universityId: string }>,
  artifact: ReviewedArtifact,
  runId: string,
) => {
  const verifiedAt = new Date();
  const rows = candidates.map((candidate) => ({
    universityId: candidate.universityId,
    title: `NCES IPEDS ${basename(artifact.datasetFile, '.csv')} (${artifact.academicYear})`,
    url: artifact.sourceUrl,
    category: 'government' as const,
    publisher: artifact.publisher,
    datasetVersion: artifact.datasetFile.replace(/\.csv$/iu, ''),
    importRunId: runId,
    verifiedAt,
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
    .returning({ id: sources.id, universityId: sources.universityId });
  return new Map(inserted.map((row) => [row.universityId, row.id]));
};

const flushCharacteristics = async (
  tx: Tx,
  runId: string,
  candidates: CharacteristicCandidate[],
  skipped: number,
  rejections: Rejection[],
  checkpointRow: number,
  checkpoint: Record<string, unknown>,
  artifact: ReviewedArtifact,
) => {
  await upsertSourceRows(tx, candidates, artifact, runId);
  for (const candidate of candidates) {
    if (Object.keys(candidate.patch).length) {
      await tx
        .update(universities)
        .set({ ...candidate.patch, updatedAt: new Date() })
        .where(eq(universities.id, candidate.universityId));
    }
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
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpoint, characteristicsSourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${candidates.length + skipped + rejections.length}`,
      updatedCount: sql`${importRuns.updatedCount} + ${candidates.length}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skipped}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${rejections.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
};

const flushCosts = async (
  tx: Tx,
  runId: string,
  candidates: CostCandidate[],
  skipped: number,
  rejections: Rejection[],
  checkpointRow: number,
  checkpoint: Record<string, unknown>,
  artifact: ReviewedArtifact,
) => {
  const sourceIds = await upsertSourceRows(tx, candidates, artifact, runId);
  if (sourceIds.size) {
    await tx.delete(costSnapshots).where(inArray(costSnapshots.sourceId, [...sourceIds.values()]));
  }
  const facts = candidates.flatMap((candidate) => {
    const sourceId = sourceIds.get(candidate.universityId);
    if (!sourceId) throw new Error(`Failed to create source for IPEDS UnitID ${candidate.unitId}`);
    return candidate.facts.map((fact) => ({
      universityId: candidate.universityId,
      programId: null,
      academicYear,
      level: fact.level,
      applicantType: fact.applicantType,
      residency: fact.residency,
      category: fact.category,
      period: fact.period,
      scenario: fact.scenario,
      amount: fact.amount,
      currency,
      sourceId,
      sourceFlags: fact.sourceFlags,
    }));
  });
  if (facts.length) await tx.insert(costSnapshots).values(facts);
  for (const candidate of candidates) {
    if (candidate.financialAidUrl) {
      await tx
        .update(universities)
        .set({ financialAidUrl: candidate.financialAidUrl, updatedAt: new Date() })
        .where(eq(universities.id, candidate.universityId));
    }
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
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpoint, costsSourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${candidates.length + skipped + rejections.length}`,
      updatedCount: sql`${importRuns.updatedCount} + ${candidates.length}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skipped}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${rejections.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
};

const getCheckpoint = (value: unknown): EnrichmentCheckpoint => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Existing IPEDS enrichment run has an invalid checkpoint object.');
  }
  const checkpoint = value as Record<string, unknown>;
  const characteristicsSourceRow = checkpoint.characteristicsSourceRow;
  const costsSourceRow = checkpoint.costsSourceRow;
  if (
    (typeof characteristicsSourceRow !== 'number' || !Number.isInteger(characteristicsSourceRow)) &&
    (typeof costsSourceRow !== 'number' || !Number.isInteger(costsSourceRow))
  ) {
    throw new Error('Existing IPEDS enrichment run has no valid source-row checkpoint.');
  }
  return {
    ...checkpoint,
    phase:
      checkpoint.phase === 'costs' || checkpoint.phase === 'completed'
        ? checkpoint.phase
        : 'characteristics',
    characteristicsSourceRow:
      typeof characteristicsSourceRow === 'number' && Number.isInteger(characteristicsSourceRow)
        ? characteristicsSourceRow
        : 0,
    costsSourceRow:
      typeof costsSourceRow === 'number' && Number.isInteger(costsSourceRow) ? costsSourceRow : 0,
  };
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
      `IPEDS enrichment ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expected !== undefined && run.processedCount !== expected) {
    throw new Error(
      `IPEDS enrichment is incomplete: processed ${run.processedCount}, expected ${expected}.`,
    );
  }
};

const makeRejection = (row: RawRow, sourceRow: number, error: unknown): Rejection => ({
  sourceRow,
  externalId: typeof row.UNITID === 'string' ? row.UNITID : null,
  reason: error instanceof Error ? error.message : String(error),
  payloadHash: payloadHash(row),
  payload: row,
});

const run = async () => {
  const [icArtifact, costArtifact, icHash, costHash, icInspection, costInspection] =
    await Promise.all([
      loadReviewedArtifact(icCsvPath),
      loadReviewedArtifact(costCsvPath),
      sha256File(icCsvPath),
      sha256File(costCsvPath),
      inspectArtifact(icCsvPath, icRequiredColumns, 'IC2024'),
      inspectArtifact(costCsvPath, costRequiredColumns, 'COST1_2024'),
    ]);
  const problems = [
    icHash === icArtifact.datasetSha256
      ? null
      : 'IC2024 SHA-256 does not match the reviewed manifest',
    costHash === costArtifact.datasetSha256
      ? null
      : 'COST1_2024 SHA-256 does not match the reviewed manifest',
    icInspection.rowCount === icArtifact.datasetRows
      ? null
      : `IC2024 row count is ${icInspection.rowCount}, expected ${icArtifact.datasetRows}`,
    costInspection.rowCount === costArtifact.datasetRows
      ? null
      : `COST1_2024 row count is ${costInspection.rowCount}, expected ${costArtifact.datasetRows}`,
    icArtifact.academicYear === costArtifact.academicYear
      ? null
      : 'IC2024 and COST1_2024 academic-year metadata do not match',
  ].filter((problem): problem is string => problem !== null);
  if (problems.length)
    throw new Error(`Refusing unreviewed IPEDS artifacts: ${problems.join('; ')}`);

  const artifactHash = sha256Text(
    `IC2024:${icHash}\nCOST1_2024:${costHash}\nacademicYear:${icArtifact.academicYear}\n`,
  );
  const connection = createDb(getConfig(), { max: 1 });
  let runId: string | undefined;
  let lockHeld = false;
  try {
    const lockResult = await connection.db.execute(sql`
      select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
    `);
    const lockRow = lockResult[0] as { acquired?: unknown } | undefined;
    if (lockRow?.acquired !== true)
      throw new Error('Another institution import is already running.');
    lockHeld = true;

    const universityIdByIpeds = await readIndexes(connection.db);
    const existingRuns = await connection.db
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
    const existingRun = existingRuns[0];
    let checkpoint: ReturnType<typeof getCheckpoint>;
    if (existingRun) {
      assertCounters(existingRun);
      checkpoint = getCheckpoint(existingRun.checkpoint);
      if (existingRun.status === 'completed') {
        if (
          checkpoint.phase !== 'completed' ||
          checkpoint.characteristicsSourceRow !== icInspection.rowCount ||
          checkpoint.costsSourceRow !== costInspection.rowCount
        ) {
          throw new Error('Completed IPEDS enrichment run has an incomplete checkpoint.');
        }
        assertCounters(existingRun, icInspection.rowCount + costInspection.rowCount);
        console.log(`IPEDS enrichment ${datasetVersion} is already fully imported.`);
        return;
      }
      runId = existingRun.id;
      await connection.db
        .update(importRuns)
        .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
    } else {
      checkpoint = {
        schemaVersion: 1,
        phase: 'characteristics',
        characteristicsSourceRow: 0,
        costsSourceRow: 0,
        characteristicsSourceRows: icInspection.rowCount,
        costsSourceRows: costInspection.rowCount,
        characteristicsSha256: icHash,
        costsSha256: costHash,
      };
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
      if (!createdRun) throw new Error('Failed to create the IPEDS enrichment run.');
      runId = createdRun.id;
    }

    const index = universityIdByIpeds;
    if (checkpoint.phase === 'characteristics') {
      const parser = createReadStream(icCsvPath).pipe(
        parse({ columns: true, bom: true, skip_empty_lines: true }),
      );
      let sourceRow = 0;
      let candidates: CharacteristicCandidate[] = [];
      let skipped = 0;
      let rejections: Rejection[] = [];
      const flush = async () => {
        if (!candidates.length && !skipped && !rejections.length) return;
        const checkpointRow = Math.max(
          sourceRow,
          ...candidates.map((item) => item.sourceRow),
          ...rejections.map((item) => item.sourceRow),
        );
        await connection.db.transaction((tx) =>
          flushCharacteristics(
            tx,
            runId as string,
            candidates,
            skipped,
            rejections,
            checkpointRow,
            checkpoint,
            icArtifact,
          ),
        );
        checkpoint = { ...checkpoint, characteristicsSourceRow: checkpointRow };
        candidates = [];
        skipped = 0;
        rejections = [];
      };
      for await (const value of parser) {
        sourceRow += 1;
        if (sourceRow <= checkpoint.characteristicsSourceRow) continue;
        const raw = value as RawRow;
        const parsed = rowSchema.safeParse(raw);
        if (!parsed.success) {
          rejections.push(makeRejection(raw, sourceRow, z.prettifyError(parsed.error)));
        } else {
          const universityId = index.get(parsed.data.UNITID);
          if (!universityId) skipped += 1;
          else {
            try {
              candidates.push(toCharacteristicCandidate(raw, sourceRow, universityId));
            } catch (error) {
              rejections.push(makeRejection(raw, sourceRow, error));
            }
          }
        }
        if (candidates.length + skipped + rejections.length >= chunkSize) await flush();
      }
      await flush();
      if (sourceRow !== icInspection.rowCount) {
        throw new Error(
          `IC2024 parser stopped at row ${sourceRow}, expected ${icInspection.rowCount}.`,
        );
      }
      checkpoint = { ...checkpoint, phase: 'costs', characteristicsSourceRow: sourceRow };
      await connection.db
        .update(importRuns)
        .set({ checkpoint, status: 'running', updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
    }

    if (checkpoint.phase === 'costs') {
      const parser = createReadStream(costCsvPath).pipe(
        parse({ columns: true, bom: true, skip_empty_lines: true }),
      );
      let sourceRow = 0;
      let candidates: CostCandidate[] = [];
      let skipped = 0;
      let rejections: Rejection[] = [];
      const flush = async () => {
        if (!candidates.length && !skipped && !rejections.length) return;
        const checkpointRow = Math.max(
          sourceRow,
          ...candidates.map((item) => item.sourceRow),
          ...rejections.map((item) => item.sourceRow),
        );
        await connection.db.transaction((tx) =>
          flushCosts(
            tx,
            runId as string,
            candidates,
            skipped,
            rejections,
            checkpointRow,
            checkpoint,
            costArtifact,
          ),
        );
        checkpoint = { ...checkpoint, costsSourceRow: checkpointRow };
        candidates = [];
        skipped = 0;
        rejections = [];
      };
      for await (const value of parser) {
        sourceRow += 1;
        if (sourceRow <= checkpoint.costsSourceRow) continue;
        const raw = value as RawRow;
        const parsed = rowSchema.safeParse(raw);
        if (!parsed.success) {
          rejections.push(makeRejection(raw, sourceRow, z.prettifyError(parsed.error)));
        } else {
          const universityId = index.get(parsed.data.UNITID);
          if (!universityId) skipped += 1;
          else {
            try {
              candidates.push(toCostCandidate(raw, sourceRow, universityId));
            } catch (error) {
              rejections.push(makeRejection(raw, sourceRow, error));
            }
          }
        }
        if (candidates.length + skipped + rejections.length >= chunkSize) await flush();
      }
      await flush();
      if (sourceRow !== costInspection.rowCount) {
        throw new Error(
          `COST1_2024 parser stopped at row ${sourceRow}, expected ${costInspection.rowCount}.`,
        );
      }
      checkpoint = { ...checkpoint, phase: 'completed', costsSourceRow: sourceRow };
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
      if (!currentRun) throw new Error('IPEDS enrichment run disappeared before finalization.');
      assertCounters(currentRun, icInspection.rowCount + costInspection.rowCount);
      await connection.db
        .update(importRuns)
        .set({ checkpoint, status: 'completed', finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
      console.log(
        `IPEDS enrichment complete: ${currentRun.updatedCount} matched rows, ${currentRun.skippedCount} unmatched rows, ${currentRun.rejectedCount} rejected rows.`,
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
        console.error('Failed to record the IPEDS enrichment error state:', statusError);
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
};

await run();

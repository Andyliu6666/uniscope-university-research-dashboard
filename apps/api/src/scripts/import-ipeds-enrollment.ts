import '../load-env.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { createDb, type Database } from '../db/client.js';
import { enrollmentSnapshots, importRuns, institutionIdentifiers, sources } from '../db/schema.js';

/**
 * Import the reviewed NCES IPEDS EF2024A fall-enrollment artifact.
 *
 * EF2024A is a long-format file. Each institution has one row for each
 * EFALEVEL, and those rows are overlapping views of the same students (for
 * example, total, undergraduate total, and full-time undergraduate total).
 * This importer intentionally writes one snapshot per official EFALEVEL and
 * never adds rows from different levels together.
 *
 * The importer is identity-only: a row is accepted only when its six-digit
 * UNITID already exists in institution_identifiers(provider = 'ipeds'). It
 * does not create or guess university identities.
 *
 * Usage:
 *   pnpm --filter @urd/api import:ipeds-enrollment [csv] [record-limit]
 *   pnpm --filter @urd/api import:ipeds-enrollment --dry-run [csv]
 *
 * A record limit is per invocation. The committed source-row checkpoint means
 * rerunning the same command resumes from the last committed row. Re-running
 * a completed artifact is safe and idempotent.
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDataDirectory = resolve(scriptDirectory, '../../../../data/sources');
const defaultCsvPath = resolve(repositoryDataDirectory, 'EF2024A.csv');
const sourceManifestPath = resolve(repositoryDataDirectory, 'ipeds-enrichment-artifacts.json');

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

const provider = 'ipeds-enrollment';
const datasetVersionFromFile = basename(csvPath).replace(/\.csv$/iu, '');
const chunkSize = 250;
const enrollmentInsertChunkSize = 1000;
const importLockName = 'uniscope:enrollment-import:v1';
const academicYearFrom = (reportedYear: string) => {
  if (!/^\d{4}$/u.test(reportedYear)) return reportedYear;
  const nextYear = String(Number(reportedYear) + 1).slice(-2);
  return `${reportedYear}-${nextYear}`;
};
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const reviewedArtifactSchema = z.object({
  datasetFile: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetRows: z.number().int().positive(),
  academicYear: z.string().regex(/^\d{4}$/u),
  sourceUrl: z.string().url().startsWith('https://'),
  publisher: z.string().min(1),
  retrievedAt: z.iso.datetime(),
});

const sourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifacts: z.array(reviewedArtifactSchema).min(1),
});

type ReviewedArtifact = z.infer<typeof reviewedArtifactSchema>;
type RawRow = Record<string, unknown>;
type SourceFlags = Record<string, unknown>;

type StudyLevel = 'all' | 'undergraduate' | 'graduate' | 'doctoral' | 'non_degree' | 'other';
type AttendanceStatus = 'all' | 'full_time' | 'part_time';

type EfaLevelDefinition = {
  level: StudyLevel;
  attendanceStatus: AttendanceStatus;
  population: string;
  label: string;
  section: '1' | '2' | '3';
  studyCode: '1' | '3' | '4';
};

/**
 * Official EF2024A EFALEVEL code meanings from the NCES EF2024A dictionary.
 * Populations are deliberately distinct even when their level is the same.
 */
const efaLevelDefinitions: Record<string, EfaLevelDefinition> = {
  '1': {
    level: 'all',
    attendanceStatus: 'all',
    population: 'total',
    label: 'All students total',
    section: '3',
    studyCode: '4',
  },
  '2': {
    level: 'undergraduate',
    attendanceStatus: 'all',
    population: 'undergraduate',
    label: 'All students, Undergraduate total',
    section: '3',
    studyCode: '1',
  },
  '3': {
    level: 'undergraduate',
    attendanceStatus: 'all',
    population: 'undergraduate_degree_seeking',
    label: 'All students, Undergraduate, Degree/certificate-seeking total',
    section: '3',
    studyCode: '1',
  },
  '4': {
    level: 'undergraduate',
    attendanceStatus: 'all',
    population: 'undergraduate_degree_seeking_first_time',
    label: 'All students, Undergraduate, Degree/certificate-seeking, First-time',
    section: '3',
    studyCode: '1',
  },
  '5': {
    level: 'undergraduate',
    attendanceStatus: 'all',
    population: 'undergraduate_degree_seeking_other',
    label:
      'All students, Undergraduate, Degree/certificate-seeking, Other degree/certificate-seeking',
    section: '3',
    studyCode: '1',
  },
  '11': {
    level: 'non_degree',
    attendanceStatus: 'all',
    population: 'undergraduate_non_degree',
    label: 'All students, Undergraduate, Non-degree/certificate-seeking',
    section: '3',
    studyCode: '1',
  },
  '12': {
    level: 'graduate',
    attendanceStatus: 'all',
    population: 'graduate',
    label: 'All students, Graduate',
    section: '3',
    studyCode: '3',
  },
  '19': {
    level: 'undergraduate',
    attendanceStatus: 'all',
    population: 'undergraduate_other_transfer_in',
    label: 'All students, Undergraduate, Other degree/certificate-seeking, Transfer-ins',
    section: '3',
    studyCode: '1',
  },
  '20': {
    level: 'undergraduate',
    attendanceStatus: 'all',
    population: 'undergraduate_other_continuing',
    label: 'All students, Undergraduate, Other degree/certificate-seeking, Continuing',
    section: '3',
    studyCode: '1',
  },
  '21': {
    level: 'all',
    attendanceStatus: 'full_time',
    population: 'full_time_total',
    label: 'Full-time students total',
    section: '1',
    studyCode: '4',
  },
  '22': {
    level: 'undergraduate',
    attendanceStatus: 'full_time',
    population: 'full_time_undergraduate',
    label: 'Full-time students, Undergraduate total',
    section: '1',
    studyCode: '1',
  },
  '23': {
    level: 'undergraduate',
    attendanceStatus: 'full_time',
    population: 'full_time_undergraduate_degree_seeking',
    label: 'Full-time students, Undergraduate, Degree/certificate-seeking total',
    section: '1',
    studyCode: '1',
  },
  '24': {
    level: 'undergraduate',
    attendanceStatus: 'full_time',
    population: 'full_time_undergraduate_degree_seeking_first_time',
    label: 'Full-time students, Undergraduate, Degree/certificate-seeking, First-time',
    section: '1',
    studyCode: '1',
  },
  '25': {
    level: 'undergraduate',
    attendanceStatus: 'full_time',
    population: 'full_time_undergraduate_degree_seeking_other',
    label: 'Full-time students, Undergraduate, Degree/certificate-seeking, Other degree-seeking',
    section: '1',
    studyCode: '1',
  },
  '31': {
    level: 'non_degree',
    attendanceStatus: 'full_time',
    population: 'full_time_undergraduate_non_degree',
    label: 'Full-time students, Undergraduate, Non-degree/certificate-seeking',
    section: '1',
    studyCode: '1',
  },
  '32': {
    level: 'graduate',
    attendanceStatus: 'full_time',
    population: 'full_time_graduate',
    label: 'Full-time students, Graduate',
    section: '1',
    studyCode: '3',
  },
  '39': {
    level: 'undergraduate',
    attendanceStatus: 'full_time',
    population: 'full_time_undergraduate_other_transfer_in',
    label: 'Full-time students, Undergraduate, Other degree/certificate-seeking, Transfer-ins',
    section: '1',
    studyCode: '1',
  },
  '40': {
    level: 'undergraduate',
    attendanceStatus: 'full_time',
    population: 'full_time_undergraduate_other_continuing',
    label: 'Full-time students, Undergraduate, Other degree/certificate-seeking, Continuing',
    section: '1',
    studyCode: '1',
  },
  '41': {
    level: 'all',
    attendanceStatus: 'part_time',
    population: 'part_time_total',
    label: 'Part-time students total',
    section: '2',
    studyCode: '4',
  },
  '42': {
    level: 'undergraduate',
    attendanceStatus: 'part_time',
    population: 'part_time_undergraduate',
    label: 'Part-time students, Undergraduate total',
    section: '2',
    studyCode: '1',
  },
  '43': {
    level: 'undergraduate',
    attendanceStatus: 'part_time',
    population: 'part_time_undergraduate_degree_seeking',
    label: 'Part-time students, Undergraduate, Degree/certificate-seeking total',
    section: '2',
    studyCode: '1',
  },
  '44': {
    level: 'undergraduate',
    attendanceStatus: 'part_time',
    population: 'part_time_undergraduate_degree_seeking_first_time',
    label: 'Part-time students, Undergraduate, Degree/certificate-seeking, First-time',
    section: '2',
    studyCode: '1',
  },
  '45': {
    level: 'undergraduate',
    attendanceStatus: 'part_time',
    population: 'part_time_undergraduate_degree_seeking_other',
    label: 'Part-time students, Undergraduate, Degree/certificate-seeking, Other degree-seeking',
    section: '2',
    studyCode: '1',
  },
  '51': {
    level: 'non_degree',
    attendanceStatus: 'part_time',
    population: 'part_time_undergraduate_non_degree',
    label: 'Part-time students, Undergraduate, Non-degree/certificate-seeking',
    section: '2',
    studyCode: '1',
  },
  '52': {
    level: 'graduate',
    attendanceStatus: 'part_time',
    population: 'part_time_graduate',
    label: 'Part-time students, Graduate',
    section: '2',
    studyCode: '3',
  },
  '59': {
    level: 'undergraduate',
    attendanceStatus: 'part_time',
    population: 'part_time_undergraduate_other_transfer_in',
    label: 'Part-time students, Undergraduate, Other degree/certificate-seeking, Transfer-ins',
    section: '2',
    studyCode: '1',
  },
  '60': {
    level: 'undergraduate',
    attendanceStatus: 'part_time',
    population: 'part_time_undergraduate_other_continuing',
    label: 'Part-time students, Undergraduate, Other degree/certificate-seeking, Continuing',
    section: '2',
    studyCode: '1',
  },
};

const expectedHeader = [
  'UNITID',
  'EFALEVEL',
  'LINE',
  'SECTION',
  'LSTUDY',
  'XEFTOTLT',
  'EFTOTLT',
  'XEFTOTLM',
  'EFTOTLM',
  'XEFTOTLW',
  'EFTOTLW',
  'XEFAIANT',
  'EFAIANT',
  'XEFAIANM',
  'EFAIANM',
  'XEFAIANW',
  'EFAIANW',
  'XEFASIAT',
  'EFASIAT',
  'XEFASIAM',
  'EFASIAM',
  'XEFASIAW',
  'EFASIAW',
  'XEFBKAAT',
  'EFBKAAT',
  'XEFBKAAM',
  'EFBKAAM',
  'XEFBKAAW',
  'EFBKAAW',
  'XEFHISPT',
  'EFHISPT',
  'XEFHISPM',
  'EFHISPM',
  'XEFHISPW',
  'EFHISPW',
  'XEFNHPIT',
  'EFNHPIT',
  'XEFNHPIM',
  'EFNHPIM',
  'XEFNHPIW',
  'EFNHPIW',
  'XEFWHITT',
  'EFWHITT',
  'XEFWHITM',
  'EFWHITM',
  'XEFWHITW',
  'EFWHITW',
  'XEF2MORT',
  'EF2MORT',
  'XEF2MORM',
  'EF2MORM',
  'XEF2MORW',
  'EF2MORW',
  'XEFUNKNT',
  'EFUNKNT',
  'XEFUNKNM',
  'EFUNKNM',
  'XEFUNKNW',
  'EFUNKNW',
  'XEFNRALT',
  'EFNRALT',
  'XEFNRALM',
  'EFNRALM',
  'XEFNRALW',
  'EFNRALW',
  'XEFGNDRUN',
  'EFGNDRUN',
  'XEFGNDRAN',
  'EFGNDRAN',
  'XEFGNDRUA',
  'EFGNDRUA',
  'XEFGNDRKN',
  'EFGNDRKN',
] as const;

const valueColumns = expectedHeader.filter(
  (column) => column.startsWith('EF') && column !== 'EFALEVEL',
);
const unitIdSchema = z.string().regex(/^\d{6}$/u);
const rowSchema = z
  .object({
    UNITID: unitIdSchema,
    EFALEVEL: z.string(),
    LINE: z.string(),
    SECTION: z.string(),
    LSTUDY: z.string(),
  })
  .passthrough();

const allowedImputationFlags = new Set([
  'A',
  'B',
  'C',
  'D',
  'G',
  'H',
  'J',
  'K',
  'L',
  'N',
  'P',
  'R',
  'S',
  'Z',
]);
const unavailableFlags = new Set(['A', 'B', 'D', 'H', 'S']);
const missingSentinels = new Set(['-1', '-2', '-3']);

type ParsedCount = { value: number | null; flag: string | null };
type ParsedRow = Record<string, string> & {
  UNITID: string;
  EFALEVEL: string;
  LINE: string;
  SECTION: string;
  LSTUDY: string;
};
type ValidatedRow = {
  parsed: ParsedRow;
  definition: EfaLevelDefinition;
  values: Map<string, ParsedCount>;
};

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const sha256Text = (value: string) => createHash('sha256').update(value).digest('hex');

const assertHeader = (columns: string[], label: string) => {
  const duplicateColumns = [
    ...new Set(columns.filter((column, index) => columns.indexOf(column) !== index)),
  ];
  if (duplicateColumns.length) {
    throw new Error(`${label} schema mismatch; duplicate columns: ${duplicateColumns.join(', ')}`);
  }
  if (
    columns.length !== expectedHeader.length ||
    columns.some((column, index) => column !== expectedHeader[index])
  ) {
    throw new Error(
      `${label} schema mismatch; expected the reviewed EF2024A header in the published order.`,
    );
  }
};

const asTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const parseFlag = (row: RawRow, column: string) => {
  const raw = asTrimmedString(row[column]).toUpperCase();
  if (raw && !allowedImputationFlags.has(raw)) {
    throw new Error(`${column} contains an unknown IPEDS imputation flag: ${raw}`);
  }
  return raw || null;
};

const parseCount = (row: RawRow, valueColumn: string, flagColumn: string): ParsedCount => {
  const raw = asTrimmedString(row[valueColumn]);
  const flag = parseFlag(row, flagColumn);
  if (!raw || missingSentinels.has(raw) || (flag && unavailableFlags.has(flag))) {
    if (raw === '' && flag && !unavailableFlags.has(flag)) {
      throw new Error(`${valueColumn} is blank but has usable imputation flag ${flag}`);
    }
    return { value: null, flag };
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${valueColumn} contains a value that is not a non-negative integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 2_147_483_647) {
    throw new Error(`${valueColumn} is outside the supported PostgreSQL integer range.`);
  }
  return { value, flag };
};

const parseCode = (row: RawRow, column: string, pattern: RegExp, label: string) => {
  const raw = asTrimmedString(row[column]);
  if (!pattern.test(raw)) throw new Error(`${column} contains an invalid ${label} code: ${raw}`);
  return raw;
};

const validateRow = (value: RawRow, sourceRow: number): ValidatedRow => {
  let parsed: ParsedRow;
  try {
    parsed = rowSchema.parse(value) as ParsedRow;
  } catch (error) {
    throw new Error(
      `Invalid EF2024A row ${sourceRow}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const efaLevel = asTrimmedString(parsed.EFALEVEL);
  const definition = efaLevelDefinitions[efaLevel];
  if (!definition) {
    throw new Error(`Unsupported EF2024A EFALEVEL code at row ${sourceRow}: ${efaLevel}`);
  }
  parseCode(parsed, 'LINE', /^\d{1,2}$/u, 'LINE');
  const section = parseCode(parsed, 'SECTION', /^[1-3]$/u, 'SECTION');
  const studyCode = parseCode(parsed, 'LSTUDY', /^[134]$/u, 'LSTUDY');
  if (section !== definition.section) {
    throw new Error(
      `EF2024A row ${sourceRow} EFALEVEL ${efaLevel} has SECTION ${section}; expected ${definition.section}.`,
    );
  }
  if (studyCode !== definition.studyCode) {
    throw new Error(
      `EF2024A row ${sourceRow} EFALEVEL ${efaLevel} has LSTUDY ${studyCode}; expected ${definition.studyCode}.`,
    );
  }
  const values = new Map<string, ParsedCount>();
  for (const valueColumn of valueColumns) {
    values.set(valueColumn, parseCount(parsed, valueColumn, `X${valueColumn}`));
  }
  return { parsed, definition, values };
};

type DatasetInspection = { rowCount: number };

const inspectArtifact = async (file: string): Promise<DatasetInspection> => {
  let columns: string[] = [];
  const parser = createReadStream(file).pipe(
    parse({
      columns: (header: string[]) => {
        columns = header;
        assertHeader(columns, 'EF2024A');
        return header;
      },
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }),
  );
  const seenKeys = new Set<string>();
  let rowCount = 0;
  for await (const value of parser) {
    rowCount += 1;
    const validated = validateRow(value as RawRow, rowCount);
    const key = `${validated.parsed.UNITID}:${validated.parsed.EFALEVEL}`;
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate EF2024A UNITID/EFALEVEL record at data row ${rowCount}: ${key}`);
    }
    seenKeys.add(key);
  }
  if (!columns.length) throw new Error('EF2024A artifact is missing its header.');
  if (!rowCount) throw new Error('EF2024A artifact contains no records.');
  return { rowCount };
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
  universityIds: string[],
  artifact: ReviewedArtifact,
  runId: string,
) => {
  const uniqueUniversityIds = [...new Set(universityIds)];
  if (!uniqueUniversityIds.length) return new Map<string, string>();
  const verifiedAt = new Date(artifact.retrievedAt);
  const rows = uniqueUniversityIds.map((universityId) => ({
    universityId,
    title: `NCES IPEDS EF2024A enrollment (${academicYearFrom(artifact.academicYear)})`,
    url: artifact.sourceUrl,
    category: 'government' as const,
    publisher: artifact.publisher,
    datasetVersion: datasetVersionFromFile,
    importRunId: runId,
    verifiedAt,
  }));
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

type ValidCandidate = {
  sourceRow: number;
  unitId: string;
  universityId: string;
  definition: EfaLevelDefinition;
  values: Map<string, ParsedCount>;
  efaLevelCode: string;
  line: string;
};

const toCandidate = (
  validated: ValidatedRow,
  sourceRow: number,
  universityId: string,
): ValidCandidate => ({
  sourceRow,
  unitId: validated.parsed.UNITID,
  universityId,
  definition: validated.definition,
  values: validated.values,
  efaLevelCode: validated.parsed.EFALEVEL,
  line: validated.parsed.LINE,
});

const buildFlags = (
  candidate: ValidCandidate,
  artifact: ReviewedArtifact,
  academicYear: string,
): SourceFlags => {
  const flags = Object.fromEntries(
    [...candidate.values.entries()]
      .filter(([, parsed]) => parsed.flag !== null)
      .map(([field, parsed]) => [field, parsed.flag]),
  );
  const total = candidate.values.get('EFTOTLT');
  const men = candidate.values.get('EFTOTLM');
  const women = candidate.values.get('EFTOTLW');
  return {
    datasetFile: artifact.datasetFile,
    datasetVersion: datasetVersionFromFile,
    sourceUrl: artifact.sourceUrl,
    sourceRetrievedAt: artifact.retrievedAt,
    reportedAcademicYear: artifact.academicYear,
    academicYear,
    sourceRow: candidate.sourceRow,
    ipedsUnitId: candidate.unitId,
    efaLevel: Number(candidate.efaLevelCode),
    efaLevelCode: candidate.efaLevelCode,
    efaLevelLabel: candidate.definition.label,
    line: Number(candidate.line),
    section: Number(candidate.definition.section),
    sectionLabel:
      candidate.definition.section === '1'
        ? 'Full-time'
        : candidate.definition.section === '2'
          ? 'Part-time'
          : 'All students',
    lstudy: Number(candidate.definition.studyCode),
    lstudyLabel:
      candidate.definition.studyCode === '1'
        ? 'Undergraduate'
        : candidate.definition.studyCode === '3'
          ? 'Graduate'
          : 'All students',
    studyLevel: candidate.definition.level,
    attendanceStatus: candidate.definition.attendanceStatus,
    population: candidate.definition.population,
    valueField: 'EFTOTLT',
    valueImputationFlag: total?.flag ?? null,
    genderTotals: { men: men?.value ?? null, women: women?.value ?? null },
    genderImputationFlags: { men: men?.flag ?? null, women: women?.flag ?? null },
    imputationFlags: flags,
  };
};

type CheckpointMetadata = {
  schemaVersion: 1;
  sourceFile: string;
  sourceSha256: string;
  sourceRows: number;
  sourceUrl: string;
  sourceRetrievedAt: string;
  reportedAcademicYear: string;
  academicYear: string;
  sourceRow: number;
};

const checkpointSchema = z.object({
  schemaVersion: z.literal(1),
  sourceFile: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRows: z.number().int().nonnegative(),
  sourceUrl: z.string().url().startsWith('https://'),
  sourceRetrievedAt: z.iso.datetime(),
  reportedAcademicYear: z.string().regex(/^\d{4}$/u),
  academicYear: z.string().regex(/^\d{4}(?:-\d{2,4})?$/u),
  sourceRow: z.number().int().nonnegative(),
});

const getCheckpoint = (
  value: unknown,
  metadata: Omit<CheckpointMetadata, 'sourceRow'>,
  maximumSourceRow: number,
): CheckpointMetadata => {
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Existing EF2024A run has an invalid checkpoint: ${z.prettifyError(parsed.error)}`,
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
    'reportedAcademicYear',
    'academicYear',
  ] as const) {
    if (checkpoint[key] !== metadata[key]) {
      throw new Error(
        `Existing EF2024A checkpoint metadata does not match the reviewed artifact (${key}).`,
      );
    }
  }
  if (checkpoint.sourceRows !== maximumSourceRow || checkpoint.sourceRow > maximumSourceRow) {
    throw new Error(
      'Existing EF2024A run has a source-row checkpoint outside the reviewed artifact.',
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
      `EF2024A import ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expectedProcessedCount !== undefined && run.processedCount !== expectedProcessedCount) {
    throw new Error(
      `EF2024A import is incomplete: processed ${run.processedCount}, expected ${expectedProcessedCount}.`,
    );
  }
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  candidates: ValidCandidate[],
  skipped: number,
  checkpointRow: number,
  checkpointMetadata: Omit<CheckpointMetadata, 'sourceRow'>,
  artifact: ReviewedArtifact,
  academicYear: string,
) => {
  const sourceByUniversityId = await upsertSourceRows(
    tx,
    candidates.map((candidate) => candidate.universityId),
    artifact,
    runId,
  );
  const total = candidates
    .map((candidate) => {
      const sourceId = sourceByUniversityId.get(candidate.universityId);
      const value = candidate.values.get('EFTOTLT');
      if (!sourceId) {
        throw new Error(`Failed to create source for IPEDS UnitID ${candidate.unitId}.`);
      }
      if (!value || value.value === null) return null;
      return {
        universityId: candidate.universityId,
        programId: null,
        academicYear,
        level: candidate.definition.level,
        attendanceStatus: candidate.definition.attendanceStatus,
        applicantType: 'all' as const,
        population: candidate.definition.population,
        studentCount: value.value,
        sourceId,
        sourceFlags: buildFlags(candidate, artifact, academicYear),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  let insertedCount = 0;
  for (let offset = 0; offset < total.length; offset += enrollmentInsertChunkSize) {
    const rows = total.slice(offset, offset + enrollmentInsertChunkSize);
    const inserted = await tx
      .insert(enrollmentSnapshots)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: enrollmentSnapshots.id });
    insertedCount += inserted.length;
  }
  const updatedCount = candidates.length - insertedCount;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpointMetadata, sourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${candidates.length + skipped}`,
      insertedCount: sql`${importRuns.insertedCount} + ${insertedCount}`,
      updatedCount: sql`${importRuns.updatedCount} + ${updatedCount}`,
      skippedCount: sql`${importRuns.skippedCount} + ${skipped}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
  return {
    processedCount: candidates.length + skipped,
    insertedCount,
    updatedCount,
    skippedCount: skipped,
  };
};

const run = async () => {
  const [csvHash, inspection, reviewedArtifact] = await Promise.all([
    sha256File(csvPath),
    inspectArtifact(csvPath),
    loadReviewedArtifact(csvPath),
  ]);
  const artifactProblems = [
    datasetVersionFromFile === reviewedArtifact.datasetFile.replace(/\.csv$/iu, '')
      ? null
      : `EF2024A file name is not the reviewed dataset: ${datasetVersionFromFile}`,
    csvHash === reviewedArtifact.datasetSha256
      ? null
      : 'EF2024A SHA-256 does not match the reviewed manifest',
    inspection.rowCount === reviewedArtifact.datasetRows
      ? null
      : `EF2024A row count is ${inspection.rowCount}, expected ${reviewedArtifact.datasetRows}`,
  ].filter((problem): problem is string => problem !== null);
  if (artifactProblems.length) {
    throw new Error(`Refusing unreviewed EF2024A artifact: ${artifactProblems.join('; ')}.`);
  }

  const academicYear = academicYearFrom(reviewedArtifact.academicYear);
  const checkpointMetadata: Omit<CheckpointMetadata, 'sourceRow'> = {
    schemaVersion: 1,
    sourceFile: reviewedArtifact.datasetFile,
    sourceSha256: csvHash,
    sourceRows: inspection.rowCount,
    sourceUrl: reviewedArtifact.sourceUrl,
    sourceRetrievedAt: reviewedArtifact.retrievedAt,
    reportedAcademicYear: reviewedArtifact.academicYear,
    academicYear,
  };

  if (dryRun) {
    let rows = 0;
    let validRows = 0;
    let matchedFacts = 0;
    const parser = createReadStream(csvPath).pipe(
      parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }),
    );
    for await (const value of parser) {
      rows += 1;
      const validated = validateRow(value as RawRow, rows);
      validRows += 1;
      if (validated.values.get('EFTOTLT')?.value !== null) matchedFacts += 1;
    }
    console.log(
      `EF2024A dry run: ${validRows} valid rows, ${matchedFacts} enrollment facts, ${inspection.rowCount - validRows} rejected rows. No database was changed.`,
    );
    return;
  }

  const artifactHash = sha256Text(`${provider}:${csvHash}\n`);
  const connection = createDb(getConfig(), { max: 1 });
  let runId: string | undefined;
  let lockHeld = false;
  try {
    const lockResult = await connection.db.execute(sql`
      select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
    `);
    const lockRow = lockResult[0] as { acquired?: unknown } | undefined;
    if (lockRow?.acquired !== true)
      throw new Error('Another enrollment import is already running.');
    lockHeld = true;

    const universityIdByIpeds = await readIndexes(connection.db);
    const existingRuns = await connection.db
      .select()
      .from(importRuns)
      .where(
        and(
          eq(importRuns.provider, provider),
          eq(importRuns.datasetVersion, datasetVersionFromFile),
          eq(importRuns.artifactHash, artifactHash),
        ),
      )
      .limit(1);
    const existingRun = existingRuns[0];
    let checkpoint: CheckpointMetadata;
    if (existingRun) {
      assertRunCounters(existingRun);
      checkpoint = getCheckpoint(existingRun.checkpoint, checkpointMetadata, inspection.rowCount);
      if (existingRun.processedCount !== checkpoint.sourceRow) {
        throw new Error(
          `EF2024A import ledger/checkpoint mismatch: processed ${existingRun.processedCount}, checkpoint ${checkpoint.sourceRow}.`,
        );
      }
      if (existingRun.status === 'completed') {
        if (checkpoint.sourceRow !== inspection.rowCount) {
          throw new Error('Completed EF2024A run has an incomplete source-row checkpoint.');
        }
        assertRunCounters(existingRun, inspection.rowCount);
        console.log(
          `IPEDS enrollment dataset ${datasetVersionFromFile} (${artifactHash.slice(0, 12)}) is already fully imported.`,
        );
        return;
      }
      runId = existingRun.id;
      await connection.db
        .update(importRuns)
        .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
    } else {
      checkpoint = { ...checkpointMetadata, sourceRow: 0 };
      const [createdRun] = await connection.db
        .insert(importRuns)
        .values({
          provider,
          datasetVersion: datasetVersionFromFile,
          artifactHash,
          status: 'running',
          checkpoint,
        })
        .returning({ id: importRuns.id });
      if (!createdRun) throw new Error('Failed to create the EF2024A import run.');
      runId = createdRun.id;
    }

    const parser = createReadStream(csvPath).pipe(
      parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }),
    );
    let sourceRow = 0;
    let processedThisRun = 0;
    let insertedThisRun = 0;
    let updatedThisRun = 0;
    let skippedThisRun = 0;
    let candidates: ValidCandidate[] = [];
    let skipped = 0;
    let exhausted = true;
    const resumeAfterRow = checkpoint.sourceRow;
    let lastLoggedSourceRow = resumeAfterRow;

    const flush = async () => {
      if (!runId || (!candidates.length && !skipped)) return;
      const result = await connection.db.transaction((tx) =>
        flushChunk(
          tx,
          runId as string,
          candidates,
          skipped,
          sourceRow,
          checkpointMetadata,
          reviewedArtifact,
          academicYear,
        ),
      );
      processedThisRun += result.processedCount;
      insertedThisRun += result.insertedCount;
      updatedThisRun += result.updatedCount;
      skippedThisRun += result.skippedCount;
      checkpoint = { ...checkpointMetadata, sourceRow };
      candidates = [];
      skipped = 0;
      if (
        checkpoint.sourceRow === inspection.rowCount ||
        checkpoint.sourceRow - lastLoggedSourceRow >= 5000 ||
        processedThisRun >= requestedLimit
      ) {
        lastLoggedSourceRow = checkpoint.sourceRow;
        console.log(
          `IPEDS enrollment progress: ${checkpoint.sourceRow}/${inspection.rowCount} source rows; ${insertedThisRun} facts inserted, ${updatedThisRun} already present, ${skippedThisRun} identities skipped.`,
        );
      }
    };

    for await (const value of parser) {
      sourceRow += 1;
      if (sourceRow <= resumeAfterRow) continue;
      const validated = validateRow(value as RawRow, sourceRow);
      const universityId = universityIdByIpeds.get(validated.parsed.UNITID);
      if (!universityId) skipped += 1;
      else candidates.push(toCandidate(validated, sourceRow, universityId));
      const bufferedRows = candidates.length + skipped;
      if (bufferedRows >= chunkSize || bufferedRows >= requestedLimit - processedThisRun) {
        await flush();
        if (processedThisRun >= requestedLimit) {
          exhausted = false;
          break;
        }
      }
    }
    if (exhausted) await flush();
    if (exhausted && sourceRow !== inspection.rowCount) {
      throw new Error(
        `EF2024A parser stopped at source row ${sourceRow}, expected ${inspection.rowCount}.`,
      );
    }
    if (!runId) throw new Error('EF2024A import run disappeared before finalization.');
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
    if (!currentRun) throw new Error('EF2024A import run disappeared before finalization.');
    assertRunCounters(currentRun, exhausted ? inspection.rowCount : undefined);
    await connection.db
      .update(importRuns)
      .set({
        checkpoint: { ...checkpointMetadata, sourceRow },
        status: exhausted ? 'completed' : 'paused',
        finishedAt: exhausted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));
    console.log(
      exhausted
        ? `IPEDS enrollment complete: ${currentRun.insertedCount} facts inserted, ${currentRun.updatedCount} already present, ${currentRun.skippedCount} identities skipped.`
        : `IPEDS enrollment batch paused cleanly at source row ${sourceRow}; rerun the same command to resume.`,
    );
  } catch (error) {
    if (runId) {
      try {
        await connection.db
          .update(importRuns)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } catch (statusError) {
        console.error('Failed to record the EF2024A import error state:', statusError);
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
      console.error('Failed to release the enrollment import lock:', unlockError);
    } finally {
      await connection.close();
    }
  }
};

await run();

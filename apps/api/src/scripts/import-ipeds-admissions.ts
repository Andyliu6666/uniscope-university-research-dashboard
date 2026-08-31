import '../load-env.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { createDb, type Database } from '../db/client.js';
import {
  admissionCounts,
  admissionProfiles,
  admissionRequirements,
  admissionTestScores,
  importRejections,
  importRuns,
  institutionIdentifiers,
  sources,
} from '../db/schema.js';

/**
 * Import the reviewed NCES IPEDS ADM2024 artifact.
 *
 * The importer is intentionally a data-only importer. It never creates an
 * institution from a name match: every row must already have a six-digit
 * IPEDS identity in institution_identifiers. This prevents a spelling change
 * or a campus row from creating a duplicate university profile.
 *
 * Usage:
 *   pnpm --filter @urd/api import:ipeds-admissions [csv] [record-limit]
 *
 * The same command can be rerun after a failure or a pause. A checkpoint is
 * committed with each batch, and a PostgreSQL advisory lock prevents two
 * admission imports from writing at the same time.
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDataDirectory = resolve(scriptDirectory, '../../../../data/sources');
const defaultCsvPath = resolve(repositoryDataDirectory, 'ADM2024.csv');
const sourceManifestPath = resolve(repositoryDataDirectory, 'ipeds-enrichment-artifacts.json');

const rawArguments = process.argv.slice(2);
if (rawArguments[0] === '--') rawArguments.shift();
const dryRun = rawArguments.includes('--dry-run');
const positionalArguments = rawArguments.filter((argument) => argument !== '--dry-run');
const csvPath = resolve(positionalArguments[0] ?? defaultCsvPath);
const requestedLimitArgument = positionalArguments[1] ?? '3000';
const requestedLimit = /^\d+$/u.test(requestedLimitArgument)
  ? Number(requestedLimitArgument)
  : Number.NaN;
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('record-limit must be a positive base-10 safe integer.');
}

const provider = 'ipeds-admissions';
const datasetVersionFromFile = basename(csvPath).replace(/\.csv$/iu, '');
const chunkSize = 250;
const importLockName = 'uniscope:admissions-import:v1';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const admissionConsiderations = [
  {
    field: 'ADMCON1',
    category: 'academic' as const,
    requirementKey: 'secondary_school_gpa',
    label: 'Secondary school GPA',
  },
  {
    field: 'ADMCON2',
    category: 'academic' as const,
    requirementKey: 'secondary_school_rank',
    label: 'Secondary school rank',
  },
  {
    field: 'ADMCON3',
    category: 'academic' as const,
    requirementKey: 'secondary_school_record',
    label: 'Secondary school record',
  },
  {
    field: 'ADMCON4',
    category: 'academic' as const,
    requirementKey: 'college_preparatory_program',
    label: 'Completion of college-preparatory program',
  },
  {
    field: 'ADMCON5',
    category: 'application' as const,
    requirementKey: 'recommendations',
    label: 'Recommendations',
  },
  {
    field: 'ADMCON6',
    category: 'application' as const,
    requirementKey: 'formal_competency_demonstration',
    label: 'Formal demonstration of competencies',
  },
  {
    field: 'ADMCON7',
    category: 'standardized_test' as const,
    requirementKey: 'admission_test_scores',
    label: 'Admission test scores (SAT, ACT, etc.)',
  },
  {
    field: 'ADMCON8',
    category: 'language' as const,
    requirementKey: 'english_proficiency_test',
    label: 'English proficiency test (for applicable students)',
  },
  {
    field: 'ADMCON9',
    category: 'standardized_test' as const,
    requirementKey: 'other_admission_test',
    label: 'Other test (Wonderlic, WISC-III, etc.)',
  },
  {
    field: 'ADMCON10',
    category: 'experience' as const,
    requirementKey: 'work_experience',
    label: 'Work experience',
  },
  {
    field: 'ADMCON11',
    category: 'application' as const,
    requirementKey: 'personal_statement_or_essay',
    label: 'Personal statement or essay',
  },
  {
    field: 'ADMCON12',
    category: 'application' as const,
    requirementKey: 'legacy_status',
    label: 'Legacy status',
  },
] as const;

const countSpecifications = [
  { field: 'APPLCN', metric: 'applicants' as const, population: 'all' },
  { field: 'APPLCNM', metric: 'applicants' as const, population: 'men' },
  { field: 'APPLCNW', metric: 'applicants' as const, population: 'women' },
  { field: 'APPLCNAN', metric: 'applicants' as const, population: 'another_gender' },
  { field: 'APPLCNUN', metric: 'applicants' as const, population: 'gender_unknown' },
  { field: 'ADMSSN', metric: 'admitted' as const, population: 'all' },
  { field: 'ADMSSNM', metric: 'admitted' as const, population: 'men' },
  { field: 'ADMSSNW', metric: 'admitted' as const, population: 'women' },
  { field: 'ADMSSNAN', metric: 'admitted' as const, population: 'another_gender' },
  { field: 'ADMSSNUN', metric: 'admitted' as const, population: 'gender_unknown' },
  { field: 'ENRLT', metric: 'enrolled' as const, population: 'all' },
  { field: 'ENRLM', metric: 'enrolled' as const, population: 'men' },
  { field: 'ENRLW', metric: 'enrolled' as const, population: 'women' },
  { field: 'ENRLAN', metric: 'enrolled' as const, population: 'another_gender' },
  { field: 'ENRLUN', metric: 'enrolled' as const, population: 'gender_unknown' },
  { field: 'ENRLFT', metric: 'enrolled' as const, population: 'full_time' },
  { field: 'ENRLFTM', metric: 'enrolled' as const, population: 'full_time_men' },
  { field: 'ENRLFTW', metric: 'enrolled' as const, population: 'full_time_women' },
  { field: 'ENRLFTAN', metric: 'enrolled' as const, population: 'full_time_another_gender' },
  { field: 'ENRLFTUN', metric: 'enrolled' as const, population: 'full_time_gender_unknown' },
  { field: 'ENRLPT', metric: 'enrolled' as const, population: 'part_time' },
  { field: 'ENRLPTM', metric: 'enrolled' as const, population: 'part_time_men' },
  { field: 'ENRLPTW', metric: 'enrolled' as const, population: 'part_time_women' },
  { field: 'ENRLPTAN', metric: 'enrolled' as const, population: 'part_time_another_gender' },
  { field: 'ENRLPTUN', metric: 'enrolled' as const, population: 'part_time_gender_unknown' },
] as const;

const testSpecifications = [
  {
    testName: 'SAT',
    section: 'evidence_based_reading_writing',
    scoreScale: '200-800',
    submittersCount: 'SATNUM',
    submittersPercent: 'SATPCT',
    percentile25: 'SATVR25',
    percentile50: 'SATVR50',
    percentile75: 'SATVR75',
  },
  {
    testName: 'SAT',
    section: 'math',
    scoreScale: '200-800',
    submittersCount: 'SATNUM',
    submittersPercent: 'SATPCT',
    percentile25: 'SATMT25',
    percentile50: 'SATMT50',
    percentile75: 'SATMT75',
  },
  {
    testName: 'ACT',
    section: 'composite',
    scoreScale: '1-36',
    submittersCount: 'ACTNUM',
    submittersPercent: 'ACTPCT',
    percentile25: 'ACTCM25',
    percentile50: 'ACTCM50',
    percentile75: 'ACTCM75',
  },
  {
    testName: 'ACT',
    section: 'english',
    scoreScale: '1-36',
    submittersCount: 'ACTNUM',
    submittersPercent: 'ACTPCT',
    percentile25: 'ACTEN25',
    percentile50: 'ACTEN50',
    percentile75: 'ACTEN75',
  },
  {
    testName: 'ACT',
    section: 'math',
    scoreScale: '1-36',
    submittersCount: 'ACTNUM',
    submittersPercent: 'ACTPCT',
    percentile25: 'ACTMT25',
    percentile50: 'ACTMT50',
    percentile75: 'ACTMT75',
  },
] as const;

// This order is part of the reviewed ADM2024 schema. The SAT/ACT submitter
// columns occur before their percentile columns in the NCES export.
const continuousFields = [
  ...countSpecifications.map((item) => item.field),
  'SATNUM',
  'SATPCT',
  'ACTNUM',
  'ACTPCT',
  'SATVR25',
  'SATVR50',
  'SATVR75',
  'SATMT25',
  'SATMT50',
  'SATMT75',
  'ACTCM25',
  'ACTCM50',
  'ACTCM75',
  'ACTEN25',
  'ACTEN50',
  'ACTEN75',
  'ACTMT25',
  'ACTMT50',
  'ACTMT75',
];
const expectedColumns = [
  'UNITID',
  ...admissionConsiderations.map((item) => item.field),
  ...continuousFields.flatMap((field) => [`X${field}`, field]),
];

const reviewedArtifactSchema = z.object({
  datasetFile: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetRows: z.number().int().positive(),
  academicYear: z.string().regex(/^\d{4}$/u),
  sourceUrl: z.url(),
  publisher: z.string().min(1),
  retrievedAt: z.iso.datetime(),
  notes: z.string().min(1),
});
const sourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifacts: z.array(reviewedArtifactSchema).min(1),
});

type ReviewedArtifact = z.infer<typeof reviewedArtifactSchema>;
type SourceFlag = 'A' | 'B' | 'C' | 'D' | 'G' | 'H' | 'J' | 'K' | 'L' | 'N' | 'P' | 'R' | 'S' | 'Z';
type ValueState = 'reported' | 'implied_zero' | 'imputed' | 'unavailable';
type ParsedValue = {
  value: number | null;
  flag: SourceFlag | null;
  state: ValueState;
  rawValue: string;
};

type CountFact = {
  metric: 'applicants' | 'admitted' | 'enrolled';
  population: string;
  value: number;
  sourceFlags: Record<string, unknown>;
};
type RequirementFact = {
  category: 'academic' | 'application' | 'language' | 'standardized_test' | 'experience';
  requirementKey: string;
  label: string;
  status: 'required' | 'optional' | 'not_considered';
  details: string;
  sourceFlags: Record<string, unknown>;
};
type TestScoreFact = {
  testName: string;
  section: string;
  context: 'enrolled_students';
  submittersCount: number | null;
  submittersPercent: number | null;
  percentile25: number | null;
  percentile50: number | null;
  percentile75: number | null;
  scoreScale: string;
  sourceFlags: Record<string, unknown>;
};
type AdmissionCandidate = {
  sourceRow: number;
  unitId: string;
  counts: CountFact[];
  requirements: RequirementFact[];
  testScores: TestScoreFact[];
};
type Rejection = {
  sourceRow: number;
  externalId: string | null;
  reason: string;
  payloadHash: string;
  payload: unknown;
};
type AdmissionRow = { candidate: AdmissionCandidate } | { rejection: Rejection };
type CheckpointMetadata = {
  sourceDownloadUrl: string;
  sourceSha256: string;
  sourceRows: number;
  academicYear: string;
  sourceRetrievedAt: string;
};

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};
const sha256Text = (value: string) => createHash('sha256').update(value).digest('hex');
const payloadHash = (payload: unknown) => sha256Text(JSON.stringify(payload));

const sourceFlagMeanings: Record<SourceFlag, string> = {
  A: 'Not applicable',
  B: 'Institution left item blank',
  C: 'Analyst corrected reported value',
  D: 'Do not know',
  G: 'Data generated from other data values',
  H: 'Value not derived; data not usable',
  J: 'Logical imputation',
  K: 'Ratio adjustment',
  L: 'Imputed using the Group Median procedure',
  N: 'Imputed using Nearest Neighbor procedure',
  P: 'Imputed using Carry Forward procedure',
  R: 'Reported',
  S: 'Suppressed for confidentiality',
  Z: 'Implied zero',
};
const sourceFlags = new Set(Object.keys(sourceFlagMeanings));

const parseInteger = (raw: Record<string, string>, field: string): ParsedValue => {
  const rawFlagText = (raw[`X${field}`] ?? '').trim().toUpperCase();
  if (rawFlagText && !sourceFlags.has(rawFlagText)) {
    throw new Error(`Unknown IPEDS imputation flag ${rawFlagText} for ${field}.`);
  }
  const flag = rawFlagText ? (rawFlagText as SourceFlag) : null;
  const rawValue = (raw[field] ?? '').trim();
  if (
    !rawValue ||
    ['-1', '-2', '-3'].includes(rawValue) ||
    ['A', 'B', 'D', 'H', 'S'].includes(rawFlagText)
  ) {
    return {
      value: null,
      flag,
      state: 'unavailable',
      rawValue,
    };
  }
  if (!/^\d+$/u.test(rawValue)) {
    throw new Error(`Expected a non-negative integer for ${field}, received ${rawValue}.`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value))
    throw new Error(`Value for ${field} exceeds safe integer range.`);
  return {
    value,
    flag,
    state:
      rawFlagText === 'Z'
        ? 'implied_zero'
        : ['J', 'K', 'L', 'N', 'P'].includes(rawFlagText)
          ? 'imputed'
          : 'reported',
    rawValue,
  };
};

const valueFlag = (field: string, parsed: ParsedValue) => ({
  dataset: 'IPEDS ADM2024',
  variable: field,
  rawValue: parsed.rawValue,
  sourceFlag: parsed.flag,
  sourceFlagMeaning: parsed.flag ? sourceFlagMeanings[parsed.flag] : null,
  state: parsed.state,
});

const numericString = (value: number | null) => (value === null ? null : value.toString());

const assertCsvColumns = (columns: string[]) => {
  const duplicateColumns = [
    ...new Set(columns.filter((column, index) => columns.indexOf(column) !== index)),
  ];
  if (duplicateColumns.length)
    throw new Error(`ADM2024 has duplicate columns: ${duplicateColumns.join(', ')}`);
  if (
    columns.length !== expectedColumns.length ||
    columns.some((column, index) => column !== expectedColumns[index])
  ) {
    const mismatchIndex = columns.findIndex((column, index) => column !== expectedColumns[index]);
    const position = mismatchIndex < 0 ? columns.length : mismatchIndex;
    throw new Error(
      `ADM2024 schema mismatch at column ${position + 1}: expected ${expectedColumns[position] ?? '(end of file)'}, received ${columns[position] ?? '(end of file)'}.`,
    );
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
    const row = value as Record<string, string>;
    const unitId = row.UNITID?.trim();
    if (!unitId || !/^\d{6}$/u.test(unitId)) {
      throw new Error(`Invalid ADM2024 UNITID at data row ${rowCount}: ${String(row.UNITID)}.`);
    }
    if (unitIds.has(unitId)) throw new Error(`Duplicate ADM2024 UNITID in artifact: ${unitId}.`);
    unitIds.add(unitId);
  }
  assertCsvColumns(columns);
  if (!rowCount) throw new Error('ADM2024 artifact contains no records.');
  return { rowCount };
};

const loadReviewedArtifact = async (): Promise<ReviewedArtifact> => {
  const raw = await readFile(sourceManifestPath, 'utf8');
  const parsed = sourceManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success)
    throw new Error(`Invalid IPEDS enrichment manifest: ${z.prettifyError(parsed.error)}`);
  const artifact = parsed.data.artifacts.find((item) => item.datasetFile === basename(csvPath));
  if (!artifact)
    throw new Error(
      `ADM artifact is not reviewed in ${basename(sourceManifestPath)}: ${basename(csvPath)}.`,
    );
  return artifact;
};

const toAdmissionRow = (raw: Record<string, string>, sourceRow: number): AdmissionRow => {
  try {
    const unitId = raw.UNITID?.trim();
    if (!unitId || !/^\d{6}$/u.test(unitId))
      throw new Error(`UNITID must be a six-digit value; received ${String(raw.UNITID)}.`);

    const requirements = admissionConsiderations.map((specification) => {
      const code = (raw[specification.field] ?? '').trim();
      const status =
        code === '1'
          ? 'required'
          : code === '5'
            ? 'optional'
            : code === '3'
              ? 'not_considered'
              : null;
      if (!status)
        throw new Error(
          `${specification.field} must be 1, 3, or 5; received ${code || '(blank)'}.`,
        );
      const details =
        status === 'required'
          ? 'Required to be considered for admission.'
          : status === 'optional'
            ? 'Not required for admission, but considered if submitted.'
            : 'Not considered for admission, even if submitted.';
      return {
        category: specification.category,
        requirementKey: specification.requirementKey,
        label: specification.label,
        status,
        details,
        sourceFlags: {
          dataset: 'IPEDS ADM2024',
          variable: specification.field,
          rawValue: code,
          interpretation: details,
        },
      } satisfies RequirementFact;
    });

    const counts: CountFact[] = [];
    for (const specification of countSpecifications) {
      const parsed = parseInteger(raw, specification.field);
      if (parsed.value !== null) {
        counts.push({
          metric: specification.metric,
          population: specification.population,
          value: parsed.value,
          sourceFlags: valueFlag(specification.field, parsed),
        });
      }
    }

    const testScores: TestScoreFact[] = [];
    for (const specification of testSpecifications) {
      const submittersCount = parseInteger(raw, specification.submittersCount);
      const submittersPercent = parseInteger(raw, specification.submittersPercent);
      const percentile25 = parseInteger(raw, specification.percentile25);
      const percentile50 = parseInteger(raw, specification.percentile50);
      const percentile75 = parseInteger(raw, specification.percentile75);
      if ([percentile25, percentile50, percentile75].some((item) => item.value !== null)) {
        testScores.push({
          testName: specification.testName,
          section: specification.section,
          context: 'enrolled_students',
          submittersCount: submittersCount.value,
          submittersPercent: submittersPercent.value,
          percentile25: percentile25.value,
          percentile50: percentile50.value,
          percentile75: percentile75.value,
          scoreScale: specification.scoreScale,
          sourceFlags: {
            dataset: 'IPEDS ADM2024',
            context: 'first-time degree/certificate-seeking undergraduate students',
            submittersCount: valueFlag(specification.submittersCount, submittersCount),
            submittersPercent: valueFlag(specification.submittersPercent, submittersPercent),
            percentile25: valueFlag(specification.percentile25, percentile25),
            percentile50: valueFlag(specification.percentile50, percentile50),
            percentile75: valueFlag(specification.percentile75, percentile75),
          },
        });
      }
    }

    return { candidate: { sourceRow, unitId, counts, requirements, testScores } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      rejection: {
        sourceRow,
        externalId: typeof raw.UNITID === 'string' ? raw.UNITID : null,
        reason,
        payloadHash: payloadHash(raw),
        payload: raw,
      },
    };
  }
};

const existingRunFor = async (db: Database, artifactHash: string) => {
  const [run] = await db
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
  return run;
};

const sourceRowFromCheckpoint = (
  checkpoint: unknown,
  maximumSourceRow: number,
  required: boolean,
) => {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    if (required) throw new Error('Existing ADM2024 run has an invalid checkpoint object.');
    return 0;
  }
  const sourceRow = (checkpoint as Record<string, unknown>).sourceRow;
  if (
    typeof sourceRow !== 'number' ||
    !Number.isInteger(sourceRow) ||
    sourceRow < 0 ||
    sourceRow > maximumSourceRow
  ) {
    if (required)
      throw new Error(
        `Existing ADM2024 run has an invalid sourceRow checkpoint: ${String(sourceRow)}.`,
      );
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
      `ADM2024 import ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expectedProcessedCount !== undefined && run.processedCount !== expectedProcessedCount) {
    throw new Error(
      `ADM2024 import is incomplete: processed ${run.processedCount}, expected ${expectedProcessedCount}.`,
    );
  }
};

const flushChunk = async (
  tx: Tx,
  runId: string,
  candidates: AdmissionCandidate[],
  rejections: Rejection[],
  checkpointRow: number,
  artifact: ReviewedArtifact,
  checkpointMetadata: CheckpointMetadata,
) => {
  const unitIds = candidates.map((item) => item.unitId);
  const identifierRows = unitIds.length
    ? await tx
        .select({
          externalId: institutionIdentifiers.externalId,
          universityId: institutionIdentifiers.universityId,
        })
        .from(institutionIdentifiers)
        .where(
          and(
            eq(institutionIdentifiers.provider, 'ipeds'),
            inArray(institutionIdentifiers.externalId, unitIds),
          ),
        )
    : [];
  const universityIdByUnitId = new Map(
    identifierRows.map((item) => [item.externalId, item.universityId]),
  );
  const acceptedCandidates: Array<AdmissionCandidate & { universityId: string }> = [];
  const identityRejections: Rejection[] = [];
  for (const candidate of candidates) {
    const universityId = universityIdByUnitId.get(candidate.unitId);
    if (!universityId) {
      identityRejections.push({
        sourceRow: candidate.sourceRow,
        externalId: candidate.unitId,
        reason:
          'No imported university profile has this IPEDS UNITID; identity-only matching refused a new profile.',
        payloadHash: payloadHash(candidate),
        payload: candidate,
      });
    } else {
      acceptedCandidates.push({ ...candidate, universityId });
    }
  }

  const sourceByUniversityId = new Map<string, string>();
  const verifiedAt = new Date(artifact.retrievedAt);
  for (const universityId of [...new Set(acceptedCandidates.map((item) => item.universityId))]) {
    const [source] = await tx
      .insert(sources)
      .values({
        universityId,
        title: `NCES IPEDS Admissions (${datasetVersionFromFile})`,
        url: artifact.sourceUrl,
        category: 'government',
        publisher: artifact.publisher,
        datasetVersion: datasetVersionFromFile,
        importRunId: runId,
        verifiedAt,
      })
      .onConflictDoUpdate({
        target: [sources.universityId, sources.url],
        set: {
          title: sql`excluded.title`,
          category: 'government',
          publisher: sql`excluded.publisher`,
          datasetVersion: sql`excluded.dataset_version`,
          importRunId: sql`excluded.import_run_id`,
          verifiedAt: sql`excluded.verified_at`,
        },
      })
      .returning({ id: sources.id });
    if (!source) throw new Error(`Failed to create source row for university ${universityId}.`);
    sourceByUniversityId.set(universityId, source.id);
  }

  const existingProfiles = acceptedCandidates.length
    ? await tx
        .select({
          id: admissionProfiles.id,
          universityId: admissionProfiles.universityId,
          sourceId: admissionProfiles.sourceId,
        })
        .from(admissionProfiles)
        .where(
          and(
            inArray(
              admissionProfiles.universityId,
              acceptedCandidates.map((item) => item.universityId),
            ),
            isNull(admissionProfiles.programId),
            eq(admissionProfiles.academicYear, artifact.academicYear),
            eq(admissionProfiles.intakeTerm, 'fall'),
            eq(admissionProfiles.entryType, 'first_year'),
            eq(admissionProfiles.level, 'undergraduate'),
            eq(admissionProfiles.applicantType, 'all'),
          ),
        )
    : [];
  const profileByUniversityId = new Map(existingProfiles.map((item) => [item.universityId, item]));
  const profileIdByUniversityId = new Map<string, string>();
  let insertedCount = 0;
  let updatedCount = 0;
  const scopeNotes =
    'IPEDS ADM2024 covers first-time, degree/certificate-seeking undergraduate admissions for the most recent fall period reported by each institution. It includes early decision, early action, and students who began in the preceding summer; it does not provide international- or program-specific requirements.';

  for (const candidate of acceptedCandidates) {
    const sourceId = sourceByUniversityId.get(candidate.universityId);
    if (!sourceId) throw new Error(`Missing source for university ${candidate.universityId}.`);
    const sourceFlags = {
      dataset: datasetVersionFromFile,
      scope: 'first-time degree/certificate-seeking undergraduate students',
      sourceRow: candidate.sourceRow,
      sourceUrl: artifact.sourceUrl,
    };
    const existing = profileByUniversityId.get(candidate.universityId);
    if (existing) {
      await tx
        .update(admissionProfiles)
        .set({
          intakeTerm: 'fall',
          entryType: 'first_year',
          level: 'undergraduate',
          applicantType: 'all',
          openAdmission: false,
          applicationUrl: null,
          notes: scopeNotes,
          sourceId,
          sourceFlags,
          updatedAt: verifiedAt,
        })
        .where(eq(admissionProfiles.id, existing.id));
      profileIdByUniversityId.set(candidate.universityId, existing.id);
      updatedCount += 1;
    } else {
      const [created] = await tx
        .insert(admissionProfiles)
        .values({
          universityId: candidate.universityId,
          academicYear: artifact.academicYear,
          intakeTerm: 'fall',
          entryType: 'first_year',
          level: 'undergraduate',
          applicantType: 'all',
          openAdmission: false,
          applicationUrl: null,
          notes: scopeNotes,
          sourceId,
          sourceFlags,
          updatedAt: verifiedAt,
        })
        .returning({ id: admissionProfiles.id });
      if (!created) throw new Error(`Failed to create admission profile for ${candidate.unitId}.`);
      profileIdByUniversityId.set(candidate.universityId, created.id);
      insertedCount += 1;
    }
  }

  const countRows = acceptedCandidates.flatMap((candidate) => {
    const profileId = profileIdByUniversityId.get(candidate.universityId);
    const sourceId = sourceByUniversityId.get(candidate.universityId);
    if (!profileId || !sourceId) throw new Error(`Missing profile/source for ${candidate.unitId}.`);
    return candidate.counts.map((fact) => ({
      admissionProfileId: profileId,
      metric: fact.metric,
      population: fact.population,
      value: fact.value,
      sourceId,
      sourceFlags: { ...fact.sourceFlags, sourceRow: candidate.sourceRow },
    }));
  });
  if (countRows.length) {
    await tx
      .insert(admissionCounts)
      .values(countRows)
      .onConflictDoUpdate({
        target: [
          admissionCounts.admissionProfileId,
          admissionCounts.metric,
          admissionCounts.population,
          admissionCounts.sourceId,
        ],
        set: { value: sql`excluded.value`, sourceFlags: sql`excluded.source_flags` },
      });
  }

  const requirementRows = acceptedCandidates.flatMap((candidate) => {
    const profileId = profileIdByUniversityId.get(candidate.universityId);
    const sourceId = sourceByUniversityId.get(candidate.universityId);
    if (!profileId || !sourceId) throw new Error(`Missing profile/source for ${candidate.unitId}.`);
    return candidate.requirements.map((fact) => ({
      admissionProfileId: profileId,
      category: fact.category,
      requirementKey: fact.requirementKey,
      label: fact.label,
      status: fact.status,
      details: fact.details,
      sourceId,
      sourceFlags: { ...fact.sourceFlags, sourceRow: candidate.sourceRow },
      verifiedAt,
    }));
  });
  if (requirementRows.length) {
    await tx
      .insert(admissionRequirements)
      .values(requirementRows)
      .onConflictDoUpdate({
        target: [
          admissionRequirements.admissionProfileId,
          admissionRequirements.category,
          admissionRequirements.requirementKey,
          admissionRequirements.sourceId,
        ],
        set: {
          label: sql`excluded.label`,
          status: sql`excluded.status`,
          details: sql`excluded.details`,
          sourceFlags: sql`excluded.source_flags`,
          verifiedAt: sql`excluded.verified_at`,
        },
      });
  }

  const testScoreRows = acceptedCandidates.flatMap((candidate) => {
    const profileId = profileIdByUniversityId.get(candidate.universityId);
    const sourceId = sourceByUniversityId.get(candidate.universityId);
    if (!profileId || !sourceId) throw new Error(`Missing profile/source for ${candidate.unitId}.`);
    return candidate.testScores.map((fact) => ({
      admissionProfileId: profileId,
      testName: fact.testName,
      section: fact.section,
      context: fact.context,
      submittersCount: fact.submittersCount,
      submittersPercent: numericString(fact.submittersPercent),
      minimumScore: null,
      maximumScore: null,
      averageScore: null,
      percentile25: numericString(fact.percentile25),
      percentile50: numericString(fact.percentile50),
      percentile75: numericString(fact.percentile75),
      scoreScale: fact.scoreScale,
      sourceId,
      sourceFlags: { ...fact.sourceFlags, sourceRow: candidate.sourceRow },
    }));
  });
  if (testScoreRows.length) {
    await tx
      .insert(admissionTestScores)
      .values(testScoreRows)
      .onConflictDoUpdate({
        target: [
          admissionTestScores.admissionProfileId,
          admissionTestScores.testName,
          admissionTestScores.section,
          admissionTestScores.context,
          admissionTestScores.sourceId,
        ],
        set: {
          submittersCount: sql`excluded.submitters_count`,
          submittersPercent: sql`excluded.submitters_percent`,
          minimumScore: sql`excluded.minimum_score`,
          maximumScore: sql`excluded.maximum_score`,
          averageScore: sql`excluded.average_score`,
          percentile25: sql`excluded.percentile_25`,
          percentile50: sql`excluded.percentile_50`,
          percentile75: sql`excluded.percentile_75`,
          scoreScale: sql`excluded.score_scale`,
          sourceFlags: sql`excluded.source_flags`,
        },
      });
  }

  const allRejections = [...rejections, ...identityRejections];
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
  const processedCount = acceptedCandidates.length + allRejections.length;
  await tx
    .update(importRuns)
    .set({
      checkpoint: { ...checkpointMetadata, sourceRow: checkpointRow },
      processedCount: sql`${importRuns.processedCount} + ${processedCount}`,
      insertedCount: sql`${importRuns.insertedCount} + ${insertedCount}`,
      updatedCount: sql`${importRuns.updatedCount} + ${updatedCount}`,
      rejectedCount: sql`${importRuns.rejectedCount} + ${allRejections.length}`,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, runId));
  return { processedCount, insertedCount, updatedCount, rejectedCount: allRejections.length };
};

const [csvHash, inspection, reviewedArtifact] = await Promise.all([
  sha256File(csvPath),
  inspectArtifact(),
  loadReviewedArtifact(),
]);
const artifactProblems = [
  csvHash === reviewedArtifact.datasetSha256
    ? null
    : 'ADM2024 SHA-256 does not match the reviewed manifest',
  inspection.rowCount === reviewedArtifact.datasetRows
    ? null
    : `ADM2024 row count is ${inspection.rowCount}, expected ${reviewedArtifact.datasetRows}`,
  datasetVersionFromFile === reviewedArtifact.datasetFile.replace(/\.csv$/iu, '')
    ? null
    : `ADM2024 file name is not the reviewed dataset: ${datasetVersionFromFile}`,
].filter((problem): problem is string => problem !== null);
if (artifactProblems.length)
  throw new Error(`Refusing unreviewed ADM2024 artifact: ${artifactProblems.join('; ')}.`);

if (dryRun) {
  const parser = createReadStream(csvPath).pipe(
    parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }),
  );
  let rows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  let countFacts = 0;
  let requirementFacts = 0;
  let testScoreFacts = 0;
  for await (const value of parser) {
    rows += 1;
    const transformed = toAdmissionRow(value as Record<string, string>, rows);
    if ('candidate' in transformed) {
      validRows += 1;
      countFacts += transformed.candidate.counts.length;
      requirementFacts += transformed.candidate.requirements.length;
      testScoreFacts += transformed.candidate.testScores.length;
    } else {
      rejectedRows += 1;
    }
  }
  console.log(
    `ADM2024 dry run: ${validRows} valid rows, ${rejectedRows} rejected rows, ${countFacts} count facts, ${requirementFacts} requirement facts, ${testScoreFacts} test-score facts. No database was changed.`,
  );
  process.exit(0);
}

const artifactHash = sha256Text(`${provider}:${csvHash}\n`);
const checkpointMetadata: CheckpointMetadata = {
  sourceDownloadUrl: reviewedArtifact.sourceUrl,
  sourceSha256: csvHash,
  sourceRows: inspection.rowCount,
  academicYear: reviewedArtifact.academicYear,
  sourceRetrievedAt: reviewedArtifact.retrievedAt,
};
const connection = createDb(getConfig(), { max: 1 });
let runId: string | undefined;
let lockHeld = false;

try {
  const lockResult = await connection.db.execute(sql`
    select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
  `);
  const lockRow = lockResult[0] as { acquired?: unknown } | undefined;
  if (lockRow?.acquired !== true) throw new Error('Another admissions import is already running.');
  lockHeld = true;

  const existingRun = await existingRunFor(connection.db, artifactHash);
  const resumeAfterRow = existingRun
    ? sourceRowFromCheckpoint(existingRun.checkpoint, inspection.rowCount, true)
    : 0;
  if (existingRun) {
    assertRunCounters(existingRun);
    if (existingRun.processedCount > inspection.rowCount) {
      throw new Error(
        `ADM2024 import ledger exceeds the reviewed artifact: ${existingRun.processedCount} processed, ${inspection.rowCount} rows.`,
      );
    }
  }
  if (existingRun?.status === 'completed') {
    if (resumeAfterRow !== inspection.rowCount) {
      throw new Error(
        `Completed ADM2024 run stops at source row ${resumeAfterRow}, expected ${inspection.rowCount}.`,
      );
    }
    assertRunCounters(existingRun, inspection.rowCount);
    console.log(
      `IPEDS admissions dataset ${datasetVersionFromFile} (${artifactHash.slice(0, 12)}) is already fully imported.`,
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
          datasetVersion: datasetVersionFromFile,
          artifactHash,
          status: 'running',
          checkpoint: { ...checkpointMetadata, sourceRow: 0 },
        })
        .returning({ id: importRuns.id });
      if (!createdRun) throw new Error('Failed to create the ADM2024 import run.');
      runId = createdRun.id;
    }

    const parser = createReadStream(csvPath).pipe(
      parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }),
    );
    let sourceRow = 0;
    let processedThisRun = 0;
    let insertedThisRun = 0;
    let updatedThisRun = 0;
    let rejectedThisRun = 0;
    let candidates: AdmissionCandidate[] = [];
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
          reviewedArtifact,
          checkpointMetadata,
        ),
      );
      processedThisRun += result.processedCount;
      insertedThisRun += result.insertedCount;
      updatedThisRun += result.updatedCount;
      rejectedThisRun += result.rejectedCount;
      candidates = [];
      rejections = [];
      console.log(
        `IPEDS admissions progress: ${processedThisRun}/${requestedLimit} rows this run; ${insertedThisRun} profiles inserted, ${updatedThisRun} updated, ${rejectedThisRun} rejected.`,
      );
    };

    for await (const value of parser) {
      sourceRow += 1;
      if (sourceRow <= resumeAfterRow) continue;
      const transformed = toAdmissionRow(value as Record<string, string>, sourceRow);
      if ('candidate' in transformed) candidates.push(transformed.candidate);
      else rejections.push(transformed.rejection);
      const bufferedRows = candidates.length + rejections.length;
      if (bufferedRows >= chunkSize || bufferedRows >= requestedLimit - processedThisRun)
        await flush();
      if (processedThisRun >= requestedLimit) {
        exhausted = false;
        break;
      }
    }
    if (exhausted) await flush();
    if (exhausted && sourceRow !== inspection.rowCount) {
      throw new Error(
        `ADM2024 parser stopped at source row ${sourceRow}, expected ${inspection.rowCount}.`,
      );
    }
    if (!runId) throw new Error('ADM2024 import run disappeared before finalization.');
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
    if (!currentRun) throw new Error('ADM2024 import run disappeared before finalization.');
    assertRunCounters(currentRun, exhausted ? inspection.rowCount : undefined);
    if (currentRun.processedCount > inspection.rowCount) {
      throw new Error(
        `ADM2024 import ledger exceeds the reviewed artifact: ${currentRun.processedCount} processed, ${inspection.rowCount} rows.`,
      );
    }
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
        ? `IPEDS admissions dataset exhausted: ${insertedThisRun} profiles inserted, ${updatedThisRun} updated, ${rejectedThisRun} rejected in this run.`
        : `IPEDS admissions batch paused cleanly at source row ${sourceRow}; rerun the same command to resume.`,
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
      console.error('Failed to record the ADM2024 import error state:', statusError);
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
    console.error('Failed to release the admissions import lock:', unlockError);
  } finally {
    await connection.close();
  }
}

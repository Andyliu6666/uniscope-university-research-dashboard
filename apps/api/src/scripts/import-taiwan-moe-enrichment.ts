import '../load-env.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { createDb, type Database } from '../db/client.js';
import {
  costSnapshots,
  importRejections,
  importRuns,
  institutionIdentifiers,
  programs,
  sources,
} from '../db/schema.js';
import {
  canonicalTaiwanMoeSchoolCode,
  taiwanMoeDepartmentArtifactSchema,
  taiwanMoeEnrichmentManifestSchema,
  taiwanMoeTuitionArtifactSchema,
  type TaiwanMoeEnrichmentManifest,
} from './taiwan-moe-enrichment-format.js';
import {
  buildTaiwanMoeCostPlan,
  buildTaiwanMoeEnrichmentSchools,
  buildTaiwanMoeProgramProvenance,
  buildTaiwanMoeProgramPlan,
  resolveExactTaiwanMoeIdentifier,
  taiwanMoeEnrichmentSchoolSummary,
  taiwanMoeProgramSourceProvider,
  type TaiwanMoeEnrichmentSchool,
} from './taiwan-moe-enrichment-import-plan.js';

/**
 * Import reviewed Taiwan MOE department offerings and tuition-fee bases.
 *
 * Identity is exact and code-only: a school must already have one unique
 * institution_identifiers(provider = 'tw_moe') row after numeric zero-padding
 * is normalised. No institution is created and no name/domain match is used.
 *
 * Usage:
 *   pnpm --filter @urd/api import:taiwan-moe-enrichment --dry-run
 *   pnpm --filter @urd/api import:taiwan-moe-enrichment [departments.json] [tuition.json] [school-limit]
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(scriptDirectory, '../../../../data/sources');
const manifestPath = resolve(sourceDirectory, 'taiwan-moe-enrichment-artifacts.json');
const defaultDepartmentPath = resolve(sourceDirectory, 'taiwan-moe-departments-114.json');
const defaultTuitionPath = resolve(sourceDirectory, 'taiwan-moe-tuition-114.json');

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
const departmentPath = resolve(positionalArguments[0] ?? defaultDepartmentPath);
const tuitionPath = resolve(positionalArguments[1] ?? defaultTuitionPath);
const requestedLimitText = positionalArguments[2];
const requestedLimit =
  requestedLimitText === undefined ? Number.MAX_SAFE_INTEGER : Number(requestedLimitText);
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('school-limit must be a positive base-10 safe integer.');
}
if (positionalArguments.length > 3) throw new Error('Too many positional arguments.');

const provider = 'tw_moe_enrichment';
const identityProvider = 'tw_moe';
const importLockName = 'uniscope:taiwan-moe-enrichment-import:v1';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const payloadHash = (value: unknown) => sha256(JSON.stringify(value));
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const metricSchema = z.object({
  programCandidatesMatched: z.number().int().nonnegative(),
  programsInserted: z.number().int().nonnegative(),
  programsAlreadyPresent: z.number().int().nonnegative(),
  organizationalUnitRowsSkipped: z.number().int().nonnegative(),
  unsupportedQualificationRowsSkipped: z.number().int().nonnegative(),
  duplicateOfferingRowsCollapsed: z.number().int().nonnegative(),
  positiveCostCellsMatched: z.number().int().nonnegative(),
  costsInserted: z.number().int().nonnegative(),
  costsUpdated: z.number().int().nonnegative(),
  sourceReportedZeroCellsSkipped: z.number().int().nonnegative(),
  sourceBlankCellsSkipped: z.number().int().nonnegative(),
  unmatchedProgramCandidates: z.number().int().nonnegative(),
  unmatchedPositiveCostCells: z.number().int().nonnegative(),
});
type ImportMetrics = z.infer<typeof metricSchema>;

const checkpointSchema = z.object({
  schemaVersion: z.literal(1),
  departmentFile: z.string().min(1),
  departmentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  departmentRows: z.number().int().positive(),
  departmentSchools: z.number().int().positive(),
  tuitionFile: z.string().min(1),
  tuitionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  tuitionRows: z.number().int().positive(),
  tuitionSchools: z.number().int().positive(),
  sourceSchools: z.number().int().positive(),
  academicYear: z.string().regex(/^\d{4}-\d{2}$/u),
  schoolIndex: z.number().int().nonnegative(),
  metrics: metricSchema,
});
type Checkpoint = z.infer<typeof checkpointSchema>;

const emptyMetrics = (): ImportMetrics => ({
  programCandidatesMatched: 0,
  programsInserted: 0,
  programsAlreadyPresent: 0,
  organizationalUnitRowsSkipped: 0,
  unsupportedQualificationRowsSkipped: 0,
  duplicateOfferingRowsCollapsed: 0,
  positiveCostCellsMatched: 0,
  costsInserted: 0,
  costsUpdated: 0,
  sourceReportedZeroCellsSkipped: 0,
  sourceBlankCellsSkipped: 0,
  unmatchedProgramCandidates: 0,
  unmatchedPositiveCostCells: 0,
});

const addMetrics = (left: ImportMetrics, right: Partial<ImportMetrics>): ImportMetrics =>
  Object.fromEntries(
    Object.entries(left).map(([key, value]) => [
      key,
      value + (right[key as keyof ImportMetrics] ?? 0),
    ]),
  ) as ImportMetrics;

const loadReviewedArtifacts = async () => {
  const [manifestBytes, departmentBytes, tuitionBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(departmentPath),
    readFile(tuitionPath),
  ]);
  const manifestResult = taiwanMoeEnrichmentManifestSchema.safeParse(
    JSON.parse(manifestBytes.toString('utf8')) as unknown,
  );
  const departmentResult = taiwanMoeDepartmentArtifactSchema.safeParse(
    JSON.parse(departmentBytes.toString('utf8')) as unknown,
  );
  const tuitionResult = taiwanMoeTuitionArtifactSchema.safeParse(
    JSON.parse(tuitionBytes.toString('utf8')) as unknown,
  );
  if (!manifestResult.success) {
    throw new Error(
      `Invalid Taiwan MOE enrichment manifest: ${z.prettifyError(manifestResult.error)}`,
    );
  }
  if (!departmentResult.success) {
    throw new Error(
      `Invalid Taiwan MOE department artifact: ${z.prettifyError(departmentResult.error)}`,
    );
  }
  if (!tuitionResult.success) {
    throw new Error(`Invalid Taiwan MOE tuition artifact: ${z.prettifyError(tuitionResult.error)}`);
  }
  const manifest = manifestResult.data;
  const departmentArtifact = departmentResult.data;
  const tuitionArtifact = tuitionResult.data;
  const [departmentMetadata, tuitionMetadata] = manifest.generatedArtifacts;
  const departmentSha256 = sha256(departmentBytes);
  const tuitionSha256 = sha256(tuitionBytes);
  const problems = [
    basename(departmentPath) === departmentMetadata.datasetFile
      ? null
      : 'department artifact filename is not reviewed',
    departmentSha256 === departmentMetadata.datasetSha256
      ? null
      : 'department artifact SHA-256 does not match the manifest',
    departmentBytes.byteLength === departmentMetadata.datasetBytes
      ? null
      : 'department artifact byte count does not match the manifest',
    departmentArtifact.selectedSourceRows === departmentMetadata.selectedRows
      ? null
      : 'department selected-row count does not match the manifest',
    departmentArtifact.schoolCount === departmentMetadata.schoolCount
      ? null
      : 'department school count does not match the manifest',
    basename(tuitionPath) === tuitionMetadata.datasetFile
      ? null
      : 'tuition artifact filename is not reviewed',
    tuitionSha256 === tuitionMetadata.datasetSha256
      ? null
      : 'tuition artifact SHA-256 does not match the manifest',
    tuitionBytes.byteLength === tuitionMetadata.datasetBytes
      ? null
      : 'tuition artifact byte count does not match the manifest',
    tuitionArtifact.selectedSourceRows === tuitionMetadata.selectedRows
      ? null
      : 'tuition selected-row count does not match the manifest',
    tuitionArtifact.schoolCount === tuitionMetadata.schoolCount
      ? null
      : 'tuition school count does not match the manifest',
    departmentArtifact.datasetVersion === departmentMetadata.datasetVersion
      ? null
      : 'department dataset version does not match the manifest',
    tuitionArtifact.datasetVersion === tuitionMetadata.datasetVersion
      ? null
      : 'tuition dataset version does not match the manifest',
    departmentArtifact.datasetVersion === tuitionArtifact.datasetVersion
      ? null
      : 'department and tuition artifacts are from different Taiwan MOE years',
    departmentArtifact.academicYear === tuitionArtifact.academicYear
      ? null
      : 'department and tuition artifacts are from different academic years',
  ].filter((problem): problem is string => problem !== null);
  if (problems.length) {
    throw new Error(`Refusing unreviewed Taiwan MOE enrichment data: ${problems.join('; ')}.`);
  }
  return {
    manifest,
    departmentArtifact,
    tuitionArtifact,
    departmentSha256,
    tuitionSha256,
  };
};

const readIdentityIndex = async (db: Database) => {
  const rows = await db
    .select({
      externalId: institutionIdentifiers.externalId,
      universityId: institutionIdentifiers.universityId,
    })
    .from(institutionIdentifiers)
    .where(eq(institutionIdentifiers.provider, identityProvider));
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const code = canonicalTaiwanMoeSchoolCode(row.externalId);
    const universityIds = result.get(code) ?? new Set<string>();
    universityIds.add(row.universityId);
    result.set(code, universityIds);
  }
  return result;
};

const programSourceKey = (universityId: string, externalId: string, academicYear: string) =>
  `${universityId}\u0000${taiwanMoeProgramSourceProvider}\u0000${externalId}\u0000${academicYear}`;

const readExistingProgramSourceKeys = async (db: Database) => {
  const rows = await db
    .select({
      universityId: programs.universityId,
      sourceProvider: programs.sourceProvider,
      sourceExternalId: programs.sourceExternalId,
      academicYear: programs.academicYear,
    })
    .from(programs)
    .where(eq(programs.sourceProvider, taiwanMoeProgramSourceProvider));
  return new Set(
    rows.flatMap((row) =>
      row.sourceExternalId && row.academicYear
        ? [programSourceKey(row.universityId, row.sourceExternalId, row.academicYear)]
        : [],
    ),
  );
};

const costKey = (
  universityId: string,
  academicYear: string,
  sourceUrl: string,
  value: {
    level: string;
    applicantType: string;
    residency: string;
    category: string;
    period: string;
    scenario: string;
  },
) =>
  [
    universityId,
    academicYear,
    value.level,
    value.applicantType,
    value.residency,
    value.category,
    value.period,
    value.scenario,
    sourceUrl,
  ].join('\u0000');

const readExistingCostKeys = async (db: Database) => {
  const rows = await db
    .select({
      universityId: costSnapshots.universityId,
      academicYear: costSnapshots.academicYear,
      level: costSnapshots.level,
      applicantType: costSnapshots.applicantType,
      residency: costSnapshots.residency,
      category: costSnapshots.category,
      period: costSnapshots.period,
      scenario: costSnapshots.scenario,
      sourceUrl: sources.url,
    })
    .from(costSnapshots)
    .innerJoin(sources, eq(costSnapshots.sourceId, sources.id));
  return new Set(
    rows.map((row) => costKey(row.universityId, row.academicYear, row.sourceUrl, row)),
  );
};

const upsertSource = async (
  tx: Tx,
  universityId: string,
  source: TaiwanMoeEnrichmentManifest['sources'][number],
  runId: string,
  title: string,
  verifiedAt: Date,
) => {
  const [row] = await tx
    .insert(sources)
    .values({
      universityId,
      title,
      url: source.datasetPageUrl,
      category: 'government',
      publisher: source.publisher,
      datasetVersion: source.datasetVersion,
      publishedAt: new Date(source.downloadLastModifiedAt),
      importRunId: runId,
      verifiedAt,
    })
    .onConflictDoUpdate({
      target: [sources.universityId, sources.url],
      set: {
        title: sql`excluded.title`,
        category: sql`excluded.category`,
        publisher: sql`excluded.publisher`,
        datasetVersion: sql`excluded.dataset_version`,
        publishedAt: sql`excluded.published_at`,
        importRunId: sql`excluded.import_run_id`,
        verifiedAt: sql`excluded.verified_at`,
      },
    })
    .returning({ id: sources.id });
  if (!row) throw new Error(`Failed to upsert Taiwan MOE source ${source.datasetPageUrl}.`);
  return row.id;
};

const checkpointFor = (
  value: unknown,
  metadata: Omit<Checkpoint, 'schoolIndex' | 'metrics'>,
  maximum: number,
) => {
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid Taiwan MOE enrichment checkpoint: ${z.prettifyError(parsed.error)}`);
  }
  const checkpoint = parsed.data;
  for (const key of [
    'schemaVersion',
    'departmentFile',
    'departmentSha256',
    'departmentRows',
    'departmentSchools',
    'tuitionFile',
    'tuitionSha256',
    'tuitionRows',
    'tuitionSchools',
    'sourceSchools',
    'academicYear',
  ] as const) {
    if (checkpoint[key] !== metadata[key]) {
      throw new Error(`Taiwan MOE enrichment checkpoint does not match ${key}.`);
    }
  }
  if (checkpoint.schoolIndex > maximum) throw new Error('Checkpoint is beyond the artifact.');
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
      `Taiwan MOE enrichment ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expected !== undefined && run.processedCount !== expected) {
    throw new Error(
      `Taiwan MOE enrichment processed ${run.processedCount} schools; expected ${expected}.`,
    );
  }
};

const printDryRun = async (
  db: Database,
  schools: TaiwanMoeEnrichmentSchool[],
  academicYear: string,
  tuitionSourceUrl: string,
) => {
  const [identityIndex, existingProgramSourceKeys, existingCostKeys] = await Promise.all([
    readIdentityIndex(db),
    readExistingProgramSourceKeys(db),
    readExistingCostKeys(db),
  ]);
  const plan = {
    sourceSchools: schools.length,
    matchedSchools: 0,
    rejectedMissingIdentifier: 0,
    rejectedAmbiguousIdentifier: 0,
    uniqueProgramCandidates: 0,
    programsToInsert: 0,
    programsAlreadyPresent: 0,
    organizationalUnitRowsSkipped: 0,
    unsupportedQualificationRowsSkipped: 0,
    duplicateOfferingRowsCollapsed: 0,
    positiveCostCells: 0,
    costsToInsert: 0,
    costsToUpdate: 0,
    sourceReportedZeroCellsSkipped: 0,
    sourceBlankCellsSkipped: 0,
    unmatchedProgramCandidates: 0,
    unmatchedPositiveCostCells: 0,
  };
  for (const school of schools) {
    const programPlan = buildTaiwanMoeProgramPlan(school);
    const costPlan = buildTaiwanMoeCostPlan(school);
    plan.organizationalUnitRowsSkipped += programPlan.organizationalUnitRowsSkipped;
    plan.unsupportedQualificationRowsSkipped += programPlan.unsupportedQualificationRowsSkipped;
    plan.duplicateOfferingRowsCollapsed += programPlan.duplicateOfferingRowsCollapsed;
    plan.sourceReportedZeroCellsSkipped += costPlan.sourceReportedZeroCellsSkipped;
    plan.sourceBlankCellsSkipped += costPlan.sourceBlankCellsSkipped;
    const resolution = resolveExactTaiwanMoeIdentifier(school.canonicalSchoolCode, identityIndex);
    if (resolution.kind === 'reject') {
      if (resolution.reason.startsWith('No exact')) plan.rejectedMissingIdentifier += 1;
      else plan.rejectedAmbiguousIdentifier += 1;
      plan.unmatchedProgramCandidates += programPlan.candidates.length;
      plan.unmatchedPositiveCostCells += costPlan.candidates.length;
      continue;
    }
    plan.matchedSchools += 1;
    plan.uniqueProgramCandidates += programPlan.candidates.length;
    for (const candidate of programPlan.candidates) {
      const key = programSourceKey(
        resolution.universityId,
        candidate.sourceExternalId,
        academicYear,
      );
      if (existingProgramSourceKeys.has(key)) plan.programsAlreadyPresent += 1;
      else plan.programsToInsert += 1;
    }
    plan.positiveCostCells += costPlan.candidates.length;
    for (const candidate of costPlan.candidates) {
      const key = costKey(resolution.universityId, academicYear, tuitionSourceUrl, candidate);
      if (existingCostKeys.has(key)) plan.costsToUpdate += 1;
      else plan.costsToInsert += 1;
    }
  }
  console.log(
    `Taiwan MOE enrichment dry-run plan: ${JSON.stringify(plan)}. No database was changed.`,
  );
};

const run = async () => {
  const { manifest, departmentArtifact, tuitionArtifact, departmentSha256, tuitionSha256 } =
    await loadReviewedArtifacts();
  const schools = buildTaiwanMoeEnrichmentSchools(departmentArtifact, tuitionArtifact);
  const [departmentSource, tuitionSource] = manifest.sources;
  const connection = createDb(getConfig(), { max: 1 });
  if (dryRun) {
    try {
      await printDryRun(
        connection.db,
        schools,
        departmentArtifact.academicYear,
        tuitionSource.datasetPageUrl,
      );
    } finally {
      await connection.close();
    }
    return;
  }

  const artifactHash = sha256(`${provider}:${departmentSha256}:${tuitionSha256}\n`);
  const datasetVersion = `academic-year-${departmentArtifact.datasetVersion}`;
  const checkpointMetadata: Omit<Checkpoint, 'schoolIndex' | 'metrics'> = {
    schemaVersion: 1,
    departmentFile: basename(departmentPath),
    departmentSha256,
    departmentRows: departmentArtifact.selectedSourceRows,
    departmentSchools: departmentArtifact.schoolCount,
    tuitionFile: basename(tuitionPath),
    tuitionSha256,
    tuitionRows: tuitionArtifact.selectedSourceRows,
    tuitionSchools: tuitionArtifact.schoolCount,
    sourceSchools: schools.length,
    academicYear: departmentArtifact.academicYear,
  };
  let runId: string | undefined;
  let lockHeld = false;
  try {
    const lockResult = await connection.db.execute(sql`
      select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
    `);
    if ((lockResult[0] as { acquired?: unknown } | undefined)?.acquired !== true) {
      throw new Error('Another Taiwan MOE enrichment import is already running.');
    }
    lockHeld = true;
    const [identityIndex, existingProgramSourceKeys, existingCostKeys] = await Promise.all([
      readIdentityIndex(connection.db),
      readExistingProgramSourceKeys(connection.db),
      readExistingCostKeys(connection.db),
    ]);
    const [existingRun] = await connection.db
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
    let checkpoint: Checkpoint;
    if (existingRun) {
      assertCounters(existingRun);
      checkpoint = checkpointFor(existingRun.checkpoint, checkpointMetadata, schools.length);
      if (checkpoint.schoolIndex !== existingRun.processedCount) {
        throw new Error('Taiwan MOE enrichment checkpoint and processed counter disagree.');
      }
      if (existingRun.status === 'completed') {
        assertCounters(existingRun, schools.length);
        console.log(`Taiwan MOE enrichment ${datasetVersion} is already fully imported.`);
        return;
      }
      runId = existingRun.id;
      await connection.db
        .update(importRuns)
        .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
    } else {
      checkpoint = {
        ...checkpointMetadata,
        schoolIndex: 0,
        metrics: emptyMetrics(),
      };
      const [created] = await connection.db
        .insert(importRuns)
        .values({ provider, datasetVersion, artifactHash, checkpoint, status: 'running' })
        .returning({ id: importRuns.id });
      if (!created) throw new Error('Failed to create Taiwan MOE enrichment import ledger.');
      runId = created.id;
    }

    const verifiedAt = new Date(manifest.retrievedAt);
    let processedThisInvocation = 0;
    for (let index = checkpoint.schoolIndex; index < schools.length; index += 1) {
      if (processedThisInvocation >= requestedLimit) break;
      const school = schools[index] as TaiwanMoeEnrichmentSchool;
      const programPlan = buildTaiwanMoeProgramPlan(school);
      const costPlan = buildTaiwanMoeCostPlan(school);
      const resolution = resolveExactTaiwanMoeIdentifier(school.canonicalSchoolCode, identityIndex);
      const commonMetrics = {
        organizationalUnitRowsSkipped: programPlan.organizationalUnitRowsSkipped,
        unsupportedQualificationRowsSkipped: programPlan.unsupportedQualificationRowsSkipped,
        duplicateOfferingRowsCollapsed: programPlan.duplicateOfferingRowsCollapsed,
        sourceReportedZeroCellsSkipped: costPlan.sourceReportedZeroCellsSkipped,
        sourceBlankCellsSkipped: costPlan.sourceBlankCellsSkipped,
      };
      const nextCheckpointBase = { ...checkpointMetadata, schoolIndex: index + 1 };

      if (resolution.kind === 'reject') {
        const summary = taiwanMoeEnrichmentSchoolSummary(school);
        const metrics = addMetrics(checkpoint.metrics, {
          ...commonMetrics,
          unmatchedProgramCandidates: programPlan.candidates.length,
          unmatchedPositiveCostCells: costPlan.candidates.length,
        });
        const nextCheckpoint = { ...nextCheckpointBase, metrics };
        if (!runId) throw new Error('Taiwan MOE enrichment import run disappeared.');
        await connection.db.transaction(async (tx) => {
          await tx.insert(importRejections).values({
            runId: runId as string,
            sourceRow: index + 1,
            externalId: school.canonicalSchoolCode,
            reason: resolution.reason,
            payloadHash: payloadHash(summary),
            payload: summary,
          });
          await tx
            .update(importRuns)
            .set({
              checkpoint: nextCheckpoint,
              processedCount: sql`${importRuns.processedCount} + 1`,
              rejectedCount: sql`${importRuns.rejectedCount} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(importRuns.id, runId as string));
        });
        checkpoint = nextCheckpoint;
        processedThisInvocation += 1;
        continue;
      }

      const newPrograms = programPlan.candidates.filter(
        (candidate) =>
          !existingProgramSourceKeys.has(
            programSourceKey(
              resolution.universityId,
              candidate.sourceExternalId,
              departmentArtifact.academicYear,
            ),
          ),
      );
      const existingPrograms = programPlan.candidates.length - newPrograms.length;
      const newCosts = costPlan.candidates.filter(
        (candidate) =>
          !existingCostKeys.has(
            costKey(
              resolution.universityId,
              tuitionArtifact.academicYear,
              tuitionSource.datasetPageUrl,
              candidate,
            ),
          ),
      ).length;
      const existingCosts = costPlan.candidates.length - newCosts;
      const metrics = addMetrics(checkpoint.metrics, {
        ...commonMetrics,
        programCandidatesMatched: programPlan.candidates.length,
        programsInserted: newPrograms.length,
        programsAlreadyPresent: existingPrograms,
        positiveCostCellsMatched: costPlan.candidates.length,
        costsInserted: newCosts,
        costsUpdated: existingCosts,
      });
      const nextCheckpoint = { ...nextCheckpointBase, metrics };
      if (!runId) throw new Error('Taiwan MOE enrichment import run disappeared.');

      await connection.db.transaction(async (tx) => {
        let departmentSourceId: string | null = null;
        if (school.department) {
          departmentSourceId = await upsertSource(
            tx,
            resolution.universityId,
            departmentSource,
            runId as string,
            `Taiwan MOE department overview (academic year ${departmentArtifact.academicYear})`,
            verifiedAt,
          );
        }
        if (programPlan.candidates.length) {
          const department = school.department;
          if (!department || !departmentSourceId) {
            throw new Error(
              `Taiwan MOE program candidates for ${school.canonicalSchoolCode} have no department source.`,
            );
          }
          await tx
            .insert(programs)
            .values(
              programPlan.candidates.map((candidate) => ({
                universityId: resolution.universityId,
                name: candidate.name,
                level: candidate.level,
                field: candidate.field,
                sourceId: departmentSourceId,
                ...buildTaiwanMoeProgramProvenance(candidate, {
                  artifactFile: basename(departmentPath),
                  datasetVersion: departmentArtifact.datasetVersion,
                  academicYear: departmentArtifact.academicYear,
                  datasetPageUrl: departmentSource.datasetPageUrl,
                  downloadUrl: departmentSource.downloadUrl,
                  sourceRetrievedAt: manifest.retrievedAt,
                  sourceLastModifiedAt: departmentSource.downloadLastModifiedAt,
                  schoolCode: department.schoolCode,
                  canonicalSchoolCode: school.canonicalSchoolCode,
                  schoolName: department.chineseName,
                }),
              })),
            )
            .onConflictDoUpdate({
              target: [
                programs.universityId,
                programs.sourceProvider,
                programs.sourceExternalId,
                programs.academicYear,
              ],
              targetWhere: sql`${programs.sourceProvider} is not null and ${programs.sourceExternalId} is not null and ${programs.academicYear} is not null`,
              set: {
                name: sql`excluded.name`,
                level: sql`excluded.level`,
                field: sql`excluded.field`,
                sourceId: sql`excluded.source_id`,
                sourceFlags: sql`excluded.source_flags`,
              },
            });
        }
        if (school.tuition) {
          const tuitionSourceId = await upsertSource(
            tx,
            resolution.universityId,
            tuitionSource,
            runId as string,
            `Taiwan MOE tuition and miscellaneous fee bases (academic year ${tuitionArtifact.datasetVersion})`,
            verifiedAt,
          );
          for (const candidate of costPlan.candidates) {
            await tx
              .insert(costSnapshots)
              .values({
                universityId: resolution.universityId,
                programId: null,
                academicYear: tuitionArtifact.academicYear,
                level: candidate.level,
                applicantType: candidate.applicantType,
                residency: candidate.residency,
                category: candidate.category,
                period: candidate.period,
                scenario: candidate.scenario,
                amount: String(candidate.amount),
                currency: candidate.currency,
                sourceId: tuitionSourceId,
                sourceFlags: {
                  provider,
                  artifactFile: basename(tuitionPath),
                  datasetVersion: tuitionArtifact.datasetVersion,
                  datasetPageUrl: tuitionSource.datasetPageUrl,
                  downloadUrl: tuitionSource.downloadUrl,
                  sourceRetrievedAt: manifest.retrievedAt,
                  sourceLastModifiedAt: tuitionSource.downloadLastModifiedAt,
                  reportedAcademicYear: tuitionArtifact.datasetVersion,
                  academicYear: tuitionArtifact.academicYear,
                  schoolCode: school.tuition.schoolCode,
                  canonicalSchoolCode: school.canonicalSchoolCode,
                  schoolName: school.tuition.chineseName,
                  sourceRow: candidate.sourceRow,
                  amountMeaning: tuitionArtifact.amountMeaning,
                  chargePeriod: tuitionArtifact.chargePeriod,
                  referenceDateRule: tuitionArtifact.referenceDateRule,
                  categoryCode: candidate.scenario,
                  categoryLabel: candidate.sourceCategoryLabel,
                  studyScope: candidate.sourceStudyScope,
                  sourceColumn: candidate.sourceColumn,
                  sourceReportedZeroTreatment: 'not_imported_as_cost_or_free_tuition',
                },
              })
              .onConflictDoUpdate({
                target: [
                  costSnapshots.universityId,
                  costSnapshots.academicYear,
                  costSnapshots.level,
                  costSnapshots.applicantType,
                  costSnapshots.residency,
                  costSnapshots.category,
                  costSnapshots.period,
                  costSnapshots.scenario,
                  costSnapshots.sourceId,
                ],
                targetWhere: sql`${costSnapshots.programId} is null`,
                set: {
                  amount: sql`excluded.amount`,
                  currency: sql`excluded.currency`,
                  sourceFlags: sql`excluded.source_flags`,
                },
              });
          }
        }
        await tx
          .update(importRuns)
          .set({
            checkpoint: nextCheckpoint,
            processedCount: sql`${importRuns.processedCount} + 1`,
            updatedCount: sql`${importRuns.updatedCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(importRuns.id, runId as string));
      });

      for (const candidate of newPrograms) {
        existingProgramSourceKeys.add(
          programSourceKey(
            resolution.universityId,
            candidate.sourceExternalId,
            departmentArtifact.academicYear,
          ),
        );
      }
      for (const candidate of costPlan.candidates) {
        existingCostKeys.add(
          costKey(
            resolution.universityId,
            tuitionArtifact.academicYear,
            tuitionSource.datasetPageUrl,
            candidate,
          ),
        );
      }
      checkpoint = nextCheckpoint;
      processedThisInvocation += 1;
      if (processedThisInvocation % 25 === 0 || checkpoint.schoolIndex === schools.length) {
        console.log(
          `Taiwan MOE enrichment progress: ${checkpoint.schoolIndex}/${schools.length} schools.`,
        );
      }
    }

    if (!runId) throw new Error('Taiwan MOE enrichment run disappeared before finalization.');
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
    if (!currentRun) throw new Error('Taiwan MOE enrichment ledger disappeared.');
    const complete = checkpoint.schoolIndex === schools.length;
    assertCounters(currentRun, complete ? schools.length : undefined);
    await connection.db
      .update(importRuns)
      .set({
        checkpoint,
        status: complete ? 'completed' : 'paused',
        finishedAt: complete ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));
    console.log(
      complete
        ? `Taiwan MOE enrichment complete: ${currentRun.updatedCount} exact-code matches, ${currentRun.rejectedCount} rejected; fact metrics ${JSON.stringify(checkpoint.metrics)}.`
        : `Taiwan MOE enrichment paused at school ${checkpoint.schoolIndex}; rerun to resume.`,
    );
  } catch (error) {
    if (runId) {
      try {
        await connection.db
          .update(importRuns)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } catch (statusError) {
        console.error('Failed to record Taiwan MOE enrichment error state:', statusError);
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
};

await run();

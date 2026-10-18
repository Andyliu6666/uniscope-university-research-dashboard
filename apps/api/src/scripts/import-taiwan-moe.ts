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
  enrollmentSnapshots,
  importRejections,
  importRuns,
  institutionAliases,
  institutionIdentifiers,
  sources,
  universities,
} from '../db/schema.js';
import {
  taiwanMoeArtifactSchema,
  taiwanMoeManifestSchema,
  hasReliableDirectoryRow,
  resolveTaiwanMoeIdentity,
  websiteDomain,
  type TaiwanMoeArtifact,
  type TaiwanMoeIdentityResolution,
  type TaiwanMoeManifest,
  type TaiwanMoeSchool,
} from './taiwan-moe-format.js';

/**
 * Import Taiwan Ministry of Education directory and 114-year enrollment data.
 *
 * Identity policy:
 * - tw_moe school code is authoritative once attached;
 * - an unattached record may match only one unique official website domain or
 *   one exact existing Chinese alias;
 * - names are never fuzzy-matched;
 * - current schools may be created only when the reviewed directory row is an
 *   exact/legal-name variant, never when the old directory conflicts or lacks
 *   the current institution.
 *
 * Usage (until a package alias is added):
 *   pnpm --filter @urd/api exec tsx src/scripts/import-taiwan-moe.ts --dry-run
 *   pnpm --filter @urd/api exec tsx src/scripts/import-taiwan-moe.ts [artifact] [school-limit]
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(scriptDirectory, '../../../../data/sources');
const manifestPath = resolve(sourceDirectory, 'taiwan-moe-artifacts.json');
const defaultArtifactPath = resolve(sourceDirectory, 'taiwan-moe-114.json');

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
const artifactPath = resolve(positionalArguments[0] ?? defaultArtifactPath);
const limitText = positionalArguments[1];
const requestedLimit = limitText === undefined ? Number.MAX_SAFE_INTEGER : Number(limitText);
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('school-limit must be a positive base-10 safe integer.');
}
if (positionalArguments.length > 2) throw new Error('Too many positional arguments.');

const provider = 'tw_moe';
const importLockName = 'uniscope:taiwan-moe-import:v1';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const payloadHash = (value: unknown) => sha256(JSON.stringify(value));
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

type Checkpoint = {
  schemaVersion: 1;
  sourceFile: string;
  sourceSha256: string;
  sourceSchools: number;
  datasetVersion: string;
  reportedAcademicYear: string;
  academicYear: string;
  schoolIndex: number;
};

const checkpointSchema = z.object({
  schemaVersion: z.literal(1),
  sourceFile: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceSchools: z.number().int().positive(),
  datasetVersion: z.string().min(1),
  reportedAcademicYear: z.string().min(1),
  academicYear: z.string().min(1),
  schoolIndex: z.number().int().nonnegative(),
});

type IdentityIndexes = {
  universityIdByCode: Map<string, string>;
  universityIdsByDomain: Map<string, Set<string>>;
  universityIdsByAlias: Map<string, Set<string>>;
  existingSlugs: Set<string>;
};

const addToSetMap = (map: Map<string, Set<string>>, key: string, value: string) => {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
};

const readIdentityIndexes = async (db: Database): Promise<IdentityIndexes> => {
  const [identifiers, universityRows, aliases] = await Promise.all([
    db
      .select({
        externalId: institutionIdentifiers.externalId,
        universityId: institutionIdentifiers.universityId,
      })
      .from(institutionIdentifiers)
      .where(eq(institutionIdentifiers.provider, provider)),
    db
      .select({
        id: universities.id,
        slug: universities.slug,
        website: universities.website,
        officialWebsite: universities.officialWebsite,
      })
      .from(universities),
    db
      .select({
        universityId: institutionAliases.universityId,
        name: institutionAliases.name,
        kind: institutionAliases.kind,
        languageCode: institutionAliases.languageCode,
        provider: institutionAliases.provider,
      })
      .from(institutionAliases),
  ]);
  const universityIdsByDomain = new Map<string, Set<string>>();
  for (const row of universityRows) {
    for (const value of [row.website, row.officialWebsite]) {
      const domain = websiteDomain(value);
      if (domain) addToSetMap(universityIdsByDomain, domain, row.id);
    }
  }
  const universityIdsByAlias = new Map<string, Set<string>>();
  for (const alias of aliases) {
    const languageCode = alias.languageCode.toLowerCase();
    const isOfficialChineseLabel =
      alias.kind === 'label' &&
      (alias.provider === provider || alias.provider === 'ror') &&
      (languageCode === 'zh' || languageCode.startsWith('zh-'));
    if (!isOfficialChineseLabel) continue;
    addToSetMap(universityIdsByAlias, alias.name.trim(), alias.universityId);
  }
  return {
    universityIdByCode: new Map(
      identifiers.map((identifier) => [identifier.externalId, identifier.universityId]),
    ),
    universityIdsByDomain,
    universityIdsByAlias,
    existingSlugs: new Set(universityRows.map((university) => university.slug)),
  };
};

const resolveIdentity = (
  school: TaiwanMoeSchool,
  indexes: IdentityIndexes,
): TaiwanMoeIdentityResolution => {
  const domain = websiteDomain(school.website);
  return resolveTaiwanMoeIdentity(school, {
    identifierUniversityId: indexes.universityIdByCode.get(school.schoolCode),
    domainUniversityIds: domain ? [...(indexes.universityIdsByDomain.get(domain) ?? [])] : [],
    aliasUniversityIds: [...(indexes.universityIdsByAlias.get(school.chineseName) ?? [])],
  });
};

const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');

const nextSlug = (school: TaiwanMoeSchool, indexes: IdentityIndexes) => {
  const stem = slugify(school.englishName ?? '') || 'taiwan-institution';
  const code = school.schoolCode.toLowerCase();
  let slug = `${stem.slice(0, 145)}-tw-${code}`.slice(0, 180);
  let suffix = 2;
  while (indexes.existingSlugs.has(slug)) {
    slug = `${stem.slice(0, 138)}-tw-${code}-${suffix}`.slice(0, 180);
    suffix += 1;
  }
  return slug;
};

const directorySource = (manifest: TaiwanMoeManifest) => {
  const source = manifest.sources.find((candidate) => candidate.role === 'directory');
  if (!source) throw new Error('Taiwan MOE manifest has no directory source.');
  return source;
};

const enrollmentSource = (manifest: TaiwanMoeManifest) => {
  const source = manifest.sources.find((candidate) => candidate.role === 'enrollment');
  if (!source) throw new Error('Taiwan MOE manifest has no enrollment source.');
  return source;
};

const upsertSource = async (
  tx: Tx,
  input: {
    universityId: string;
    title: string;
    url: string;
    publisher: string;
    datasetVersion: string;
    runId: string;
    verifiedAt: Date;
  },
) => {
  const [source] = await tx
    .insert(sources)
    .values({
      universityId: input.universityId,
      title: input.title,
      url: input.url,
      category: 'government',
      publisher: input.publisher,
      datasetVersion: input.datasetVersion,
      importRunId: input.runId,
      verifiedAt: input.verifiedAt,
    })
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
    .returning({ id: sources.id });
  if (!source) throw new Error(`Failed to create source row: ${input.url}`);
  return source.id;
};

const createUniversity = async (
  tx: Tx,
  school: TaiwanMoeSchool,
  indexes: IdentityIndexes,
  retrievedAt: Date,
) => {
  const website = school.website;
  if (!website) throw new Error(`School ${school.schoolCode} has no safe creation website.`);
  const slug = nextSlug(school, indexes);
  const offersUndergraduate = school.enrollments.some(
    (enrollment) => enrollment.level === 'undergraduate',
  );
  const offersGraduate = school.enrollments.some(
    (enrollment) => enrollment.level === 'graduate' || enrollment.level === 'doctoral',
  );
  const highestAwardLevel = school.enrollments.some((item) => item.level === 'doctoral')
    ? 'doctoral degree'
    : school.enrollments.some((item) => item.level === 'graduate')
      ? "master's degree"
      : school.enrollments.some((item) => item.level === 'undergraduate')
        ? "bachelor's or sub-baccalaureate award"
        : null;
  const displayName = school.englishName ?? school.chineseName;
  const location = school.county ?? 'Taiwan';
  const city = school.district ?? school.county ?? 'Taiwan';
  const [created] = await tx
    .insert(universities)
    .values({
      name: displayName.slice(0, 160),
      slug,
      country: 'Taiwan',
      countryCode: 'TW',
      continentCode: 'AS',
      region: school.county,
      city: city.slice(0, 80),
      addressLine: school.address,
      postalCode: school.postalCode,
      phone: school.phone,
      website,
      officialWebsite: website,
      summary: `${displayName} (${school.chineseName}) is a ${school.publicPrivate ?? 'Ministry-listed'} ${school.systemType ?? 'higher-education institution'} in ${location}, Taiwan. Institution details and 114-academic-year enrollment are sourced from Taiwan's Ministry of Education.`,
      institutionType: school.publicPrivate ?? 'unknown',
      ownership: school.publicPrivate === 'public' ? 'public' : 'unknown',
      operatingStatus: 'active',
      highestAwardLevel,
      offersUndergraduate,
      offersGraduate,
      studentCount: school.totalStudentCount,
      featured: false,
      updatedAt: retrievedAt,
    })
    .returning({ id: universities.id });
  if (!created) throw new Error(`Failed to create Taiwan MOE school ${school.schoolCode}.`);
  return { universityId: created.id, slug };
};

const patchExistingUniversity = async (
  tx: Tx,
  universityId: string,
  school: TaiwanMoeSchool,
  retrievedAt: Date,
) => {
  const [current] = await tx
    .select({
      countryCode: universities.countryCode,
      continentCode: universities.continentCode,
      region: universities.region,
      city: universities.city,
      addressLine: universities.addressLine,
      postalCode: universities.postalCode,
      phone: universities.phone,
      officialWebsite: universities.officialWebsite,
      institutionType: universities.institutionType,
      ownership: universities.ownership,
      operatingStatus: universities.operatingStatus,
      offersUndergraduate: universities.offersUndergraduate,
      offersGraduate: universities.offersGraduate,
    })
    .from(universities)
    .where(eq(universities.id, universityId))
    .limit(1);
  if (!current) throw new Error(`Matched university disappeared: ${universityId}`);
  const safeDirectory = hasReliableDirectoryRow(school);
  const patch: Partial<typeof universities.$inferInsert> = {
    studentCount: school.totalStudentCount,
    updatedAt: retrievedAt,
  };
  if (!current.countryCode) patch.countryCode = 'TW';
  if (!current.continentCode) patch.continentCode = 'AS';
  if (safeDirectory) {
    if (!current.region && school.county) patch.region = school.county;
    const currentCity = school.district ?? school.county;
    if ((!current.city || current.city === 'Unknown') && currentCity) {
      patch.city = currentCity;
    }
    if (!current.addressLine && school.address) patch.addressLine = school.address;
    if (!current.postalCode && school.postalCode) patch.postalCode = school.postalCode;
    if (!current.phone && school.phone) patch.phone = school.phone;
    if (!current.officialWebsite && school.website) patch.officialWebsite = school.website;
    if (current.institutionType === 'unknown' && school.publicPrivate) {
      patch.institutionType = school.publicPrivate;
    }
    if (
      (!current.ownership || current.ownership === 'unknown') &&
      school.publicPrivate === 'public'
    ) {
      patch.ownership = 'public';
    }
  }
  if (!current.operatingStatus || current.operatingStatus === 'unknown')
    patch.operatingStatus = 'active';
  if (current.offersUndergraduate === null) {
    patch.offersUndergraduate = school.enrollments.some(
      (enrollment) => enrollment.level === 'undergraduate',
    );
  }
  if (current.offersGraduate === null) {
    patch.offersGraduate = school.enrollments.some(
      (enrollment) => enrollment.level === 'graduate' || enrollment.level === 'doctoral',
    );
  }
  await tx.update(universities).set(patch).where(eq(universities.id, universityId));
};

const upsertAliasesAndIdentifier = async (
  tx: Tx,
  universityId: string,
  school: TaiwanMoeSchool,
  retrievedAt: Date,
) => {
  const aliases = [
    { name: school.chineseName, languageCode: 'zh-TW' },
    ...(school.englishName ? [{ name: school.englishName, languageCode: 'en' }] : []),
  ];
  await tx
    .insert(institutionAliases)
    .values(
      aliases.map((alias) => ({
        universityId,
        name: alias.name,
        kind: 'label',
        languageCode: alias.languageCode,
        provider,
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(institutionIdentifiers)
    .values({
      universityId,
      provider,
      externalId: school.schoolCode,
      sourceModifiedAt: retrievedAt,
      firstSeenAt: retrievedAt,
      lastSeenAt: retrievedAt,
    })
    .onConflictDoUpdate({
      target: [institutionIdentifiers.provider, institutionIdentifiers.externalId],
      set: { sourceModifiedAt: retrievedAt, lastSeenAt: retrievedAt },
    });
};

const upsertEnrollmentSnapshots = async (
  tx: Tx,
  universityId: string,
  sourceId: string,
  school: TaiwanMoeSchool,
  artifact: TaiwanMoeArtifact,
  manifest: TaiwanMoeManifest,
) => {
  const enrollment = enrollmentSource(manifest);
  const commonFlags = {
    provider,
    datasetFile: enrollment.datasetFile,
    datasetVersion: enrollment.datasetVersion,
    datasetPageUrl: enrollment.datasetPageUrl,
    downloadUrl: enrollment.downloadUrl,
    sourceRetrievedAt: manifest.retrievedAt,
    reportedAcademicYear: artifact.reportedAcademicYear,
    academicYear: artifact.academicYear,
    schoolCode: school.schoolCode,
    schoolName: school.chineseName,
  };
  const rows = [
    {
      universityId,
      programId: null,
      academicYear: artifact.academicYear,
      level: 'all' as const,
      attendanceStatus: 'all' as const,
      applicantType: 'all' as const,
      population: 'total',
      studentCount: school.totalStudentCount,
      sourceId,
      sourceFlags: {
        ...commonFlags,
        sourceRows: school.sourceRows,
        genderTotals: { men: school.menCount, women: school.womenCount },
      },
    },
    ...school.enrollments.map((snapshot) => ({
      universityId,
      programId: null,
      academicYear: artifact.academicYear,
      level: snapshot.level,
      attendanceStatus: 'all' as const,
      applicantType: 'all' as const,
      population: snapshot.population,
      studentCount: snapshot.studentCount,
      sourceId,
      sourceFlags: {
        ...commonFlags,
        qualificationCode: snapshot.qualificationCode,
        qualificationLabel: snapshot.qualificationLabel,
        attendanceModes: snapshot.attendanceModes,
        sourceRows: snapshot.sourceRows,
        genderTotals: { men: snapshot.menCount, women: snapshot.womenCount },
      },
    })),
  ];
  for (const row of rows) {
    await tx
      .insert(enrollmentSnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: [
          enrollmentSnapshots.universityId,
          enrollmentSnapshots.academicYear,
          enrollmentSnapshots.level,
          enrollmentSnapshots.attendanceStatus,
          enrollmentSnapshots.applicantType,
          enrollmentSnapshots.population,
          enrollmentSnapshots.sourceId,
        ],
        targetWhere: sql`${enrollmentSnapshots.programId} is null`,
        set: {
          studentCount: sql`excluded.student_count`,
          sourceFlags: sql`excluded.source_flags`,
        },
      });
  }
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
      `Taiwan MOE ledger is inconsistent: processed ${run.processedCount}, accounted ${accounted}.`,
    );
  }
  if (expected !== undefined && run.processedCount !== expected) {
    throw new Error(`Taiwan MOE import processed ${run.processedCount}; expected ${expected}.`);
  }
};

const checkpointFor = (
  value: unknown,
  metadata: Omit<Checkpoint, 'schoolIndex'>,
  maximum: number,
) => {
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid Taiwan MOE checkpoint: ${z.prettifyError(parsed.error)}`);
  }
  const checkpoint = parsed.data;
  for (const key of [
    'schemaVersion',
    'sourceFile',
    'sourceSha256',
    'sourceSchools',
    'datasetVersion',
    'reportedAcademicYear',
    'academicYear',
  ] as const) {
    if (checkpoint[key] !== metadata[key]) {
      throw new Error(`Taiwan MOE checkpoint does not match reviewed artifact (${key}).`);
    }
  }
  if (checkpoint.schoolIndex > maximum) throw new Error('Checkpoint is beyond the artifact.');
  return checkpoint;
};

const loadReviewedArtifact = async () => {
  const [manifestBytes, artifactBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(artifactPath),
  ]);
  const manifestResult = taiwanMoeManifestSchema.safeParse(
    JSON.parse(manifestBytes.toString('utf8')) as unknown,
  );
  if (!manifestResult.success) {
    throw new Error(`Invalid Taiwan MOE manifest: ${z.prettifyError(manifestResult.error)}`);
  }
  const artifactResult = taiwanMoeArtifactSchema.safeParse(
    JSON.parse(artifactBytes.toString('utf8')) as unknown,
  );
  if (!artifactResult.success) {
    throw new Error(`Invalid Taiwan MOE artifact: ${z.prettifyError(artifactResult.error)}`);
  }
  const manifest = manifestResult.data;
  const artifact = artifactResult.data;
  const artifactSha256 = sha256(artifactBytes);
  const errors = [
    basename(artifactPath) === manifest.generatedArtifact.datasetFile
      ? null
      : 'artifact filename is not reviewed',
    artifactSha256 === manifest.generatedArtifact.datasetSha256
      ? null
      : 'artifact SHA-256 does not match manifest',
    artifact.datasetVersion === manifest.generatedArtifact.datasetVersion
      ? null
      : 'dataset version does not match manifest',
    artifact.schools.length === manifest.generatedArtifact.schoolCount
      ? null
      : 'school count does not match manifest',
    artifact.selectedSourceRows === manifest.generatedArtifact.selectedSourceRows
      ? null
      : 'selected source-row count does not match manifest',
  ].filter((error): error is string => error !== null);
  for (const source of manifest.sources) {
    const bytes = await readFile(resolve(sourceDirectory, source.datasetFile));
    if (sha256(bytes) !== source.datasetSha256) {
      errors.push(`${source.role} source SHA-256 does not match manifest`);
    }
  }
  if (errors.length) throw new Error(`Refusing unreviewed Taiwan MOE data: ${errors.join('; ')}.`);
  return { manifest, artifact, artifactSha256 };
};

const run = async () => {
  const { manifest, artifact, artifactSha256 } = await loadReviewedArtifact();
  const statusCounts = Object.fromEntries(
    ['exact', 'legal_name_variant', 'conflict', 'missing'].map((status) => [
      status,
      artifact.schools.filter((school) => school.directoryStatus === status).length,
    ]),
  );
  const snapshotCount = artifact.schools.reduce(
    (count, school) => count + school.enrollments.length + 1,
    0,
  );
  if (dryRun) {
    const connection = createDb(getConfig(), { max: 1 });
    try {
      const indexes = await readIdentityIndexes(connection.db);
      const resolutions = artifact.schools.map((school) => resolveIdentity(school, indexes));
      const resolutionCounts = {
        identifier: resolutions.filter(
          (resolution) => resolution.kind === 'existing' && resolution.matchedBy === 'identifier',
        ).length,
        domain: resolutions.filter(
          (resolution) => resolution.kind === 'existing' && resolution.matchedBy === 'domain',
        ).length,
        alias: resolutions.filter(
          (resolution) => resolution.kind === 'existing' && resolution.matchedBy === 'alias',
        ).length,
        create: resolutions.filter((resolution) => resolution.kind === 'create').length,
        reject: resolutions.filter((resolution) => resolution.kind === 'reject').length,
      };
      const rejectionReasons = Object.fromEntries(
        [
          ...new Set(
            resolutions.flatMap((resolution) =>
              resolution.kind === 'reject' ? [resolution.reason] : [],
            ),
          ),
        ]
          .sort()
          .map((reason) => [
            reason,
            resolutions.filter(
              (resolution) => resolution.kind === 'reject' && resolution.reason === reason,
            ).length,
          ]),
      );
      console.log(
        `Taiwan MOE dry run: ${artifact.schools.length} current schools, ${artifact.selectedSourceRows} reviewed 114-year rows, ${snapshotCount} enrollment snapshots; directory status ${JSON.stringify(statusCounts)}; identity plan ${JSON.stringify(resolutionCounts)}; rejection reasons ${JSON.stringify(rejectionReasons)}. No database was changed.`,
      );
    } finally {
      await connection.close();
    }
    return;
  }

  const artifactHash = sha256(`${provider}:${artifactSha256}\n`);
  const datasetVersion = `academic-year-${artifact.datasetVersion}`;
  const checkpointMetadata: Omit<Checkpoint, 'schoolIndex'> = {
    schemaVersion: 1,
    sourceFile: basename(artifactPath),
    sourceSha256: artifactSha256,
    sourceSchools: artifact.schools.length,
    datasetVersion,
    reportedAcademicYear: artifact.reportedAcademicYear,
    academicYear: artifact.academicYear,
  };
  const connection = createDb(getConfig(), { max: 1 });
  let runId: string | undefined;
  let lockHeld = false;
  try {
    const lockResult = await connection.db.execute(sql`
      select pg_try_advisory_lock(hashtextextended(${importLockName}, 0)) as acquired
    `);
    if ((lockResult[0] as { acquired?: unknown } | undefined)?.acquired !== true) {
      throw new Error('Another Taiwan MOE import is already running.');
    }
    lockHeld = true;
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
      checkpoint = checkpointFor(
        existingRun.checkpoint,
        checkpointMetadata,
        artifact.schools.length,
      );
      if (checkpoint.schoolIndex !== existingRun.processedCount) {
        throw new Error('Taiwan MOE checkpoint and processed counter disagree.');
      }
      if (existingRun.status === 'completed') {
        assertCounters(existingRun, artifact.schools.length);
        console.log(`Taiwan MOE ${datasetVersion} is already fully imported.`);
        return;
      }
      runId = existingRun.id;
      await connection.db
        .update(importRuns)
        .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
        .where(eq(importRuns.id, runId));
    } else {
      checkpoint = { ...checkpointMetadata, schoolIndex: 0 };
      const [created] = await connection.db
        .insert(importRuns)
        .values({ provider, datasetVersion, artifactHash, checkpoint, status: 'running' })
        .returning({ id: importRuns.id });
      if (!created) throw new Error('Failed to create Taiwan MOE import ledger.');
      runId = created.id;
    }
    const indexes = await readIdentityIndexes(connection.db);
    const retrievedAt = new Date(manifest.retrievedAt);
    let processedThisInvocation = 0;
    for (let index = checkpoint.schoolIndex; index < artifact.schools.length; index += 1) {
      if (processedThisInvocation >= requestedLimit) break;
      const school = artifact.schools[index] as TaiwanMoeSchool;
      const resolution = resolveIdentity(school, indexes);
      const outcome = await connection.db.transaction(async (tx) => {
        if (!runId) throw new Error('Taiwan MOE import run disappeared.');
        const nextCheckpoint = { ...checkpointMetadata, schoolIndex: index + 1 };
        if (resolution.kind === 'reject') {
          await tx.insert(importRejections).values({
            runId,
            sourceRow: index + 1,
            externalId: school.schoolCode,
            reason: resolution.reason,
            payloadHash: payloadHash(school),
            payload: school,
          });
          await tx
            .update(importRuns)
            .set({
              checkpoint: nextCheckpoint,
              processedCount: sql`${importRuns.processedCount} + 1`,
              rejectedCount: sql`${importRuns.rejectedCount} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(importRuns.id, runId));
          return { kind: 'rejected' as const };
        }

        let universityId: string;
        let slug: string | null = null;
        if (resolution.kind === 'create') {
          const created = await createUniversity(tx, school, indexes, retrievedAt);
          universityId = created.universityId;
          slug = created.slug;
        } else {
          universityId = resolution.universityId;
          await patchExistingUniversity(tx, universityId, school, retrievedAt);
        }
        await upsertAliasesAndIdentifier(tx, universityId, school, retrievedAt);
        const enrollment = enrollmentSource(manifest);
        const enrollmentSourceId = await upsertSource(tx, {
          universityId,
          title: `Taiwan MOE institution enrollment (academic year ${artifact.reportedAcademicYear})`,
          url: enrollment.datasetPageUrl,
          publisher: enrollment.publisher,
          datasetVersion: enrollment.datasetVersion,
          runId,
          verifiedAt: retrievedAt,
        });
        if (hasReliableDirectoryRow(school)) {
          const directory = directorySource(manifest);
          await upsertSource(tx, {
            universityId,
            title: `Taiwan MOE higher-education directory (${directory.datasetVersion})`,
            url: directory.datasetPageUrl,
            publisher: directory.publisher,
            datasetVersion: directory.datasetVersion,
            runId,
            verifiedAt: retrievedAt,
          });
        }
        await upsertEnrollmentSnapshots(
          tx,
          universityId,
          enrollmentSourceId,
          school,
          artifact,
          manifest,
        );
        await tx
          .update(importRuns)
          .set({
            checkpoint: nextCheckpoint,
            processedCount: sql`${importRuns.processedCount} + 1`,
            insertedCount:
              resolution.kind === 'create'
                ? sql`${importRuns.insertedCount} + 1`
                : importRuns.insertedCount,
            updatedCount:
              resolution.kind === 'existing'
                ? sql`${importRuns.updatedCount} + 1`
                : importRuns.updatedCount,
            updatedAt: new Date(),
          })
          .where(eq(importRuns.id, runId));
        return { kind: resolution.kind, universityId, slug };
      });
      processedThisInvocation += 1;
      checkpoint = { ...checkpointMetadata, schoolIndex: index + 1 };
      if (outcome.kind !== 'rejected') {
        indexes.universityIdByCode.set(school.schoolCode, outcome.universityId);
        addToSetMap(indexes.universityIdsByAlias, school.chineseName, outcome.universityId);
        const domain = websiteDomain(school.website);
        if (domain) addToSetMap(indexes.universityIdsByDomain, domain, outcome.universityId);
        if (outcome.slug) indexes.existingSlugs.add(outcome.slug);
      }
      if (
        processedThisInvocation % 25 === 0 ||
        checkpoint.schoolIndex === artifact.schools.length
      ) {
        console.log(
          `Taiwan MOE progress: ${checkpoint.schoolIndex}/${artifact.schools.length} schools.`,
        );
      }
    }
    if (!runId) throw new Error('Taiwan MOE import run disappeared before finalization.');
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
    if (!currentRun) throw new Error('Taiwan MOE import ledger disappeared.');
    const complete = checkpoint.schoolIndex === artifact.schools.length;
    assertCounters(currentRun, complete ? artifact.schools.length : undefined);
    await connection.db
      .update(importRuns)
      .set({
        status: complete ? 'completed' : 'paused',
        finishedAt: complete ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));
    console.log(
      complete
        ? `Taiwan MOE import complete: ${currentRun.insertedCount} created, ${currentRun.updatedCount} matched and updated, ${currentRun.rejectedCount} rejected for review.`
        : `Taiwan MOE import paused at school ${checkpoint.schoolIndex}; rerun to resume.`,
    );
  } catch (error) {
    if (runId) {
      try {
        await connection.db
          .update(importRuns)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(importRuns.id, runId));
      } catch (statusError) {
        console.error('Failed to record Taiwan MOE error state:', statusError);
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

import { createHash } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  ibDatasetSchema,
  ibRequirementSchema,
  type IbDataset,
  type IbProgramInput,
  type IbRequirement,
} from '@urd/shared';
import type { Database } from '../db/client.js';
import {
  admissionProfiles,
  importRejections,
  importRuns,
  institutionIdentifiers,
  programs,
  qualificationRequirements,
  sources,
  universities,
} from '../db/schema.js';
import { IB_PROVIDER } from '../services/ib-service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type RecordInput = IbDataset['records'][number];
type Institution = IbDataset['institutions'][number];
type ProgramRow = typeof programs.$inferSelect;
export class IbIdentityError extends Error {}
export const ibHash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Shared catalog pages can list several courses: the URL, exact name and level form an internal identity. */
export const getIbProgramKey = (input: IbProgramInput): string =>
  input.courseCode ?? `source-url-${ibHash(JSON.stringify([input.url, input.name, input.level]))}`;

export const assertIbRevision = (
  old: IbRequirement,
  next: IbRequirement,
  previousProgramId: string | null,
  nextProgramId: string | null,
  unresolvedProgram: boolean,
) => {
  if (
    previousProgramId !== nextProgramId ||
    unresolvedProgram ||
    old.recordKey !== next.recordKey ||
    old.academicYear !== next.academicYear ||
    old.intakeTerm !== next.intakeTerm ||
    old.entryType !== next.entryType ||
    old.applicantType !== next.applicantType
  )
    throw new IbIdentityError(
      'A record key cannot change course/year/applicant scope. Use a new key for a new intake.',
    );
  if (old.source.checkedOn > next.source.checkedOn)
    throw new IbIdentityError('A newer reviewed requirement already exists.');
};

/** Exact ownership wins; an ambiguous display name always needs a maintainer mapping. */
export const chooseIbProgram = (
  input: IbProgramInput,
  candidates: ProgramRow[],
): ProgramRow | null => {
  if (input.existingProgramId) {
    const match = candidates.find(
      (p) => p.id === input.existingProgramId && p.level === input.level,
    );
    if (!match)
      throw new IbIdentityError(
        'The explicit program ID is absent, belongs to another institution, or has the wrong level.',
      );
    return match;
  }
  const programKey = getIbProgramKey(input);
  const owned = candidates.filter(
    (p) =>
      p.sourceProvider === IB_PROVIDER &&
      p.sourceExternalId === programKey &&
      p.level === input.level,
  );
  if (owned.length > 1)
    throw new IbIdentityError('Multiple course identities; supply existingProgramId.');
  if (owned[0]) return owned[0];
  const named = candidates.filter((p) => p.name === input.name && p.level === input.level);
  if (named.length > 1)
    throw new IbIdentityError('Ambiguous exact course name; supply existingProgramId.');
  if (named[0]?.sourceProvider === IB_PROVIDER && named[0].sourceExternalId !== programKey)
    throw new IbIdentityError(
      'A same-name course has a different official code or reviewed URL identity; supply existingProgramId after reviewing the mapping.',
    );
  return named[0] ?? null;
};

const planRecord = async (db: Database | Tx, institution: Institution, record: RecordInput) => {
  const matches = await db
    .select({ university: universities })
    .from(institutionIdentifiers)
    .innerJoin(universities, eq(institutionIdentifiers.universityId, universities.id))
    .where(
      and(
        eq(institutionIdentifiers.provider, institution.provider),
        eq(institutionIdentifiers.externalId, institution.externalId),
      ),
    );
  if (matches.length !== 1 || matches[0]?.university.countryCode !== institution.countryCode)
    throw new IbIdentityError('Exact institution identifier or country does not match.');
  const university = matches[0].university;
  const candidates = record.program
    ? await db
        .select()
        .from(programs)
        .where(
          and(
            eq(programs.universityId, university.id),
            record.program.existingProgramId
              ? eq(programs.id, record.program.existingProgramId)
              : or(
                  eq(programs.name, record.program.name),
                  and(
                    eq(programs.sourceProvider, IB_PROVIDER),
                    eq(programs.sourceExternalId, getIbProgramKey(record.program)),
                  ),
                ),
          ),
        )
    : [];
  const program = record.program ? chooseIbProgram(record.program, candidates) : null;
  const requirement = record.requirement;
  const [existingSource] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.universityId, university.id), eq(sources.url, requirement.source.url)));
  if (existingSource && existingSource.category !== 'official')
    throw new IbIdentityError('An existing source at this URL has a conflicting category.');
  const existing = await db
    .select({ row: qualificationRequirements, profile: admissionProfiles })
    .from(qualificationRequirements)
    .innerJoin(
      admissionProfiles,
      eq(qualificationRequirements.admissionProfileId, admissionProfiles.id),
    )
    .where(
      and(
        eq(admissionProfiles.universityId, university.id),
        eq(qualificationRequirements.qualificationSystem, 'IB'),
        eq(qualificationRequirements.subject, requirement.recordKey),
        sql`${qualificationRequirements.sourceFlags}->>'provider' = ${IB_PROVIDER}`,
      ),
    );
  if (existing.length > 1) throw new IbIdentityError('Conflicting stored requirement keys.');
  const previous = existing[0];
  if (previous) {
    const old = ibRequirementSchema.parse(previous.row.sourceFlags.ib);
    if (
      old.academicYear !== previous.profile.academicYear ||
      old.intakeTerm !== previous.profile.intakeTerm ||
      old.applicantType !== previous.profile.applicantType ||
      old.entryType !== previous.profile.entryType
    )
      throw new IbIdentityError(
        'Stored IB evidence does not match its parent admission scope. Review before importing.',
      );
    assertIbRevision(
      old,
      requirement,
      previous.profile.programId,
      program?.id ?? null,
      Boolean(!program && record.program),
    );
  }
  return { university, program, existingSource, previous };
};

const saveRecord = async (
  tx: Tx,
  institution: Institution,
  record: RecordInput,
  runId: string,
  dataset: IbDataset,
) => {
  const plan = await planRecord(tx, institution, record);
  const requirement = record.requirement;
  let sourceId = plan.existingSource?.id;
  if (!sourceId) {
    const [inserted] = await tx
      .insert(sources)
      .values({
        universityId: plan.university.id,
        title: requirement.source.title,
        url: requirement.source.url,
        category: 'official',
        publisher: institution.name,
        datasetVersion: dataset.datasetVersion,
        verifiedAt: new Date(`${requirement.source.checkedOn}T00:00:00Z`),
        importRunId: runId,
      })
      .returning();
    if (!inserted) throw new Error('IB source insert failed.');
    sourceId = inserted.id;
  }
  let programId = plan.program?.id ?? null;
  if (record.program && !programId) {
    const [inserted] = await tx
      .insert(programs)
      .values({
        universityId: plan.university.id,
        name: record.program.name,
        level: record.program.level,
        field: record.program.field,
        academicYear: requirement.academicYear,
        sourceId,
        sourceProvider: IB_PROVIDER,
        sourceExternalId: getIbProgramKey(record.program),
        sourceFlags: {
          courseUrl: record.program.url,
          officialCourseCode: record.program.courseCode,
          identityBasis:
            record.program.courseCode === null ? 'reviewed_course_url_and_name' : 'course_code',
          datasetVersion: dataset.datasetVersion,
        },
      })
      .returning();
    if (!inserted) throw new Error('IB course insert failed.');
    programId = inserted.id;
  }
  const level = record.program?.level ?? 'undergraduate';
  const [existingProfile] = await tx
    .select()
    .from(admissionProfiles)
    .where(
      and(
        eq(admissionProfiles.universityId, plan.university.id),
        programId
          ? eq(admissionProfiles.programId, programId)
          : isNull(admissionProfiles.programId),
        eq(admissionProfiles.academicYear, requirement.academicYear),
        eq(admissionProfiles.intakeTerm, requirement.intakeTerm),
        eq(admissionProfiles.entryType, requirement.entryType),
        eq(admissionProfiles.applicantType, requirement.applicantType),
        eq(admissionProfiles.level, level),
      ),
    );
  let profileId = existingProfile?.id;
  if (!profileId) {
    const [inserted] = await tx
      .insert(admissionProfiles)
      .values({
        universityId: plan.university.id,
        programId,
        academicYear: requirement.academicYear,
        intakeTerm: requirement.intakeTerm,
        entryType: requirement.entryType,
        level,
        applicantType: requirement.applicantType,
        sourceId,
        sourceFlags: { provider: IB_PROVIDER },
      })
      .returning();
    if (!inserted) throw new Error('IB admission profile insert failed.');
    profileId = inserted.id;
  }
  const values = {
    admissionProfileId: profileId,
    qualificationSystem: 'IB',
    qualificationName: 'International Baccalaureate Diploma',
    kind: 'overall_score' as const,
    subject: requirement.recordKey,
    operator:
      requirement.totalMin === null
        ? ('descriptive' as const)
        : requirement.totalMax !== null
          ? ('range' as const)
          : ('minimum' as const),
    minimumValue: requirement.totalMin?.toString() ?? null,
    maximumValue: requirement.totalMax?.toString() ?? null,
    valueText: requirement.conditions,
    scale: requirement.scoreScale?.toString() ?? null,
    notes: requirement.subjectNotes || null,
    sourceId,
    sourceFlags: { provider: IB_PROVIDER, ib: requirement, datasetVersion: dataset.datasetVersion },
  };
  if (plan.previous)
    await tx
      .update(qualificationRequirements)
      .set(values)
      .where(eq(qualificationRequirements.id, plan.previous.row.id));
  else await tx.insert(qualificationRequirements).values(values);
  return {
    action: plan.previous ? ('updated' as const) : ('inserted' as const),
    createdProgram: Boolean(record.program && !plan.program),
  };
};

export const importIbDataset = async (
  db: Database,
  input: unknown,
  options: { dryRun?: boolean; limit?: number } = {},
) => {
  const dataset = ibDatasetSchema.parse(input);
  const artifactHash = ibHash(JSON.stringify(dataset));
  const limit = options.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error('Batch limit must be an integer from 1 to 10000.');
  const institutions = new Map(dataset.institutions.map((i) => [i.key, i]));
  const institutionFor = (r: RecordInput) => {
    const institution = institutions.get(r.institutionKey);
    if (!institution) throw new Error('Dataset institution disappeared after validation.');
    return institution;
  };
  if (options.dryRun) {
    const result = {
      mode: 'dry-run',
      records: dataset.records.length,
      insertCandidates: 0,
      updateCandidates: 0,
      rejected: [] as Array<{ recordKey: string; reason: string }>,
    };
    for (const record of dataset.records) {
      try {
        const plan = await planRecord(db, institutionFor(record), record);
        if (plan.previous) result.updateCandidates += 1;
        else result.insertCandidates += 1;
      } catch (error) {
        if (!(error instanceof IbIdentityError)) throw error;
        result.rejected.push({ recordKey: record.requirement.recordKey, reason: error.message });
      }
    }
    return result;
  }
  // Each batch is atomic. A failed batch rolls back; a committed batch resumes at rowIndex.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('uniscope:official_ib'))`);
    const runFilter = and(
      eq(importRuns.provider, IB_PROVIDER),
      eq(importRuns.datasetVersion, dataset.datasetVersion),
      eq(importRuns.artifactHash, artifactHash),
    );
    let [run] = await tx.select().from(importRuns).where(runFilter);
    if (run?.status === 'completed')
      return { mode: 'import', status: 'already-completed', processed: run.processedCount };
    if (!run) {
      [run] = await tx
        .insert(importRuns)
        .values({ provider: IB_PROVIDER, datasetVersion: dataset.datasetVersion, artifactHash })
        .returning();
    }
    if (!run) throw new Error('IB import run could not be opened.');
    const start = Number(run.checkpoint.rowIndex ?? 0);
    if (!Number.isInteger(start) || start < 0 || start > dataset.records.length)
      throw new Error('Invalid IB import checkpoint.');
    const end = Math.min(start + limit, dataset.records.length);
    let inserted = run.insertedCount,
      updated = run.updatedCount,
      rejected = run.rejectedCount;
    let createdPrograms = Number(run.checkpoint.createdPrograms ?? 0);
    for (let index = start; index < end; index += 1) {
      const record = dataset.records[index];
      if (!record) throw new Error('IB source row is missing.');
      try {
        const saved = await saveRecord(tx, institutionFor(record), record, run.id, dataset);
        if (saved.action === 'inserted') inserted += 1;
        else updated += 1;
        if (saved.createdProgram) createdPrograms += 1;
      } catch (error) {
        if (!(error instanceof IbIdentityError)) throw error;
        await tx.insert(importRejections).values({
          runId: run.id,
          sourceRow: index + 1,
          externalId: record.requirement.recordKey,
          reason: error.message,
          payloadHash: ibHash(JSON.stringify(record)),
          payload: record,
        });
        rejected += 1;
      }
    }
    const status = end === dataset.records.length ? ('completed' as const) : ('paused' as const);
    await tx
      .update(importRuns)
      .set({
        status,
        processedCount: end,
        insertedCount: inserted,
        updatedCount: updated,
        rejectedCount: rejected,
        checkpoint: {
          rowIndex: end,
          sourceRows: dataset.records.length,
          createdPrograms,
          schemaVersion: 1,
        },
        finishedAt: status === 'completed' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, run.id));
    return {
      mode: 'import',
      status,
      processed: end,
      sourceRows: dataset.records.length,
      inserted,
      updated,
      rejected,
      createdPrograms,
    };
  });
};

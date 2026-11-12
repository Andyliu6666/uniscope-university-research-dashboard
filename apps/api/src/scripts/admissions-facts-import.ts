import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  admissionProfiles,
  admissionRequirements,
  importRuns,
  institutionIdentifiers,
  programs,
  sources,
  universities,
} from '../db/schema.js';
import {
  admissionFactsDatasetSchema,
  chooseExistingFact,
  factScope,
  normalizeFactText,
  type AdmissionsFactsDataset,
  type FactProfile,
  type FactProgram,
} from './admissions-facts-format.js';

const PROVIDER = 'official_admissions';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Store = Database | Tx;
type ProgramRow = typeof programs.$inferSelect;
type School = AdmissionsFactsDataset['institutions'][number];

export const getFactProgramKey = (program: FactProgram) =>
  `name-${createHash('sha256')
    .update(JSON.stringify([normalizeFactText(program.name), program.level]))
    .digest('hex')}`;

/** Names are matched within one resolved institution. Never choose among ambiguous courses. */
export function chooseFactProgram(input: FactProgram, candidates: ProgramRow[]) {
  const key = getFactProgramKey(input);
  const matching = candidates.filter(
    (row) =>
      (normalizeFactText(row.name) === normalizeFactText(input.name) &&
        row.level === input.level) ||
      (row.sourceProvider === PROVIDER && row.sourceExternalId === key),
  );
  if (matching.length > 1) throw new Error('Ambiguous programme identity; review required.');
  const existing = matching[0];
  if (
    existing &&
    (normalizeFactText(existing.name) !== normalizeFactText(input.name) ||
      existing.level !== input.level ||
      normalizeFactText(existing.field) !== normalizeFactText(input.field))
  )
    throw new Error('Programme metadata conflicts; review rather than overwrite.');
  return existing;
}

async function resolveInstitution(db: Store, dataset: AdmissionsFactsDataset, key: string) {
  const school = dataset.institutions.find((item) => item.key === key);
  if (!school) throw new Error('Missing institution.');
  const matches = await db
    .select({ university: universities })
    .from(institutionIdentifiers)
    .innerJoin(universities, eq(institutionIdentifiers.universityId, universities.id))
    .where(
      and(
        eq(institutionIdentifiers.provider, school.provider),
        eq(institutionIdentifiers.externalId, school.externalId),
      ),
    );
  const university = matches[0]?.university;
  if (matches.length !== 1 || !university || university.countryCode !== school.countryCode)
    throw new Error(`Exact institution identifier/country mismatch: ${school.key}`);
  return { school, university };
}

async function ensureSource(
  store: Store,
  universityId: string,
  school: School,
  evidence: FactProgram['source'],
  datasetVersion: string,
  runId: string,
) {
  const [stored] = await store
    .select()
    .from(sources)
    .where(and(eq(sources.universityId, universityId), eq(sources.url, evidence.url)));
  if (stored) {
    if (stored.category !== 'official')
      throw new Error('Source category conflicts; review required.');
    return stored.id;
  }
  const [saved] = await store
    .insert(sources)
    .values({
      universityId,
      url: evidence.url,
      title: evidence.title,
      category: 'official',
      publisher: school.name,
      datasetVersion,
      verifiedAt: new Date(`${evidence.checkedOn}T00:00:00Z`),
      importRunId: runId,
    })
    .returning();
  if (!saved) throw new Error('Source insert failed.');
  return saved.id;
}

type ProgramPlan = {
  input: FactProgram;
  universityId: string;
  school: School;
  existing: ProgramRow | undefined;
};

async function planPriorSharedLinks(store: Store, programsToImport: Map<string, ProgramPlan>) {
  const targets = new Map<
    string,
    { id: string; sourceFlags: Record<string, unknown>; programIds: string[]; addedKeys: string[] }
  >();
  for (const [key, { input, universityId, existing }] of programsToImport) {
    for (const reference of input.priorSharedRequirements ?? []) {
      const targetKey = JSON.stringify([
        universityId,
        input.level,
        reference.datasetVersion,
        reference.key,
      ]);
      let target = targets.get(targetKey);
      if (!target) {
        const matches = await store
          .select({ id: admissionRequirements.id, sourceFlags: admissionRequirements.sourceFlags })
          .from(admissionRequirements)
          .innerJoin(
            admissionProfiles,
            eq(admissionRequirements.admissionProfileId, admissionProfiles.id),
          )
          .innerJoin(sources, eq(admissionRequirements.sourceId, sources.id))
          .where(
            and(
              eq(admissionProfiles.universityId, universityId),
              eq(admissionProfiles.level, input.level),
              isNull(admissionProfiles.programId),
              eq(sources.universityId, universityId),
              eq(sources.category, 'official'),
              eq(admissionRequirements.requirementKey, reference.key),
              eq(sql`${admissionRequirements.sourceFlags}->>'provider'`, PROVIDER),
              eq(
                sql`${admissionRequirements.sourceFlags}->>'datasetVersion'`,
                reference.datasetVersion,
              ),
            ),
          );
        const row = matches[0];
        if (matches.length !== 1 || !row)
          throw new Error(
            `Expected one prior shared requirement in the same institution and level: ${reference.datasetVersion}/${reference.key}`,
          );
        const ids = row.sourceFlags.sharedProgramIds;
        if (
          ids !== undefined &&
          (!Array.isArray(ids) ||
            !ids.length ||
            !ids.every((id) => typeof id === 'string') ||
            new Set(ids).size !== ids.length)
        )
          throw new Error('Invalid existing shared programme links.');
        target = { ...row, programIds: ids ?? [], addedKeys: [] };
        targets.set(targetKey, target);
      }
      if (!existing || !target.programIds.includes(existing.id)) target.addedKeys.push(key);
    }
  }
  return [...targets.values()].filter(({ addedKeys }) => addedKeys.length);
}

async function resolveProfile(
  db: Store,
  dataset: AdmissionsFactsDataset,
  profile: FactProfile,
  programPlans: Map<string, ProgramPlan>,
) {
  const { school, university } = await resolveInstitution(db, dataset, profile.institutionKey);
  const declaredProgram = profile.programKey ? programPlans.get(profile.programKey) : undefined;
  const programId = declaredProgram?.existing?.id ?? profile.programId;
  if (profile.programId) {
    const [program] = await db.select().from(programs).where(eq(programs.id, profile.programId));
    if (!program || program.universityId !== university.id || program.level !== profile.level)
      throw new Error('The explicit programme must belong to this institution and level.');
  }
  const [existingProfile] =
    declaredProgram && !declaredProgram.existing
      ? []
      : await db
          .select()
          .from(admissionProfiles)
          .where(
            and(
              eq(admissionProfiles.universityId, university.id),
              programId
                ? eq(admissionProfiles.programId, programId)
                : isNull(admissionProfiles.programId),
              eq(admissionProfiles.academicYear, profile.academicYear),
              eq(admissionProfiles.intakeTerm, profile.intakeTerm),
              eq(admissionProfiles.deliveryMode, profile.deliveryMode ?? 'unspecified'),
              eq(admissionProfiles.entryType, profile.entryType),
              eq(admissionProfiles.level, profile.level),
              eq(admissionProfiles.applicantType, profile.applicantType),
            ),
          );
  const existing = existingProfile
    ? await db
        .select()
        .from(admissionRequirements)
        .where(eq(admissionRequirements.admissionProfileId, existingProfile.id))
    : [];
  const sourceRows = await db.select().from(sources).where(eq(sources.universityId, university.id));
  const facts = profile.requirements.map((fact) => {
    const source = sourceRows.find((row) => row.url === fact.source.url);
    if (source && source.category !== 'official')
      throw new Error('Source category conflicts; review required.');
    return { fact, existing: chooseExistingFact(fact, existing), source };
  });
  return { school, university, profile, programId, existingProfile, facts };
}

/** Add facts and explicit programme links atomically. Repeated facts reuse their original rows. */
export async function importAdmissionsFacts(db: Database, input: unknown, dryRun = false) {
  const dataset = admissionFactsDatasetSchema.parse(input);
  const artifactHash = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
  const perform = async (store: Store, write: boolean) => {
    const programPlans = new Map<string, ProgramPlan>();
    const resolvedPrograms = new Set<string>();
    for (const input of dataset.programs ?? []) {
      const { school, university } = await resolveInstitution(store, dataset, input.institutionKey);
      const candidates = await store
        .select()
        .from(programs)
        .where(eq(programs.universityId, university.id));
      const existing = chooseFactProgram(input, candidates);
      const identity = existing?.id ?? `${university.id}:${getFactProgramKey(input)}`;
      if (resolvedPrograms.has(identity))
        throw new Error(
          'Institution aliases resolve to the same programme; consolidate the dataset.',
        );
      resolvedPrograms.add(identity);
      const [source] = await store
        .select()
        .from(sources)
        .where(and(eq(sources.universityId, university.id), eq(sources.url, input.source.url)));
      if (source && source.category !== 'official')
        throw new Error('Source category conflicts; review required.');
      programPlans.set(input.key, { input, school, universityId: university.id, existing });
    }
    const programCounts = dataset.programs
      ? {
          programsCreated: [...programPlans.values()].filter((plan) => !plan.existing).length,
          programsReused: [...programPlans.values()].filter((plan) => plan.existing).length,
        }
      : {};
    const priorLinks = await planPriorSharedLinks(store, programPlans);
    const linkCounts = [...programPlans.values()].some(({ input }) => input.priorSharedRequirements)
      ? {
          priorSharedLinksAdded: priorLinks.reduce(
            (total, link) => total + link.addedKeys.length,
            0,
          ),
        }
      : {};
    const plans = [];
    const sharedKeysFor = (profile: FactProfile, key: string) => {
      if (profile.programId !== null || profile.programKey) return [];
      return (dataset.programs ?? [])
        .filter(
          (program) =>
            program.institutionKey === profile.institutionKey &&
            program.level === profile.level &&
            program.sharedRequirementKeys?.includes(key),
        )
        .map((program) => program.key);
    };
    const resolvedScopes = new Set<string>();
    for (const profile of dataset.profiles) {
      const plan = await resolveProfile(store, dataset, profile, programPlans);
      const pending = profile.programKey ? programPlans.get(profile.programKey) : undefined;
      const scope = factScope({
        ...profile,
        institutionKey: plan.university.id,
        programKey: undefined,
        programId:
          plan.programId ?? (pending ? `pending:${getFactProgramKey(pending.input)}` : null),
      });
      if (resolvedScopes.has(scope))
        throw new Error(
          'Institution aliases resolve to the same admission scope; consolidate the dataset before import.',
        );
      resolvedScopes.add(scope);
      plans.push(plan);
    }
    for (const plan of plans)
      for (const item of plan.facts) {
        const keys = sharedKeysFor(plan.profile, item.fact.key);
        if (!item.existing || !keys.length) continue;
        const ids = keys.map((key) => programPlans.get(key)?.existing?.id);
        const stored = item.existing.sourceFlags?.sharedProgramIds;
        if (
          ids.some((id) => !id) ||
          !Array.isArray(stored) ||
          ids.some((id) => !stored.includes(id))
        )
          throw new Error(
            'Shared programme links conflict with an existing fact; review rather than overwrite.',
          );
      }
    const inserted = plans.flatMap((plan) => plan.facts).filter((item) => !item.existing).length;
    const skipped = plans.flatMap((plan) => plan.facts).length - inserted;
    if (!write)
      return {
        mode: 'dry-run',
        inserted,
        skipped,
        databaseWrites: 0,
        ...programCounts,
        ...linkCounts,
      };
    const [previousRun] = await store
      .select()
      .from(importRuns)
      .where(
        and(
          eq(importRuns.provider, PROVIDER),
          eq(importRuns.datasetVersion, dataset.datasetVersion),
          eq(importRuns.artifactHash, artifactHash),
        ),
      );
    if (previousRun?.status === 'completed') {
      if (inserted || priorLinks.length || programCounts.programsCreated)
        throw new Error(
          'Completed artifact has missing facts, programmes or links; investigate before restoring.',
        );
      return { mode: 'already-completed', inserted: 0, skipped, ...programCounts, ...linkCounts };
    }
    if (previousRun) throw new Error('Unexpected incomplete ledger; review before retrying.');
    const [run] = await store
      .insert(importRuns)
      .values({ provider: PROVIDER, datasetVersion: dataset.datasetVersion, artifactHash })
      .returning();
    if (!run) throw new Error('Import ledger insert failed.');
    const programIds = new Map<string, string>();
    for (const [key, plan] of programPlans) {
      if (plan.existing) {
        programIds.set(key, plan.existing.id);
        continue;
      }
      const sourceId = await ensureSource(
        store,
        plan.universityId,
        plan.school,
        plan.input.source,
        dataset.datasetVersion,
        run.id,
      );
      const [saved] = await store
        .insert(programs)
        .values({
          universityId: plan.universityId,
          name: plan.input.name,
          level: plan.input.level,
          field: plan.input.field,
          academicYear: 'unspecified',
          sourceId,
          sourceProvider: PROVIDER,
          sourceExternalId: getFactProgramKey(plan.input),
          sourceFlags: {
            provider: PROVIDER,
            datasetVersion: dataset.datasetVersion,
            sourceUrl: plan.input.source.url,
          },
        })
        .returning();
      if (!saved) throw new Error('Programme insert failed.');
      programIds.set(key, saved.id);
    }
    for (const { id, sourceFlags, programIds: priorIds, addedKeys } of priorLinks) {
      const newIds = addedKeys.map((key) => {
        const programId = programIds.get(key);
        if (!programId) throw new Error('Shared programme identity disappeared.');
        return programId;
      });
      await store
        .update(admissionRequirements)
        .set({ sourceFlags: { ...sourceFlags, sharedProgramIds: [...priorIds, ...newIds] } })
        .where(eq(admissionRequirements.id, id));
    }
    for (const plan of plans) {
      let profileId = plan.existingProfile?.id;
      for (const { fact, existing } of plan.facts) {
        // Existing facts are never cloned just because a second official page repeats them.
        if (existing) continue;
        const sourceId = await ensureSource(
          store,
          plan.university.id,
          plan.school,
          fact.source,
          dataset.datasetVersion,
          run.id,
        );
        if (!profileId) {
          const {
            requirements: _requirements,
            institutionKey: _institutionKey,
            programKey: _programKey,
            ...scope
          } = plan.profile;
          const [saved] = await store
            .insert(admissionProfiles)
            .values({
              ...scope,
              deliveryMode: plan.profile.deliveryMode ?? 'unspecified',
              programId: plan.profile.programKey
                ? programIds.get(plan.profile.programKey)
                : plan.programId,
              universityId: plan.university.id,
              sourceId,
              sourceFlags: { provider: PROVIDER, datasetVersion: dataset.datasetVersion },
            })
            .returning();
          if (!saved) throw new Error('Profile insert failed.');
          profileId = saved.id;
        }
        await store.insert(admissionRequirements).values({
          admissionProfileId: profileId,
          requirementKey: fact.key,
          category: fact.category,
          label: fact.label,
          status: fact.status,
          details: fact.details,
          sourceId,
          verifiedAt: new Date(`${fact.source.checkedOn}T00:00:00Z`),
          sourceFlags: {
            provider: PROVIDER,
            datasetVersion: dataset.datasetVersion,
            sourceUrl: fact.source.url,
            sourceTitle: fact.source.title,
            ...(sharedKeysFor(plan.profile, fact.key).length
              ? {
                  sharedProgramIds: sharedKeysFor(plan.profile, fact.key).map((key) => {
                    const id = programIds.get(key);
                    if (!id) throw new Error('Shared programme identity disappeared.');
                    return id;
                  }),
                }
              : {}),
          },
        });
      }
    }
    await store
      .update(importRuns)
      .set({
        status: 'completed',
        insertedCount: inserted,
        skippedCount: skipped,
        processedCount: inserted + skipped,
        finishedAt: new Date(),
        checkpoint: {
          profiles: plans.length,
          admissionFacts: inserted + skipped,
          ...programCounts,
          ...linkCounts,
        },
      })
      .where(eq(importRuns.id, run.id));
    return { mode: 'completed', inserted, skipped, ...programCounts, ...linkCounts };
  };
  if (dryRun) return perform(db, false);
  return db.transaction(async (tx) => {
    // Cooperates with the existing admissions importers and serializes repeated reviewed batches.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('uniscope:admissions-import:v1'))`);
    await tx.execute(
      sql`lock table programs, admission_profiles, admission_requirements, sources in share row exclusive mode`,
    );
    return perform(tx, true);
  });
}

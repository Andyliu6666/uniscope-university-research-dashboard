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

/** Append only: repeat facts are skipped across source URLs. Conflicts roll back the whole batch. */
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
    const plans = [];
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
    const inserted = plans.flatMap((plan) => plan.facts).filter((item) => !item.existing).length;
    const skipped = plans.flatMap((plan) => plan.facts).length - inserted;
    if (!write) return { mode: 'dry-run', inserted, skipped, databaseWrites: 0, ...programCounts };
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
      if (inserted)
        throw new Error(
          'Completed artifact has missing facts; investigate instead of silently restoring.',
        );
      return { mode: 'already-completed', inserted: 0, skipped, ...programCounts };
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
        },
      })
      .where(eq(importRuns.id, run.id));
    return { mode: 'completed', inserted, skipped, ...programCounts };
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

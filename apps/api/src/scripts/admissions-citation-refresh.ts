import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
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
  assertCitationContent,
  citationContentHash,
  citationRefreshSchema,
} from './admissions-citation-format.js';

const PROVIDER = 'official_citation_refresh';
type Store = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export async function refreshAdmissionsCitations(db: Database, input: unknown, dryRun: boolean) {
  const dataset = citationRefreshSchema.parse(input);
  const artifactHash = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
  const perform = async (store: Store, write: boolean) => {
    const matches = await store
      .select({ university: universities })
      .from(universities)
      .innerJoin(institutionIdentifiers, eq(institutionIdentifiers.universityId, universities.id))
      .where(
        and(
          eq(institutionIdentifiers.provider, 'ror'),
          eq(institutionIdentifiers.externalId, dataset.institution.ror),
        ),
      );
    const institution = matches[0]?.university;
    if (
      matches.length !== 1 ||
      !institution ||
      institution.countryCode !== dataset.institution.countryCode
    )
      throw new Error('Exact citation institution/country mismatch.');
    if (write)
      await store.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${PROVIDER + institution.id},0))`,
      );
    const rows = await store
      .select({
        fact: admissionRequirements,
        profile: admissionProfiles,
        programName: programs.name,
        source: sources,
      })
      .from(admissionRequirements)
      .innerJoin(
        admissionProfiles,
        eq(admissionProfiles.id, admissionRequirements.admissionProfileId),
      )
      .leftJoin(programs, eq(programs.id, admissionProfiles.programId))
      .innerJoin(sources, eq(sources.id, admissionRequirements.sourceId))
      .where(eq(admissionProfiles.universityId, institution.id));
    const plans = dataset.records.map((record) => {
      const candidates = rows.filter(
        (row) =>
          row.fact.requirementKey === record.fact.key &&
          row.programName === record.programName &&
          row.profile.academicYear === record.scope.academicYear &&
          row.profile.intakeTerm === record.scope.intakeTerm &&
          row.profile.deliveryMode === record.scope.deliveryMode &&
          row.profile.entryType === record.scope.entryType &&
          row.profile.level === record.scope.level &&
          row.profile.applicantType === record.scope.applicantType,
      );
      const row = candidates[0];
      if (
        candidates.length !== 1 ||
        !row ||
        row.fact.sourceFlags.provider !== 'official_admissions' ||
        row.source.universityId !== institution.id ||
        row.source.category !== 'official'
      )
        throw new Error(`Expected one official citation target: ${record.fact.key}`);
      assertCitationContent(record, {
        originalDatasetVersion: row.fact.sourceFlags.datasetVersion,
        programName: row.programName,
        scope: {
          academicYear: row.profile.academicYear,
          intakeTerm: row.profile.intakeTerm,
          deliveryMode: row.profile.deliveryMode,
          entryType: row.profile.entryType,
          level: row.profile.level,
          applicantType: row.profile.applicantType,
        },
        fact: {
          key: row.fact.requirementKey,
          category: row.fact.category,
          label: row.fact.label,
          status: row.fact.status,
          details: row.fact.details ?? '',
        },
      });
      const date = row.fact.verifiedAt?.toISOString().slice(0, 10);
      const marker = row.fact.sourceFlags.citationRefresh;
      const applied =
        row.source.url === record.replacement.url &&
        row.fact.sourceFlags.sourceUrl === record.replacement.url &&
        row.fact.sourceFlags.sourceTitle === record.replacement.title &&
        date === record.replacement.checkedOn &&
        typeof marker === 'object' &&
        marker !== null &&
        'datasetVersion' in marker &&
        marker.datasetVersion === dataset.datasetVersion;
      if (
        !applied &&
        (row.source.url !== record.fact.source.url ||
          row.fact.sourceFlags.sourceUrl !== record.fact.source.url ||
          row.fact.sourceFlags.sourceTitle !== record.fact.source.title ||
          date !== record.fact.source.checkedOn)
      )
        throw new Error(`Citation provenance changed: ${record.fact.key}`);
      return { record, row, applied };
    });
    const [run] = await store
      .select()
      .from(importRuns)
      .where(
        and(
          eq(importRuns.provider, PROVIDER),
          eq(importRuns.datasetVersion, dataset.datasetVersion),
          eq(importRuns.artifactHash, artifactHash),
        ),
      );
    const pending = plans.filter((p) => !p.applied);
    const previousUrl = dataset.records[0]?.fact.source.url;
    if (!previousUrl) throw new Error('Missing previous source.');
    const [oldSource] = await store
      .select()
      .from(sources)
      .where(and(eq(sources.universityId, institution.id), eq(sources.url, previousUrl)));
    if (run) {
      if (
        run.status !== 'completed' ||
        pending.length ||
        (dataset.retirePreviousSource && oldSource)
      )
        throw new Error('Completed citation run has inconsistent state.');
      const movedIds = run.checkpoint.programCitationsMoved;
      if (!Array.isArray(movedIds)) throw new Error('Missing programme citation audit.');
      const movedPrograms = (
        await store.select().from(programs).where(eq(programs.universityId, institution.id))
      ).filter((p) => movedIds.includes(p.id));
      const [canonical] = await store
        .select()
        .from(sources)
        .where(
          and(
            eq(sources.universityId, institution.id),
            eq(sources.url, dataset.canonicalSource.url),
          ),
        );
      if (
        !canonical ||
        movedPrograms.length !== movedIds.length ||
        movedPrograms.some(
          (p) => p.sourceId !== canonical.id || p.sourceFlags.sourceUrl !== canonical.url,
        )
      )
        throw new Error('Completed programme citation provenance is inconsistent.');
      return { mode: 'already-completed', updated: 0, skipped: plans.length };
    }
    if (pending.length !== plans.length)
      throw new Error('Partially refreshed citation set has no completed ledger.');
    const sourceRows = await store
      .select()
      .from(sources)
      .where(eq(sources.universityId, institution.id));
    const targets = [dataset.canonicalSource, ...dataset.records.map((r) => r.replacement)];
    for (const target of targets) {
      const saved = sourceRows.find((s) => s.url === target.url);
      if (saved && saved.category !== 'official')
        throw new Error('Replacement source category conflicts.');
    }
    const ownedProfiles = await store
      .select()
      .from(admissionProfiles)
      .where(eq(admissionProfiles.universityId, institution.id));
    const ownedPrograms = await store
      .select()
      .from(programs)
      .where(eq(programs.universityId, institution.id));
    const retiredProfiles = oldSource
      ? ownedProfiles.filter((p) => p.sourceId === oldSource.id)
      : [];
    const retiredPrograms = oldSource
      ? ownedPrograms.filter((p) => p.sourceId === oldSource.id)
      : [];
    if (dataset.retirePreviousSource) {
      if (oldSource?.category !== 'official')
        throw new Error('Previous official source is missing.');
      const reviewedIds = new Set(plans.map((p) => p.row.fact.id));
      if (rows.some((r) => r.source.id === oldSource.id && !reviewedIds.has(r.fact.id)))
        throw new Error('Unreviewed requirements still use the previous source.');
      const profileIds = new Set(plans.map((p) => p.row.profile.id));
      const programIds = new Set(
        plans.flatMap((p) => (p.row.profile.programId ? [p.row.profile.programId] : [])),
      );
      if (
        retiredProfiles.some((p) => !profileIds.has(p.id)) ||
        retiredPrograms.some((p) => !programIds.has(p.id))
      )
        throw new Error('Unreviewed programme/profile metadata uses the previous source.');
      if (
        retiredPrograms.some(
          (p) =>
            p.sourceProvider !== 'official_admissions' ||
            p.sourceFlags.provider !== 'official_admissions' ||
            p.sourceFlags.sourceUrl !== previousUrl,
        )
      )
        throw new Error('Previous programme provenance is not the reviewed official source.');
    }
    if (!write)
      return {
        mode: 'dry-run',
        updated: pending.length,
        skipped: 0,
        databaseWrites: 0,
        sourceRetirements: dataset.retirePreviousSource ? 1 : 0,
        profileCitationsMoved: retiredProfiles.length,
        programCitationsMoved: retiredPrograms.length,
      };
    const [savedRun] = await store
      .insert(importRuns)
      .values({ provider: PROVIDER, datasetVersion: dataset.datasetVersion, artifactHash })
      .returning();
    if (!savedRun) throw new Error('Citation ledger insert failed.');
    const targetIds = new Map(sourceRows.map((s) => [s.url, s.id]));
    for (const target of targets) {
      if (targetIds.has(target.url)) continue;
      const [saved] = await store
        .insert(sources)
        .values({
          universityId: institution.id,
          url: target.url,
          title: target.title,
          category: 'official',
          publisher: institution.name,
          datasetVersion: dataset.datasetVersion,
          verifiedAt: new Date(`${target.checkedOn}T00:00:00Z`),
          importRunId: savedRun.id,
        })
        .returning();
      if (!saved) throw new Error('Replacement source insert failed.');
      targetIds.set(target.url, saved.id);
    }
    for (const { record, row } of pending) {
      const flags = {
        ...row.fact.sourceFlags,
        sourceUrl: record.replacement.url,
        sourceTitle: record.replacement.title,
        citationRefresh: {
          datasetVersion: dataset.datasetVersion,
          originalUrl: record.fact.source.url,
          originalCheckedOn: record.fact.source.checkedOn,
          checkedOn: record.replacement.checkedOn,
          sourceSha256: record.replacement.sha256,
          contentSha256: citationContentHash(record),
        },
      };
      await store
        .update(admissionRequirements)
        .set({
          sourceId: targetIds.get(record.replacement.url),
          sourceFlags: flags,
          verifiedAt: new Date(`${record.replacement.checkedOn}T00:00:00Z`),
        })
        .where(eq(admissionRequirements.id, row.fact.id));
    }
    if (dataset.retirePreviousSource && oldSource) {
      const canonicalId = targetIds.get(dataset.canonicalSource.url);
      if (!canonicalId) throw new Error('Missing canonical source.');
      for (const profile of retiredProfiles)
        await store
          .update(admissionProfiles)
          .set({ sourceId: canonicalId })
          .where(eq(admissionProfiles.id, profile.id));
      for (const program of retiredPrograms)
        await store
          .update(programs)
          .set({
            sourceId: canonicalId,
            sourceFlags: {
              ...program.sourceFlags,
              sourceUrl: dataset.canonicalSource.url,
              citationRefresh: {
                datasetVersion: dataset.datasetVersion,
                originalUrl: previousUrl,
                checkedOn: dataset.reviewedOn,
                sourceSha256: dataset.canonicalSource.sha256,
              },
            },
          })
          .where(eq(programs.id, program.id));
      // Do not rely on cascading deletes: check every actual source foreign key.
      const references = await store.execute<{
        schemaName: string;
        tableName: string;
        columnName: string;
      }>(sql`
        select n.nspname as "schemaName",t.relname as "tableName",a.attname as "columnName"
        from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
        where c.contype='f' and c.confrelid='sources'::regclass`);
      for (const ref of references) {
        const remaining = await store.execute<{ found: boolean }>(
          sql`select exists(select 1 from ${sql.identifier(ref.schemaName)}.${sql.identifier(ref.tableName)} where ${sql.identifier(ref.columnName)}=${oldSource.id}::uuid) as found`,
        );
        if (remaining[0]?.found)
          throw new Error(
            `Previous source still referenced by ${ref.tableName}; transaction rolled back.`,
          );
      }
      await store.delete(sources).where(eq(sources.id, oldSource.id));
    }
    await store
      .update(importRuns)
      .set({
        status: 'completed',
        processedCount: plans.length,
        updatedCount: pending.length,
        finishedAt: new Date(),
        updatedAt: new Date(),
        checkpoint: {
          sourceRetired: dataset.retirePreviousSource,
          retiredSource: dataset.retirePreviousSource ? oldSource : null,
          profileCitationsMoved: retiredProfiles.map((p) => p.id),
          programCitationsMoved: retiredPrograms.map((p) => p.id),
          programCitationFlagsRefreshed: retiredPrograms.length,
          originalRequirementIds: plans.map((p) => p.row.fact.id),
        },
      })
      .where(eq(importRuns.id, savedRun.id));
    return {
      mode: 'completed',
      updated: pending.length,
      skipped: 0,
      sourceRetirements: dataset.retirePreviousSource ? 1 : 0,
      profileCitationsMoved: retiredProfiles.length,
      programCitationsMoved: retiredPrograms.length,
    };
  };
  return dryRun
    ? perform(db, false)
    : db.transaction((tx) => perform(tx, true), { isolationLevel: 'serializable' });
}

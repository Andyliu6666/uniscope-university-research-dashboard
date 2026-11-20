import '../load-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getConfig } from '../config.js';
import { refreshAdmissionsCitations } from '../scripts/admissions-citation-refresh.js';
import { citationRefreshSchema } from '../scripts/admissions-citation-format.js';
import { createDb } from './client.js';
import {
  admissionProfiles,
  admissionRequirements,
  deadlines,
  importRuns,
  institutionIdentifiers,
  programs,
  sources,
  universities,
} from './schema.js';

const config = getConfig();
const databaseName = new URL(config.DATABASE_URL).pathname.slice(1);
if (!databaseName.startsWith('uniscope_ci') && !databaseName.startsWith('uniscope_citation_test_'))
  throw new Error('Citation integration fixture requires a dedicated uniscope_ci/test database.');
const connection = createDb(config, { max: 1 });
const id = randomUUID();
const ror = `00${id.replaceAll('-', '').slice(0, 7)}`;
const datasetVersion = `citation-fixture-${id}`;
try {
  const [university] = await connection.db
    .insert(universities)
    .values({
      name: 'Citation fixture',
      slug: `citation-fixture-${id}`,
      country: 'Test',
      countryCode: 'JM',
      city: 'Test',
      website: 'https://example.invalid',
      summary: 'Isolated integration fixture',
      institutionType: 'unknown',
    })
    .returning();
  assert(university);
  await connection.db
    .insert(institutionIdentifiers)
    .values({ universityId: university.id, provider: 'ror', externalId: ror });
  const original = {
    url: 'https://example.invalid/old.pdf',
    title: 'Original citation',
    checkedOn: '2026-01-01',
  };
  const replacement = {
    url: 'https://example.invalid/new.pdf',
    title: 'Reviewed official replacement, page 4',
    checkedOn: '2026-02-01',
    sha256: 'b'.repeat(64),
  };
  const [evidence] = await connection.db
    .insert(sources)
    .values({
      universityId: university.id,
      ...{ url: original.url, title: original.title },
      category: 'official',
      verifiedAt: new Date(`${original.checkedOn}T00:00:00Z`),
    })
    .returning();
  assert(evidence);
  const [course] = await connection.db
    .insert(programs)
    .values({
      universityId: university.id,
      name: 'Fixture Engineering',
      field: 'Engineering',
      level: 'undergraduate',
      sourceId: evidence.id,
      sourceProvider: 'official_admissions',
      sourceExternalId: `fixture-${id}`,
      academicYear: 'unspecified',
      sourceFlags: {
        provider: 'official_admissions',
        sourceUrl: original.url,
        datasetVersion: 'fixture-v1',
        fixtureMarker: 'retained',
      },
    })
    .returning();
  assert(course);
  const scope = {
    academicYear: '2027',
    intakeTerm: 'unspecified',
    deliveryMode: 'unspecified',
    entryType: 'first_year',
    level: 'undergraduate',
    applicantType: 'all',
  } as const;
  const [profile] = await connection.db
    .insert(admissionProfiles)
    .values({ universityId: university.id, programId: course.id, ...scope, sourceId: evidence.id })
    .returning();
  assert(profile);
  const fact = {
    key: 'grades',
    category: 'academic',
    label: 'A-level subjects',
    status: 'required',
    details: 'Mathematics and Physics at grade C.',
    source: original,
  } as const;
  const [requirement] = await connection.db
    .insert(admissionRequirements)
    .values({
      admissionProfileId: profile.id,
      requirementKey: fact.key,
      category: fact.category,
      label: fact.label,
      status: fact.status,
      details: fact.details,
      sourceId: evidence.id,
      verifiedAt: new Date(`${original.checkedOn}T00:00:00Z`),
      sourceFlags: {
        provider: 'official_admissions',
        datasetVersion: 'fixture-v1',
        sourceUrl: original.url,
        sourceTitle: original.title,
      },
    })
    .returning();
  assert(requirement);
  const input = citationRefreshSchema.parse({
    datasetVersion,
    reviewedOn: replacement.checkedOn,
    institution: { ror, countryCode: 'JM', officialDomains: ['example.invalid'] },
    retirePreviousSource: true,
    canonicalSource: replacement,
    records: [
      { originalDatasetVersion: 'fixture-v1', programName: course.name, scope, fact, replacement },
    ],
  });
  const preview = await refreshAdmissionsCitations(connection.db, input, true);
  assert.equal(preview.mode, 'dry-run');
  assert.equal(preview.updated, 1);
  const [unreviewed] = await connection.db
    .insert(deadlines)
    .values({
      universityId: university.id,
      label: 'Unreviewed source use',
      applicantType: 'all',
      date: '2027-01-01',
      sourceId: evidence.id,
    })
    .returning();
  assert(unreviewed);
  await assert.rejects(
    refreshAdmissionsCitations(connection.db, input, false),
    /still referenced by deadlines/u,
  );
  const [unchanged] = await connection.db
    .select()
    .from(admissionRequirements)
    .where(eq(admissionRequirements.id, requirement.id));
  assert.deepEqual(unchanged, requirement);
  assert.equal(
    (
      await connection.db
        .select()
        .from(importRuns)
        .where(eq(importRuns.datasetVersion, datasetVersion))
    ).length,
    0,
  );
  assert.equal(
    (await connection.db.select().from(sources).where(eq(sources.universityId, university.id)))
      .length,
    1,
  );
  await connection.db.delete(deadlines).where(eq(deadlines.id, unreviewed.id));
  const result = await refreshAdmissionsCitations(connection.db, input, false);
  assert.equal(result.mode, 'completed');
  assert.equal(result.updated, 1);
  const [changed] = await connection.db
    .select()
    .from(admissionRequirements)
    .where(eq(admissionRequirements.id, requirement.id));
  assert(changed);
  for (const key of [
    'id',
    'admissionProfileId',
    'requirementKey',
    'category',
    'label',
    'status',
    'details',
  ] as const)
    assert.equal(changed[key], requirement[key]);
  assert.equal(changed.sourceFlags.sourceUrl, replacement.url);
  const [changedCourse] = await connection.db
    .select()
    .from(programs)
    .where(eq(programs.id, course.id));
  assert.equal(changedCourse?.sourceFlags.sourceUrl, replacement.url);
  assert.equal(changedCourse?.sourceFlags.fixtureMarker, 'retained');
  assert.equal(changedCourse?.name, course.name);
  assert.equal(
    (await connection.db.select().from(sources).where(eq(sources.id, evidence.id))).length,
    0,
  );
  const [audit] = await connection.db
    .select()
    .from(importRuns)
    .where(eq(importRuns.datasetVersion, datasetVersion));
  assert.equal(audit?.status, 'completed');
  assert.deepEqual(await refreshAdmissionsCitations(connection.db, input, false), {
    mode: 'already-completed',
    updated: 0,
    skipped: 1,
  });
  const [repeated] = await connection.db
    .select()
    .from(admissionRequirements)
    .where(eq(admissionRequirements.id, requirement.id));
  assert.deepEqual(repeated, changed);
  console.log(
    'Citation transaction rollback, source-reference protection, content preservation and repeat safety passed.',
  );
} finally {
  await connection.db.delete(universities).where(eq(universities.slug, `citation-fixture-${id}`));
  await connection.db
    .delete(importRuns)
    .where(
      and(
        eq(importRuns.provider, 'official_citation_refresh'),
        eq(importRuns.datasetVersion, datasetVersion),
      ),
    );
  await connection.close();
}

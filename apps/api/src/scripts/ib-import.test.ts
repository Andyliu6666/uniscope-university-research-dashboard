import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { ibDatasetSchema, type IbProgramInput } from '@urd/shared';
import type { Database } from '../db/client.js';
import { importRejections, importRuns, institutionIdentifiers, programs } from '../db/schema.js';
import {
  assertIbRevision,
  chooseIbProgram,
  getIbProgramKey,
  ibHash,
  IbIdentityError,
  importIbDataset,
} from './ib-import.js';

const dataset = ibDatasetSchema.parse(
  JSON.parse(
    await readFile(
      new URL('../../../../data/sources/ib-requirements-20260910.json', import.meta.url),
      'utf8',
    ),
  ),
);
const example = dataset.records[0];
if (!example) throw new Error('The reviewed IB fixture must contain a requirement.');
const course: IbProgramInput = {
  name: 'Computing',
  level: 'undergraduate',
  field: 'Computing',
  courseCode: 'G400',
  url: 'https://www.example.edu/course',
};
const program = (
  id: string,
  extra: Partial<typeof programs.$inferSelect> = {},
): typeof programs.$inferSelect => ({
  id,
  universityId: 'school',
  name: 'Computing',
  level: 'undergraduate',
  field: 'Computing',
  academicYear: '2026',
  sourceId: null,
  sourceProvider: null,
  sourceExternalId: null,
  sourceFlags: {},
  ...extra,
});

describe('official IB identity and scope safety', () => {
  it('validates the reviewed artifact and counts policies separately from courses', () => {
    expect(dataset.institutions).toHaveLength(9);
    expect(dataset.records).toHaveLength(20);
    expect(dataset.records.filter((r) => r.program)).toHaveLength(15);
    expect(
      dataset.records.filter((r) => r.program && r.requirement.status === 'published'),
    ).toHaveLength(13);
  });
  it('uses an exact code before a display name and never fuzzy-matches a course', () => {
    const owned = program('owned', {
      sourceProvider: 'official_ib',
      sourceExternalId: 'G400',
      name: 'New display name',
    });
    expect(chooseIbProgram(course, [program('named'), owned])?.id).toBe('owned');
    expect(
      chooseIbProgram(course, [program('similar', { name: 'Computing with business' })]),
    ).toBeNull();
  });
  it('rejects ambiguous same-name or wrong-level programs', () => {
    expect(() => chooseIbProgram(course, [program('one'), program('two')])).toThrow(
      IbIdentityError,
    );
    expect(() =>
      chooseIbProgram({ ...course, existingProgramId: 'other-school' }, [program('one')]),
    ).toThrow(IbIdentityError);
    expect(() =>
      chooseIbProgram({ ...course, existingProgramId: 'one' }, [
        program('one', { level: 'graduate' }),
      ]),
    ).toThrow(IbIdentityError);
  });
  it('refuses same-name courses with a conflicting known official code', () => {
    const otherCode = program('other-code', {
      sourceProvider: 'official_ib',
      sourceExternalId: 'G401',
    });
    expect(() => chooseIbProgram(course, [otherCode])).toThrow(/different official code/);
    expect(chooseIbProgram({ ...course, existingProgramId: 'other-code' }, [otherCode])?.id).toBe(
      'other-code',
    );
  });
  it('preserves a public code or derives a stable internal identity from the reviewed URL', () => {
    expect(getIbProgramKey(course)).toBe('G400');
    const noCode = { ...course, courseCode: null };
    expect(getIbProgramKey(noCode)).toBe(
      `source-url-${ibHash(JSON.stringify([course.url, course.name, course.level]))}`,
    );
    expect(getIbProgramKey({ ...noCode, name: 'Renamed course' })).not.toBe(
      getIbProgramKey(noCode),
    );
    expect(getIbProgramKey({ ...noCode, url: `${course.url}/another-course` })).not.toBe(
      getIbProgramKey(noCode),
    );
  });
  it('keeps courses on one shared official catalog page separate', () => {
    const first = { ...course, courseCode: null };
    const second = { ...first, name: 'Integrated Engineering' };
    const owned = program('first-course', {
      sourceProvider: 'official_ib',
      sourceExternalId: getIbProgramKey(first),
    });
    expect(getIbProgramKey(first)).not.toBe(getIbProgramKey(second));
    expect(chooseIbProgram(second, [owned])).toBeNull();
    expect(getIbProgramKey({ ...first, level: 'graduate' })).not.toBe(getIbProgramKey(first));
  });
  it('matches URL-based identities without pretending that they are official course codes', () => {
    const noCode = { ...course, courseCode: null };
    const owned = program('url-course', {
      sourceProvider: 'official_ib',
      sourceExternalId: getIbProgramKey(noCode),
      name: 'Earlier course title',
    });
    expect(chooseIbProgram(noCode, [owned])?.id).toBe('url-course');
    const differentUrl = program('other-url', {
      sourceProvider: 'official_ib',
      sourceExternalId: getIbProgramKey({ ...noCode, url: `${course.url}/other` }),
    });
    expect(() => chooseIbProgram(noCode, [differentUrl])).toThrow(/reviewed URL identity/);
  });
  it('stores the reviewed URL basis and a null public code when importing an uncoded program', async () => {
    if (!example.program) throw new Error('This fixture must contain a course requirement.');
    const institution = dataset.institutions.find((item) => item.key === example.institutionKey);
    if (!institution) throw new Error('The fixture institution must be present.');
    const record = { ...example, program: { ...example.program, courseCode: null } };
    const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    let run: Record<string, unknown> | undefined;
    const tx = {
      execute: vi.fn(async () => undefined),
      select: () => {
        let table: unknown;
        const chain = {
          from: (value: unknown) => {
            table = value;
            return chain;
          },
          innerJoin: () => chain,
          where: async () => {
            if (table === institutionIdentifiers)
              return [{ university: { id: 'school', countryCode: institution.countryCode } }];
            return table === importRuns && run ? [run] : [];
          },
        };
        return chain;
      },
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          inserted.push({ table, values });
          if (table === importRuns)
            run = {
              id: 'run',
              status: 'running',
              checkpoint: {},
              processedCount: 0,
              insertedCount: 0,
              updatedCount: 0,
              rejectedCount: 0,
              ...values,
            };
          return {
            returning: async () =>
              table === importRuns ? [run] : [{ id: 'created-row', ...values }],
          };
        },
      }),
      update: () => ({
        set: (value: Record<string, unknown>) => ({
          where: async () => {
            run = { ...run, ...value };
          },
        }),
      }),
    };
    const db = {
      transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as Database;
    expect(await importIbDataset(db, { ...dataset, records: [record] })).toMatchObject({
      status: 'completed',
      inserted: 1,
      createdPrograms: 1,
      rejected: 0,
    });
    expect(inserted.find((item) => item.table === programs)?.values).toMatchObject({
      sourceProvider: 'official_ib',
      sourceExternalId: getIbProgramKey(record.program),
      sourceFlags: {
        courseUrl: record.program.url,
        officialCourseCode: null,
        identityBasis: 'reviewed_course_url_and_name',
        datasetVersion: dataset.datasetVersion,
      },
    });
  });
  it('permits explicit mapping only to a scoped candidate', () => {
    expect(
      chooseIbProgram({ ...course, existingProgramId: 'two' }, [program('one'), program('two')])
        ?.id,
    ).toBe('two');
  });
  it('prevents course, year, entry-route and applicant revisions from overwriting another scope', () => {
    const current = example.requirement;
    expect(() => assertIbRevision(current, current, 'one', 'one', false)).not.toThrow();
    for (const next of [
      { ...current, academicYear: '2027' },
      { ...current, entryType: 'transfer' as const },
      { ...current, applicantType: 'international' as const },
    ])
      expect(() => assertIbRevision(current, next, 'one', 'one', false)).toThrow(IbIdentityError);
    expect(() => assertIbRevision(current, current, 'one', 'two', false)).toThrow(IbIdentityError);
    expect(() => assertIbRevision(current, current, null, null, true)).toThrow(IbIdentityError);
  });
  it('refuses to replace a newer source check with an older one', () => {
    const current = example.requirement;
    const old = { ...current, source: { ...current.source, checkedOn: '2026-08-01' } };
    expect(() => assertIbRevision(current, old, 'one', 'one', false)).toThrow(/newer reviewed/);
  });
  it('a dry run with missing identities performs no writes or transactions', async () => {
    const chain = { from: () => chain, innerJoin: () => chain, where: async () => [] };
    const mock = { select: () => chain, insert: vi.fn(), update: vi.fn(), transaction: vi.fn() };
    const result = await importIbDataset(mock as unknown as Database, dataset, { dryRun: true });
    expect(result).toMatchObject({ mode: 'dry-run', insertCandidates: 0, updateCandidates: 0 });
    expect('rejected' in result && result.rejected).toHaveLength(20);
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it('resumes rejected-row batches at a committed checkpoint and does not repeat a completed run', async () => {
    let run: Record<string, unknown> | undefined;
    const rejections: unknown[] = [];
    const tx = {
      execute: vi.fn(async () => undefined),
      select: () => {
        let table: unknown;
        const chain = {
          from: (value: unknown) => {
            table = value;
            return chain;
          },
          innerJoin: () => chain,
          where: async () => (table === importRuns && run ? [run] : []),
        };
        return chain;
      },
      insert: (table: unknown) => ({
        values: (value: Record<string, unknown>) => {
          if (table === importRuns)
            run = {
              id: 'run',
              status: 'running',
              checkpoint: {},
              processedCount: 0,
              insertedCount: 0,
              updatedCount: 0,
              rejectedCount: 0,
              ...value,
            };
          else if (table === importRejections) rejections.push(value);
          else throw new Error('No facts should be written for unresolved institutions.');
          return { returning: async () => [run] };
        },
      }),
      update: () => ({
        set: (value: Record<string, unknown>) => ({
          where: async () => {
            run = { ...run, ...value };
          },
        }),
      }),
    };
    const db = {
      transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as Database;
    const small = { ...dataset, records: dataset.records.slice(0, 3) };
    expect(await importIbDataset(db, small, { limit: 2 })).toMatchObject({
      status: 'paused',
      processed: 2,
      rejected: 2,
    });
    expect(await importIbDataset(db, small, { limit: 2 })).toMatchObject({
      status: 'completed',
      processed: 3,
      rejected: 3,
    });
    expect(await importIbDataset(db, small)).toMatchObject({
      status: 'already-completed',
      processed: 3,
    });
    expect(rejections).toHaveLength(3);
    expect(run?.checkpoint).toMatchObject({ rowIndex: 3, sourceRows: 3 });
  });
});

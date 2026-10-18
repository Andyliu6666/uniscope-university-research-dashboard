import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import {
  admissionProfiles,
  admissionRequirements,
  institutionIdentifiers,
  importRuns,
  programs,
  sources,
} from '../db/schema.js';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';
import {
  chooseFactProgram,
  getFactProgramKey,
  importAdmissionsFacts,
} from './admissions-facts-import.js';

const dataset = admissionFactsDatasetSchema.parse(
  JSON.parse(
    await readFile(
      new URL('../../../../data/sources/admissions-facts-namibia-20261002.json', import.meta.url),
      'utf8',
    ),
  ),
);
const profile = dataset.profiles[0];
const fact = profile?.requirements[0];
if (!profile || !fact) throw new Error('Missing fixture');
const one = { ...dataset, profiles: [{ ...profile, requirements: [fact] }] };

function mockDb(overrides: Map<unknown, unknown[]> = new Map(), allowWrites = false) {
  const rows = new Map<unknown, unknown[]>([
    [institutionIdentifiers, [{ university: { id: 'unam', countryCode: 'NA' } }]],
    [admissionProfiles, []],
    [admissionRequirements, []],
    [sources, []],
    [programs, []],
    [importRuns, []],
    ...overrides,
  ]);
  let nextId = 0;
  const insert = vi.fn((table: unknown) => {
    if (!allowWrites) throw new Error('Unexpected write');
    return {
      values: (value: Record<string, unknown>) => {
        const row = { id: `saved-${++nextId}`, ...value };
        const items = rows.get(table) ?? [];
        rows.set(table, [...items, row]);
        return { returning: async () => [row] };
      },
    };
  });
  const update = vi.fn(() => {
    if (!allowWrites) throw new Error('Unexpected write');
    return { set: () => ({ where: async () => [] }) };
  });
  const execute = vi.fn(async () => []);
  const transaction = vi.fn();
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const query = { innerJoin: () => query, where: async () => rows.get(table) ?? [] };
        return query;
      },
    }),
    insert,
    update,
    execute,
    transaction,
  };
  transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) =>
    callback(db),
  );
  return { db: db as unknown as Database, insert, update, execute, transaction, rows };
}

describe('admission facts import safety', () => {
  it('rejects aliases from different providers that resolve to one real admission scope', async () => {
    const school = dataset.institutions[0];
    if (!school) throw new Error('Missing fixture institution.');
    const alias = {
      ...one,
      institutions: [
        ...one.institutions,
        { ...school, key: 'alias', provider: 'ipeds', externalId: '123456' },
      ],
      profiles: [
        ...one.profiles,
        {
          ...profile,
          institutionKey: 'alias',
          requirements: [
            { ...fact, source: { ...fact.source, url: 'https://www.unam.edu.na/another-page' } },
          ],
        },
      ],
    };
    for (const dryRun of [true, false]) {
      const mock = mockDb(new Map([[admissionProfiles, [{ id: 'existing-profile' }]]]));
      await expect(importAdmissionsFacts(mock.db, alias, dryRun)).rejects.toThrow(
        /aliases resolve/,
      );
      expect(mock.insert).not.toHaveBeenCalled();
      expect(mock.update).not.toHaveBeenCalled();
    }
  });
  it('dry-runs the reviewed batch without writes or a transaction', async () => {
    const mock = mockDb();
    expect(await importAdmissionsFacts(mock.db, dataset, true)).toEqual({
      mode: 'dry-run',
      inserted: 18,
      skipped: 0,
      databaseWrites: 0,
    });
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it('refuses a wrong country before any write', async () => {
    const mock = mockDb(
      new Map([[institutionIdentifiers, [{ university: { id: 'other', countryCode: 'ZM' } }]]]),
    );
    await expect(importAdmissionsFacts(mock.db, one)).rejects.toThrow(/identifier\/country/);
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.execute).toHaveBeenCalledTimes(2);
  });
  it('refuses a wrong institution or programme level', async () => {
    const mock = mockDb(
      new Map([
        [
          programs,
          [
            {
              id: '36afd6eb-9eaa-44b4-a963-e65abfce0570',
              universityId: 'someone-else',
              level: 'graduate',
            },
          ],
        ],
      ]),
    );
    await expect(
      importAdmissionsFacts(
        mock.db,
        {
          ...one,
          profiles: [{ ...one.profiles[0], programId: '36afd6eb-9eaa-44b4-a963-e65abfce0570' }],
        },
        true,
      ),
    ).rejects.toThrow(/explicit programme/);
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it('skips matching old-provider facts without taking their ownership', async () => {
    const mock = mockDb(
      new Map<unknown, unknown[]>([
        [admissionProfiles, [{ id: 'existing-profile' }]],
        [
          admissionRequirements,
          [
            {
              id: 'old',
              requirementKey: fact.key,
              category: fact.category,
              status: fact.status,
              details: fact.details,
              sourceFlags: { provider: 'another-provider' },
            },
          ],
        ],
      ]),
    );
    expect(await importAdmissionsFacts(mock.db, one, true)).toMatchObject({
      inserted: 0,
      skipped: 1,
      databaseWrites: 0,
    });
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('refuses a source ownership/category conflict', async () => {
    const mock = mockDb(
      new Map([[sources, [{ id: 'source', url: fact.source.url, category: 'independent' }]]]),
    );
    await expect(importAdmissionsFacts(mock.db, one)).rejects.toThrow(/Source category/);
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it('fails an altered existing requirement instead of creating another source row', async () => {
    const mock = mockDb(
      new Map<unknown, unknown[]>([
        [admissionProfiles, [{ id: 'existing-profile' }]],
        [
          admissionRequirements,
          [
            {
              requirementKey: fact.key,
              category: fact.category,
              status: fact.status,
              details: 'A different requirement',
            },
          ],
        ],
      ]),
    );
    await expect(importAdmissionsFacts(mock.db, one)).rejects.toThrow(/Conflicting/);
    expect(mock.insert).not.toHaveBeenCalled();
  });
});

const declaredProgram = {
  key: 'law',
  institutionKey: profile.institutionKey,
  name: 'Bachelor of Laws',
  level: 'undergraduate' as const,
  field: 'Law',
  source: fact.source,
};
const programmeDataset = {
  ...one,
  programs: [declaredProgram],
  profiles: [
    {
      ...profile,
      level: 'undergraduate',
      programId: null,
      programKey: 'law',
      requirements: [fact],
    },
  ],
};
const storedProgram = {
  id: '36afd6eb-9eaa-44b4-a963-e65abfce0570',
  universityId: 'unam',
  name: declaredProgram.name,
  level: declaredProgram.level,
  field: declaredProgram.field,
  academicYear: 'unspecified',
  sourceId: 'source',
  sourceProvider: 'official_admissions',
  sourceExternalId: getFactProgramKey(declaredProgram),
  sourceFlags: {},
};
describe('programme admissions import', () => {
  it('previews programme creation without treating it as university-wide requirements', async () => {
    const mock = mockDb(new Map([[admissionProfiles, [{ id: 'university-wide' }]]]));
    expect(await importAdmissionsFacts(mock.db, programmeDataset, true)).toMatchObject({
      inserted: 1,
      skipped: 0,
      programsCreated: 1,
      programsReused: 0,
      databaseWrites: 0,
    });
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it('reuses an exact course without taking another provider ownership', async () => {
    const existing = {
      ...storedProgram,
      sourceProvider: 'another-provider',
      sourceExternalId: 'external',
    };
    expect(chooseFactProgram(declaredProgram, [existing])).toBe(existing);
    const mock = mockDb(new Map([[programs, [existing]]]));
    expect(await importAdmissionsFacts(mock.db, programmeDataset, true)).toMatchObject({
      programsCreated: 0,
      programsReused: 1,
    });
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('rejects ambiguous names and conflicting programme metadata', () => {
    expect(() =>
      chooseFactProgram(declaredProgram, [storedProgram, { ...storedProgram, id: 'other' }]),
    ).toThrow(/Ambiguous/);
    expect(() =>
      chooseFactProgram(declaredProgram, [{ ...storedProgram, field: 'Medicine' }]),
    ).toThrow(/metadata conflicts/);
    expect(() =>
      chooseFactProgram(declaredProgram, [{ ...storedProgram, name: 'Renamed course' }]),
    ).toThrow(/metadata conflicts/);
  });
  it('rejects institution aliases that declare the same programme twice before writes', async () => {
    const school = dataset.institutions[0];
    if (!school) throw new Error('Missing fixture institution.');
    const alias = {
      ...programmeDataset,
      institutions: [school, { ...school, key: 'alias', provider: 'ipeds', externalId: '123456' }],
      programs: [
        declaredProgram,
        { ...declaredProgram, key: 'alias_law', institutionKey: 'alias' },
      ],
      profiles: [
        ...programmeDataset.profiles,
        { ...programmeDataset.profiles[0], institutionKey: 'alias', programKey: 'alias_law' },
      ],
    };
    const mock = mockDb();
    await expect(importAdmissionsFacts(mock.db, alias)).rejects.toThrow(/same programme/);
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it('creates a sourced programme and links its requirements within the import transaction', async () => {
    const mock = mockDb(new Map(), true);
    expect(await importAdmissionsFacts(mock.db, programmeDataset)).toMatchObject({
      mode: 'completed',
      inserted: 1,
      programsCreated: 1,
    });
    const savedProgram = mock.rows.get(programs)?.[0] as Record<string, unknown>;
    const savedProfile = mock.rows.get(admissionProfiles)?.[0] as Record<string, unknown>;
    expect(savedProgram).toMatchObject({
      name: declaredProgram.name,
      sourceProvider: 'official_admissions',
    });
    expect(savedProgram.sourceId).toBeTruthy();
    expect(savedProfile.programId).toBe(savedProgram.id);
    expect(savedProfile).not.toHaveProperty('programKey');
    expect(mock.transaction).toHaveBeenCalledTimes(1);
  });
  it('skips a completed programme artifact and never duplicates the programme', async () => {
    const mock = mockDb(
      new Map<unknown, unknown[]>([
        [programs, [storedProgram]],
        [admissionProfiles, [{ id: 'profile' }]],
        [
          admissionRequirements,
          [
            {
              requirementKey: fact.key,
              category: fact.category,
              status: fact.status,
              details: fact.details,
            },
          ],
        ],
        [importRuns, [{ status: 'completed' }]],
      ]),
    );
    expect(await importAdmissionsFacts(mock.db, programmeDataset)).toMatchObject({
      mode: 'already-completed',
      inserted: 0,
      skipped: 1,
      programsCreated: 0,
      programsReused: 1,
    });
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });
});

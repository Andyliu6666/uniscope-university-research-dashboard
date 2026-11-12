import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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
  const filters = new Map<unknown, SQL[]>();
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
  const updateValues = vi.fn(() => ({ where: async () => [] }));
  const update = vi.fn(() => {
    if (!allowWrites) throw new Error('Unexpected write');
    return { set: updateValues };
  });
  const execute = vi.fn(async () => []);
  const transaction = vi.fn();
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const query = {
          innerJoin: () => query,
          where: async (filter: SQL) => {
            filters.set(table, [...(filters.get(table) ?? []), filter]);
            return rows.get(table) ?? [];
          },
        };
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
  return {
    db: db as unknown as Database,
    insert,
    update,
    updateValues,
    execute,
    transaction,
    rows,
    filters,
  };
}

describe('admission facts import safety', () => {
  const shared = {
    ...one,
    programs: ['first', 'second'].map((key) => ({
      key,
      institutionKey: profile.institutionKey,
      name: `Course ${key}`,
      level: 'undergraduate',
      field: 'Science',
      source: fact.source,
      sharedRequirementKeys: [fact.key],
    })),
    profiles: [{ ...profile, level: 'undergraduate', requirements: [fact] }],
  };

  it('stores one shared fact with two resolved programme identities and refuses changed links on repeats', async () => {
    const mock = mockDb(new Map(), true);
    await importAdmissionsFacts(mock.db, shared);
    const savedFacts = mock.rows.get(admissionRequirements) as Array<{
      sourceFlags: Record<string, unknown>;
    }>;
    const savedPrograms = mock.rows.get(programs) as Array<{ id: string }>;
    expect(savedFacts).toHaveLength(1);
    expect(savedFacts[0]?.sourceFlags.sharedProgramIds).toEqual(
      savedPrograms.map((program) => program.id),
    );
    const calls = mock.insert.mock.calls.length;
    await expect(
      importAdmissionsFacts(mock.db, {
        ...shared,
        programs: [
          ...shared.programs,
          { ...shared.programs[0], key: 'third', name: 'Third course' },
        ],
      }),
    ).rejects.toThrow(/Shared programme links conflict/);
    expect(mock.insert.mock.calls).toHaveLength(calls);
  });
  it('keeps a same-key programme-specific fact separate from its shared rule', async () => {
    const mock = mockDb(new Map(), true);
    const [sharedScope] = shared.profiles;
    if (!sharedScope) throw new Error('Missing shared scope');
    await importAdmissionsFacts(mock.db, {
      ...shared,
      profiles: [
        sharedScope,
        {
          ...sharedScope,
          programKey: 'first',
          requirements: [{ ...fact, details: 'A different condition for this programme.' }],
        },
      ],
    });
    const savedFacts = mock.rows.get(admissionRequirements) as Array<{
      sourceFlags: Record<string, unknown>;
    }>;
    expect(savedFacts).toHaveLength(2);
    expect(savedFacts[0]?.sourceFlags.sharedProgramIds).toHaveLength(2);
    expect(savedFacts[1]?.sourceFlags).not.toHaveProperty('sharedProgramIds');
  });
  const priorLinkBatch = {
    ...one,
    datasetVersion: 'additional-catalogue',
    programs: shared.programs.map(({ sharedRequirementKeys: _keys, ...program }) => ({
      ...program,
      priorSharedRequirements: [{ datasetVersion: dataset.datasetVersion, key: fact.key }],
    })),
    profiles: [],
  };

  it('adds earlier shared links while retaining existing fact provenance and programme IDs', async () => {
    const sourceFlags = { provider: 'official_admissions', sharedProgramIds: ['existing-id'] };
    const mock = mockDb(
      new Map([[admissionRequirements, [{ id: 'prior-fact', sourceFlags }]]]),
      true,
    );
    const preview = await importAdmissionsFacts(mock.db, priorLinkBatch, true);
    expect(preview).toMatchObject({ priorSharedLinksAdded: 2, databaseWrites: 0, inserted: 0 });
    expect(mock.update).not.toHaveBeenCalled();
    const result = await importAdmissionsFacts(mock.db, priorLinkBatch);
    const added = mock.rows.get(programs) as Array<{ id: string }>;
    expect(result).toMatchObject({
      mode: 'completed',
      programsCreated: 2,
      priorSharedLinksAdded: 2,
    });
    expect(mock.update).toHaveBeenNthCalledWith(1, admissionRequirements);
    expect(mock.updateValues).toHaveBeenNthCalledWith(1, {
      sourceFlags: {
        ...sourceFlags,
        sharedProgramIds: ['existing-id', ...added.map(({ id }) => id)],
      },
    });
    expect(mock.insert).not.toHaveBeenCalledWith(admissionRequirements);
  });

  it.each([0, 2])('rejects a prior requirement matching %i rows before writes', async (count) => {
    const mock = mockDb(
      new Map([
        [
          admissionRequirements,
          Array.from({ length: count }, (_, id) => ({ id, sourceFlags: {} })),
        ],
      ]),
    );
    await expect(importAdmissionsFacts(mock.db, priorLinkBatch)).rejects.toThrow(
      /Expected one prior shared requirement in the same institution and level/,
    );
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it.each(['distance', undefined] as const)(
    'resolves and writes the correct mode for %s input',
    async (deliveryMode) => {
      const mock = mockDb(new Map(), true);
      await importAdmissionsFacts(mock.db, {
        ...one,
        profiles: [{ ...profile, ...(deliveryMode ? { deliveryMode } : {}), requirements: [fact] }],
      });
      expect(mock.rows.get(admissionProfiles)).toEqual([
        expect.objectContaining({ deliveryMode: deliveryMode ?? 'unspecified' }),
      ]);
      const filter = mock.filters.get(admissionProfiles)?.[0];
      if (!filter) throw new Error('Missing profile identity query.');
      const compiled = new PgDialect().sqlToQuery(filter);
      expect(compiled.sql).toContain('"admission_profiles"."delivery_mode"');
      expect(compiled.params).toContain(deliveryMode ?? 'unspecified');
    },
  );
  it('retains different page citations for facts sharing one source URL', async () => {
    const second = {
      ...fact,
      key: 'another_page',
      details: 'A distinct reviewed condition.',
      source: { ...fact.source, title: 'Same guide, page 22' },
    };
    const mock = mockDb(new Map(), true);
    await importAdmissionsFacts(mock.db, {
      ...one,
      profiles: [{ ...profile, requirements: [fact, second] }],
    });
    const saved = mock.rows.get(admissionRequirements) as Array<{
      sourceFlags: Record<string, unknown>;
    }>;
    expect(saved.map((r) => r.sourceFlags.sourceTitle)).toEqual([
      fact.source.title,
      second.source.title,
    ]);
    expect(mock.rows.get(sources)).toHaveLength(1);
  });
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

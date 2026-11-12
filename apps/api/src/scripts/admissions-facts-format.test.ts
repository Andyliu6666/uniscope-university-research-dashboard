import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  admissionFactsDatasetSchema,
  chooseExistingFact,
  factScope,
  normalizeFactText,
} from './admissions-facts-format.js';

const input = JSON.parse(
  await readFile(
    new URL('../../../../data/sources/admissions-facts-namibia-20261002.json', import.meta.url),
    'utf8',
  ),
);
const dataset = admissionFactsDatasetSchema.parse(input);
const profile = dataset.profiles[0];
const fact = profile?.requirements[0];
if (!profile || !fact) throw new Error('Reviewed fixture is empty.');
const row = {
  requirementKey: fact.key,
  category: fact.category,
  status: fact.status,
  details: fact.details,
};

describe('reviewed admission fact deduplication', () => {
  it('preserves legacy artifact contents and hashes without optional defaults', () => {
    expect(JSON.stringify(dataset)).toBe(JSON.stringify(input));
    expect(dataset).not.toHaveProperty('programs');
    expect(dataset.profiles[0]).not.toHaveProperty('programKey');
    expect(dataset.profiles[0]).not.toHaveProperty('deliveryMode');
  });
  it('accepts a link-only artifact with distinct references to an earlier batch', () => {
    const reference = { datasetVersion: dataset.datasetVersion, key: fact.key };
    const programme = {
      key: 'catalogue_course',
      institutionKey: profile.institutionKey,
      name: 'Course',
      level: 'undergraduate',
      field: 'Science',
      source: fact.source,
    };
    const linked = {
      ...dataset,
      datasetVersion: 'additional-catalogue',
      profiles: [],
    };
    const valid = (references: Array<typeof reference>) =>
      admissionFactsDatasetSchema.safeParse({
        ...linked,
        programs: [{ ...programme, priorSharedRequirements: references }],
      }).success;
    expect(valid([reference])).toBe(true);
    expect(valid([reference, reference])).toBe(false);
    expect(valid([{ ...reference, datasetVersion: linked.datasetVersion }])).toBe(false);
    expect(admissionFactsDatasetSchema.safeParse(linked).success).toBe(false);
  });
  it('distinguishes distance/campus scopes but treats an omitted mode as unspecified', () => {
    expect(factScope({ ...profile, deliveryMode: 'unspecified' })).toBe(factScope(profile));
    const distance = { ...profile, deliveryMode: 'distance' as const };
    expect(factScope(distance)).not.toBe(factScope(profile));
    expect(
      admissionFactsDatasetSchema.safeParse({ ...dataset, profiles: [profile, distance] }).success,
    ).toBe(true);
    expect(
      admissionFactsDatasetSchema.safeParse({
        ...dataset,
        profiles: [profile, { ...profile, deliveryMode: 'unspecified' }],
      }).success,
    ).toBe(false);
  });
  it('validates the reviewed 18 facts in seven scopes without creating programmes', () => {
    expect(dataset.profiles).toHaveLength(7);
    expect(dataset.profiles.flatMap((p) => p.requirements)).toHaveLength(18);
    expect(dataset.profiles.every((p) => p.programId === null)).toBe(true);
  });
  it('treats whitespace/case/Unicode normalization as the same text', () => {
    expect(normalizeFactText('  ＡBC\n Def ')).toBe('abc def');
    expect(chooseExistingFact({ ...fact, details: ` ${fact.details.toUpperCase()} ` }, [row])).toBe(
      row,
    );
  });
  it('deduplicates across source URL, label, and alternate key', () => {
    expect(
      chooseExistingFact(
        {
          ...fact,
          key: 'alternate',
          label: 'Another label',
          source: { ...fact.source, url: 'https://www.unam.edu.na/another' },
        },
        [row],
      ),
    ).toBe(row);
  });
  it('rejects a changed threshold at an existing meaning key', () => {
    expect(() => chooseExistingFact({ ...fact, details: 'Different threshold.' }, [row])).toThrow(
      /Conflicting/,
    );
  });
  it('does not silently merge a changed status or category', () => {
    expect(() => chooseExistingFact({ ...fact, status: 'optional' }, [row])).toThrow(/Conflicting/);
    expect(() => chooseExistingFact({ ...fact, category: 'language' }, [row])).toThrow(
      /Conflicting/,
    );
  });
  it('flags already duplicated database facts for human review', () => {
    expect(() => chooseExistingFact(fact, [row, { ...row }])).toThrow(/Existing duplicate/);
  });
  it('rejects duplicate keys even if they cite different pages', () => {
    const next = structuredClone(input);
    next.profiles[0].requirements.push({
      ...fact,
      source: { ...fact.source, url: 'https://www.unam.edu.na/other' },
    });
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
  });
  it('rejects the same content smuggled under another key', () => {
    const next = structuredClone(input);
    next.profiles[0].requirements.push({ ...fact, key: 'alias_fact' });
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
  });
  it('rejects duplicate scope or institution identity aliases', () => {
    const next = structuredClone(input);
    next.profiles.push(next.profiles[0]);
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
    const alias = structuredClone(input);
    alias.institutions.push({ ...alias.institutions[0], key: 'alias' });
    expect(admissionFactsDatasetSchema.safeParse(alias).success).toBe(false);
  });
  it('preserves distinct year/applicant/entry/level/intake/programme scopes', () => {
    for (const change of [
      { academicYear: '2027' },
      { applicantType: 'international' },
      { entryType: 'transfer' },
      { level: 'doctoral' },
      { intakeTerm: 'January' },
      { programId: '36afd6eb-9eaa-44b4-a963-e65abfce0570' },
    ] as const)
      expect(factScope({ ...profile, ...change })).not.toBe(factScope(profile));
  });
  it('rejects external lookalike domains and future source checks', () => {
    const next = structuredClone(input);
    next.profiles[0].requirements[0].source.url = 'https://unam.edu.na.attacker.example/fake';
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
    next.profiles[0].requirements[0].source.url = fact.source.url;
    next.profiles[0].requirements[0].source.checkedOn = '2027-01-01';
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
  });
  it('rejects a future dataset even when its source dates agree', () => {
    const next = structuredClone(input);
    next.reviewedOn = '2099-01-01';
    next.profiles[0].requirements[0].source.checkedOn = '2099-01-01';
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
  });
});

const programInput = {
  ...input,
  programs: [
    {
      key: 'law',
      institutionKey: profile.institutionKey,
      name: 'Bachelor of Laws',
      level: 'undergraduate',
      field: 'Law',
      source: fact.source,
    },
  ],
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
describe('reviewed programme declarations', () => {
  it('lets two programmes cite one shared fact without cloning its profile or body', () => {
    const shared = {
      ...programInput,
      programs: ['first', 'second'].map((key) => ({
        ...programInput.programs[0],
        key,
        name: `Course ${key}`,
        sharedRequirementKeys: [fact.key],
      })),
      profiles: [{ ...programInput.profiles[0], programKey: undefined }],
    };
    const parsed = admissionFactsDatasetSchema.parse(shared);
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.programs).toHaveLength(2);
    expect(parsed.profiles[0]?.requirements).toHaveLength(1);
  });
  it('rejects missing, duplicated, wrong-level and programme-specific shared references', () => {
    const shared = {
      ...programInput,
      programs: [{ ...programInput.programs[0], sharedRequirementKeys: [fact.key] }],
      profiles: [{ ...programInput.profiles[0], programKey: undefined }],
    };
    expect(admissionFactsDatasetSchema.safeParse(shared).success).toBe(true);
    for (const keys of [['missing'], [fact.key, fact.key]])
      expect(
        admissionFactsDatasetSchema.safeParse({
          ...shared,
          programs: [{ ...shared.programs[0], sharedRequirementKeys: keys }],
        }).success,
      ).toBe(false);
    expect(
      admissionFactsDatasetSchema.safeParse({
        ...shared,
        profiles: [{ ...shared.profiles[0], level: 'graduate' }],
      }).success,
    ).toBe(false);
    expect(
      admissionFactsDatasetSchema.safeParse({ ...shared, profiles: programInput.profiles }).success,
    ).toBe(false);
    expect(
      admissionFactsDatasetSchema.safeParse({
        ...shared,
        profiles: [shared.profiles[0], { ...shared.profiles[0], entryType: 'other' }],
      }).success,
    ).toBe(false);
  });
  it('accepts a sourced programme referenced within the same institution and level', () => {
    expect(admissionFactsDatasetSchema.parse(programInput).programs).toHaveLength(1);
  });
  it('rejects missing, wrong-school, wrong-level and dual programme references', () => {
    for (const change of [
      { programKey: 'missing' },
      { level: 'graduate' },
      { programId: '36afd6eb-9eaa-44b4-a963-e65abfce0570' },
    ]) {
      const next = structuredClone(programInput);
      Object.assign(next.profiles[0] ?? {}, change);
      expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
    }
    const next = structuredClone(programInput);
    const programme = next.programs[0];
    if (!programme) throw new Error('Missing fixture programme.');
    programme.institutionKey = 'another-school';
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
  });
  it('rejects duplicate normalized course names and unused declarations', () => {
    const next = structuredClone(programInput);
    const programme = next.programs[0];
    if (!programme) throw new Error('Missing fixture programme.');
    next.programs.push({
      ...programme,
      key: 'law_duplicate',
      name: '  BACHELOR OF LAWS  ',
    });
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
    const duplicate = next.programs[1];
    if (!duplicate) throw new Error('Missing fixture duplicate.');
    duplicate.name = 'Different course';
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
  });
  it('checks programme source domains and review dates just like requirement sources', () => {
    const next = structuredClone(programInput);
    const programme = next.programs[0];
    if (!programme) throw new Error('Missing fixture programme.');
    programme.source = { ...fact.source, url: 'https://attacker.example/catalog' };
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
    programme.source = { ...fact.source, checkedOn: '2099-01-01' };
    expect(admissionFactsDatasetSchema.safeParse(next).success).toBe(false);
  });
});

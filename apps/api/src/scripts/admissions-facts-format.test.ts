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

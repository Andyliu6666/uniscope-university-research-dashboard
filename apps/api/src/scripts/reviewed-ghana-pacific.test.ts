import { readFile } from 'node:fs/promises';
import { ibDatasetSchema } from '@urd/shared';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';

const readArtifact = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`../../../../data/sources/${file}`, import.meta.url), 'utf8'));
const general = admissionFactsDatasetSchema.parse(
  await readArtifact('admissions-facts-ghana-pacific-20261018.json'),
);
const ib = ibDatasetSchema.parse(await readArtifact('ib-requirements-ghana-pacific-20261018.json'));
const facts = general.profiles.flatMap((p) => p.requirements);

describe('reviewed Ghana and Pacific admissions safeguards', () => {
  it('validates the finite reviewed coverage, not a global completeness claim', () => {
    expect(general.institutions).toHaveLength(3);
    expect(general.profiles).toHaveLength(30);
    expect(general.programs).toHaveLength(19);
    expect(facts).toHaveLength(87);
    expect(ib.records).toHaveLength(22);
    expect(ib.records.filter((r) => r.program)).toHaveLength(20);
  });

  it('records shared Ashesi international requirements once across degree levels', () => {
    const translations = general.profiles.filter((p) =>
      p.requirements.some((r) => r.key === 'non_english_document_translation'),
    );
    expect(translations).toHaveLength(1);
    expect(translations[0]).toMatchObject({ level: 'all', applicantType: 'international' });
    expect(
      general.profiles.filter((p) =>
        p.requirements.some((r) => r.key === 'alevel_common_eligibility'),
      ),
    ).toHaveLength(1);
  });

  it('does not turn absent AP/SAT/competition thresholds into a waiver or compulsory award', () => {
    expect(facts.some((f) => ['not_required', 'not_considered'].includes(f.status))).toBe(false);
    expect(facts.find((f) => f.key === 'additional_awards_updates')?.status).toBe('optional');
    expect(facts.find((f) => f.key === 'extracurricular_review')?.status).toBe('considered');
    expect(facts.find((f) => f.key === 'shortlisted_interview')?.status).toBe('conditional');
  });

  it('keeps historical essay prompts out of undated/current application scopes', () => {
    const essayForm = general.profiles.find((p) =>
      p.requirements.some((r) => r.key === 'paper_form_two_essays'),
    );
    expect(essayForm?.academicYear).toBe('2024/25');
    expect(essayForm?.notes).toContain('Historical paper form');
    expect(
      general.profiles
        .filter((p) => p.institutionKey !== 'usp')
        .every((p) => ['unspecified', '2024/25'].includes(p.academicYear)),
    ).toBe(true);
  });

  it('does not invent IB totals from Ghana subject grades or an Ashesi acceptance policy', () => {
    const noTotal = ib.records.filter((r) => r.institutionKey !== 'usp');
    expect(
      noTotal.every(
        (r) => r.requirement.totalMin === null && r.requirement.status === 'not_stated_in_source',
      ),
    ).toBe(true);
    const medicine = ib.records.find(
      (r) => r.requirement.recordKey === 'ghana-medicine-ib-international-undated',
    );
    expect(medicine?.requirement.hlGrades).toEqual([5]);
    expect(medicine?.requirement.subjectNotes).toContain('no numeric minimum');
    expect(
      ib.records.find((r) => r.requirement.recordKey === 'ghana-law-ib-international-undated')
        ?.requirement.hlGrades,
    ).toEqual([6, 6, 6]);
    expect(
      ib.records.find((r) => r.requirement.recordKey === 'ghana-business-ib-international-undated')
        ?.requirement.hlGrades,
    ).toEqual([5, 5, 5]);
  });

  it('retains the explicit Ghana international first-year scope without importing copied introductions', () => {
    expect(
      ib.records
        .filter((r) => r.institutionKey === 'ghana')
        .every(
          (r) =>
            r.requirement.applicantType === 'international' &&
            r.requirement.entryType === 'first_year' &&
            r.requirement.academicYear === 'unspecified',
        ),
    ).toBe(true);
    expect(ib.records.find((r) => r.institutionKey === 'usp')?.requirement).toMatchObject({
      totalMin: 24,
      includesCorePoints: null,
      academicYear: '2026',
    });
  });

  it('keeps legacy scales and ambiguous foreign qualification wording unresolved', () => {
    for (const key of [
      'cambridge_legacy_scale',
      'toefl_legacy_undergraduate',
      'international_hong_kong_equivalency',
      'international_korea_equivalency',
    ])
      expect(facts.find((f) => f.key === key)?.status).toBe('unknown');
    expect(facts.find((f) => f.key === 'english_requirement_applicability')?.details).toContain(
      'non-USP-member countries',
    );
  });
});

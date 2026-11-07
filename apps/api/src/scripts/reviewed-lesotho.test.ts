import { readFile } from 'node:fs/promises';
import { ibDatasetSchema } from '@urd/shared';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';

const read = async (name: string) =>
  JSON.parse(await readFile(new URL(`../../../../data/sources/${name}`, import.meta.url), 'utf8'));
const general = admissionFactsDatasetSchema.parse(
  await read('admissions-facts-lesotho-20261107.json'),
);
const ib = ibDatasetSchema.parse(await read('ib-requirements-lesotho-20261107.json'));
const facts = general.profiles.flatMap((p) => p.requirements);
const fact = (key: string) => {
  const result = facts.find((f) => f.key === `nul_${key}`);
  if (!result) throw new Error(`Missing reviewed fact: ${key}`);
  return result;
};

describe('reviewed Lesotho admissions safeguards', () => {
  it('preserves the lower-is-better APS ceiling and COSC qualification distinction', () => {
    expect(fact('lgcse_baseline').details).toContain('must not exceed 26');
    expect(fact('aps_scale').details).toContain('A*=1');
    expect(fact('aps_scale').details).toContain('G=8');
    expect(fact('cosc_baseline').details).toContain('no greater than 34');
  });
  it('keeps fee-category, ECOL and English-source differences unresolved', () => {
    for (const key of [
      'fee_categories_unresolved',
      'ecol_scope_conflict',
      'english_general_faculty_difference',
    ]) {
      expect(fact(key).status).toBe('unknown');
    }
    expect(fact('fee_categories_unresolved').source.url).toContain('2025-2026.docx');
    expect(fact('fee_categories_unresolved').details).toContain('SADC');
    expect(fact('ecol_scope_conflict').details).toContain('IGCSE');
  });
  it('does not apply the postgraduate motivation/CV checklist to school-leavers', () => {
    expect(
      facts.some((f) => f.source.url.endsWith('APPLICATION-REQUIREMENTS-2026-2027-1.pdf')),
    ).toBe(false);
    expect(fact('academic_references').details).toContain('not considered until references');
    expect(fact('academic_references').source.url).toContain('REFERENCE-FORM-2026-2027.docx');
  });
  it('distinguishes teacher-certificate Year 1 from secondary-diploma Year 2', () => {
    expect(fact('bed_shared_stc_placement').details).toContain('starting in Year 1');
    expect(fact('bed_shared_diploma_placement').details).toContain('starting in Year 2');
    expect(fact('science_education_stc').details).toContain('two science subjects OR Mathematics');
    expect(fact('primary_diploma').details).toContain('Diploma in Education (Primary)');
    expect(fact('agriculture_stc_wording').status).toBe('unknown');
  });
  it('keeps Nursing science B separate from Pharmacy mathematics B and the shared C baseline', () => {
    expect(fact('nursing_school').details).toContain('recognized science B');
    expect(fact('pharmacy_school').details).toContain('Mathematics B');
    expect(fact('environment_nutrition_school').details).toContain('C or better in Mathematics');
    expect(fact('nursing_indirect_grade_ambiguity').status).toBe('unknown');
    expect(fact('nursing_indirect_grade_ambiguity').details).toContain('alphabetic D');
  });
  it('records the Pharmacy indirect IB subjects without manufacturing a total or a first-year cutoff', () => {
    const record = ib.records[0];
    expect(record?.program?.name).toBe('Bachelor of Pharmacy (Honours)');
    expect(record?.requirement.entryType).toBe('other');
    expect(record?.requirement.status).toBe('not_stated_in_source');
    expect(record?.requirement.totalMin).toBeNull();
    expect(record?.requirement.hlGrades).toEqual([4, 4, 3]);
    expect(record?.requirement.subjectNotes).toContain(
      'Biology at least 4 AND Higher Level Chemistry',
    );
    expect(record?.requirement.subjectNotes).toContain('Mathematics OR Higher Level Physics');
    expect(facts.some((f) => f.details.includes('Higher Level Biology at least 4'))).toBe(false);
  });
  it('limits Pharmacy work evidence to the pass-diploma alternative', () => {
    expect(fact('pharmacy_diploma_alternatives').details).toContain('separates these with OR');
    expect(fact('pharmacy_alevel').details).toContain('Mathematics OR Physics');
    expect(fact('nutrition_indirect_connector').status).toBe('unknown');
    expect(fact('environmental_health_indirect').details).toContain('pass or better OR');
  });
  it('keeps ODL registration and intended-major midwifery in the diploma-based distance route', () => {
    const odl = general.profiles.find((p) => p.programKey === 'nul_nursing_odl');
    expect(odl?.deliveryMode).toBe('distance');
    expect(odl?.entryType).toBe('other');
    expect(fact('nursing_odl_registration').status).toBe('required');
    expect(fact('nursing_odl_midwifery').status).toBe('conditional');
    expect(fact('nursing_odl_midwifery').details).toContain('those two intended majors');
    expect(general.profiles.filter((p) => p.deliveryMode === 'distance')).toHaveLength(1);
  });
  it('preserves three-year versus two-year Law and insurance work-scope uncertainty', () => {
    expect(fact('law_other_degree').details).toContain('Second Class Second-Division');
    expect(fact('law_ba_law').details).toContain('BA Law with a minimum of pass');
    expect(fact('insurance_work_scope').status).toBe('unknown');
    const certificate = general.profiles.find((p) =>
      p.requirements.some((f) => f.key === 'nul_insurance_school'),
    );
    expect(certificate?.level).toBe('other');
    expect(certificate?.programId).toBeNull();
    expect(general.programs?.some((p) => /Certificate of Proficiency/u.test(p.name))).toBe(false);
  });
  it('stores shared conditions once and gives every fact its own official source locator', () => {
    expect(new Set(facts.map((f) => f.key)).size).toBe(facts.length);
    expect(new Set(facts.map((f) => f.details.toLowerCase().replace(/\s+/gu, ' '))).size).toBe(
      facts.length,
    );
    expect(facts.every((f) => new URL(f.source.url).hostname === 'nul.ls')).toBe(true);
    expect(fact('bed_shared_school_baseline').details).toContain('Special Education');
    expect(fact('environment_nutrition_school').details).toContain('two named');
  });
});

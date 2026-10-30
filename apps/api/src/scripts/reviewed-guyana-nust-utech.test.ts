import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema, factScope } from './admissions-facts-format.js';

const dataset = admissionFactsDatasetSchema.parse(
  JSON.parse(
    await readFile(
      new URL(
        '../../../../data/sources/admissions-facts-guyana-nust-utech-20261030.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const previous = admissionFactsDatasetSchema.parse(
  JSON.parse(
    await readFile(
      new URL(
        '../../../../data/sources/admissions-facts-nust-utech-20261023.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const facts = dataset.profiles.flatMap((p) => p.requirements);
const fact = (key: string) => {
  const found = facts.find((f) => f.key === key);
  if (!found) throw new Error(`Missing reviewed fact: ${key}`);
  return found;
};
const scope = (key: string) => {
  const found = dataset.profiles.find((p) => p.requirements.some((f) => f.key === key));
  if (!found) throw new Error(`Missing scope: ${key}`);
  return found;
};

describe('Guyana and additional NUST/UTech route safeguards', () => {
  it('resolves Guyana independently of Guam/Ghana and bounds the increment', () => {
    expect(dataset.institutions[0]).toMatchObject({ externalId: '05d8pm274', countryCode: 'GY' });
    expect(facts).toHaveLength(70);
    expect(dataset.programs).toHaveLength(21);
    expect(new Set(dataset.profiles.map(factScope)).size).toBe(28);
    const previousKeys = new Set(
      previous.profiles.flatMap((p) => p.requirements.map((f) => f.key)),
    );
    expect(facts.some((f) => previousKeys.has(f.key))).toBe(false);
  });
  it('does not date undated Guyana rules from curriculum or course changes', () => {
    const medicine = scope('guyana_mbbs_advanced_school_route');
    expect(medicine.academicYear).toBe('2026/2027');
    expect(medicine.notes).toContain('2023 intake batch');
    expect(
      dataset.profiles
        .filter((p) => p.institutionKey === 'guyana' && p !== medicine)
        .every((p) => p.academicYear === 'unspecified'),
    ).toBe(true);
    expect(
      dataset.profiles
        .filter((p) => p.institutionKey === 'utech')
        .every((p) => p.academicYear === '2027/2028'),
    ).toBe(true);
    expect(dataset.profiles.every((p) => p.intakeTerm === 'unspecified')).toBe(true);
  });
  it('retains conflicting official mature ages instead of choosing a convenient cutoff', () => {
    expect(fact('guyana_mature_age_conflict').status).toBe('unknown');
    expect(fact('guyana_mature_age_conflict').details).toContain('21');
    expect(fact('guyana_mature_age_conflict').details).toContain('26');
    expect(scope('guyana_mature_age_conflict').entryType).toBe('other');
    expect(fact('guyana_qualified_ugee_exemption').status).toBe('not_required');
    expect(fact('guyana_mature_ugee').status).toBe('required');
  });
  it('does not turn professional-entry Nursing into a direct school-leaver offer', () => {
    expect(scope('guyana_nursing_registration').entryType).toBe('other');
    expect(fact('guyana_nursing_registration').details).toContain('Every listed academic route');
    expect(fact('guyana_nursing_registration').details).toContain('Medex');
    expect(fact('guyana_nursing_mature_experience').status).toBe('conditional');
    expect(fact('guyana_nursing_mature_experience').details).toContain('five years');
    expect(fact('guyana_mature_age_conflict').details).not.toContain('five years');
  });
  it('keeps portfolio counts and authorship evidence within the applicable route', () => {
    expect(scope('guyana_architecture_external_portfolio').entryType).toBe('other');
    expect(fact('guyana_architecture_external_portfolio').details).toContain('5–10');
    expect(fact('guyana_architecture_authorship').status).toBe('conditional');
    expect(fact('guyana_architecture_interview').status).toBe('conditional');
    expect(fact('guyana_architecture_local_higher_entry').details).toContain('2.0');
    expect(fact('guyana_architecture_local_higher_entry').details).toContain('ARH2205');
  });
  it('keeps old/new Namibian curricula and subject APS separate from IB totals', () => {
    expect(fact('health_information_old_subject_aps').details).toContain('15 APS');
    expect(fact('health_information_old_subject_aps').details).toContain('none below D');
    expect(fact('health_information_new_subject_aps').details).toContain('20 APS');
    expect(fact('health_information_new_subject_aps').details).toContain('Physics and Chemistry');
    expect(fact('emergency_new_subject_aps').details).toContain('either Physics or Chemistry');
    expect(fact('emergency_old_curriculum_wording').status).toBe('unknown');
    expect(fact('actuarial_school_leaver_route').status).toBe('unknown');
    expect(fact('actuarial_school_leaver_route').details).toContain('previous-degree prerequisite');
    expect(scope('health_information_mature_test_scope').entryType).toBe('other');
    expect(fact('health_information_mature_test_scope').status).toBe('unknown');
  });
  it('keeps certificate/diploma subject counts and award names intact', () => {
    expect(fact('child_certificate_subjects').details).toContain('Three CSEC');
    expect(fact('associate_health_it_subjects').details).toContain('Four CSEC');
    expect(fact('mechanical_diploma_subjects').details).toContain('Four CSEC');
    expect(fact('electrical_diploma_subjects').details).toContain('five CSEC');
    expect(fact('pharmacy_technician_interview').details).toContain('not imposed here');
    expect(fact('child_certificate_psychometric').status).toBe('required');
    expect(fact('child_certificate_police_record').status).toBe('required');
    expect(scope('child_certificate_subjects').notes).toContain("a bachelor's degree");
  });
  it('retains ambiguous subject counts and separates preferences from requirements', () => {
    expect(fact('entertainment_ordinary_count_ambiguity').status).toBe('unknown');
    expect(fact('entertainment_vocational_alternative').status).toBe('unknown');
    expect(fact('pharmacy_technician_biology_preference').status).toBe('recommended');
    expect(fact('communication_arts_advantage').status).toBe('recommended');
    expect(fact('child_certificate_work_preference').details).toContain('no minimum age');
    expect(fact('guyana_mbbs_advanced_school_route').details).toContain(
      'does not specify a unit count',
    );
  });
  it('stores shared facts once and preserves stricter programme grades and transfer limits', () => {
    for (const key of [
      'health_science_new_subject_aps',
      'commerce_mathematics_d_group',
      'guyana_cs_shared_school_subjects',
      'guyana_cs_missing_it_remedy',
    ]) {
      expect(facts.filter((f) => f.key === key)).toHaveLength(1);
      expect(scope(key).programKey).toBeUndefined();
    }
    expect(fact('guyana_grade_acceptance').details).toContain('A–E is not a universal');
    expect(fact('guyana_cs_shared_school_subjects').details).toContain('A–C');
    expect(scope('guyana_transfer_residence_credit').entryType).toBe('transfer');
    expect(fact('guyana_transfer_residence_credit').details).toContain('including the final year');
    expect(fact('guyana_certificate_bridge_lower_csec').details).toContain('not establish direct');
  });
});

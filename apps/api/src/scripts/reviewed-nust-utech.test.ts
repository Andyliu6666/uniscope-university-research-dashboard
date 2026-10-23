import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema, factScope } from './admissions-facts-format.js';

const dataset = admissionFactsDatasetSchema.parse(
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
const profile = (programKey: string, entryType = 'first_year') => {
  const found = dataset.profiles.find(
    (p) => p.programKey === programKey && p.entryType === entryType,
  );
  if (!found) throw new Error(`Missing programme scope: ${programKey}/${entryType}`);
  return found;
};

describe('reviewed NUST Namibia and UTech Jamaica safeguards', () => {
  it('keeps the reviewed increment bounded and all programme declarations referenced', () => {
    expect(dataset.institutions.map((i) => i.externalId)).toEqual(['03gg1ey66', '02w1kdc51']);
    expect(facts).toHaveLength(79);
    expect(dataset.profiles).toHaveLength(39);
    expect(dataset.programs).toHaveLength(25);
    expect(new Set(dataset.profiles.map(factScope)).size).toBe(39);
    expect(
      dataset.programs?.every((p) => dataset.profiles.some((s) => s.programKey === p.key)),
    ).toBe(true);
  });
  it('does not confuse APS subject conversion with an IB Diploma total', () => {
    expect(fact('general_aps_minimum').details).toContain('not an IB total');
    expect(fact('aps_ib_grade_mapping').details).toContain('HL grades 7,6,5,4,3,2,1');
    expect(fact('aps_ib_grade_mapping').details).toContain('SL grades 7,6,5,4,3,2');
    expect(fact('aps_ib_grade_mapping').details).toContain('No minimum IB Diploma total');
    expect(fact('architecture_subjects').details).toContain('APS allocations, not an IB total');
  });
  it('keeps admissions years separate from the adjacent tuition year', () => {
    expect(
      dataset.profiles
        .filter((p) => p.institutionKey === 'nust')
        .every((p) => p.academicYear === '2027'),
    ).toBe(true);
    expect(
      dataset.profiles
        .filter((p) => p.institutionKey === 'utech')
        .every((p) => p.academicYear === '2027/2028'),
    ).toBe(true);
    expect(dataset.profiles.every((p) => p.intakeTerm === 'unspecified')).toBe(true);
    expect(fact('ordinary_and_late_deadlines').details).toContain('already past');
    expect(fact('mature_age_tests').details).toContain('already past');
    expect(fact('early_regular_deadlines').details).toContain('31 March 2027');
  });
  it('preserves source conflicts instead of inventing certainty or waivers', () => {
    for (const key of [
      'submission_route_conflict',
      'nqa_evaluation_scope_conflict',
      'identity_scope_conflict',
      'built_environment_mature_wording',
    ]) {
      expect(fact(key).status).toBe('unknown');
    }
    expect(fact('nqa_evaluation_scope_conflict').details).toContain(
      'do not infer a universal SADC exemption',
    );
    expect(facts.some((f) => ['not_required', 'not_considered'].includes(f.status))).toBe(false);
  });
  it('stores genuinely shared computing and nursing conditions once', () => {
    for (const key of [
      'cs_informatics_mathematics',
      'computing_shared_school_subjects',
      'nursing_midwifery_subjects',
      'nursing_midwifery_selection',
    ]) {
      expect(facts.filter((f) => f.key === key)).toHaveLength(1);
      expect(
        dataset.profiles.find((p) => p.requirements.some((f) => f.key === key))?.programKey,
      ).toBeUndefined();
    }
    expect(fact('computing_shared_school_subjects').details).toContain('Stored once');
    expect(profile('utech_computing').requirements.map((f) => f.key)).toEqual([
      'computing_interview',
    ]);
  });
  it('does not transfer an Architecture portfolio size to Animation or universalize interviews', () => {
    expect(fact('animation_drawing_portfolio').status).toBe('required');
    expect(fact('animation_drawing_portfolio').details).toContain('No piece count');
    expect(fact('animation_interview').status).toBe('conditional');
    expect(fact('architecture_interview_portfolio').details).toContain('at least ten');
    expect(fact('architecture_interview_portfolio').details).toContain('Early Bird and overseas');
    expect(fact('pharmtech_interview').status).toBe('required');
  });
  it('separates standard engineering from accelerated or higher-year alternatives', () => {
    for (const key of [
      'utech_chemical',
      'utech_civil',
      'utech_electrical',
      'utech_industrial',
      'utech_mechanical',
    ]) {
      expect(profile(key).requirements[0]?.key).toBe('engineering_standard_route');
      expect(profile(key, 'other').requirements[0]?.key).toBe('engineering_accelerated_route');
    }
    expect(profile('utech_electrical').requirements[0]?.status).toBe('unknown');
    expect(profile('utech_mechanical').requirements[0]?.status).toBe('unknown');
    expect(profile('utech_electrical', 'other').requirements[0]?.details).toContain('C or better');
    expect(profile('utech_civil', 'other').requirements[0]?.details).toContain('2.7');
    expect(profile('utech_civil').requirements[0]?.details).toContain('3.05');
  });
  it('does not rename articulation College Board AP or internal placement IELTS entry', () => {
    expect(fact('articulation_recognised_diploma').details).toContain(
      'does not mean College Board AP',
    );
    expect(fact('post_admission_english_test').details).toContain('post-admission');
    expect(fact('english_test_exemptions').details).toContain('No IB-English or IELTS exemption');
    const language = dataset.profiles.find((p) =>
      p.requirements.some((f) => f.key === 'post_admission_english_test'),
    );
    expect(language?.entryType).toBe('other');
  });
  it('does not apply Journalism mature-age pass marks to ordinary entry', () => {
    expect(
      profile('nust_journalism').requirements.every((f) => !f.details.includes('minimum 50%')),
    ).toBe(true);
    expect(profile('nust_journalism', 'other').requirements[0]?.details).toContain('minimum 50%');
    expect(fact('mature_age_eligibility').details).toContain('alternative route');
  });
  it('keeps preferred subjects distinct from absolute requirements', () => {
    expect(fact('animation_visual_arts_preference').status).toBe('recommended');
    expect(fact('pharmacy_school_advanced_subjects').details).toContain('not a mandatory Physics');
    expect(fact('actuarial_three_top_grades').details).toContain('not an A-level AAA');
    expect(fact('forensic_subject_relevance').details).toContain('directly relate');
  });
});

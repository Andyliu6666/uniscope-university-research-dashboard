import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';

const load = async (file: string) =>
  admissionFactsDatasetSchema.parse(
    JSON.parse(
      await readFile(new URL(`../../../../data/sources/${file}`, import.meta.url), 'utf8'),
    ),
  );
const dataset = await load('admissions-facts-eswatini-faculties-20261105.json');
const prior = await load('admissions-facts-eswatini-belize-20261030.json');
const facts = dataset.profiles.flatMap((p) => p.requirements);
const fact = (key: string) => {
  const found = facts.find((f) => f.key === key);
  if (!found) throw new Error(`Missing reviewed fact: ${key}`);
  return found;
};
const scope = (key: string) => {
  const found = dataset.profiles.find((p) => p.requirements.some((f) => f.key === key));
  if (!found) throw new Error(`Missing reviewed scope: ${key}`);
  return found;
};

describe('reviewed Eswatini faculty-route safeguards', () => {
  it('retains the dated conventional scheme without manufacturing new programme identities', () => {
    expect(dataset.profiles.every((p) => p.academicYear === '2026/2027')).toBe(true);
    expect(dataset.programs).toHaveLength(12);
    expect(dataset.programs?.filter((p) => /Information Science$/u.test(p.name))).toHaveLength(2);
    expect(
      dataset.programs?.some((p) => /Library Science|Library Information Systems/u.test(p.name)),
    ).toBe(false);
    expect(dataset.programs?.some((p) => /Distance|IDE/u.test(p.name))).toBe(false);
    expect(
      dataset.profiles
        .filter((p) => p.programKey === 'es_public_sector_accounting')
        .every((p) => p.level === 'graduate'),
    ).toBe(true);
  });
  it('keeps the English and six-pass discrepancies unresolved without overwriting the general rule', () => {
    expect(fact('es_science_english_credit_conflict').status).toBe('unknown');
    expect(fact('es_science_english_credit_conflict').details).toContain(
      'general-rule waiver or precedence',
    );
    expect(fact('es_social_sciences_general_count_clarification').status).toBe('unknown');
    expect(scope('es_science_english_credit_conflict').programKey).toBeUndefined();
    expect(
      prior.profiles.flatMap((p) => p.requirements).find((f) => f.key === 'es_degree_six_credits')
        ?.status,
    ).toBe('required');
  });
  it('stores shared pools once and does not enlarge the narrower Computer Science Education list', () => {
    expect(scope('es_technical_shared_sgcse_pool').programKey).toBeUndefined();
    expect(scope('es_technical_shared_gce_pool').programKey).toBeUndefined();
    expect(scope('es_science_additional_maths_no_double_count').programKey).toBeUndefined();
    expect(fact('es_cse_gce_subjects').details).toContain('does not include Home Economics or ICT');
    expect(fact('es_science_additional_maths_no_double_count').details).toContain(
      'cannot count again',
    );
    expect(fact('es_technical_shared_sgcse_pool').details).toContain(
      'not twenty simultaneous subjects',
    );
  });
  it('keeps possible A-level exemptions separate from guaranteed placement or admission totals', () => {
    expect(fact('es_science_alevel_exemption').details).toContain(
      'At least two A-level grades of C',
    );
    expect(fact('es_science_alevel_exemption').details).toContain(
      'take and pass first-year courses',
    );
    expect(fact('es_engineering_alevel_exemption').details).toContain('Mathematics and Physics');
    expect(fact('es_engineering_alevel_exemption').status).toBe('conditional');
    expect(fact('es_information_science_alevel').details).toContain('entry into Level 1');
    expect(fact('es_consumer_alevel_course_exemption').details).toContain(
      'not a guaranteed full-year exemption',
    );
  });
  it('requires both Engineering approvals only in the evidenced international scope', () => {
    const p = scope('es_engineering_international_approvals');
    expect(p.applicantType).toBe('international');
    expect(p.entryType).toBe('first_year');
    expect(p.programKey).toBe('es_electrical_electronic_engineering');
    expect(fact('es_engineering_international_approvals').details).toContain(
      'BOTH Admissions Committee and Faculty',
    );
    expect(fact('es_engineering_international_approvals').status).toBe('required');
  });
  it('does not impose AAT work years or graduation credits on every postgraduate applicant', () => {
    const p = scope('es_public_accounting_bcom');
    expect(p.requirements).toHaveLength(4);
    expect(fact('es_public_accounting_bcom').status).toBe('conditional');
    expect(fact('es_public_accounting_professional').details).toContain(
      'completed CA, ACCA, CPA, CIMA',
    );
    expect(fact('es_public_accounting_noncommerce_wording').status).toBe('unknown');
    expect(fact('es_public_accounting_noncommerce_wording').details).toContain(
      'No work-duration minimum',
    );
    expect(fact('es_public_accounting_aat_work').details).toContain(
      'AAT Level III or equivalent AND five years',
    );
    expect(fact('es_public_accounting_aat_work').details).toContain(
      'graduation requirements, not prior-admission credits',
    );
  });
  it('preserves the Consumer diploma field, year placement and incomplete-course obligations', () => {
    expect(fact('es_consumer_diploma_year_placement').details).toContain('two-year');
    expect(fact('es_consumer_diploma_year_placement').details).toContain('three-year');
    expect(fact('es_consumer_diploma_course_review').details).toContain(
      'must still take Level 1 or 2',
    );
    expect(scope('es_consumer_education_relevant_diploma').entryType).toBe('transfer');
    expect(fact('es_consumer_education_relevant_diploma').details).toContain(
      'Home Economics Education',
    );
    expect(fact('es_consumer_non_education_diploma').details).toContain(
      'not automatically interchangeable',
    );
  });
  it('keeps Library Science diploma entitlement and the mature aptitude paper in their routes', () => {
    expect(fact('es_information_science_library_option').details).toContain(
      'does not publish the separate Library Information Systems mathematics',
    );
    expect(fact('es_information_science_systems_option').details).toContain(
      'Mathematics/Additional Mathematics',
    );
    expect(fact('es_information_science_diploma').details).toContain(
      'does not state the same diploma entitlement',
    );
    expect(fact('es_information_science_mature_aptitude').category).toBe('standardized_test');
    expect(fact('es_information_science_mature_aptitude').status).toBe('conditional');
    expect(scope('es_information_science_mature_aptitude').entryType).toBe('other');
    expect(fact('es_gis_diploma_groups').status).toBe('unknown');
  });
  it('does not extend Law Year 3 placement or major-specific Mathematics to unrelated applicants', () => {
    expect(fact('es_law_ba_law_year_three').details).toContain(
      'no exemptions from courses in that year',
    );
    expect(fact('es_law_diploma_placement').details).toContain('no automatic Year 3 entitlement');
    expect(fact('es_social_work_diploma_admission').details).toContain('Senate determines');
    expect(fact('es_social_science_mathematics_major').status).toBe('conditional');
    expect(fact('es_social_science_mathematics_major').details).toContain(
      'Mathematics, Economics or Statistics',
    );
    expect(fact('es_social_science_mathematics_major').details).toContain('not a universal');
  });
});

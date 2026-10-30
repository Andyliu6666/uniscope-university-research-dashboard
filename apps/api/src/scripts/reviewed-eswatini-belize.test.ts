import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema, factScope } from './admissions-facts-format.js';

const dataset = admissionFactsDatasetSchema.parse(
  JSON.parse(
    await readFile(
      new URL(
        '../../../../data/sources/admissions-facts-eswatini-belize-20261030.json',
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
  if (!found) throw new Error(`Missing reviewed scope: ${key}`);
  return found;
};

describe('reviewed Eswatini and Belize admissions safeguards', () => {
  it('keeps exact institutions, bounded facts and distinct scopes', () => {
    expect(dataset.institutions.map((s) => [s.externalId, s.countryCode])).toEqual([
      ['05nv2rz39', 'SZ'],
      ['00fgcap50', 'BZ'],
    ]);
    expect(facts).toHaveLength(74);
    expect(dataset.programs).toHaveLength(9);
    expect(new Set(dataset.profiles.map(factScope)).size).toBe(23);
  });
  it('does not promote old banners, upload years or recurring formulas to current dates', () => {
    expect(
      dataset.profiles
        .filter((p) => p.institutionKey === 'eswatini')
        .every((p) => p.academicYear === '2026/2027'),
    ).toBe(true);
    expect(
      dataset.profiles
        .filter((p) => p.institutionKey === 'belize')
        .every((p) => p.academicYear === 'unspecified'),
    ).toBe(true);
    expect(dataset.profiles.every((p) => p.intakeTerm === 'unspecified')).toBe(true);
    expect(fact('es_2026_deadline').details).toContain('already past');
    expect(fact('bz_recurring_deadline_rules').details).toContain('No year is assigned');
    expect(fact('bz_medicine_deadline_confirmation').status).toBe('unknown');
    expect(fact('bz_medicine_deadline_confirmation').details).toContain(
      '6 June 2025, already past',
    );
  });
  it('preserves degree, diploma, certificate and postgraduate eligibility', () => {
    expect(fact('es_degree_six_credits').details).toContain('six SGCSE/IGCSE passes at C');
    expect(fact('es_diploma_six_credits').details).toContain('three other relevant');
    expect(fact('es_certificate_four_passes').details).toContain('English at E');
    expect(scope('es_certificate_four_passes').level).toBe('other');
    expect(scope('es_pgce_degree_subject_gpa').level).toBe('graduate');
    expect(fact('es_pgce_degree_subject_gpa').details).toContain('teaching-subject threshold');
    expect(scope('es_taxation_prior_qualifications').level).toBe('graduate');
    expect(fact('es_taxation_prior_qualifications').details).toContain('last alternative');
  });
  it('does not equate diploma duration with automatic third-year entry', () => {
    expect(scope('es_agriculture_diploma_levels').entryType).toBe('transfer');
    expect(fact('es_agriculture_diploma_levels').details).toContain('Level 2 or 3');
    expect(fact('es_commerce_diploma_placement').details).toContain('DABS');
    expect(fact('es_commerce_diploma_placement').details).toContain('Level 1');
    expect(fact('es_commerce_diploma_placement').details).toContain('may support Level 3');
    expect(scope('es_commerce_diploma_placement').entryType).toBe('other');
  });
  it('keeps subject choices and selection alternatives within their named courses', () => {
    expect(fact('es_environmental_health_subject_exception').details).toContain('only for');
    expect(fact('es_humanities_geography_mathematics').status).toBe('conditional');
    expect(fact('es_nursing_grade_priority').status).toBe('considered');
    expect(fact('es_nursing_selection_methods').details).toContain("source says 'or'");
    expect(fact('es_health_higcse_as_route').details).toContain('six passes');
    expect(fact('es_health_alevel_year_exemption').details).toContain('Two relevant');
  });
  it('separates placement, ATLIB alternatives and a version-ambiguous SAT score', () => {
    expect(scope('bz_placement_conditions').entryType).toBe('other');
    expect(fact('bz_placement_conditions').details).toContain('35/50');
    expect(fact('bz_placement_conditions').details).toContain('60/100');
    expect(fact('bz_placement_conditions').details).toContain('not universal');
    expect(fact('bz_atlib_cxc_act_alternatives').details).toContain('alternatives, not cumulative');
    expect(fact('bz_sat_version_unspecified').status).toBe('unknown');
    expect(fact('bz_international_language_scores').details).toContain(
      'without specifying TOEFL edition',
    );
  });
  it('preserves QESE section minimums, MCAT recommendation and unresolved test applicability', () => {
    expect(fact('bz_medicine_qese_threshold').details).toContain('320');
    expect(fact('bz_medicine_qese_threshold').details).toContain('80 in each section');
    expect(fact('bz_medicine_mcat_recommendation').status).toBe('recommended');
    expect(fact('bz_medicine_test_applicability').status).toBe('unknown');
    expect(fact('bz_medicine_broader_degree_list').status).toBe('unknown');
    expect(fact('bz_medicine_advanced_school_route').details).toContain(
      'does not specify CAPE units',
    );
  });
  it('stores shared essay/recommendation counts once with medical differences separately', () => {
    expect(scope('bz_personal_statement_shared').programKey).toBeUndefined();
    expect(fact('bz_personal_statement_shared').details).toContain('250–500');
    expect(facts.filter((f) => f.details.includes('250–500'))).toHaveLength(1);
    expect(scope('bz_two_recommendation_forms').programKey).toBeUndefined();
    expect(fact('bz_medicine_recommender_one').details).toContain(
      'licensed healthcare professional',
    );
    expect(fact('bz_medicine_recommender_two').details).toContain('academic recommenders');
    expect(fact('bz_medicine_police_record').details).toContain('previous four years');
    expect(fact('bz_ordinary_application_fee').details).toContain('Medicine uses a separate');
    expect(fact('bz_medicine_application_fee').details).toContain('BZ$200');
    expect(scope('bz_international_transfer_outlines')).toMatchObject({
      entryType: 'transfer',
      applicantType: 'international',
    });
    expect(scope('bz_pued_odl_ace_readmission').entryType).toBe('readmission');
  });
});

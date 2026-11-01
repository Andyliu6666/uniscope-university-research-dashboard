import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema, factScope } from './admissions-facts-format.js';

const load = async (name: string) =>
  admissionFactsDatasetSchema.parse(
    JSON.parse(
      await readFile(new URL(`../../../../data/sources/${name}`, import.meta.url), 'utf8'),
    ),
  );
const malawi = await load('admissions-facts-malawi-economic-20261101.json');
const belize = await load('admissions-facts-belize-business-graduate-20261101.json');
const datasets = [malawi, belize];
const profiles = datasets.flatMap((d) => d.profiles);
const facts = profiles.flatMap((p) => p.requirements);
const fact = (key: string) => {
  const found = facts.find((f) => f.key === key);
  if (!found) throw new Error(`Missing reviewed fact: ${key}`);
  return found;
};
const scope = (key: string) => {
  const found = profiles.find((p) => p.requirements.some((f) => f.key === key));
  if (!found) throw new Error(`Missing reviewed scope: ${key}`);
  return found;
};

describe('Malawi economic-fee-paying source safeguards', () => {
  it('keeps all 43 named courses in the dated scheme and undated guidance separate', () => {
    expect(malawi.institutions[0]).toMatchObject({ externalId: '04vtx5s55', countryCode: 'MW' });
    expect(malawi.programs).toHaveLength(43);
    expect(malawi.profiles).toHaveLength(50);
    expect(new Set(malawi.profiles.map(factScope)).size).toBe(50);
    expect(
      malawi.profiles.filter((p) => p.programKey).every((p) => p.academicYear === '2026/2027'),
    ).toBe(true);
    expect(scope('mw_international_alevel_three_principals').academicYear).toBe('unspecified');
    expect(scope('mw_international_equivalent_school_awards').applicantType).toBe('international');
  });
  it('preserves explicit lower-point cutoffs and never interprets them as IB scores', () => {
    expect(fact('mw_mathematics_school_subjects').details).toContain('4 points or below');
    expect(fact('mw_statistics_school_subjects').details).toContain('4 points or below');
    expect(fact('mw_international_relations_school_subjects').details).toContain(
      'maximum aggregate of 26 MSCE points',
    );
    expect(fact('mw_actuarial_point_wording').status).toBe('unknown');
    expect(fact('mw_literary_english_wording').status).toBe('unknown');
  });
  it('does not silently reverse contradictory A-level point ceilings', () => {
    for (const key of [
      'mw_history_alevel_aggregate_conflict',
      'mw_library_alevel_aggregate_conflict',
    ]) {
      expect(fact(key).status).toBe('unknown');
      expect(fact(key).details).toContain('ceiling of 9');
      expect(fact(key).details).toContain('at least 9');
      expect(fact(key).details).toContain('force exactly 9');
      expect(scope(key).entryType).toBe('other');
    }
    expect(fact('mw_law_enforcement_school_subjects').details).toContain('minimum aggregate of 9');
    expect(fact('mw_international_alevel_three_principals').details).toContain(
      'A=5, B=4, C=3, D=2 and E=1',
    );
  });
  it('preserves alternative subject groups without adding Physics to every computing course', () => {
    expect(fact('mw_computer_science_school_subjects').details).toContain('Physics is not added');
    expect(fact('mw_network_engineering_school_subjects').details).toContain(
      'strong credit in Physics',
    );
    expect(fact('mw_food_nutrition_school_subjects').details).toContain('Home Economics');
    expect(fact('mw_geology_school_subjects').status).toBe('unknown');
    expect(fact('mw_geography_school_subjects').details).toContain(
      'not all simultaneously required',
    );
    expect(fact('mw_social_work_school_subjects').details).toContain('does not add Mathematics');
  });
  it('keeps A-level year-two assessment shared with distinct music and exceptional routes', () => {
    expect(scope('mw_economic_relevant_alevel_year_two').programKey).toBeUndefined();
    expect(scope('mw_economic_relevant_alevel_year_two').entryType).toBe('other');
    expect(fact('mw_economic_relevant_alevel_year_two').status).toBe('conditional');
    expect(fact('mw_economic_relevant_alevel_year_two').details).toContain(
      'following 40 listed programmes',
    );
    expect(scope('mw_music_alevel_year_two').programKey).toBe('mw_music');
    expect(scope('mw_music_alevel_year_two').entryType).toBe('other');
    expect(fact('mw_music_alevel_year_two').details).toContain('Music among the passed subjects');
    expect(fact('mw_music_school_subjects').details).toContain('not an added first-year audition');
  });
  it('does not generalize professional registration or promote an expired deadline', () => {
    expect(fact('mw_economic_registration_if_applicable').status).toBe('conditional');
    expect(fact('mw_economic_registration_if_applicable').details).toContain(
      'not a nursing-registration condition for every',
    );
    expect(fact('mw_economic_2026_closed_deadline').details).toContain(
      '31 July 2026, already past',
    );
    expect(fact('mw_economic_application_fee').details).toContain('MWK 25,000');
    expect(fact('mw_economic_application_fee').details).toContain('USD 35');
    expect(fact('mw_economic_training_funds').details).toContain(
      'does not set a universal bank-balance',
    );
  });
  it('keeps scheme-specific application channels and unclear conversion labels unresolved', () => {
    expect(fact('mw_international_application_route_confirmation').status).toBe('unknown');
    expect(fact('mw_international_application_route_confirmation').details).toContain('NCHE');
    expect(fact('mw_international_application_route_confirmation').details).toContain(
      'direct Registrar',
    );
    expect(fact('mw_international_conversion_table').status).toBe('unknown');
    expect(fact('mw_international_conversion_table').details).toContain('A*1');
    expect(malawi.programs?.filter((p) => p.name.includes('Chemistry'))).toHaveLength(1);
  });
});

describe('Belize business/graduate source safeguards', () => {
  it('preserves exact identities, levels and undated application cycles', () => {
    expect(belize.institutions[0]).toMatchObject({ externalId: '00fgcap50', countryCode: 'BZ' });
    expect(belize.programs).toHaveLength(10);
    expect(belize.profiles).toHaveLength(13);
    expect(belize.profiles.flatMap((p) => p.requirements)).toHaveLength(24);
    expect(belize.profiles.every((p) => p.academicYear === 'unspecified')).toBe(true);
    expect(scope('bz_associate_business_eligibility').level).toBe('undergraduate');
    expect(scope('bz_mba_degree_grades').level).toBe('graduate');
    expect(scope('bz_accounting_eligibility').entryType).toBe('other');
  });
  it('keeps graduate honours as an alternative to a numeric GPA', () => {
    for (const key of ['bz_mba_degree_grades', 'bz_medl_degree_grades', 'bz_mphil_degree_grades']) {
      expect(fact(key).details).toContain(
        'either cumulative GPA of at least 3.0 on a 4.0 scale or upper second-class',
      );
    }
    expect(fact('bz_bba_entrepreneurship_eligibility').details).toContain('offered by cohort');
    expect(fact('bz_public_sector_management_eligibility').details).toContain('online delivery');
  });
  it('does not give every graduate a compulsory interview, two references or three work years', () => {
    expect(fact('bz_three_graduate_interview').status).toBe('conditional');
    expect(fact('bz_three_graduate_recommendations').details).toContain(
      'do not specify a universal number',
    );
    expect(scope('bz_three_graduate_cv').programKey).toBeUndefined();
    expect(scope('bz_mba_professional_experience').programKey).toBe('bz_mba');
    expect(fact('bz_mba_professional_experience').details).toContain('At least three years');
    expect(fact('bz_mba_medl_job_letter').status).toBe('conditional');
    expect(fact('bz_mba_medl_job_letter').details).toContain('not applied to MPhil');
  });
  it('distinguishes graduate statements and the labelled MPhil research proposal', () => {
    expect(fact('bz_mba_personal_statement').details).toContain('two pages');
    expect(fact('bz_medl_personal_statement').details).toContain('APA format');
    expect(fact('bz_mphil_research_proposal').details).toContain('research proposal');
    expect(fact('bz_mphil_research_proposal').details).toContain(
      'not an invented full thesis-proposal word count',
    );
    expect(
      belize.profiles
        .flatMap((p) => p.requirements)
        .filter((f) => f.key === 'bz_three_graduate_cv'),
    ).toHaveLength(1);
  });
  it('keeps international rules in the named graduate programme with test/timing limits', () => {
    for (const p of ['bz_medl', 'bz_mphil']) {
      expect(scope(`${p}_international_english`).applicantType).toBe('international');
      expect(scope(`${p}_international_english`).level).toBe('graduate');
      expect(fact(`${p}_international_english`).details).toContain(
        'TOEFL at least 87, IELTS at least 5',
      );
      expect(fact(`${p}_international_english`).details).toContain(
        'does not identify a TOEFL edition',
      );
      expect(fact(`${p}_international_first_term_payment`).details).toContain(
        'no amount or precise offer/registration/payment stage',
      );
    }
    expect(
      belize.profiles.some((p) => p.programKey === 'bz_mba' && p.applicantType === 'international'),
    ).toBe(false);
  });
  it('does not introduce duplicate keys or fabricated IB/AP programme totals', () => {
    expect(facts).toHaveLength(85);
    expect(new Set(facts.map((f) => f.key)).size).toBe(85);
    expect(profiles.every((p) => p.intakeTerm === 'unspecified')).toBe(true);
    expect(
      facts.some((f) => /minimum IB (?:total|score) [0-9]|AP minimum [0-9]/iu.test(f.details)),
    ).toBe(false);
  });
});

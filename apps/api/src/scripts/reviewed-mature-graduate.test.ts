import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema, factScope } from './admissions-facts-format.js';

const load = async (file: string) =>
  admissionFactsDatasetSchema.parse(
    JSON.parse(
      await readFile(new URL(`../../../../data/sources/${file}`, import.meta.url), 'utf8'),
    ),
  );
const malawi = await load('admissions-facts-malawi-mature-20261104.json');
const belize = await load('admissions-facts-belize-graduate-forms-20261104.json');
const previousMalawi = await load('admissions-facts-malawi-economic-20261101.json');
const previousBelize = await load('admissions-facts-belize-business-graduate-20261101.json');
const facts = [...malawi.profiles, ...belize.profiles].flatMap((p) => p.requirements);
const fact = (key: string) => {
  const f = facts.find((f) => f.key === key);
  if (!f) throw new Error(`Missing reviewed fact: ${key}`);
  return f;
};
const scope = (key: string) => {
  const p = [...malawi.profiles, ...belize.profiles].find((p) =>
    p.requirements.some((f) => f.key === key),
  );
  if (!p) throw new Error(`Missing reviewed scope: ${key}`);
  return p;
};

describe('reviewed mature-entry and graduate-form safeguards', () => {
  it('does not turn mixed cycle labels or upload directories into confirmed entry years', () => {
    expect(
      malawi.profiles.every((p) => p.academicYear === 'unspecified' && p.entryType === 'other'),
    ).toBe(true);
    expect(
      belize.profiles.every((p) => p.academicYear === 'unspecified' && p.level === 'graduate'),
    ).toBe(true);
    expect(fact('mw_mature_cycle_confirmation').status).toBe('unknown');
    expect(fact('mw_mature_cycle_confirmation').details).toContain('2025/2026');
    expect(fact('mw_mature_expired_closing_date').details).toContain('31 July 2026');
    expect(fact('mw_mature_expired_closing_date').details).toContain('already past');
  });
  it('reuses existing course identities and fields rather than cloning award variants', () => {
    expect(malawi.programs).toHaveLength(7);
    expect(belize.programs).toHaveLength(3);
    for (const [d, previous] of [
      [malawi, previousMalawi],
      [belize, previousBelize],
    ] as const) {
      for (const programme of d.programs ?? []) {
        const old = previous.programs?.find((p) => p.key === programme.key);
        if (old)
          expect([programme.name, programme.level, programme.field]).toEqual([
            old.name,
            old.level,
            old.field,
          ]);
      }
    }
    expect(new Set(malawi.profiles.map(factScope)).size).toBe(8);
    expect(new Set(belize.profiles.map(factScope)).size).toBe(6);
    expect(facts).toHaveLength(47);
    expect(new Set(facts.map((f) => f.key)).size).toBe(47);
  });
  it('does not conflate CV referees, employer letters, work duration and age', () => {
    expect(fact('mw_mature_cv_three_referees').details).toContain(
      'not a requirement for three separate recommendation letters',
    );
    expect(fact('mw_mature_employer_reference_evidence').details).toContain('each listed employer');
    expect(fact('mw_mature_post_diploma_experience').status).toBe('conditional');
    expect(fact('mw_mature_post_diploma_experience').details).toContain('after the diploma');
    expect(fact('mw_mature_creative_arts_four_years').details).toContain('at least four years');
    expect(fact('mw_mature_post_diploma_experience').details).toContain('not an age cutoff');
  });
  it('preserves programme-specific credit counts and certificate/bachelor exceptions', () => {
    expect(fact('mw_education_language_mature_route').details).toContain('four MSCE');
    expect(fact('mw_psychology_mature_route').details).toContain('Six MSCE');
    expect(fact('mw_humanities_philosophy_certificate_exception').status).toBe('unknown');
    expect(fact('mw_humanities_philosophy_certificate_exception').details).toContain('six MSCE');
    expect(fact('mw_library_information_mature_route').status).toBe('unknown');
    expect(fact('mw_library_information_mature_route').details).toContain('Certificate for Year 2');
    expect(fact('mw_psychology_mature_bachelor_alternative').status).toBe('conditional');
    expect(fact('mw_theology_mature_route').details).toContain(
      'not two diplomas that must both be held',
    );
  });
  it('keeps exclusions, document originals and mature funding scoped to their actual scheme', () => {
    expect(scope('mw_mature_prior_registration_ineligibility').entryType).toBe('other');
    expect(fact('mw_mature_prior_registration_ineligibility').details).toContain(
      'already registered',
    );
    expect(fact('mw_mature_transcript_originals_confirmation').status).toBe('unknown');
    expect(fact('mw_mature_funding_evidence').details).toContain(
      'does not set a universal minimum bank balance',
    );
    expect(fact('mw_mature_fee_deposit_evidence').details).toContain('MWK 25,000');
  });
  it('adds the newly evidenced two-reference count once and flags role contradictions', () => {
    expect(scope('bz_grad_forms_two_references').programKey).toBeUndefined();
    expect(facts.filter((f) => f.key === 'bz_grad_forms_two_references')).toHaveLength(1);
    expect(fact('bz_grad_forms_recommender_roles_conflict').status).toBe('unknown');
    expect(fact('bz_grad_forms_recommender_roles_conflict').details).toContain(
      'does not waive the separate MBA three-year',
    );
    expect(fact('bz_grad_forms_recommender_delivery').details).toContain('These are alternatives');
  });
  it('does not silently combine MPhil word/page limits or make employment universal', () => {
    expect(fact('bz_mphil_form_proposal_format_conflict').status).toBe('unknown');
    expect(scope('bz_mphil_form_proposal_format_conflict').programKey).toBe('bz_mphil');
    expect(fact('bz_mphil_form_proposal_format_conflict').details).toContain('1000 words');
    expect(fact('bz_mphil_form_proposal_format_conflict').details).toContain(
      'maximum of two APA-formatted pages',
    );
    expect(fact('bz_mphil_form_proposal_format_conflict').details).toContain(
      'No source establishes precedence',
    );
    expect(fact('bz_mphil_form_job_letter_if_applicable').status).toBe('conditional');
  });
  it('preserves alumni and citizenship-document alternatives without universal exemptions', () => {
    expect(fact('bz_grad_forms_transcript_scope').status).toBe('conditional');
    expect(fact('bz_grad_forms_transcript_scope').details).toContain(
      'without printing the same exemption',
    );
    expect(fact('bz_grad_forms_citizenship_evidence').details).toContain('explicitly not both');
    expect(fact('bz_mba_form_social_security_applicability').status).toBe('unknown');
    expect(fact('bz_mba_form_standardized_exam_applicability').status).toBe('conditional');
    expect(fact('bz_mba_form_standardized_exam_applicability').details).toContain(
      'does not publish a compulsory GRE',
    );
  });
  it('does not convert native-language/country triggers or evaluator lists into guessed waivers', () => {
    expect(scope('bz_mba_form_international_english').applicantType).toBe('international');
    expect(fact('bz_mba_form_international_english').details).toContain(
      'non-native English speakers',
    );
    for (const p of ['bz_medl', 'bz_mphil']) {
      expect(fact(`${p}_form_english_trigger_conflict`).status).toBe('unknown');
      expect(scope(`${p}_form_english_trigger_conflict`).applicantType).toBe('international');
      expect(fact(`${p}_form_evaluator_list_conflict`).status).toBe('unknown');
      expect(fact(`${p}_form_evaluator_list_conflict`).details).toContain('only Josef Silny');
    }
  });
});

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';

const load = async (file: string) =>
  admissionFactsDatasetSchema.parse(
    JSON.parse(
      await readFile(new URL(`../../../../data/sources/${file}`, import.meta.url), 'utf8'),
    ),
  );
const dataset = await load('admissions-facts-malawi-mature-remaining-20261104.json');
const previous = await load('admissions-facts-malawi-economic-20261101.json');
const facts = dataset.profiles.flatMap((p) => p.requirements);
const fact = (key: string) => {
  const found = facts.find((f) => f.key === key);
  if (!found) throw new Error(`Missing reviewed fact: ${key}`);
  return found;
};
const profile = (key: string) => {
  const found = dataset.profiles.find((p) => p.requirements.some((f) => f.key === key));
  if (!found) throw new Error(`Missing reviewed scope: ${key}`);
  return found;
};

describe('remaining Malawi mature-entry route safeguards', () => {
  it('keeps the mixed cycle undated and does not classify diplomas as bachelor awards', () => {
    expect(
      dataset.profiles.every((p) => p.academicYear === 'unspecified' && p.entryType === 'other'),
    ).toBe(true);
    const diploma = profile('mw_diploma_statistics_mature_eligibility_wording');
    expect(diploma.level).toBe('other');
    expect(diploma.programId).toBeNull();
    expect(diploma.programKey).toBeUndefined();
    expect(dataset.programs?.some((p) => p.name.startsWith('Diploma'))).toBe(false);
    expect(fact('mw_mature_alternative_baseline_interaction').status).toBe('unknown');
  });
  it('reuses nineteen existing award identities rather than creating title variants', () => {
    const reused = dataset.programs?.filter((p) => previous.programs?.some((x) => x.key === p.key));
    expect(reused).toHaveLength(19);
    for (const p of reused ?? []) {
      const old = previous.programs?.find((x) => x.key === p.key);
      expect([p.name, p.level, p.field]).toEqual([old?.name, old?.level, old?.field]);
    }
    expect(profile('mw_music_mature_diploma_option').notes).toContain('BMUS matches');
    const family = profile('mw_mature_family_consumer_named_route');
    expect(family.programKey).toBeUndefined();
    expect(fact('mw_mature_family_consumer_named_route').details).toContain(
      'equivalence is not established',
    );
  });
  it('retains ambiguous subject and qualification wording rather than inventing equivalence', () => {
    for (const key of [
      'mw_mature_science_subject_list_clarification',
      'mw_geography_mature_year_two_wording',
      'mw_geology_mature_year_one_subjects',
      'mw_diploma_statistics_mature_eligibility_wording',
    ]) {
      expect(fact(key).status).toBe('unknown');
    }
    expect(fact('mw_geography_mature_year_two_wording').details).toContain('IGSCE');
    expect(profile('mw_mature_science_subject_list_clarification').programKey).toBeUndefined();
    expect(fact('mw_geology_mature_year_two_alevel').details).toContain('All five named subjects');
  });
  it('keeps A-level points, mathematics percentages and professional groups distinct', () => {
    expect(fact('mw_statistics_mature_alevel_points').details).toContain(
      'six points in the two principal subjects',
    );
    expect(fact('mw_actuarial_mature_quantitative_degree').details).toContain(
      'mathematics subjects, not',
    );
    expect(fact('mw_actuarial_mature_board_subjects').details).toContain(
      'not an additional third subject',
    );
    for (const key of [
      'mw_actuarial_mature_quantitative_degree',
      'mw_actuarial_mature_board_subjects',
      'mw_actuarial_mature_caa',
      'mw_actuarial_mature_cfa',
    ]) {
      expect(fact(key).status).toBe('conditional');
    }
    expect(fact('mw_actuarial_mature_cfa').details).toContain(
      'Full CFA and first-level completion are alternatives',
    );
  });
  it('preserves institutional certificate, diploma and year-placement limitations', () => {
    expect(fact('mw_information_systems_mature_unima_certificate').details).toContain(
      'not expanded to every private',
    );
    expect(fact('mw_information_systems_mature_advanced_diploma').details).toContain('For Year 3');
    expect(fact('mw_early_childhood_mature_year_two').details).toContain(
      'alternatives, not cumulative',
    );
    expect(fact('mw_communication_mature_diploma_placement').details).toContain(
      'Education applicants specifically commence in Year 2',
    );
    expect(fact('mw_mathematics_mature_diploma_content').details).toContain(
      'first-year college mathematics',
    );
  });
  it('does not lower stronger work requirements or promote added advantages to mandates', () => {
    expect(fact('mw_hrm_mature_degree_advantage').status).toBe('considered');
    expect(fact('mw_hrm_mature_qualifications').details).toContain(
      'international examining boards',
    );
    expect(fact('mw_law_enforcement_mature_agency_experience').details).toContain(
      'recognized by the Government of Malawi',
    );
    for (const key of [
      'mw_media_development_mature_work',
      'mw_drama_mature_work',
      'mw_fashion_mature_work',
      'mw_film_mature_work',
    ]) {
      expect(fact(key).status).toBe('required');
      expect(fact(key).details).toContain('four years');
    }
  });
  it('retains four separate music alternatives and their audition/portfolio boundaries', () => {
    const p = profile('mw_music_mature_diploma_option');
    expect(p.requirements).toHaveLength(4);
    expect(p.requirements.every((f) => f.status === 'conditional')).toBe(true);
    expect(fact('mw_music_mature_grade_five_six_credits').details).toContain(
      'does not itself print the two-year',
    );
    expect(fact('mw_music_mature_grade_three_year_two').details).toContain('commencing in Year 2');
    expect(fact('mw_music_mature_diploma_option').details).toContain('not both made compulsory');
    expect(fact('mw_diploma_music_practice_audition_option').details).toContain(
      'does not offer a portfolio',
    );
  });
  it('does not impose the alternative Fine Arts portfolio on every applicant', () => {
    expect(fact('mw_fine_arts_mature_related_diploma').status).toBe('conditional');
    expect(fact('mw_fine_arts_mature_related_diploma').details).toContain(
      'not automatically made compulsory',
    );
    expect(fact('mw_fine_arts_mature_other_diploma_portfolio').details).toContain(
      'portfolio of original work',
    );
    expect(fact('mw_fine_arts_mature_other_diploma_portfolio').details).toContain(
      'Year 2 commencement',
    );
  });
});

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';

const dataset = admissionFactsDatasetSchema.parse(
  JSON.parse(
    await readFile(
      new URL(
        '../../../../data/sources/admissions-facts-lesotho-remaining-20261108.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const facts = dataset.profiles.flatMap((profile) => profile.requirements);
const fact = (suffix: string) => {
  const result = facts.find((row) => row.key === `nul_remaining_${suffix}`);
  if (!result) throw new Error(`Missing reviewed fact ${suffix}`);
  return result;
};
const programme = (key: string) => dataset.programs?.find((row) => row.key === `nul_${key}`);

describe('remaining Lesotho admissions source safeguards', () => {
  it('links named catalogue awards to shared requirements instead of cloning single/double major options', () => {
    expect(dataset.programs).toHaveLength(32);
    expect(
      dataset.programs?.filter((p) => p.name === 'Bachelor of Science in Computer Science'),
    ).toHaveLength(1);
    expect(
      dataset.programs?.filter((p) => p.name === 'Bachelor of Arts in Political Science'),
    ).toHaveLength(1);
    for (const key of ['humanities', 'spiritual', 'philosophy', 'library', 'journalism'])
      expect(programme(key)?.sharedRequirementKeys).toContain('nul_remaining_humanities_school');
    expect(new Set(facts.map((f) => f.details)).size).toBe(facts.length);
  });
  it('keeps Humanities diploma APS32 distinct from degree APS26 and qualifies indirect grade/work connectors', () => {
    expect(fact('humanities_diploma_lgcse').details).toContain('no greater than 32');
    expect(fact('humanities_diploma_cosc').details).toContain('40 or better');
    expect(fact('humanities_diplomas').status).toBe('unknown');
    expect(fact('humanities_evaluation').details).toContain('CHE');
    expect(fact('journalism_diploma_fields').details).toContain('Film Studies');
  });
  it('distinguishes BSc Year1 continuation, Biotechnology Year2 and alternative engineering diplomas', () => {
    for (const key of ['biology', 'chemistry', 'chemtech', 'cs', 'maths', 'physics'])
      expect(programme(key)?.sharedRequirementKeys).toContain(
        'nul_remaining_bsc_first_year_preparation',
      );
    expect(fact('biotech_year_two').details).toContain('Biology and Chemistry Year 2');
    expect(fact('networks_alternatives').details).toContain('Year 2 OR');
    expect(fact('electronics_alternatives').details).toContain('equivalent BSc Year 2');
    expect(fact('environmental_science_alternatives').details).toContain(
      'Water and Environmental Engineering',
    );
  });
  it('keeps English and subject-pool differences attached to their named Science groups', () => {
    expect(fact('science_general_cs_school').details).toContain('English D');
    expect(fact('statistics_systems_school').details).toContain('English C');
    expect(fact('computing_as_science').details).toContain('Computer Science or equivalent');
    expect(programme('general')?.sharedRequirementKeys).not.toContain(
      'nul_remaining_computing_as_science',
    );
    expect(fact('human_geography_school').details).toContain('two other subjects C');
    expect(fact('planning_school').details).toContain('remaining two subjects D');
  });
  it('preserves Commerce alternatives, Economics credit subjects and Social Work placement conflicts', () => {
    expect(fact('commerce_diploma_cas').details).toContain('distinction OR');
    expect(fact('marketing_hrm_external').details).toContain(
      'Accounting and Finance paragraph does not',
    );
    expect(fact('economics_diploma').details).toContain(
      'Quantitative Techniques and Business Statistics',
    );
    expect(fact('social_work_placement_conflict').status).toBe('unknown');
    expect(fact('social_work_placement_conflict').details).toContain('Year 3');
    expect(fact('social_work_placement_conflict').details).toContain('Year 2');
  });
  it('does not erase post-graduation work timing or impose it on every Demography credit holder', () => {
    expect(fact('demography_grade_work').status).toBe('unknown');
    expect(fact('demography_grade_work').details).toContain('AFTER graduating');
    expect(fact('demography_grade_work').details).toContain(
      'do not impose work on every credit holder',
    );
    expect(fact('public_politics_lipam').details).toContain('pass with credit');
  });
  it('models explicit ODL study without promising fully online delivery or inventing a COSC waiver', () => {
    const adult = dataset.profiles.filter((p) => p.programKey === 'nul_adult');
    expect(adult.every((p) => p.deliveryMode === 'distance')).toBe(true);
    expect(fact('adult_degree_direct').details).toContain('face-to-face, print-based and online');
    expect(fact('adult_degree_cosc_conflict').status).toBe('unknown');
    expect(fact('business_degree_direct').details).toContain('Mathematics D');
    expect(fact('business_degree_three_year').details).toContain('pass OR');
  });
  it('does not fill unprinted sixth grades or replace the Mass Communication language condition', () => {
    expect(fact('adult_diploma_lgcse').status).toBe('unknown');
    expect(fact('management_diploma_direct').status).toBe('unknown');
    expect(fact('mass_communication_diploma_direct').details).toContain('English AND Sesotho');
    expect(fact('mass_communication_diploma_direct').details).toContain('remaining two');
    const diploma = dataset.profiles.find((p) =>
      p.requirements.some((f) => f.key === fact('adult_diploma_lgcse').key),
    );
    expect(diploma?.level).toBe('other');
    expect(dataset.programs?.some((p) => p.name.startsWith('Diploma'))).toBe(false);
  });
  it('scopes RPL forms, portfolios and assessment to the actual indirect routes', () => {
    expect(fact('mass_communication_rpl').status).toBe('required');
    expect(fact('mass_communication_work').details).toContain(
      'portfolio of work OR employment contracts',
    );
    expect(fact('management_diploma_indirect').details).toContain('certificate alternative');
    expect(fact('management_diploma_documents').status).toBe('considered');
    const rpl = dataset.profiles.find((p) =>
      p.requirements.some((f) => f.key === fact('mass_communication_rpl').key),
    );
    expect(rpl?.entryType).toBe('other');
    expect(rpl?.deliveryMode).toBe('distance');
  });
  it('retains per-fact official chapter locators and one review date', () => {
    expect(
      facts.every(
        (f) =>
          f.source.url.startsWith('https://nul.ls/') &&
          f.source.checkedOn === '2026-11-08' &&
          f.source.title.includes('printed page'),
      ),
    ).toBe(true);
    expect(new Set(facts.map((f) => f.key)).size).toBe(facts.length);
    expect(facts.some((f) => f.label.toLowerCase().includes('career'))).toBe(false);
  });
});

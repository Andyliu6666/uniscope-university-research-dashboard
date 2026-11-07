import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';

const load = async (name: string) =>
  admissionFactsDatasetSchema.parse(
    JSON.parse(
      await readFile(new URL(`../../../../data/sources/${name}`, import.meta.url), 'utf8'),
    ),
  );
const dataset = await load('admissions-facts-eswatini-distance-20261107.json');
const previous = [
  await load('admissions-facts-eswatini-belize-20261030.json'),
  await load('admissions-facts-eswatini-faculties-20261105.json'),
];
const facts = dataset.profiles.flatMap((p) => p.requirements);
const fact = (key: string) => {
  const f = facts.find((r) => r.key === key);
  if (!f) throw new Error(`Missing reviewed fact: ${key}`);
  return f;
};
describe('reviewed Eswatini distance-route safeguards', () => {
  it('uses a real delivery scope and reuses nine award identities', () => {
    expect(
      dataset.profiles.every(
        (p) => p.deliveryMode === 'distance' && p.intakeTerm === 'unspecified',
      ),
    ).toBe(true);
    const old = previous.flatMap((d) => d.programs ?? []);
    const reused = dataset.programs?.filter((p) => old.some((q) => q.key === p.key)) ?? [];
    expect(reused).toHaveLength(9);
    for (const p of reused) {
      const q = old.find((q) => q.key === p.key);
      expect([p.name, p.level, p.field]).toEqual([q?.name, q?.level, q?.field]);
    }
    expect(
      dataset.programs?.filter((p) => !old.some((q) => q.key === p.key)).map((p) => p.key),
    ).toEqual(['es_nursing_completion']);
  });
  it('keeps certificate/diploma alternatives and unresolved baseline counts distinct', () => {
    expect(fact('es_ide_other_level_general_conflict').status).toBe('unknown');
    expect(fact('es_ide_law_diploma_certificate_options').details).toContain(
      'OR a formal certificate',
    );
    expect(fact('es_ide_portuguese_year_two').details).toContain('including Portuguese');
    expect(fact('es_ide_portuguese_junior_entry').details).toContain(
      'not a Portuguese-subject condition',
    );
    expect(
      dataset.programs?.some(
        (p) => p.name.startsWith('Certificate') || p.name === 'Diploma in Law',
      ),
    ).toBe(false);
  });
  it('does not turn preferred employment/recommendation into mandatory employment for everyone', () => {
    expect(fact('es_ide_psychosocial_preference_reference').status).toBe('considered');
    expect(fact('es_ide_psychosocial_preference_reference').details).toContain(
      'not universal employment eligibility',
    );
    expect(fact('es_ide_psychosocial_qualification_options').details).toContain('OR EGCSE');
  });
  it('preserves mode-specific placement rather than borrowing conventional entitlements', () => {
    expect(fact('es_ide_commerce_diploma_placement').details).toContain('Level 4');
    expect(fact('es_ide_llb_ba_law_senate').details).toContain('Senate-determined placement');
    expect(fact('es_ide_llb_other_degree_level_one').details).toContain('Level 1');
    expect(fact('es_ide_it_prior_degree_level_two').details).toContain('may allow Level 2');
    expect(fact('es_ide_it_diploma').details).toContain('no fixed diploma-entry year');
  });
  it('keeps teacher subject and placement conditions attached to the right specialization', () => {
    expect(fact('es_ide_primary_science_school_options').details).toContain(
      'expressly counts as two',
    );
    expect(fact('es_ide_secondary_science_subjects').details).toContain(
      'does not explicitly repeat',
    );
    expect(fact('es_ide_primary_teacher_placement').details).toContain('Senate review');
    expect(fact('es_ide_secondary_science_teacher_year_two').details).toContain(
      'not extended to promise Level 2',
    );
    expect(fact('es_ide_secondary_business_geography_maths').status).toBe('conditional');
  });
  it('retains the narrower distance IT/CSE pools and mathematics counting restrictions', () => {
    expect(fact('es_ide_it_school_pool').details).toContain(
      'does not include the extra prevocational',
    );
    expect(fact('es_ide_cse_school_pool').details).toContain('cannot count again');
    expect(fact('es_ide_cse_school_pool').details).toContain('not part of this printed IDE list');
    expect(fact('es_ide_cse_gce_pool').details).toContain('no-double-count');
  });
  it('keeps mature aptitude and Nursing Completion requirements in their respective routes', () => {
    expect(fact('es_ide_information_science_mature_aptitude').status).toBe('conditional');
    expect(fact('es_ide_information_science_mature_aptitude').category).toBe('standardized_test');
    expect(fact('es_ide_nursing_completion_diploma').status).toBe('required');
    expect(fact('es_ide_nursing_completion_registration').status).toBe('required');
    expect(fact('es_ide_nursing_completion_registration').details).toContain(
      'Current registration',
    );
    expect(fact('es_ide_degree_mature_framework').details).toContain('not a mature-entry waiver');
  });
  it('does not confuse teaching-subject GPA, all-subject preparation or unavailable French', () => {
    expect(fact('es_ide_pgce_degree_subject_gpa').details).toContain('GPA 2.0 (D grade)');
    expect(fact('es_ide_pgce_degree_subject_gpa').details).toContain(
      'not an invented whole-degree GPA',
    );
    expect(fact('es_ide_pgce_teaching_fields').details).toContain('not every subject');
    expect(fact('es_ide_pgce_teaching_fields').details).toContain(
      'French is printed but marked currently not offered',
    );
    expect(fact('es_ide_degree_credit_count_clarification').status).toBe('unknown');
  });
});

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema } from './admissions-facts-format.js';

const dataset = admissionFactsDatasetSchema.parse(
  JSON.parse(
    await readFile(
      new URL('../../../../data/sources/admissions-facts-ara-uca-20261019.json', import.meta.url),
      'utf8',
    ),
  ),
);
const facts = dataset.profiles.flatMap((p) => p.requirements);
const fact = (key: string) => {
  const item = facts.find((f) => f.key === key);
  if (!item) throw new Error(`Missing reviewed fact ${key}`);
  return item;
};

describe('reviewed Ara and UCA admissions safeguards', () => {
  it('validates a bounded 110-fact batch with no invented programme catalogue', () => {
    expect(dataset.institutions).toHaveLength(2);
    expect(dataset.profiles).toHaveLength(7);
    expect(facts).toHaveLength(110);
    expect(dataset.programs).toBeUndefined();
    expect(dataset.profiles.every((p) => p.programId === null)).toBe(true);
  });
  it('keeps diploma and degree incoming qualification columns separate', () => {
    const diploma = dataset.profiles.find((p) =>
      p.requirements.some((f) => f.key === 'diploma_india'),
    );
    const degree = dataset.profiles.find((p) =>
      p.requirements.some((f) => f.key === 'degree_india'),
    );
    expect(diploma).toMatchObject({
      level: 'non_degree',
      applicantType: 'international',
      academicYear: 'unspecified',
    });
    expect(degree).toMatchObject({
      level: 'undergraduate',
      applicantType: 'international',
      academicYear: 'unspecified',
    });
    expect(fact('diploma_india').details).toContain('55%');
    expect(fact('degree_india').details).toContain('70%');
    expect(fact('degree_tertiary_year_group').details).toContain('Stored once');
    expect(facts.filter((f) => f.key === 'degree_tertiary_year_group')).toHaveLength(1);
  });
  it('does not fill blank cells or treat old SAT/AP wording as a modern numeric mandate', () => {
    expect(facts.some((f) => ['diploma_france', 'diploma_italy'].includes(f.key))).toBe(false);
    expect(fact('degree_usa')).toMatchObject({ status: 'unknown' });
    expect(fact('degree_usa').details).toContain('number/subjects/scores for AP are absent');
    expect(fact('degree_new_caledonia').status).toBe('unknown');
    expect(fact('diploma_papua_new_guinea').status).toBe('unknown');
    expect(facts.some((f) => f.key.startsWith('ib_'))).toBe(false);
  });
  it('preserves the two SAT routes without inventing a composite', () => {
    expect(fact('sat_preparatory_subscores').details).toContain('Mathematics 500');
    expect(fact('sat_preparatory_subscores').details).toContain('Writing 500');
    expect(fact('sat_direct_entry_subscores').details).toContain('Mathematics 600');
    expect(fact('sat_direct_entry_subscores').details).toContain('Writing 550');
    expect(fact('uca_test_supersedes_sat').details).toContain('only the UCA test result');
  });
  it('does not turn considered competitions or scholarship awards into required admission medals', () => {
    expect(fact('academic_achievements_considered').status).toBe('considered');
    expect(fact('extracurricular_evidence_considered').status).toBe('considered');
    expect(fact('academic_achievements_considered').details).toContain('No universal competition');
    expect(
      facts
        .filter((f) => f.status === 'required')
        .some((f) => /Olympiad|medal|prize/u.test(f.details)),
    ).toBe(false);
    expect(fact('ability_to_pay_not_considered').status).toBe('not_considered');
  });
  it('keeps historical 2026 cycle dates distinct from an undated policy or current opening', () => {
    const timed = dataset.profiles.filter(
      (p) => p.institutionKey === 'uca' && p.academicYear === '2026',
    );
    expect(timed.every((p) => p.notes.includes('historical and already past'))).toBe(true);
    expect(fact('stage3_shortlisted_form').details).toContain(
      'without defining whether it is a deadline',
    );
    const financial = dataset.profiles.find((p) =>
      p.requirements.some((f) => f.key === 'ability_to_pay_not_considered'),
    );
    expect(financial?.academicYear).toBe('unspecified');
  });
  it('does not infer nationality or guaranteed invitation from founding-state wording', () => {
    const scope = dataset.profiles.find((p) =>
      p.requirements.some((f) => f.key === 'outside_founding_states_shortlist'),
    );
    expect(scope?.applicantType).toBe('all');
    expect(fact('outside_founding_states_shortlist').details).toContain('does not define');
    expect(fact('outside_founding_states_shortlist').status).toBe('conditional');
    expect(fact('uca_test_fee').status).toBe('conditional');
  });
});

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { admissionFactsDatasetSchema, factScope } from './admissions-facts-format.js';

const dataset = admissionFactsDatasetSchema.parse(
  JSON.parse(
    await readFile(
      new URL(
        '../../../../data/sources/admissions-facts-belize-programmes-20261101.json',
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

describe('reviewed Belize programme eligibility safeguards', () => {
  it('binds the exact institution and individually published programme scopes', () => {
    expect(dataset.institutions).toHaveLength(1);
    expect(dataset.institutions[0]).toMatchObject({ externalId: '00fgcap50', countryCode: 'BZ' });
    expect(dataset.programs).toHaveLength(43);
    expect(facts).toHaveLength(56);
    expect(new Set(dataset.profiles.map(factScope)).size).toBe(46);
    expect(dataset.profiles.every((p) => p.academicYear === 'unspecified')).toBe(true);
    expect(dataset.profiles.every((p) => p.intakeTerm === 'unspecified')).toBe(true);
    expect(facts.every((f) => new URL(f.source.url).hostname === 'ub.edu.bz')).toBe(true);
    expect(facts.every((f) => f.source.checkedOn === '2026-11-01')).toBe(true);
  });
  it('preserves chemistry overall GPA differences and pre-medical versus medicine entry', () => {
    expect(fact('bz_associate_biology_eligibility').details).toContain(
      'cumulative GPA must be at least 2.0',
    );
    expect(fact('bz_associate_chemistry_eligibility').details).toContain(
      'cumulative GPA must be at least 2.5',
    );
    expect(fact('bz_associate_premedical_eligibility').details).toContain(
      'each of Biology, Chemistry, English and Mathematics',
    );
    expect(fact('bz_associate_premedical_eligibility').details).toContain('not an MBBS offer');
    expect(fact('bz_marine_biology_eligibility').details).toContain(
      'Biology and Chemistry each need GPA 3.0',
    );
    expect(fact('bz_associate_it_eligibility').details).toContain('Mathematics requires GPA 3.0');
  });
  it('keeps nursing CXC grades and entry age within the named award', () => {
    expect(fact('bz_nursing_eligibility').details).toContain('Five CXC subjects at grades 1 or 2');
    expect(fact('bz_nursing_age').details).toContain('17 or older');
    expect(scope('bz_nursing_age').programKey).toBe('bz_nursing');
    expect(scope('bz_nursing_age').entryType).toBe('first_year');
    expect(scope('bz_practical_nursing_certificate_age').level).toBe('other');
    expect(fact('bz_practical_nursing_certificate_age').details).toContain(
      'not extended to the other certificates',
    );
  });
  it('does not make favourable engineering/agriculture backgrounds compulsory', () => {
    for (const key of [
      'bz_architectural_technology_background',
      'bz_civil_engineering_technology_background',
      'bz_mechanical_electrical_background',
      'bz_agriculture_background',
    ]) {
      expect(fact(key).status).toBe('considered');
    }
    expect(fact('bz_mechanical_electrical_background').details).toContain('Chemistry');
    expect(fact('bz_architectural_technology_background').details).toContain('Technical Drawing');
  });
  it('separates prior-associate alternatives from school-leaver GPA routes', () => {
    expect(scope('bz_medical_laboratory_science_eligibility').entryType).toBe('first_year');
    expect(scope('bz_medlab_associate_alternative').entryType).toBe('other');
    expect(fact('bz_medlab_associate_alternative').details).toContain('an alternative');
    expect(scope('bz_social_work_associate_alternative').entryType).toBe('other');
    expect(scope('bz_biology_eligibility').entryType).toBe('other');
    expect(fact('bz_primary_education_eligibility').details).toContain(
      'does not list an unrestricted related-field alternative',
    );
    expect(fact('bz_tourism_eligibility').details).toContain('business-related');
  });
  it('preserves associate and certificate awards without inventing bachelor equivalence', () => {
    const associates = dataset.programs?.filter((p) => p.name.startsWith('Associate')) ?? [];
    expect(associates.length).toBeGreaterThan(0);
    for (const p of associates) {
      expect(dataset.profiles.find((s) => s.programKey === p.key)?.notes).toContain(
        'not a bachelor degree',
      );
    }
    const certificates = scope('bz_gis_certificate_prior_award');
    expect(certificates.programKey).toBeUndefined();
    expect(certificates.level).toBe('other');
    expect(certificates.requirements).toHaveLength(6);
    expect(fact('bz_gis_certificate_prior_award').details).toContain(
      'requires an associate degree',
    );
    expect(fact('bz_esl_certificate_prior_award').details).toContain(
      'requires a high-school diploma',
    );
    expect(fact('bz_practical_nursing_certificate_credit_limit').details).toContain(
      'do not transfer to that degree',
    );
  });
  it('retains cohort and delivery restrictions without creating a fictitious intake', () => {
    expect(fact('bz_associate_early_childhood_eligibility').details).toContain(
      'online and part-time only',
    );
    expect(fact('bz_spanish_education_eligibility').details).toContain('Availability is by cohort');
    const cognates = dataset.programs?.filter((p) =>
      p.name.startsWith('Bachelor in Business Education'),
    );
    expect(cognates?.map((p) => p.name)).toEqual([
      'Bachelor in Business Education - Accounting',
      'Bachelor in Business Education - IT',
      'Bachelor in Business Education - Management',
    ]);
  });
  it('does not duplicate shared application documents or fabricate international score conversions', () => {
    expect(facts.some((f) => /essay|recommendation|police record/iu.test(f.label))).toBe(false);
    expect(
      facts.some((f) => /IB\s*(?:minimum|total)|AP\s*(?:score|minimum)/iu.test(f.details)),
    ).toBe(false);
    expect(new Set(facts.map((f) => f.key)).size).toBe(facts.length);
    expect(facts.some((f) => f.source.url.includes('old.ub.edu.bz'))).toBe(false);
  });
});

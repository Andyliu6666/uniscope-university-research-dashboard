import { z } from 'zod';

export const normalizeFactText = (text: string) =>
  text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const text = (max: number) => z.string().trim().min(1).max(max);
const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
}, 'Use an official HTTPS URL without credentials or a fragment.');
const source = z.strictObject({
  url: httpsUrl,
  title: text(200),
  checkedOn: z.iso.date(),
});
const programSchema = z.strictObject({
  key: text(80),
  institutionKey: text(80),
  name: text(160),
  level: z.enum(['undergraduate', 'graduate']),
  field: text(100),
  source,
});
export const admissionFactSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u),
  category: z.enum([
    'academic',
    'application',
    'language',
    'standardized_test',
    'document',
    'experience',
    'portfolio',
    'interview',
    'financial',
    'other',
  ]),
  label: text(200),
  status: z.enum([
    'required',
    'conditional',
    'considered',
    'recommended',
    'optional',
    'not_required',
    'not_considered',
    'unknown',
  ]),
  details: text(6000),
  source,
});
const profileSchema = z.strictObject({
  institutionKey: text(80),
  programId: z.uuid().nullable(),
  programKey: text(80).optional(),
  academicYear: z.string().regex(/^(?:[0-9]{4}(?:[/-][0-9]{2,4})?|unspecified)$/u),
  intakeTerm: text(80),
  entryType: z.enum(['first_year', 'transfer', 'readmission', 'other']),
  level: z.enum(['all', 'undergraduate', 'graduate', 'doctoral', 'non_degree', 'other']),
  applicantType: z.enum(['all', 'domestic', 'international']),
  notes: text(3000),
  requirements: z.array(admissionFactSchema).min(1).max(100),
});
export type AdmissionFact = z.infer<typeof admissionFactSchema>;
export type FactProfile = z.infer<typeof profileSchema>;
export type FactProgram = z.infer<typeof programSchema>;
export const factScope = (profile: FactProfile) =>
  JSON.stringify([
    profile.institutionKey,
    profile.programKey ? ['programKey', profile.programKey] : profile.programId,
    profile.academicYear,
    profile.intakeTerm,
    profile.entryType,
    profile.level,
    profile.applicantType,
  ]);

export const admissionFactsDatasetSchema = z
  .strictObject({
    datasetVersion: text(120),
    reviewedOn: z.iso.date(),
    institutions: z
      .array(
        z.strictObject({
          key: text(80),
          name: text(160),
          provider: z.enum(['ror', 'ipeds', 'tw_moe']),
          externalId: text(255),
          countryCode: z.string().regex(/^[A-Z]{2}$/u),
          officialDomains: z
            .array(z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/u))
            .min(1),
        }),
      )
      .min(1)
      .max(50),
    profiles: z.array(profileSchema).min(1).max(50),
    // No default: adding an empty array would change previously reviewed artifact hashes.
    programs: z.array(programSchema).min(1).max(50).optional(),
  })
  .superRefine((dataset, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (dataset.reviewedOn > new Date().toISOString().slice(0, 10))
      fail('A source review cannot be dated in the future.');
    const schools = new Map(dataset.institutions.map((school) => [school.key, school]));
    if (schools.size !== dataset.institutions.length) fail('Duplicate institution key.');
    const identities = new Set(dataset.institutions.map((s) => `${s.provider}:${s.externalId}`));
    if (identities.size !== dataset.institutions.length) fail('Duplicate institution identity.');
    const checkSource = (evidence: z.infer<typeof source>, institutionKey: string) => {
      const school = schools.get(institutionKey);
      if (!school) {
        fail('Unknown institution key.');
        return;
      }
      const hostname = new URL(evidence.url).hostname;
      if (
        !school.officialDomains.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        )
      )
        fail('Requirement or programme source is outside the reviewed official domains.');
      if (evidence.checkedOn > dataset.reviewedOn)
        fail('Source check is later than dataset review.');
    };
    const programMap = new Map(dataset.programs?.map((program) => [program.key, program]));
    if (programMap.size !== (dataset.programs?.length ?? 0)) fail('Duplicate programme key.');
    const programIdentities = new Set<string>();
    for (const program of dataset.programs ?? []) {
      const identity = JSON.stringify([
        program.institutionKey,
        normalizeFactText(program.name),
        program.level,
      ]);
      if (programIdentities.has(identity)) fail('Duplicate normalized programme identity.');
      programIdentities.add(identity);
      checkSource(program.source, program.institutionKey);
      if (!dataset.profiles.some((profile) => profile.programKey === program.key))
        fail('Every declared programme must have a referenced admissions profile.');
    }
    const scopes = new Set<string>();
    let count = 0;
    for (const profile of dataset.profiles) {
      const school = schools.get(profile.institutionKey);
      if (!school) {
        fail('Unknown institution key.');
        continue;
      }
      if (profile.programKey) {
        const program = programMap.get(profile.programKey);
        if (profile.programId !== null) fail('Use programKey or programId, not both.');
        if (
          !program ||
          program.institutionKey !== profile.institutionKey ||
          program.level !== profile.level
        )
          fail('Programme key must reference the same institution and level.');
      }
      if (scopes.has(factScope(profile)))
        fail('Merge requirements in the same scope into one profile.');
      scopes.add(factScope(profile));
      const keys = new Set<string>();
      const bodies = new Set<string>();
      for (const fact of profile.requirements) {
        count++;
        if (keys.has(fact.key)) fail(`Duplicate fact key in scope: ${fact.key}`);
        keys.add(fact.key);
        const body = normalizeFactText(fact.details);
        if (bodies.has(body)) fail('Repeated requirement text under another key; consolidate it.');
        bodies.add(body);
        checkSource(fact.source, profile.institutionKey);
      }
    }
    if (count > 200) fail('A reviewed batch may contain at most 200 facts.');
  });
export type AdmissionsFactsDataset = z.infer<typeof admissionFactsDatasetSchema>;

/** Keys identify meaning, not pages. Different wording at an existing key needs human review. */
export const chooseExistingFact = <
  T extends {
    requirementKey: string;
    category: string;
    status: string;
    details: string | null;
  },
>(
  incoming: AdmissionFact,
  existing: T[],
): T | undefined => {
  const matches = existing.filter(
    (row) =>
      row.requirementKey === incoming.key ||
      (row.details !== null &&
        normalizeFactText(row.details) === normalizeFactText(incoming.details)),
  );
  if (matches.length > 1)
    throw new Error(`Existing duplicate facts require review: ${incoming.key}`);
  const old = matches[0];
  if (
    old &&
    (old.category !== incoming.category ||
      old.status !== incoming.status ||
      normalizeFactText(old.details ?? '') !== normalizeFactText(incoming.details))
  )
    throw new Error(`Conflicting requirement; review rather than overwrite: ${incoming.key}`);
  return old;
};

import { z } from 'zod';

const httpsUrl = z
  .url()
  .startsWith('https://')
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }, 'Source URLs must not contain credentials.');
const year = z.string().regex(/^(?:20[0-9]{2}|unspecified)$/u);

export const ibRequirementSchema = z
  .strictObject({
    recordKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,95}$/u),
    academicYear: year,
    intakeTerm: z.string().trim().min(1).max(80),
    entryType: z.enum(['first_year', 'transfer', 'readmission', 'other']),
    applicantType: z.enum(['domestic', 'international', 'all']),
    applicantContext: z.string().trim().min(5).max(500),
    status: z.enum([
      'published',
      'not_stated_in_source',
      'no_fixed_minimum',
      'conversion_required',
      'not_applicable',
      'not_accepted',
    ]),
    scoreKind: z
      .enum(['minimum_entry', 'typical_offer', 'contextual_offer', 'guaranteed_entry'])
      .nullable(),
    totalMin: z.number().int().min(1).max(45).nullable(),
    totalMax: z.number().int().min(1).max(45).nullable(),
    scoreScale: z.union([z.literal(45), z.literal(42)]).nullable(),
    includesCorePoints: z.boolean().nullable(),
    hlGrades: z.array(z.number().int().min(1).max(7)).max(4),
    subjectNotes: z.string().trim().max(1800),
    conditions: z.string().trim().min(10).max(2500),
    source: z.strictObject({
      title: z.string().trim().min(5).max(200),
      url: httpsUrl,
      checkedOn: z.iso.date(),
      evidence: z.string().trim().min(5).max(300),
    }),
  })
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.status === 'published') {
      if (value.totalMin === null || value.scoreKind === null || value.scoreScale === null)
        issue('totalMin', 'A published total requires a score, its meaning, and its scale.');
    } else if (
      value.totalMin !== null ||
      value.totalMax !== null ||
      value.scoreKind !== null ||
      value.scoreScale !== null
    ) {
      issue('totalMin', 'Do not invent a total for a non-numeric policy.');
    }
    if (value.totalMax !== null && (value.totalMin === null || value.totalMax < value.totalMin))
      issue('totalMax', 'An offer range must have ordered bounds.');
    if (value.scoreScale !== null && (value.totalMin ?? 0) > value.scoreScale)
      issue('totalMin', 'The score exceeds its scale.');
    if (value.scoreScale !== null && (value.totalMax ?? 0) > value.scoreScale)
      issue('totalMax', 'The score exceeds its scale.');
    if (value.scoreScale === 42 && value.includesCorePoints !== false)
      issue('includesCorePoints', 'A 42-point score excludes core points.');
    if (value.scoreKind === 'contextual_offer' && value.applicantContext.length < 20)
      issue('applicantContext', 'Describe eligibility for a contextual offer.');
    if (value.source.evidence.split(/\s+/u).length > 25)
      issue('source', 'Keep the evidence excerpt to at most 25 words.');
  });

export const ibProgramInputSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  level: z.enum(['undergraduate', 'graduate']),
  field: z.string().trim().min(2).max(100),
  courseCode: z.string().trim().min(1).max(120).nullable(),
  url: httpsUrl,
  existingProgramId: z.uuid().optional(),
});

export const ibDatasetSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    datasetVersion: z.string().trim().min(1).max(120),
    reviewedOn: z.iso.date(),
    institutions: z
      .array(
        z.strictObject({
          key: z.string().regex(/^[a-z0-9-]+$/u),
          name: z.string().trim().min(2),
          provider: z.enum(['ror', 'ipeds', 'tw_moe']),
          externalId: z.string().trim().min(1).max(255),
          countryCode: z.string().regex(/^[A-Z]{2}$/u),
          officialDomains: z.array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/u)).min(1),
        }),
      )
      .min(1),
    records: z
      .array(
        z.strictObject({
          institutionKey: z.string(),
          program: ibProgramInputSchema.nullable(),
          requirement: ibRequirementSchema,
        }),
      )
      .min(1)
      .max(10000),
  })
  .superRefine((dataset, ctx) => {
    if (dataset.reviewedOn > new Date().toISOString().slice(0, 10))
      ctx.addIssue({
        code: 'custom',
        path: ['reviewedOn'],
        message: 'A source review cannot be dated in the future.',
      });
    const keys = new Set<string>();
    const identities = new Set<string>();
    const institutionByKey = new Map(dataset.institutions.map((i) => [i.key, i]));
    if (institutionByKey.size !== dataset.institutions.length)
      ctx.addIssue({
        code: 'custom',
        path: ['institutions'],
        message: 'Duplicate institution key.',
      });
    for (const institution of dataset.institutions) {
      const identity = `${institution.provider}:${institution.externalId}`;
      if (identities.has(identity))
        ctx.addIssue({
          code: 'custom',
          path: ['institutions'],
          message: 'Duplicate official identity.',
        });
      identities.add(identity);
    }
    dataset.records.forEach((record, index) => {
      const institution = institutionByKey.get(record.institutionKey);
      const path = ['records', index];
      const key = `${record.institutionKey}:${record.requirement.recordKey}`;
      if (keys.has(key))
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'Duplicate requirement key within an institution.',
        });
      keys.add(key);
      if (!institution) {
        ctx.addIssue({ code: 'custom', path, message: 'Unknown institution key.' });
        return;
      }
      for (const url of [record.requirement.source.url, record.program?.url].filter(
        (u): u is string => Boolean(u),
      )) {
        const host = new URL(url).hostname;
        if (!institution.officialDomains.some((d) => host === d || host.endsWith(`.${d}`)))
          ctx.addIssue({
            code: 'custom',
            path,
            message: 'The source must be on a reviewed official institution domain.',
          });
      }
      if (record.requirement.source.checkedOn > dataset.reviewedOn)
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'Source check date is after the dataset review date.',
        });
      if (record.program?.level === 'graduate' && record.requirement.status === 'published')
        ctx.addIssue({
          code: 'custom',
          path,
          message:
            'An IB first-degree threshold must not be applied to a postgraduate program. Integrated undergraduate masters use undergraduate level.',
        });
    });
  });

export const ibQuerySchema = z.object({
  year: year.optional(),
  applicantType: z.enum(['domestic', 'international']).optional(),
  entryType: z.enum(['first_year', 'transfer', 'readmission', 'other']).default('first_year'),
  q: z.string().trim().max(100).default(''),
  level: z.enum(['undergraduate', 'graduate']).default('undergraduate'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type IbRequirement = z.infer<typeof ibRequirementSchema>;
export type IbDataset = z.infer<typeof ibDatasetSchema>;
export type IbQuery = z.infer<typeof ibQuerySchema>;
export type IbProgramInput = z.infer<typeof ibProgramInputSchema>;
export interface IbProgram {
  id: string;
  name: string;
  level: 'undergraduate' | 'graduate';
  field: string;
  catalogYear: string | null;
  requirements: IbRequirement[];
}
export interface UniversityIbResponse {
  university: { id: string; name: string; slug: string };
  institutionPolicies: IbRequirement[];
  programs: IbProgram[];
  years: string[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  coverage: {
    catalogPrograms: number;
    programsWithReviewedIb: number;
    programsWithPublishedTotals: number;
  };
}

export const ibStatusLabels: Record<IbRequirement['status'], string> = {
  published: 'Published IB total',
  not_stated_in_source: 'IB total not stated in the reviewed source',
  no_fixed_minimum: 'Officially no fixed IB minimum',
  conversion_required: 'Official qualification conversion required',
  not_applicable: 'IB is not the entry qualification',
  not_accepted: 'IB not accepted for this route',
};
export const ibScoreKindLabels: Record<NonNullable<IbRequirement['scoreKind']>, string> = {
  minimum_entry: 'Minimum entry requirement',
  typical_offer: 'Typical offer',
  contextual_offer: 'Contextual offer — eligibility conditions apply',
  guaranteed_entry: 'Guaranteed entry — all stated conditions must be met',
};
export const formatIbTotal = (value: IbRequirement): string => {
  if (value.status !== 'published' || value.totalMin === null) return ibStatusLabels[value.status];
  const score =
    value.totalMax !== null && value.totalMax !== value.totalMin
      ? `${value.totalMin}–${value.totalMax}`
      : String(value.totalMin);
  return `${score}/${value.scoreScale} · ${value.scoreKind ? ibScoreKindLabels[value.scoreKind] : ''}`;
};

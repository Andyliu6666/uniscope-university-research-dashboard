import { z } from 'zod';

const postgresInteger = z.number().int().min(0).max(2_147_483_647);

export const openAlexResearchRowSchema = z
  .object({
    openAlexId: z.string().regex(/^I[1-9][0-9]*$/u),
    rorId: z.string().regex(/^[a-z0-9]{9}$/u),
    displayName: z.string().trim().min(1).max(500),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/u)
      .nullable(),
    homepageUrl: z.url().nullable(),
    worksCount: postgresInteger,
    citedByCount: postgresInteger,
    twoYearMeanCitedness: z.number().finite().nonnegative().nullable(),
    hIndex: postgresInteger,
    i10Index: postgresInteger,
    status: z.enum(['active', 'inactive', 'withdrawn']),
    sourceUpdatedAt: z.string().min(10).max(40),
  })
  .strict()
  .superRefine((row, context) => {
    if (Number.isNaN(sourceTimestamp(row.sourceUpdatedAt).getTime())) {
      context.addIssue({
        code: 'custom',
        path: ['sourceUpdatedAt'],
        message: 'OpenAlex sourceUpdatedAt must be a valid ISO timestamp.',
      });
    }
  });

export const openAlexResearchManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('openalex'),
    datasetVersion: z.iso.date(),
    artifactFile: z.string().regex(/^[^/]+[.]jsonl$/u),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    artifactRows: z.number().int().positive(),
    sourceUrl: z.url().startsWith('https://api.openalex.org/institutions'),
    sourceRecordCount: z.number().int().positive(),
    retrievedAt: z.iso.datetime(),
    license: z.literal('CC0 1.0'),
    licenseUrl: z.url().startsWith('https://'),
    identityRule: z.literal('Exact ROR ID only; names and domains are never automatic merge keys.'),
  })
  .strict();

export type OpenAlexResearchRow = z.infer<typeof openAlexResearchRowSchema>;
export type OpenAlexResearchManifest = z.infer<typeof openAlexResearchManifestSchema>;

/** OpenAlex emits updated_date without a timezone suffix; it represents UTC. */
export const sourceTimestamp = (value: string) =>
  new Date(/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value) ? value : `${value}Z`);

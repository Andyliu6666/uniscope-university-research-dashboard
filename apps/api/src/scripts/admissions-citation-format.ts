import { createHash } from 'node:crypto';
import { z } from 'zod';
import { admissionFactSchema } from './admissions-facts-format.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const sourceSchema = admissionFactSchema.shape.source.extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const citationRefreshSchema = z
  .strictObject({
    datasetVersion: text(120),
    reviewedOn: z.iso.date(),
    institution: z.strictObject({
      ror: text(20),
      countryCode: z.string().regex(/^[A-Z]{2}$/u),
      officialDomains: z
        .array(z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/u))
        .min(1),
    }),
    // Retirement is allowed only after every remaining reference has been checked.
    retirePreviousSource: z.boolean(),
    canonicalSource: sourceSchema,
    records: z
      .array(
        z.strictObject({
          originalDatasetVersion: text(120),
          programName: text(160).nullable(),
          scope: z.strictObject({
            academicYear: text(20),
            intakeTerm: text(80),
            deliveryMode: text(20),
            entryType: text(20),
            level: text(20),
            applicantType: text(20),
          }),
          fact: admissionFactSchema,
          replacement: sourceSchema,
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((data, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (data.reviewedOn > new Date().toISOString().slice(0, 10)) fail('Future review date.');
    const identities = new Set<string>();
    for (const record of data.records) {
      const identity = JSON.stringify([record.programName, record.scope, record.fact.key]);
      if (identities.has(identity)) fail('Duplicate citation target.');
      identities.add(identity);
      for (const source of [record.fact.source, record.replacement, data.canonicalSource]) {
        const host = new URL(source.url).hostname;
        if (!data.institution.officialDomains.some((d) => host === d || host.endsWith(`.${d}`)))
          fail('Citation outside the reviewed official domains.');
      }
      if (
        record.replacement.checkedOn !== data.reviewedOn ||
        data.canonicalSource.checkedOn !== data.reviewedOn
      )
        fail('Replacement check date differs from the review date.');
      if (record.fact.source.checkedOn > data.reviewedOn)
        fail('Cannot backdate a citation refresh.');
      if (record.replacement.url === record.fact.source.url)
        fail('A replacement must identify a new source URL.');
    }
    if (data.retirePreviousSource && new Set(data.records.map((r) => r.fact.source.url)).size !== 1)
      fail('Source retirement requires one fully reviewed previous URL.');
    if (!data.records.some((r) => r.replacement.url === data.canonicalSource.url))
      fail('Canonical source must support at least one reviewed fact.');
  });
export type CitationRefresh = z.infer<typeof citationRefreshSchema>;
export type CitationRecord = CitationRefresh['records'][number];

export const citationContentHash = (record: CitationRecord) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        record.originalDatasetVersion,
        record.programName,
        record.scope,
        record.fact.key,
        record.fact.category,
        record.fact.label,
        record.fact.status,
        record.fact.details,
      ]),
    )
    .digest('hex');

export function assertCitationContent(
  expected: CitationRecord,
  actual: {
    originalDatasetVersion: unknown;
    programName: string | null;
    scope: CitationRecord['scope'];
    fact: Pick<CitationRecord['fact'], 'key' | 'category' | 'label' | 'status' | 'details'>;
  },
) {
  if (
    JSON.stringify(actual.scope) !== JSON.stringify(expected.scope) ||
    actual.originalDatasetVersion !== expected.originalDatasetVersion ||
    actual.programName !== expected.programName ||
    actual.fact.key !== expected.fact.key ||
    actual.fact.category !== expected.fact.category ||
    actual.fact.label !== expected.fact.label ||
    actual.fact.status !== expected.fact.status ||
    actual.fact.details !== expected.fact.details
  )
    throw new Error(`Citation target content or scope changed: ${expected.fact.key}`);
}

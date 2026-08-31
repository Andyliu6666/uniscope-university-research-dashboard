import { z } from 'zod';

export const programSchema = z.object({
  name: z.string().min(2).max(160),
  level: z.enum(['undergraduate', 'graduate']),
  field: z.string().min(2).max(100),
});

export const deadlineSchema = z.object({
  label: z.string().min(2).max(100),
  date: z.iso.date(),
  applicantType: z.enum(['domestic', 'international', 'all']),
  entryType: z.enum(['first_year', 'transfer', 'readmission', 'other']).default('first_year'),
  academicYear: z
    .string()
    .regex(/^(?:[0-9]{4}(?:[/-][0-9]{2,4})?|unspecified)$/u)
    .default('unspecified'),
});

export const sourceSchema = z.object({
  title: z.string().min(2).max(200),
  url: z.url().startsWith('https://'),
  category: z.enum(['official', 'government', 'independent']),
  publisher: z.string().max(200).nullable().optional(),
  datasetVersion: z.string().max(120).nullable().optional(),
  publishedAt: z.iso.datetime().nullable().optional(),
  verifiedAt: z.iso.datetime(),
});

export const universityInputSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  country: z.string().min(2).max(80),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .nullable()
    .optional(),
  region: z.string().max(120).nullable().optional(),
  city: z.string().min(2).max(80),
  addressLine: z.string().max(500).nullable().optional(),
  postalCode: z.string().max(32).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  website: z.url().startsWith('https://'),
  officialWebsite: z.url().startsWith('https://').nullable().optional(),
  admissionsUrl: z.url().startsWith('https://').nullable().optional(),
  financialAidUrl: z.url().startsWith('https://').nullable().optional(),
  netPriceUrl: z.url().startsWith('https://').nullable().optional(),
  summary: z.string().min(40).max(1000),
  institutionType: z.enum(['public', 'private', 'unknown']),
  ownership: z
    .enum(['public', 'private_nonprofit', 'private_forprofit', 'unknown'])
    .nullable()
    .optional(),
  operatingStatus: z.enum(['active', 'inactive', 'unknown']).nullable().optional(),
  highestAwardLevel: z.string().max(100).nullable().optional(),
  offersUndergraduate: z.boolean().nullable().optional(),
  offersGraduate: z.boolean().nullable().optional(),
  academicCalendar: z.string().max(100).nullable().optional(),
  establishedYear: z.number().int().min(1000).max(2100).nullable().optional(),
  studentCount: z.number().int().positive().nullable(),
  acceptanceRate: z.number().min(0).max(100).nullable(),
  annualTuitionUsd: z.number().int().nonnegative().nullable(),
  ibTypicalMin: z.number().int().min(24).max(45).nullable(),
  featured: z.boolean().default(false),
  programs: z.array(programSchema).default([]),
  deadlines: z.array(deadlineSchema).default([]),
  sources: z.array(sourceSchema).min(1),
});

const costSnapshotSchema = z.object({
  academicYear: z.string(),
  level: z.string(),
  applicantType: z.enum(['domestic', 'international', 'all']),
  residency: z.string(),
  category: z.string(),
  period: z.string(),
  scenario: z.string(),
  amount: z.number(),
  currency: z.string(),
  sourceFlags: z.record(z.string(), z.unknown()),
  source: sourceSchema,
});

export const universitySchema = universityInputSchema.extend({
  id: z.string().uuid(),
  updatedAt: z.iso.datetime(),
  costs: z.array(costSnapshotSchema),
});

export const universityQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  country: z.string().trim().max(80).optional(),
  type: z.enum(['public', 'private', 'unknown']).optional(),
  maxTuition: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(9),
});

export type UniversityInput = z.infer<typeof universityInputSchema>;
export type University = z.infer<typeof universitySchema>;
export type UniversityQuery = z.infer<typeof universityQuerySchema>;

export const admissionsQuerySchema = z.object({
  year: z
    .string()
    .regex(/^(?:[0-9]{4}(?:[/-][0-9]{2,4})?|unspecified)$/u)
    .optional(),
  level: z.enum(['all', 'undergraduate', 'graduate', 'doctoral', 'non_degree', 'other']).optional(),
  applicantType: z.enum(['domestic', 'international', 'all']).optional(),
  entryType: z.enum(['first_year', 'transfer', 'readmission', 'other']).optional(),
});

export type AdmissionsQuery = z.infer<typeof admissionsQuerySchema>;

export interface UniversitySource {
  title: string;
  url: string;
  category: 'official' | 'government' | 'independent';
  publisher?: string | null;
  datasetVersion?: string | null;
  publishedAt?: string | null;
  verifiedAt: string;
}

export interface AdmissionCount {
  metric: 'applicants' | 'admitted' | 'enrolled' | 'waitlisted' | 'waitlist_admitted' | 'other';
  population: string;
  value: number;
  sourceFlags: Record<string, unknown>;
}

export interface AdmissionRequirement {
  category:
    | 'academic'
    | 'application'
    | 'language'
    | 'standardized_test'
    | 'document'
    | 'experience'
    | 'portfolio'
    | 'interview'
    | 'financial'
    | 'other';
  requirementKey: string;
  label: string;
  status:
    | 'required'
    | 'conditional'
    | 'considered'
    | 'recommended'
    | 'optional'
    | 'not_required'
    | 'not_considered'
    | 'unknown';
  details: string | null;
  sourceFlags: Record<string, unknown>;
  verifiedAt: string;
}

export interface AdmissionTestScore {
  testName: string;
  section: string;
  context: 'requirement' | 'admitted_students' | 'enrolled_students';
  submittersCount: number | null;
  submittersPercent: number | null;
  minimumScore: number | null;
  maximumScore: number | null;
  averageScore: number | null;
  percentile25: number | null;
  percentile50: number | null;
  percentile75: number | null;
  scoreScale: string | null;
  sourceFlags: Record<string, unknown>;
}

export interface QualificationRequirement {
  qualificationSystem: string;
  qualificationName: string;
  kind: string;
  subject: string;
  operator: string;
  minimumValue: number | null;
  maximumValue: number | null;
  valueText: string | null;
  scale: string | null;
  notes: string | null;
  sourceFlags: Record<string, unknown>;
}

export interface CostSnapshot {
  academicYear: string;
  level: string;
  applicantType: 'domestic' | 'international' | 'all';
  residency: string;
  category: string;
  period: string;
  scenario: string;
  amount: number;
  currency: string;
  sourceFlags: Record<string, unknown>;
  source: UniversitySource;
}

export interface EnrollmentSnapshot {
  academicYear: string;
  level: string;
  attendanceStatus: 'all' | 'full_time' | 'part_time';
  applicantType: 'domestic' | 'international' | 'all';
  population: string;
  studentCount: number;
  sourceFlags: Record<string, unknown>;
}

export interface FinancialAidSnapshot {
  academicYear: string;
  level: string;
  applicantType: 'domestic' | 'international' | 'all';
  population: string;
  category: string;
  recipientCount: number | null;
  recipientPercent: number | null;
  averageAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  sourceFlags: Record<string, unknown>;
}

export interface AdmissionProfile {
  id: string;
  academicYear: string;
  intakeTerm: string;
  entryType: 'first_year' | 'transfer' | 'readmission' | 'other';
  level: string;
  applicantType: 'domestic' | 'international' | 'all';
  openAdmission: boolean | null;
  applicationUrl: string | null;
  notes: string | null;
  counts: AdmissionCount[];
  requirements: AdmissionRequirement[];
  qualifications: QualificationRequirement[];
  testScores: AdmissionTestScore[];
  source: UniversitySource;
}

export interface UniversityAdmissionsResponse {
  university: { id: string; name: string; slug: string };
  profiles: AdmissionProfile[];
  costs: CostSnapshot[];
  enrollment: EnrollmentSnapshot[];
  financialAid: FinancialAidSnapshot[];
  sources: UniversitySource[];
}

export interface UniversityListResponse {
  items: University[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  countries: string[];
}

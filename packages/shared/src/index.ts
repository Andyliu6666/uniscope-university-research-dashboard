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
});

export const sourceSchema = z.object({
  title: z.string().min(2).max(200),
  url: z.url().startsWith('https://'),
  category: z.enum(['official', 'government', 'independent']),
  verifiedAt: z.iso.datetime(),
});

export const universityInputSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  country: z.string().min(2).max(80),
  city: z.string().min(2).max(80),
  website: z.url().startsWith('https://'),
  summary: z.string().min(40).max(1000),
  institutionType: z.enum(['public', 'private', 'unknown']),
  studentCount: z.number().int().positive().nullable(),
  acceptanceRate: z.number().min(0).max(100).nullable(),
  annualTuitionUsd: z.number().int().nonnegative().nullable(),
  ibTypicalMin: z.number().int().min(24).max(45).nullable(),
  featured: z.boolean().default(false),
  programs: z.array(programSchema).default([]),
  deadlines: z.array(deadlineSchema).default([]),
  sources: z.array(sourceSchema).min(1),
});

export const universitySchema = universityInputSchema.extend({
  id: z.string().uuid(),
  updatedAt: z.iso.datetime(),
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

export interface UniversityListResponse {
  items: University[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  countries: string[];
}

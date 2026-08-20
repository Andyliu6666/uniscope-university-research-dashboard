import {
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const institutionType = pgEnum('institution_type', ['public', 'private']);
export const programLevel = pgEnum('program_level', ['undergraduate', 'graduate']);
export const applicantType = pgEnum('applicant_type', ['domestic', 'international', 'all']);
export const sourceCategory = pgEnum('source_category', ['official', 'government', 'independent']);

export const universities = pgTable('universities', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  slug: varchar('slug', { length: 180 }).notNull().unique(),
  country: varchar('country', { length: 80 }).notNull(),
  city: varchar('city', { length: 80 }).notNull(),
  website: text('website').notNull(),
  summary: text('summary').notNull(),
  institutionType: institutionType('institution_type').notNull(),
  studentCount: integer('student_count'),
  acceptanceRate: numeric('acceptance_rate', { precision: 5, scale: 2 }),
  annualTuitionUsd: integer('annual_tuition_usd'),
  ibTypicalMin: integer('ib_typical_min'),
  featured: boolean('featured').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const programs = pgTable('programs', {
  id: uuid('id').primaryKey().defaultRandom(),
  universityId: uuid('university_id')
    .notNull()
    .references(() => universities.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 160 }).notNull(),
  level: programLevel('level').notNull(),
  field: varchar('field', { length: 100 }).notNull(),
});

export const deadlines = pgTable('deadlines', {
  id: uuid('id').primaryKey().defaultRandom(),
  universityId: uuid('university_id')
    .notNull()
    .references(() => universities.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 100 }).notNull(),
  date: date('date').notNull(),
  applicantType: applicantType('applicant_type').notNull(),
});

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  universityId: uuid('university_id')
    .notNull()
    .references(() => universities.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  url: text('url').notNull(),
  category: sourceCategory('category').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
});

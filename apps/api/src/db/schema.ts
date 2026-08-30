import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const institutionType = pgEnum('institution_type', ['public', 'private', 'unknown']);
export const programLevel = pgEnum('program_level', ['undergraduate', 'graduate']);
export const applicantType = pgEnum('applicant_type', ['domestic', 'international', 'all']);
export const sourceCategory = pgEnum('source_category', ['official', 'government', 'independent']);
export const importRunStatus = pgEnum('import_run_status', [
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

export const universities = pgTable(
  'universities',
  {
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
  },
  (table) => [
    index('universities_country_idx').on(table.country),
    index('universities_type_idx').on(table.institutionType),
    index('universities_name_trgm_idx').using('gin', table.name.op('gin_trgm_ops')),
    index('universities_city_trgm_idx').using('gin', table.city.op('gin_trgm_ops')),
    index('universities_country_trgm_idx').using('gin', table.country.op('gin_trgm_ops')),
  ],
);

export const institutionIdentifiers = pgTable(
  'institution_identifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    sourceModifiedAt: timestamp('source_modified_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('institution_identifiers_provider_external_id_unique').on(
      table.provider,
      table.externalId,
    ),
    index('institution_identifiers_university_id_idx').on(table.universityId),
  ],
);

export const importRuns = pgTable(
  'import_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 40 }).notNull(),
    datasetVersion: varchar('dataset_version', { length: 120 }).notNull(),
    artifactHash: varchar('artifact_hash', { length: 64 }).notNull(),
    status: importRunStatus('status').notNull().default('running'),
    checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>().notNull().default({}),
    processedCount: integer('processed_count').notNull().default(0),
    insertedCount: integer('inserted_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('import_runs_provider_dataset_artifact_unique').on(
      table.provider,
      table.datasetVersion,
      table.artifactHash,
    ),
    index('import_runs_provider_started_at_idx').on(table.provider, table.startedAt),
    index('import_runs_status_idx').on(table.status),
  ],
);

export const importRejections = pgTable(
  'import_rejections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => importRuns.id, { onDelete: 'cascade' }),
    sourceRow: integer('source_row'),
    externalId: varchar('external_id', { length: 255 }),
    reason: text('reason').notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('import_rejections_run_id_idx').on(table.runId)],
);

export const programs = pgTable(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    level: programLevel('level').notNull(),
    field: varchar('field', { length: 100 }).notNull(),
  },
  (table) => [index('programs_university_id_idx').on(table.universityId)],
);

export const deadlines = pgTable(
  'deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 100 }).notNull(),
    date: date('date').notNull(),
    applicantType: applicantType('applicant_type').notNull(),
  },
  (table) => [index('deadlines_university_id_idx').on(table.universityId)],
);

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    url: text('url').notNull(),
    category: sourceCategory('category').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('sources_university_id_idx').on(table.universityId),
    uniqueIndex('sources_university_id_url_unique').on(table.universityId, table.url),
  ],
);

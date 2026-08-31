import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
export const universityOwnership = pgEnum('university_ownership', [
  'public',
  'private_nonprofit',
  'private_forprofit',
  'unknown',
]);
export const operatingStatus = pgEnum('operating_status', ['active', 'inactive', 'unknown']);
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
export const studyLevel = pgEnum('study_level', [
  'all',
  'undergraduate',
  'graduate',
  'doctoral',
  'non_degree',
  'other',
]);
export const admissionEntryType = pgEnum('admission_entry_type', [
  'first_year',
  'transfer',
  'readmission',
  'other',
]);
export const admissionCountMetric = pgEnum('admission_count_metric', [
  'applicants',
  'admitted',
  'enrolled',
  'waitlisted',
  'waitlist_admitted',
  'other',
]);
export const requirementCategory = pgEnum('requirement_category', [
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
]);
export const requirementStatus = pgEnum('requirement_status', [
  'required',
  'conditional',
  'considered',
  'recommended',
  'optional',
  'not_required',
  'not_considered',
  'unknown',
]);
export const qualificationRequirementKind = pgEnum('qualification_requirement_kind', [
  'credential',
  'overall_score',
  'subject_score',
  'grade',
  'coursework',
  'other',
]);
export const requirementOperator = pgEnum('requirement_operator', [
  'minimum',
  'maximum',
  'exact',
  'range',
  'equivalent',
  'descriptive',
]);
export const testScoreContext = pgEnum('test_score_context', [
  'requirement',
  'admitted_students',
  'enrolled_students',
]);
export const attendanceStatus = pgEnum('attendance_status', ['all', 'full_time', 'part_time']);
export const residencyCategory = pgEnum('residency_category', [
  'all',
  'in_district',
  'in_state',
  'out_of_state',
  'domestic',
  'international',
  'other',
]);
export const costCategory = pgEnum('cost_category', [
  'tuition',
  'fees',
  'tuition_and_fees',
  'application_fee',
  'housing',
  'meals',
  'housing_and_meals',
  'books_and_supplies',
  'transportation',
  'personal',
  'total_cost_of_attendance',
  'other',
]);
export const costPeriod = pgEnum('cost_period', [
  'academic_year',
  'per_credit_hour',
  'semester',
  'term',
  'month',
  'one_time',
  'other',
]);
export const financialAidCategory = pgEnum('financial_aid_category', [
  'any_aid',
  'grant_or_scholarship',
  'institutional_grant',
  'government_grant',
  'loan',
  'work_study',
  'other',
]);

export const universities = pgTable(
  'universities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 180 }).notNull().unique(),
    country: varchar('country', { length: 80 }).notNull(),
    countryCode: varchar('country_code', { length: 2 }),
    region: varchar('region', { length: 120 }),
    city: varchar('city', { length: 80 }).notNull(),
    addressLine: text('address_line'),
    postalCode: varchar('postal_code', { length: 32 }),
    phone: varchar('phone', { length: 40 }),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    website: text('website').notNull(),
    officialWebsite: text('official_website'),
    admissionsUrl: text('admissions_url'),
    financialAidUrl: text('financial_aid_url'),
    netPriceUrl: text('net_price_url'),
    summary: text('summary').notNull(),
    institutionType: institutionType('institution_type').notNull(),
    ownership: universityOwnership('ownership'),
    operatingStatus: operatingStatus('operating_status'),
    highestAwardLevel: varchar('highest_award_level', { length: 100 }),
    offersUndergraduate: boolean('offers_undergraduate'),
    offersGraduate: boolean('offers_graduate'),
    academicCalendar: varchar('academic_calendar', { length: 100 }),
    establishedYear: integer('established_year'),
    studentCount: integer('student_count'),
    acceptanceRate: numeric('acceptance_rate', { precision: 5, scale: 2 }),
    annualTuitionUsd: integer('annual_tuition_usd'),
    ibTypicalMin: integer('ib_typical_min'),
    featured: boolean('featured').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('universities_country_idx').on(table.country),
    index('universities_country_code_idx').on(table.countryCode),
    index('universities_type_idx').on(table.institutionType),
    index('universities_ownership_idx').on(table.ownership),
    index('universities_operating_status_idx').on(table.operatingStatus),
    index('universities_name_trgm_idx').using('gin', table.name.op('gin_trgm_ops')),
    index('universities_city_trgm_idx').using('gin', table.city.op('gin_trgm_ops')),
    index('universities_country_trgm_idx').using('gin', table.country.op('gin_trgm_ops')),
    check(
      'universities_country_code_iso_check',
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'universities_latitude_range_check',
      sql`${table.latitude} is null or ${table.latitude} between -90 and 90`,
    ),
    check(
      'universities_longitude_range_check',
      sql`${table.longitude} is null or ${table.longitude} between -180 and 180`,
    ),
    check(
      'universities_established_year_range_check',
      sql`${table.establishedYear} is null or ${table.establishedYear} between 1000 and 2100`,
    ),
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
    entryType: admissionEntryType('entry_type').notNull().default('first_year'),
    academicYear: varchar('academic_year', { length: 20 }).notNull().default('unspecified'),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('deadlines_university_id_idx').on(table.universityId),
    index('deadlines_source_id_idx').on(table.sourceId),
    check(
      'deadlines_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
  ],
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
    publisher: varchar('publisher', { length: 200 }),
    datasetVersion: varchar('dataset_version', { length: 120 }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => importRuns.id, { onDelete: 'set null' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('sources_university_id_idx').on(table.universityId),
    index('sources_import_run_id_idx').on(table.importRunId),
    uniqueIndex('sources_university_id_url_unique').on(table.universityId, table.url),
  ],
);

export const admissionProfiles = pgTable(
  'admission_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
    academicYear: varchar('academic_year', { length: 20 }).notNull(),
    intakeTerm: varchar('intake_term', { length: 80 }).notNull().default('unspecified'),
    entryType: admissionEntryType('entry_type').notNull().default('first_year'),
    level: studyLevel('level').notNull().default('all'),
    applicantType: applicantType('applicant_type').notNull().default('all'),
    openAdmission: boolean('open_admission'),
    applicationUrl: text('application_url'),
    notes: text('notes'),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admission_profiles_institution_scope_unique')
      .on(
        table.universityId,
        table.academicYear,
        table.intakeTerm,
        table.entryType,
        table.level,
        table.applicantType,
      )
      .where(sql`${table.programId} is null`),
    uniqueIndex('admission_profiles_program_scope_unique')
      .on(
        table.universityId,
        table.programId,
        table.academicYear,
        table.intakeTerm,
        table.entryType,
        table.level,
        table.applicantType,
      )
      .where(sql`${table.programId} is not null`),
    index('admission_profiles_university_id_idx').on(table.universityId),
    index('admission_profiles_program_id_idx').on(table.programId),
    index('admission_profiles_source_id_idx').on(table.sourceId),
    check(
      'admission_profiles_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
    check(
      'admission_profiles_academic_year_format_check',
      sql`${table.academicYear} ~ '^[0-9]{4}([/-][0-9]{2,4})?$' or ${table.academicYear} = 'unspecified'`,
    ),
  ],
);

export const admissionCounts = pgTable(
  'admission_counts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    admissionProfileId: uuid('admission_profile_id')
      .notNull()
      .references(() => admissionProfiles.id, { onDelete: 'cascade' }),
    metric: admissionCountMetric('metric').notNull(),
    population: varchar('population', { length: 100 }).notNull().default('all'),
    value: integer('value').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('admission_counts_profile_metric_population_source_unique').on(
      table.admissionProfileId,
      table.metric,
      table.population,
      table.sourceId,
    ),
    index('admission_counts_profile_id_idx').on(table.admissionProfileId),
    index('admission_counts_source_id_idx').on(table.sourceId),
    check('admission_counts_value_nonnegative_check', sql`${table.value} >= 0`),
    check(
      'admission_counts_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
  ],
);

export const admissionRequirements = pgTable(
  'admission_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    admissionProfileId: uuid('admission_profile_id')
      .notNull()
      .references(() => admissionProfiles.id, { onDelete: 'cascade' }),
    category: requirementCategory('category').notNull(),
    requirementKey: varchar('requirement_key', { length: 100 }).notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    status: requirementStatus('status').notNull().default('unknown'),
    details: text('details'),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admission_requirements_profile_key_source_unique').on(
      table.admissionProfileId,
      table.category,
      table.requirementKey,
      table.sourceId,
    ),
    index('admission_requirements_profile_id_idx').on(table.admissionProfileId),
    index('admission_requirements_source_id_idx').on(table.sourceId),
    check(
      'admission_requirements_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
  ],
);

export const qualificationRequirements = pgTable(
  'qualification_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    admissionProfileId: uuid('admission_profile_id')
      .notNull()
      .references(() => admissionProfiles.id, { onDelete: 'cascade' }),
    qualificationSystem: varchar('qualification_system', { length: 100 }).notNull(),
    qualificationName: varchar('qualification_name', { length: 160 }).notNull(),
    kind: qualificationRequirementKind('kind').notNull(),
    subject: varchar('subject', { length: 160 }).notNull().default('overall'),
    operator: requirementOperator('operator').notNull(),
    minimumValue: numeric('minimum_value', { precision: 10, scale: 3 }),
    maximumValue: numeric('maximum_value', { precision: 10, scale: 3 }),
    valueText: text('value_text'),
    scale: varchar('scale', { length: 80 }),
    notes: text('notes'),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('qualification_requirements_scope_source_unique').on(
      table.admissionProfileId,
      table.qualificationSystem,
      table.qualificationName,
      table.kind,
      table.subject,
      table.sourceId,
    ),
    index('qualification_requirements_profile_id_idx').on(table.admissionProfileId),
    index('qualification_requirements_source_id_idx').on(table.sourceId),
    check(
      'qualification_requirements_value_present_check',
      sql`${table.minimumValue} is not null or ${table.maximumValue} is not null or ${table.valueText} is not null`,
    ),
    check(
      'qualification_requirements_range_order_check',
      sql`${table.minimumValue} is null or ${table.maximumValue} is null or ${table.minimumValue} <= ${table.maximumValue}`,
    ),
    check(
      'qualification_requirements_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
  ],
);

export const admissionTestScores = pgTable(
  'admission_test_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    admissionProfileId: uuid('admission_profile_id')
      .notNull()
      .references(() => admissionProfiles.id, { onDelete: 'cascade' }),
    testName: varchar('test_name', { length: 100 }).notNull(),
    section: varchar('section', { length: 100 }).notNull().default('overall'),
    context: testScoreContext('context').notNull(),
    submittersCount: integer('submitters_count'),
    submittersPercent: numeric('submitters_percent', { precision: 5, scale: 2 }),
    minimumScore: numeric('minimum_score', { precision: 10, scale: 3 }),
    maximumScore: numeric('maximum_score', { precision: 10, scale: 3 }),
    averageScore: numeric('average_score', { precision: 10, scale: 3 }),
    percentile25: numeric('percentile_25', { precision: 10, scale: 3 }),
    percentile50: numeric('percentile_50', { precision: 10, scale: 3 }),
    percentile75: numeric('percentile_75', { precision: 10, scale: 3 }),
    scoreScale: varchar('score_scale', { length: 80 }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('admission_test_scores_profile_test_section_context_source_unique').on(
      table.admissionProfileId,
      table.testName,
      table.section,
      table.context,
      table.sourceId,
    ),
    index('admission_test_scores_profile_id_idx').on(table.admissionProfileId),
    index('admission_test_scores_source_id_idx').on(table.sourceId),
    check(
      'admission_test_scores_value_present_check',
      sql`${table.minimumScore} is not null or ${table.maximumScore} is not null or ${table.averageScore} is not null or ${table.percentile25} is not null or ${table.percentile50} is not null or ${table.percentile75} is not null`,
    ),
    check(
      'admission_test_scores_range_order_check',
      sql`${table.minimumScore} is null or ${table.maximumScore} is null or ${table.minimumScore} <= ${table.maximumScore}`,
    ),
    check(
      'admission_test_scores_percentile_order_check',
      sql`${table.percentile25} is null or ${table.percentile75} is null or ${table.percentile25} <= ${table.percentile75}`,
    ),
    check(
      'admission_test_scores_percentile_median_order_check',
      sql`${table.percentile25} is null or ${table.percentile50} is null or ${table.percentile25} <= ${table.percentile50}`,
    ),
    check(
      'admission_test_scores_median_percentile_order_check',
      sql`${table.percentile50} is null or ${table.percentile75} is null or ${table.percentile50} <= ${table.percentile75}`,
    ),
    check(
      'admission_test_scores_values_nonnegative_check',
      sql`coalesce(${table.submittersCount}, 0) >= 0 and coalesce(${table.submittersPercent}, 0) >= 0 and coalesce(${table.submittersPercent}, 0) <= 100 and coalesce(${table.minimumScore}, 0) >= 0 and coalesce(${table.maximumScore}, 0) >= 0 and coalesce(${table.averageScore}, 0) >= 0 and coalesce(${table.percentile25}, 0) >= 0 and coalesce(${table.percentile50}, 0) >= 0 and coalesce(${table.percentile75}, 0) >= 0`,
    ),
    check(
      'admission_test_scores_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
  ],
);

export const enrollmentSnapshots = pgTable(
  'enrollment_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
    academicYear: varchar('academic_year', { length: 20 }).notNull(),
    level: studyLevel('level').notNull().default('all'),
    attendanceStatus: attendanceStatus('attendance_status').notNull().default('all'),
    applicantType: applicantType('applicant_type').notNull().default('all'),
    population: varchar('population', { length: 100 }).notNull().default('all'),
    studentCount: integer('student_count').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('enrollment_snapshots_institution_scope_source_unique')
      .on(
        table.universityId,
        table.academicYear,
        table.level,
        table.attendanceStatus,
        table.applicantType,
        table.population,
        table.sourceId,
      )
      .where(sql`${table.programId} is null`),
    uniqueIndex('enrollment_snapshots_program_scope_source_unique')
      .on(
        table.universityId,
        table.programId,
        table.academicYear,
        table.level,
        table.attendanceStatus,
        table.applicantType,
        table.population,
        table.sourceId,
      )
      .where(sql`${table.programId} is not null`),
    index('enrollment_snapshots_university_id_idx').on(table.universityId),
    index('enrollment_snapshots_program_id_idx').on(table.programId),
    index('enrollment_snapshots_source_id_idx').on(table.sourceId),
    check('enrollment_snapshots_count_nonnegative_check', sql`${table.studentCount} >= 0`),
    check(
      'enrollment_snapshots_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
  ],
);

export const costSnapshots = pgTable(
  'cost_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
    academicYear: varchar('academic_year', { length: 20 }).notNull(),
    level: studyLevel('level').notNull().default('all'),
    applicantType: applicantType('applicant_type').notNull().default('all'),
    residency: residencyCategory('residency').notNull().default('all'),
    category: costCategory('category').notNull(),
    period: costPeriod('period').notNull(),
    scenario: varchar('scenario', { length: 80 }).notNull().default('standard'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('cost_snapshots_institution_scope_source_unique')
      .on(
        table.universityId,
        table.academicYear,
        table.level,
        table.applicantType,
        table.residency,
        table.category,
        table.period,
        table.scenario,
        table.sourceId,
      )
      .where(sql`${table.programId} is null`),
    uniqueIndex('cost_snapshots_program_scope_source_unique')
      .on(
        table.universityId,
        table.programId,
        table.academicYear,
        table.level,
        table.applicantType,
        table.residency,
        table.category,
        table.period,
        table.scenario,
        table.sourceId,
      )
      .where(sql`${table.programId} is not null`),
    index('cost_snapshots_university_id_idx').on(table.universityId),
    index('cost_snapshots_program_id_idx').on(table.programId),
    index('cost_snapshots_source_id_idx').on(table.sourceId),
    check('cost_snapshots_amount_nonnegative_check', sql`${table.amount} >= 0`),
    check('cost_snapshots_currency_iso_check', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'cost_snapshots_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
  ],
);

export const financialAidSnapshots = pgTable(
  'financial_aid_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
    academicYear: varchar('academic_year', { length: 20 }).notNull(),
    level: studyLevel('level').notNull().default('all'),
    applicantType: applicantType('applicant_type').notNull().default('all'),
    population: varchar('population', { length: 100 }).notNull().default('all'),
    category: financialAidCategory('category').notNull(),
    recipientCount: integer('recipient_count'),
    recipientPercent: numeric('recipient_percent', { precision: 5, scale: 2 }),
    averageAmount: numeric('average_amount', { precision: 14, scale: 2 }),
    totalAmount: numeric('total_amount', { precision: 16, scale: 2 }),
    currency: varchar('currency', { length: 3 }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceFlags: jsonb('source_flags').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('financial_aid_snapshots_institution_scope_source_unique')
      .on(
        table.universityId,
        table.academicYear,
        table.level,
        table.applicantType,
        table.population,
        table.category,
        table.sourceId,
      )
      .where(sql`${table.programId} is null`),
    uniqueIndex('financial_aid_snapshots_program_scope_source_unique')
      .on(
        table.universityId,
        table.programId,
        table.academicYear,
        table.level,
        table.applicantType,
        table.population,
        table.category,
        table.sourceId,
      )
      .where(sql`${table.programId} is not null`),
    index('financial_aid_snapshots_university_id_idx').on(table.universityId),
    index('financial_aid_snapshots_program_id_idx').on(table.programId),
    index('financial_aid_snapshots_source_id_idx').on(table.sourceId),
    check(
      'financial_aid_snapshots_value_present_check',
      sql`${table.recipientCount} is not null or ${table.recipientPercent} is not null or ${table.averageAmount} is not null or ${table.totalAmount} is not null`,
    ),
    check(
      'financial_aid_snapshots_values_nonnegative_check',
      sql`coalesce(${table.recipientCount}, 0) >= 0 and coalesce(${table.recipientPercent}, 0) >= 0 and coalesce(${table.averageAmount}, 0) >= 0 and coalesce(${table.totalAmount}, 0) >= 0`,
    ),
    check(
      'financial_aid_snapshots_percent_range_check',
      sql`${table.recipientPercent} is null or ${table.recipientPercent} <= 100`,
    ),
    check(
      'financial_aid_snapshots_currency_dependency_check',
      sql`(${table.averageAmount} is null and ${table.totalAmount} is null) or ${table.currency} is not null`,
    ),
    check(
      'financial_aid_snapshots_currency_iso_check',
      sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      'financial_aid_snapshots_source_flags_object_check',
      sql`jsonb_typeof(${table.sourceFlags}) = 'object'`,
    ),
  ],
);

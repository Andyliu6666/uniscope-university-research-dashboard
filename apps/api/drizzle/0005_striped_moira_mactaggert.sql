CREATE TYPE "public"."admission_count_metric" AS ENUM('applicants', 'admitted', 'enrolled', 'waitlisted', 'waitlist_admitted', 'other');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('all', 'full_time', 'part_time');--> statement-breakpoint
CREATE TYPE "public"."cost_category" AS ENUM('tuition', 'fees', 'tuition_and_fees', 'housing', 'meals', 'books_and_supplies', 'transportation', 'personal', 'total_cost_of_attendance', 'other');--> statement-breakpoint
CREATE TYPE "public"."cost_period" AS ENUM('academic_year', 'semester', 'term', 'month', 'one_time', 'other');--> statement-breakpoint
CREATE TYPE "public"."financial_aid_category" AS ENUM('any_aid', 'grant_or_scholarship', 'institutional_grant', 'government_grant', 'loan', 'work_study', 'other');--> statement-breakpoint
CREATE TYPE "public"."operating_status" AS ENUM('active', 'inactive', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."qualification_requirement_kind" AS ENUM('credential', 'overall_score', 'subject_score', 'grade', 'coursework', 'other');--> statement-breakpoint
CREATE TYPE "public"."requirement_category" AS ENUM('academic', 'application', 'language', 'standardized_test', 'document', 'experience', 'portfolio', 'interview', 'financial', 'other');--> statement-breakpoint
CREATE TYPE "public"."requirement_operator" AS ENUM('minimum', 'maximum', 'exact', 'range', 'equivalent', 'descriptive');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('required', 'conditional', 'recommended', 'optional', 'not_required', 'not_considered', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."residency_category" AS ENUM('all', 'in_state', 'out_of_state', 'domestic', 'international', 'other');--> statement-breakpoint
CREATE TYPE "public"."study_level" AS ENUM('all', 'undergraduate', 'graduate', 'doctoral', 'non_degree', 'other');--> statement-breakpoint
CREATE TYPE "public"."test_score_context" AS ENUM('requirement', 'admitted_students', 'enrolled_students');--> statement-breakpoint
CREATE TYPE "public"."university_ownership" AS ENUM('public', 'private_nonprofit', 'private_forprofit', 'unknown');--> statement-breakpoint
CREATE TABLE "admission_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_profile_id" uuid NOT NULL,
	"metric" "admission_count_metric" NOT NULL,
	"population" varchar(100) DEFAULT 'all' NOT NULL,
	"value" integer NOT NULL,
	"source_id" uuid NOT NULL,
	"source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "admission_counts_value_nonnegative_check" CHECK ("admission_counts"."value" >= 0),
	CONSTRAINT "admission_counts_source_flags_object_check" CHECK (jsonb_typeof("admission_counts"."source_flags") = 'object')
);
--> statement-breakpoint
CREATE TABLE "admission_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"program_id" uuid,
	"academic_year" varchar(20) NOT NULL,
	"intake_term" varchar(80) DEFAULT 'unspecified' NOT NULL,
	"level" "study_level" DEFAULT 'all' NOT NULL,
	"applicant_type" "applicant_type" DEFAULT 'all' NOT NULL,
	"application_url" text,
	"notes" text,
	"source_id" uuid NOT NULL,
	"source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_profiles_source_flags_object_check" CHECK (jsonb_typeof("admission_profiles"."source_flags") = 'object')
);
--> statement-breakpoint
CREATE TABLE "admission_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_profile_id" uuid NOT NULL,
	"category" "requirement_category" NOT NULL,
	"requirement_key" varchar(100) NOT NULL,
	"status" "requirement_status" DEFAULT 'unknown' NOT NULL,
	"details" text,
	"source_id" uuid NOT NULL,
	"source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "admission_requirements_source_flags_object_check" CHECK (jsonb_typeof("admission_requirements"."source_flags") = 'object')
);
--> statement-breakpoint
CREATE TABLE "admission_test_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_profile_id" uuid NOT NULL,
	"test_name" varchar(100) NOT NULL,
	"section" varchar(100) DEFAULT 'overall' NOT NULL,
	"context" "test_score_context" NOT NULL,
	"minimum_score" numeric(10, 3),
	"maximum_score" numeric(10, 3),
	"average_score" numeric(10, 3),
	"percentile_25" numeric(10, 3),
	"percentile_75" numeric(10, 3),
	"score_scale" varchar(80),
	"source_id" uuid NOT NULL,
	"source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "admission_test_scores_value_present_check" CHECK ("admission_test_scores"."minimum_score" is not null or "admission_test_scores"."maximum_score" is not null or "admission_test_scores"."average_score" is not null or "admission_test_scores"."percentile_25" is not null or "admission_test_scores"."percentile_75" is not null),
	CONSTRAINT "admission_test_scores_range_order_check" CHECK ("admission_test_scores"."minimum_score" is null or "admission_test_scores"."maximum_score" is null or "admission_test_scores"."minimum_score" <= "admission_test_scores"."maximum_score"),
	CONSTRAINT "admission_test_scores_percentile_order_check" CHECK ("admission_test_scores"."percentile_25" is null or "admission_test_scores"."percentile_75" is null or "admission_test_scores"."percentile_25" <= "admission_test_scores"."percentile_75"),
	CONSTRAINT "admission_test_scores_values_nonnegative_check" CHECK (coalesce("admission_test_scores"."minimum_score", 0) >= 0 and coalesce("admission_test_scores"."maximum_score", 0) >= 0 and coalesce("admission_test_scores"."average_score", 0) >= 0 and coalesce("admission_test_scores"."percentile_25", 0) >= 0 and coalesce("admission_test_scores"."percentile_75", 0) >= 0),
	CONSTRAINT "admission_test_scores_source_flags_object_check" CHECK (jsonb_typeof("admission_test_scores"."source_flags") = 'object')
);
--> statement-breakpoint
CREATE TABLE "cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"program_id" uuid,
	"academic_year" varchar(20) NOT NULL,
	"level" "study_level" DEFAULT 'all' NOT NULL,
	"applicant_type" "applicant_type" DEFAULT 'all' NOT NULL,
	"residency" "residency_category" DEFAULT 'all' NOT NULL,
	"category" "cost_category" NOT NULL,
	"period" "cost_period" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"source_id" uuid NOT NULL,
	"source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "cost_snapshots_amount_nonnegative_check" CHECK ("cost_snapshots"."amount" >= 0),
	CONSTRAINT "cost_snapshots_currency_iso_check" CHECK ("cost_snapshots"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cost_snapshots_source_flags_object_check" CHECK (jsonb_typeof("cost_snapshots"."source_flags") = 'object')
);
--> statement-breakpoint
CREATE TABLE "enrollment_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"program_id" uuid,
	"academic_year" varchar(20) NOT NULL,
	"level" "study_level" DEFAULT 'all' NOT NULL,
	"attendance_status" "attendance_status" DEFAULT 'all' NOT NULL,
	"applicant_type" "applicant_type" DEFAULT 'all' NOT NULL,
	"population" varchar(100) DEFAULT 'all' NOT NULL,
	"student_count" integer NOT NULL,
	"source_id" uuid NOT NULL,
	"source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "enrollment_snapshots_count_nonnegative_check" CHECK ("enrollment_snapshots"."student_count" >= 0),
	CONSTRAINT "enrollment_snapshots_source_flags_object_check" CHECK (jsonb_typeof("enrollment_snapshots"."source_flags") = 'object')
);
--> statement-breakpoint
CREATE TABLE "financial_aid_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"program_id" uuid,
	"academic_year" varchar(20) NOT NULL,
	"level" "study_level" DEFAULT 'all' NOT NULL,
	"applicant_type" "applicant_type" DEFAULT 'all' NOT NULL,
	"population" varchar(100) DEFAULT 'all' NOT NULL,
	"category" "financial_aid_category" NOT NULL,
	"recipient_count" integer,
	"recipient_percent" numeric(5, 2),
	"average_amount" numeric(14, 2),
	"total_amount" numeric(16, 2),
	"currency" varchar(3),
	"source_id" uuid NOT NULL,
	"source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "financial_aid_snapshots_value_present_check" CHECK ("financial_aid_snapshots"."recipient_count" is not null or "financial_aid_snapshots"."recipient_percent" is not null or "financial_aid_snapshots"."average_amount" is not null or "financial_aid_snapshots"."total_amount" is not null),
	CONSTRAINT "financial_aid_snapshots_values_nonnegative_check" CHECK (coalesce("financial_aid_snapshots"."recipient_count", 0) >= 0 and coalesce("financial_aid_snapshots"."recipient_percent", 0) >= 0 and coalesce("financial_aid_snapshots"."average_amount", 0) >= 0 and coalesce("financial_aid_snapshots"."total_amount", 0) >= 0),
	CONSTRAINT "financial_aid_snapshots_percent_range_check" CHECK ("financial_aid_snapshots"."recipient_percent" is null or "financial_aid_snapshots"."recipient_percent" <= 100),
	CONSTRAINT "financial_aid_snapshots_currency_dependency_check" CHECK (("financial_aid_snapshots"."average_amount" is null and "financial_aid_snapshots"."total_amount" is null) or "financial_aid_snapshots"."currency" is not null),
	CONSTRAINT "financial_aid_snapshots_currency_iso_check" CHECK ("financial_aid_snapshots"."currency" is null or "financial_aid_snapshots"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "financial_aid_snapshots_source_flags_object_check" CHECK (jsonb_typeof("financial_aid_snapshots"."source_flags") = 'object')
);
--> statement-breakpoint
CREATE TABLE "qualification_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_profile_id" uuid NOT NULL,
	"qualification_system" varchar(100) NOT NULL,
	"qualification_name" varchar(160) NOT NULL,
	"kind" "qualification_requirement_kind" NOT NULL,
	"subject" varchar(160) DEFAULT 'overall' NOT NULL,
	"operator" "requirement_operator" NOT NULL,
	"minimum_value" numeric(10, 3),
	"maximum_value" numeric(10, 3),
	"value_text" text,
	"scale" varchar(80),
	"notes" text,
	"source_id" uuid NOT NULL,
	"source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "qualification_requirements_value_present_check" CHECK ("qualification_requirements"."minimum_value" is not null or "qualification_requirements"."maximum_value" is not null or "qualification_requirements"."value_text" is not null),
	CONSTRAINT "qualification_requirements_range_order_check" CHECK ("qualification_requirements"."minimum_value" is null or "qualification_requirements"."maximum_value" is null or "qualification_requirements"."minimum_value" <= "qualification_requirements"."maximum_value"),
	CONSTRAINT "qualification_requirements_source_flags_object_check" CHECK (jsonb_typeof("qualification_requirements"."source_flags") = 'object')
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "publisher" varchar(200);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "dataset_version" varchar(120);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "import_run_id" uuid;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "country_code" varchar(2);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "region" varchar(120);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "postal_code" varchar(32);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "phone" varchar(40);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "official_website" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "admissions_url" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "financial_aid_url" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "net_price_url" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "ownership" "university_ownership";--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "operating_status" "operating_status";--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "highest_award_level" varchar(100);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "offers_undergraduate" boolean;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "offers_graduate" boolean;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "academic_calendar" varchar(100);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "established_year" integer;--> statement-breakpoint
ALTER TABLE "admission_counts" ADD CONSTRAINT "admission_counts_admission_profile_id_admission_profiles_id_fk" FOREIGN KEY ("admission_profile_id") REFERENCES "public"."admission_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_counts" ADD CONSTRAINT "admission_counts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_profiles" ADD CONSTRAINT "admission_profiles_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_profiles" ADD CONSTRAINT "admission_profiles_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_profiles" ADD CONSTRAINT "admission_profiles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_requirements" ADD CONSTRAINT "admission_requirements_admission_profile_id_admission_profiles_id_fk" FOREIGN KEY ("admission_profile_id") REFERENCES "public"."admission_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_requirements" ADD CONSTRAINT "admission_requirements_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_test_scores" ADD CONSTRAINT "admission_test_scores_admission_profile_id_admission_profiles_id_fk" FOREIGN KEY ("admission_profile_id") REFERENCES "public"."admission_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_test_scores" ADD CONSTRAINT "admission_test_scores_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_snapshots" ADD CONSTRAINT "cost_snapshots_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_snapshots" ADD CONSTRAINT "cost_snapshots_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_snapshots" ADD CONSTRAINT "cost_snapshots_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_snapshots" ADD CONSTRAINT "enrollment_snapshots_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_snapshots" ADD CONSTRAINT "enrollment_snapshots_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_snapshots" ADD CONSTRAINT "enrollment_snapshots_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_aid_snapshots" ADD CONSTRAINT "financial_aid_snapshots_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_aid_snapshots" ADD CONSTRAINT "financial_aid_snapshots_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_aid_snapshots" ADD CONSTRAINT "financial_aid_snapshots_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_admission_profile_id_admission_profiles_id_fk" FOREIGN KEY ("admission_profile_id") REFERENCES "public"."admission_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_counts_profile_metric_population_source_unique" ON "admission_counts" USING btree ("admission_profile_id","metric","population","source_id");--> statement-breakpoint
CREATE INDEX "admission_counts_profile_id_idx" ON "admission_counts" USING btree ("admission_profile_id");--> statement-breakpoint
CREATE INDEX "admission_counts_source_id_idx" ON "admission_counts" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_profiles_institution_scope_unique" ON "admission_profiles" USING btree ("university_id","academic_year","intake_term","level","applicant_type") WHERE "admission_profiles"."program_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_profiles_program_scope_unique" ON "admission_profiles" USING btree ("university_id","program_id","academic_year","intake_term","level","applicant_type") WHERE "admission_profiles"."program_id" is not null;--> statement-breakpoint
CREATE INDEX "admission_profiles_university_id_idx" ON "admission_profiles" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "admission_profiles_program_id_idx" ON "admission_profiles" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "admission_profiles_source_id_idx" ON "admission_profiles" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_requirements_profile_key_source_unique" ON "admission_requirements" USING btree ("admission_profile_id","category","requirement_key","source_id");--> statement-breakpoint
CREATE INDEX "admission_requirements_profile_id_idx" ON "admission_requirements" USING btree ("admission_profile_id");--> statement-breakpoint
CREATE INDEX "admission_requirements_source_id_idx" ON "admission_requirements" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_test_scores_profile_test_section_context_source_unique" ON "admission_test_scores" USING btree ("admission_profile_id","test_name","section","context","source_id");--> statement-breakpoint
CREATE INDEX "admission_test_scores_profile_id_idx" ON "admission_test_scores" USING btree ("admission_profile_id");--> statement-breakpoint
CREATE INDEX "admission_test_scores_source_id_idx" ON "admission_test_scores" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_snapshots_institution_scope_source_unique" ON "cost_snapshots" USING btree ("university_id","academic_year","level","applicant_type","residency","category","period","source_id") WHERE "cost_snapshots"."program_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_snapshots_program_scope_source_unique" ON "cost_snapshots" USING btree ("university_id","program_id","academic_year","level","applicant_type","residency","category","period","source_id") WHERE "cost_snapshots"."program_id" is not null;--> statement-breakpoint
CREATE INDEX "cost_snapshots_university_id_idx" ON "cost_snapshots" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "cost_snapshots_program_id_idx" ON "cost_snapshots" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "cost_snapshots_source_id_idx" ON "cost_snapshots" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_snapshots_institution_scope_source_unique" ON "enrollment_snapshots" USING btree ("university_id","academic_year","level","attendance_status","applicant_type","population","source_id") WHERE "enrollment_snapshots"."program_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_snapshots_program_scope_source_unique" ON "enrollment_snapshots" USING btree ("university_id","program_id","academic_year","level","attendance_status","applicant_type","population","source_id") WHERE "enrollment_snapshots"."program_id" is not null;--> statement-breakpoint
CREATE INDEX "enrollment_snapshots_university_id_idx" ON "enrollment_snapshots" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "enrollment_snapshots_program_id_idx" ON "enrollment_snapshots" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "enrollment_snapshots_source_id_idx" ON "enrollment_snapshots" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_aid_snapshots_institution_scope_source_unique" ON "financial_aid_snapshots" USING btree ("university_id","academic_year","level","applicant_type","population","category","source_id") WHERE "financial_aid_snapshots"."program_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_aid_snapshots_program_scope_source_unique" ON "financial_aid_snapshots" USING btree ("university_id","program_id","academic_year","level","applicant_type","population","category","source_id") WHERE "financial_aid_snapshots"."program_id" is not null;--> statement-breakpoint
CREATE INDEX "financial_aid_snapshots_university_id_idx" ON "financial_aid_snapshots" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "financial_aid_snapshots_program_id_idx" ON "financial_aid_snapshots" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "financial_aid_snapshots_source_id_idx" ON "financial_aid_snapshots" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_requirements_scope_source_unique" ON "qualification_requirements" USING btree ("admission_profile_id","qualification_system","qualification_name","kind","subject","source_id");--> statement-breakpoint
CREATE INDEX "qualification_requirements_profile_id_idx" ON "qualification_requirements" USING btree ("admission_profile_id");--> statement-breakpoint
CREATE INDEX "qualification_requirements_source_id_idx" ON "qualification_requirements" USING btree ("source_id");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sources_import_run_id_idx" ON "sources" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "universities_country_code_idx" ON "universities" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "universities_ownership_idx" ON "universities" USING btree ("ownership");--> statement-breakpoint
CREATE INDEX "universities_operating_status_idx" ON "universities" USING btree ("operating_status");--> statement-breakpoint
ALTER TABLE "universities" ADD CONSTRAINT "universities_country_code_iso_check" CHECK ("universities"."country_code" is null or "universities"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "universities" ADD CONSTRAINT "universities_latitude_range_check" CHECK ("universities"."latitude" is null or "universities"."latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "universities" ADD CONSTRAINT "universities_longitude_range_check" CHECK ("universities"."longitude" is null or "universities"."longitude" between -180 and 180);--> statement-breakpoint
ALTER TABLE "universities" ADD CONSTRAINT "universities_established_year_range_check" CHECK ("universities"."established_year" is null or "universities"."established_year" between 1000 and 2100);
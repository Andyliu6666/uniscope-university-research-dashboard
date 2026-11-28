CREATE TYPE "public"."admission_entry_type" AS ENUM('first_year', 'transfer', 'readmission', 'other');--> statement-breakpoint
ALTER TABLE "admission_test_scores" DROP CONSTRAINT "admission_test_scores_value_present_check";--> statement-breakpoint
ALTER TABLE "admission_test_scores" DROP CONSTRAINT "admission_test_scores_values_nonnegative_check";--> statement-breakpoint
DROP INDEX "admission_profiles_institution_scope_unique";--> statement-breakpoint
DROP INDEX "admission_profiles_program_scope_unique";--> statement-breakpoint
ALTER TABLE "admission_profiles" ADD COLUMN "entry_type" "admission_entry_type" DEFAULT 'first_year' NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_profiles" ADD COLUMN "open_admission" boolean;--> statement-breakpoint
ALTER TABLE "admission_requirements" ADD COLUMN "label" varchar(200) NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_requirements" ADD COLUMN "verified_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_test_scores" ADD COLUMN "percentile_50" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "entry_type" "admission_entry_type" DEFAULT 'first_year' NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "academic_year" varchar(20) DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadlines_source_id_idx" ON "deadlines" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_profiles_institution_scope_unique" ON "admission_profiles" USING btree ("university_id","academic_year","intake_term","entry_type","level","applicant_type") WHERE "admission_profiles"."program_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_profiles_program_scope_unique" ON "admission_profiles" USING btree ("university_id","program_id","academic_year","intake_term","entry_type","level","applicant_type") WHERE "admission_profiles"."program_id" is not null;--> statement-breakpoint
ALTER TABLE "admission_profiles" ADD CONSTRAINT "admission_profiles_academic_year_format_check" CHECK ("admission_profiles"."academic_year" ~ '^[0-9]{4}([/-][0-9]{2,4})?$' or "admission_profiles"."academic_year" = 'unspecified');--> statement-breakpoint
ALTER TABLE "admission_test_scores" ADD CONSTRAINT "admission_test_scores_percentile_median_order_check" CHECK ("admission_test_scores"."percentile_25" is null or "admission_test_scores"."percentile_50" is null or "admission_test_scores"."percentile_25" <= "admission_test_scores"."percentile_50");--> statement-breakpoint
ALTER TABLE "admission_test_scores" ADD CONSTRAINT "admission_test_scores_median_percentile_order_check" CHECK ("admission_test_scores"."percentile_50" is null or "admission_test_scores"."percentile_75" is null or "admission_test_scores"."percentile_50" <= "admission_test_scores"."percentile_75");--> statement-breakpoint
ALTER TABLE "admission_test_scores" ADD CONSTRAINT "admission_test_scores_value_present_check" CHECK ("admission_test_scores"."minimum_score" is not null or "admission_test_scores"."maximum_score" is not null or "admission_test_scores"."average_score" is not null or "admission_test_scores"."percentile_25" is not null or "admission_test_scores"."percentile_50" is not null or "admission_test_scores"."percentile_75" is not null);--> statement-breakpoint
ALTER TABLE "admission_test_scores" ADD CONSTRAINT "admission_test_scores_values_nonnegative_check" CHECK (coalesce("admission_test_scores"."minimum_score", 0) >= 0 and coalesce("admission_test_scores"."maximum_score", 0) >= 0 and coalesce("admission_test_scores"."average_score", 0) >= 0 and coalesce("admission_test_scores"."percentile_25", 0) >= 0 and coalesce("admission_test_scores"."percentile_50", 0) >= 0 and coalesce("admission_test_scores"."percentile_75", 0) >= 0);--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_source_flags_object_check" CHECK (jsonb_typeof("deadlines"."source_flags") = 'object');
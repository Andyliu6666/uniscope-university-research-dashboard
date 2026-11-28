ALTER TYPE "public"."cost_category" ADD VALUE 'application_fee' BEFORE 'housing';--> statement-breakpoint
ALTER TYPE "public"."cost_category" ADD VALUE 'housing_and_meals' BEFORE 'books_and_supplies';--> statement-breakpoint
ALTER TYPE "public"."cost_period" ADD VALUE 'per_credit_hour' BEFORE 'semester';--> statement-breakpoint
ALTER TYPE "public"."residency_category" ADD VALUE 'in_district' BEFORE 'in_state';--> statement-breakpoint
DROP INDEX "cost_snapshots_institution_scope_source_unique";--> statement-breakpoint
DROP INDEX "cost_snapshots_program_scope_source_unique";--> statement-breakpoint
ALTER TABLE "cost_snapshots" ADD COLUMN "scenario" varchar(80) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_snapshots_institution_scope_source_unique" ON "cost_snapshots" USING btree ("university_id","academic_year","level","applicant_type","residency","category","period","scenario","source_id") WHERE "cost_snapshots"."program_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_snapshots_program_scope_source_unique" ON "cost_snapshots" USING btree ("university_id","program_id","academic_year","level","applicant_type","residency","category","period","scenario","source_id") WHERE "cost_snapshots"."program_id" is not null;
CREATE TYPE "public"."admission_delivery_mode" AS ENUM('unspecified', 'campus', 'distance', 'hybrid');--> statement-breakpoint
DROP INDEX "admission_profiles_institution_scope_unique";--> statement-breakpoint
DROP INDEX "admission_profiles_program_scope_unique";--> statement-breakpoint
ALTER TABLE "admission_profiles" ADD COLUMN "delivery_mode" "admission_delivery_mode" DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_profiles_institution_scope_unique" ON "admission_profiles" USING btree ("university_id","academic_year","intake_term","delivery_mode","entry_type","level","applicant_type") WHERE "admission_profiles"."program_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_profiles_program_scope_unique" ON "admission_profiles" USING btree ("university_id","program_id","academic_year","intake_term","delivery_mode","entry_type","level","applicant_type") WHERE "admission_profiles"."program_id" is not null;
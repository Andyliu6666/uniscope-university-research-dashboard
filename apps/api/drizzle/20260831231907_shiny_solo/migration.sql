CREATE INDEX "institution_aliases_name_trgm_idx" ON "institution_aliases" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "universities" DROP CONSTRAINT IF EXISTS "universities_established_year_range_check";--> statement-breakpoint
ALTER TABLE "universities" ADD CONSTRAINT "universities_established_year_range_check" CHECK ("universities"."established_year" is null or "universities"."established_year" between 1 and 2100);

ALTER TABLE "programs" ADD COLUMN "academic_year" varchar(20);--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "source_provider" varchar(80);--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "source_external_id" varchar(255);--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "source_flags" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "programs" AS "program"
SET "source_id" = "source"."id"
FROM "sources" AS "source"
WHERE "program"."source_id" IS NULL
  AND "program"."university_id" = "source"."university_id"
  AND "program"."field" LIKE 'CIP %'
  AND "source"."url" = 'https://nces.ed.gov/ipeds/datacenter/data/C2024_A.zip';--> statement-breakpoint
CREATE INDEX "programs_source_id_idx" ON "programs" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_source_identity_unique" ON "programs" USING btree ("university_id","source_provider","source_external_id","academic_year") WHERE "programs"."source_provider" is not null and "programs"."source_external_id" is not null and "programs"."academic_year" is not null;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_source_identity_pair_check" CHECK (("programs"."source_provider" is null) = ("programs"."source_external_id" is null));--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_source_flags_object_check" CHECK (jsonb_typeof("programs"."source_flags") = 'object');--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_academic_year_format_check" CHECK ("programs"."academic_year" is null or "programs"."academic_year" ~ '^[0-9]{4}([/-][0-9]{2,4})?$' or "programs"."academic_year" = 'unspecified');

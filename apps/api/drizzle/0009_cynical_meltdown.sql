CREATE TABLE "institution_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"language_code" varchar(24) DEFAULT 'und' NOT NULL,
	"provider" varchar(40) NOT NULL,
	CONSTRAINT "institution_aliases_kind_check" CHECK ("institution_aliases"."kind" in ('acronym', 'alias', 'label')),
	CONSTRAINT "institution_aliases_name_not_blank_check" CHECK (length(btrim("institution_aliases"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "continent_code" varchar(2);--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "wikipedia_url" text;--> statement-breakpoint
ALTER TABLE "institution_aliases" ADD CONSTRAINT "institution_aliases_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "institution_aliases_identity_unique" ON "institution_aliases" USING btree ("university_id","provider","kind","language_code","name");--> statement-breakpoint
CREATE INDEX "institution_aliases_university_id_idx" ON "institution_aliases" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "universities_continent_code_idx" ON "universities" USING btree ("continent_code");--> statement-breakpoint
ALTER TABLE "universities" ADD CONSTRAINT "universities_continent_code_check" CHECK ("universities"."continent_code" is null or "universities"."continent_code" in ('AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'));--> statement-breakpoint
ALTER TABLE "universities" DROP CONSTRAINT "universities_established_year_range_check";--> statement-breakpoint
ALTER TABLE "universities" ADD CONSTRAINT "universities_established_year_range_check" CHECK ("universities"."established_year" is null or "universities"."established_year" between 1 and 2100);

CREATE TABLE "research_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"openalex_id" varchar(32) NOT NULL,
	"works_count" integer NOT NULL,
	"cited_by_count" integer NOT NULL,
	"h_index" integer NOT NULL,
	"i10_index" integer NOT NULL,
	"two_year_mean_citedness" numeric(14, 8),
	"status" varchar(16) NOT NULL,
	"source_id" uuid NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_profiles_openalex_id_check" CHECK ("research_profiles"."openalex_id" ~ '^I[1-9][0-9]*$'),
	CONSTRAINT "research_profiles_counts_nonnegative_check" CHECK ("research_profiles"."works_count" >= 0 and "research_profiles"."cited_by_count" >= 0 and "research_profiles"."h_index" >= 0 and "research_profiles"."i10_index" >= 0),
	CONSTRAINT "research_profiles_mean_citedness_nonnegative_check" CHECK ("research_profiles"."two_year_mean_citedness" is null or "research_profiles"."two_year_mean_citedness" >= 0),
	CONSTRAINT "research_profiles_status_check" CHECK ("research_profiles"."status" in ('active', 'inactive', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "research_profiles" ADD CONSTRAINT "research_profiles_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_profiles" ADD CONSTRAINT "research_profiles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_profiles_university_id_unique" ON "research_profiles" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_profiles_openalex_id_unique" ON "research_profiles" USING btree ("openalex_id");--> statement-breakpoint
CREATE INDEX "research_profiles_source_id_idx" ON "research_profiles" USING btree ("source_id");
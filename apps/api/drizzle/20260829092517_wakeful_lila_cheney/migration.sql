DO $$ BEGIN
	CREATE TYPE "public"."import_run_status" AS ENUM('running', 'paused', 'completed', 'failed', 'cancelled');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_rejections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"external_id" varchar(255),
	"reason" text NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) NOT NULL,
	"dataset_version" varchar(120) NOT NULL,
	"artifact_hash" varchar(64) NOT NULL,
	"status" "import_run_status" DEFAULT 'running' NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "institution_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"source_modified_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "import_rejections" ADD CONSTRAINT "import_rejections_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "institution_identifiers" ADD CONSTRAINT "institution_identifiers_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_rejections_run_id_idx" ON "import_rejections" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_runs_provider_dataset_artifact_unique" ON "import_runs" USING btree ("provider","dataset_version","artifact_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_runs_provider_started_at_idx" ON "import_runs" USING btree ("provider","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_runs_status_idx" ON "import_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "institution_identifiers_provider_external_id_unique" ON "institution_identifiers" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "institution_identifiers_university_id_idx" ON "institution_identifiers" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deadlines_university_id_idx" ON "deadlines" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "programs_university_id_idx" ON "programs" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_university_id_idx" ON "sources" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sources_university_id_url_unique" ON "sources" USING btree ("university_id","url");--> statement-breakpoint
WITH "normalized_ror_sources" AS (
	SELECT
		"university_id",
		lower(substring("url" FROM '^https://ror[.]org/([^/?#]+)')) AS "external_id",
		row_number() OVER (
			PARTITION BY lower(substring("url" FROM '^https://ror[.]org/([^/?#]+)'))
			ORDER BY "verified_at" DESC, "id"
		) AS "source_rank"
	FROM "sources"
	WHERE "url" LIKE 'https://ror.org/%'
)
INSERT INTO "institution_identifiers" ("university_id", "provider", "external_id")
SELECT "university_id", 'ror', "external_id"
FROM "normalized_ror_sources"
WHERE "source_rank" = 1 AND "external_id" IS NOT NULL AND "external_id" <> ''
ON CONFLICT ("provider", "external_id") DO NOTHING;

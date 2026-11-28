CREATE TYPE "institution_type" AS ENUM ('public', 'private');
CREATE TYPE "program_level" AS ENUM ('undergraduate', 'graduate');
CREATE TYPE "applicant_type" AS ENUM ('domestic', 'international', 'all');
CREATE TYPE "source_category" AS ENUM ('official', 'government', 'independent');
CREATE TABLE "universities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" varchar(160) NOT NULL,
  "slug" varchar(180) NOT NULL UNIQUE, "country" varchar(80) NOT NULL, "city" varchar(80) NOT NULL,
  "website" text NOT NULL, "summary" text NOT NULL, "institution_type" institution_type NOT NULL,
  "student_count" integer, "acceptance_rate" numeric(5,2), "annual_tuition_usd" integer,
  "ib_typical_min" integer, "featured" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "programs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "university_id" uuid NOT NULL REFERENCES "universities"("id") ON DELETE CASCADE,
  "name" varchar(160) NOT NULL, "level" program_level NOT NULL, "field" varchar(100) NOT NULL
);
CREATE TABLE "deadlines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "university_id" uuid NOT NULL REFERENCES "universities"("id") ON DELETE CASCADE,
  "label" varchar(100) NOT NULL, "date" date NOT NULL, "applicant_type" applicant_type NOT NULL
);
CREATE TABLE "sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "university_id" uuid NOT NULL REFERENCES "universities"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL, "url" text NOT NULL, "category" source_category NOT NULL, "verified_at" timestamptz NOT NULL
);
CREATE INDEX "universities_country_idx" ON "universities" ("country");
CREATE INDEX "universities_name_idx" ON "universities" ("name");

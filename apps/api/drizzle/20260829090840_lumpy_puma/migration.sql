CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universities_country_idx" ON "universities" USING btree ("country");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universities_type_idx" ON "universities" USING btree ("institution_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universities_name_trgm_idx" ON "universities" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universities_city_trgm_idx" ON "universities" USING gin ("city" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universities_country_trgm_idx" ON "universities" USING gin ("country" gin_trgm_ops);

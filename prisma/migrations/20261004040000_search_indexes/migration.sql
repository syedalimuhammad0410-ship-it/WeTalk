-- Fast case-insensitive substring search for global search and lead filters.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Business_name_trgm" ON "Business" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Business_email_trgm" ON "Business" USING GIN ("email" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Business_city_trgm" ON "Business" USING GIN ("city" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Note_body_trgm" ON "Note" USING GIN ("body" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "EmailMessage_subject_trgm" ON "EmailMessage" USING GIN ("subject" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Campaign_name_trgm" ON "Campaign" USING GIN ("name" gin_trgm_ops);

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "working_days" jsonb DEFAULT '["monday","tuesday","wednesday","thursday","friday"]'::jsonb;

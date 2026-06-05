ALTER TABLE "service_plans"
  ADD COLUMN IF NOT EXISTS "monthly_week_ordinal" varchar(10);

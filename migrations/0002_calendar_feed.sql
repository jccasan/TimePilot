-- Migration: ICS Calendar Feed per tenant
-- Task #942

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'calendar_feed_mode') THEN
    CREATE TYPE calendar_feed_mode AS ENUM ('summary', 'detailed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_window_type') THEN
    CREATE TYPE time_window_type AS ENUM ('anytime', 'morning', 'afternoon', 'specific');
  END IF;
END $$;

-- Companies: add calendar_token and calendar_feed_mode
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS calendar_token text,
  ADD COLUMN IF NOT EXISTS calendar_feed_mode calendar_feed_mode NOT NULL DEFAULT 'summary';

-- Backfill calendar_token for all existing companies that don't have one
UPDATE companies SET calendar_token = gen_random_uuid()::text WHERE calendar_token IS NULL;

-- Enforce NOT NULL, set DB-level default, and UNIQUE index after backfill
ALTER TABLE companies ALTER COLUMN calendar_token SET NOT NULL;
ALTER TABLE companies ALTER COLUMN calendar_token SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS companies_calendar_token_unique ON companies(calendar_token);

-- Visits: add time window columns
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS scheduled_time_start time,
  ADD COLUMN IF NOT EXISTS scheduled_time_end time,
  ADD COLUMN IF NOT EXISTS time_window_type time_window_type NOT NULL DEFAULT 'anytime';

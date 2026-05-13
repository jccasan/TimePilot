-- Migration: add contact_type enum and columns to contacts
-- Task #857 — Residential/Commercial contact type

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_type') THEN
    CREATE TYPE contact_type AS ENUM ('residential', 'commercial');
  END IF;
END $$;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_type contact_type NOT NULL DEFAULT 'residential',
  ADD COLUMN IF NOT EXISTS company_name  VARCHAR(255);

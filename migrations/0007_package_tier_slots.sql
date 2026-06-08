-- Migration: wire custom packages to quote tiers
-- Adds a tier slot (tier1/tier2/tier3) and an inheritance-prefix flag to packages.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'package_tier_slot') THEN
    CREATE TYPE package_tier_slot AS ENUM ('tier1', 'tier2', 'tier3');
  END IF;
END $$;

ALTER TABLE service_packages
  ADD COLUMN IF NOT EXISTS tier_slot package_tier_slot,
  ADD COLUMN IF NOT EXISTS show_inheritance_prefix BOOLEAN NOT NULL DEFAULT FALSE;

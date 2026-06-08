-- Migration: beginning-of-month prepay billing
-- Charge on the 1st for the full upcoming calendar month, and make it the
-- default for new companies.

-- Add the new enum value (ADD VALUE cannot run inside a transaction block in
-- older Postgres, so it is kept on its own statement).
ALTER TYPE charge_timing ADD VALUE IF NOT EXISTS 'beginning_of_month';

-- New companies default to beginning_of_month. Existing rows are intentionally
-- NOT updated, so operators keep their current charge timing.
ALTER TABLE companies
  ALTER COLUMN charge_timing SET DEFAULT 'beginning_of_month';

-- Per-company guard: the YYYY-MM last billed by the prepay job, so the monthly
-- charge fires once per month and never double-fires on a restart.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS last_prepay_billing_month VARCHAR(7);

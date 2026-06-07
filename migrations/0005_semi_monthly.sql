-- Migration: add semi_monthly service frequency
-- Semi-monthly = exactly twice per calendar month on two operator-specified days.

-- Add the new enum value. ADD VALUE cannot run inside a transaction block in
-- older Postgres, so this statement is intentionally kept on its own.
ALTER TYPE service_frequency ADD VALUE IF NOT EXISTS 'semi_monthly';

-- Two days-of-month for semi_monthly plans. Constrained to 1-28 in application
-- code to avoid month-length edge cases (February has 28 days minimum).
ALTER TABLE service_plans
  ADD COLUMN IF NOT EXISTS semi_monthly_day1 INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS semi_monthly_day2 INTEGER DEFAULT 15;

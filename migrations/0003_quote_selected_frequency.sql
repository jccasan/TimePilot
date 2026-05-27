-- Migration: Add selected_frequency to quotes
-- Task #1131 — residential frequency selection

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS selected_frequency VARCHAR(50);

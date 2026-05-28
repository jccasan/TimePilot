// shared/timecard-schema.ts
//
// ─── INTEGRATION NOTES FOR REPLIT ────────────────────────────────────────────
//
// 1. Adjust the import path below to wherever your companies / users /
//    timeEntries tables are defined (commonly `./schema` or `@shared/schema`).
//
// 2. Add these columns to the EXISTING time_entries table definition:
//
//      periodId: varchar('period_id', { length: 255 })
//        .references(() => timecardPeriods.id, { onDelete: 'set null' }),
//      // nullable, no default — existing rows will have periodId = null (intentional)
//      editedBy: varchar('edited_by', { length: 255 })
//        .references(() => users.id, { onDelete: 'set null' }),
//      editedAt: timestamp('edited_at'),
//
// 3. Add these columns to the EXISTING companies table definition:
//
//      timecardEnabled: boolean('timecard_enabled').notNull().default(false),
//      timecardTrialEndsAt: timestamp('timecard_trial_ends_at'),
//      stripeTimecardSubscriptionId: varchar('stripe_timecard_subscription_id', { length: 255 }),
//
// 4. Add this file to the schema array in drizzle.config.ts:
//
//      schema: ['./shared/schema.ts', './shared/timecard-schema.ts'],
//
// 5. Run `npx drizzle-kit generate` — the migration should show:
//      - CREATE TYPE pay_period_type (enum)
//      - CREATE TYPE timecard_status (enum)
//      - CREATE TABLE timecard_settings
//      - CREATE TABLE timecard_periods  (+ 4 indexes)
//      - CREATE TABLE time_entry_breaks (+ 1 index)
//      - ALTER TABLE time_entries ADD COLUMN period_id   (nullable, no default ✓)
//      - ALTER TABLE time_entries ADD COLUMN edited_by   (nullable, no default)
//      - ALTER TABLE time_entries ADD COLUMN edited_at   (nullable, no default)
//      - ALTER TABLE companies    ADD COLUMN timecard_enabled (NOT NULL DEFAULT false)
//      - ALTER TABLE companies    ADD COLUMN timecard_trial_ends_at  (nullable)
//      - ALTER TABLE companies    ADD COLUMN stripe_timecard_subscription_id (nullable)
//
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  pgEnum,
  varchar,
  text,
  timestamp,
  integer,
  decimal,
  date,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Adjust this import path to match your project.
import { companies, users, timeEntries } from './schema';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const payPeriodTypeEnum = pgEnum('pay_period_type', [
  'weekly',
  'bi-weekly',
  'semi-monthly',
  'monthly',
]);

export const timecardStatusEnum = pgEnum('timecard_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
]);

// ─── timecardSettings ─────────────────────────────────────────────────────────
// One row per company. Created automatically on first timecard access.

export const timecardSettings = pgTable('timecard_settings', {
  id: varchar('id', { length: 255 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id', { length: 255 })
    .notNull()
    .unique()
    .references(() => companies.id, { onDelete: 'cascade' }),
  payPeriodType: payPeriodTypeEnum('pay_period_type')
    .notNull()
    .default('bi-weekly'),
  // Reference date used to calculate all pay period boundaries.
  payPeriodAnchorDate: date('pay_period_anchor_date').notNull(),
  overtimeWeeklyHours: decimal('overtime_weekly_hours', { precision: 4, scale: 1 })
    .notNull()
    .default('40.0'),
  // Null means daily OT rule is disabled (most states).
  overtimeDailyHours: decimal('overtime_daily_hours', { precision: 4, scale: 1 }),
  // Array of { id, name, fields: [{ field, columnName }] }
  exportTemplates: jsonb('export_templates')
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── timecardPeriods ──────────────────────────────────────────────────────────
// One row per tech per pay period.

export const timecardPeriods = pgTable(
  'timecard_periods',
  {
    id: varchar('id', { length: 255 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: varchar('company_id', { length: 255 })
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: timecardStatusEnum('status').notNull().default('draft'),
    submittedAt: timestamp('submitted_at'),
    approvedBy: varchar('approved_by', { length: 255 }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    approvedAt: timestamp('approved_at'),
    rejectedBy: varchar('rejected_by', { length: 255 }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    rejectedAt: timestamp('rejected_at'),
    rejectionNotes: text('rejection_notes'),
    // Cached on approval — null until then.
    totalRegularMinutes: integer('total_regular_minutes'),
    totalOvertimeMinutes: integer('total_overtime_minutes'),
    totalBreakMinutes: integer('total_break_minutes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    companyUserIdx: index('timecard_periods_company_user_idx').on(
      t.companyId,
      t.userId,
    ),
    companyStatusIdx: index('timecard_periods_company_status_idx').on(
      t.companyId,
      t.status,
    ),
    companyPeriodIdx: index('timecard_periods_company_period_idx').on(
      t.companyId,
      t.periodStart,
      t.periodEnd,
    ),
    // One period per tech per start date within a company.
    uniqueCompanyUserPeriod: uniqueIndex(
      'timecard_periods_unique_company_user_period',
    ).on(t.companyId, t.userId, t.periodStart),
  }),
);

// ─── timeEntryBreaks ──────────────────────────────────────────────────────────
// One row per break. Child of time_entries.

export const timeEntryBreaks = pgTable(
  'time_entry_breaks',
  {
    id: varchar('id', { length: 255 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: varchar('company_id', { length: 255 })
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    timeEntryId: varchar('time_entry_id', { length: 255 })
      .notNull()
      .references(() => timeEntries.id, { onDelete: 'cascade' }),
    breakStart: timestamp('break_start').notNull(),
    // Null while break is active.
    breakEnd: timestamp('break_end'),
    // Computed when breakEnd is set.
    durationMinutes: integer('duration_minutes'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    companyEntryIdx: index('time_entry_breaks_company_entry_idx').on(
      t.companyId,
      t.timeEntryId,
    ),
  }),
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimecardSettings = typeof timecardSettings.$inferSelect;
export type NewTimecardSettings = typeof timecardSettings.$inferInsert;

export type TimecardPeriod = typeof timecardPeriods.$inferSelect;
export type NewTimecardPeriod = typeof timecardPeriods.$inferInsert;

export type TimeEntryBreak = typeof timeEntryBreaks.$inferSelect;
export type NewTimeEntryBreak = typeof timeEntryBreaks.$inferInsert;

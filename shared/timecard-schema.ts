// shared/timecard-schema.ts

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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { companies, users, timeEntries } from "./schema";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const payPeriodTypeEnum = pgEnum("pay_period_type", [
  "weekly",
  "bi-weekly",
  "semi-monthly",
  "monthly",
]);

export const timecardStatusEnum = pgEnum("timecard_status", [
  "draft",
  "submitted",
  "approved",
  "rejected",
]);

// ─── timecardSettings ─────────────────────────────────────────────────────────
// One row per company. Created automatically on first timecard access.

export const timecardSettings = pgTable("timecard_settings", {
  id: varchar("id", { length: 255 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id", { length: 255 })
    .notNull()
    .unique()
    .references(() => companies.id, { onDelete: "cascade" }),
  payPeriodType: payPeriodTypeEnum("pay_period_type").notNull().default("bi-weekly"),
  payPeriodAnchorDate: date("pay_period_anchor_date").notNull(),
  overtimeWeeklyHours: decimal("overtime_weekly_hours", { precision: 4, scale: 1 })
    .notNull()
    .default("40.0"),
  overtimeDailyHours: decimal("overtime_daily_hours", { precision: 4, scale: 1 }),
  exportTemplates: jsonb("export_templates")
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── timecardPeriods ──────────────────────────────────────────────────────────
// One row per tech per pay period.

export const timecardPeriods = pgTable(
  "timecard_periods",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: varchar("company_id", { length: 255 })
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: timecardStatusEnum("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at"),
    approvedBy: varchar("approved_by", { length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    rejectedBy: varchar("rejected_by", { length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at"),
    rejectionNotes: text("rejection_notes"),
    totalRegularMinutes: integer("total_regular_minutes"),
    totalOvertimeMinutes: integer("total_overtime_minutes"),
    totalBreakMinutes: integer("total_break_minutes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyUserIdx: index("timecard_periods_company_user_idx").on(t.companyId, t.userId),
    companyStatusIdx: index("timecard_periods_company_status_idx").on(t.companyId, t.status),
    companyPeriodIdx: index("timecard_periods_company_period_idx").on(
      t.companyId,
      t.periodStart,
      t.periodEnd
    ),
    uniqueCompanyUserPeriod: uniqueIndex("timecard_periods_unique_company_user_period").on(
      t.companyId,
      t.userId,
      t.periodStart
    ),
  })
);

// ─── timeEntryBreaks ──────────────────────────────────────────────────────────
// One row per break. Child of time_entries.

export const timeEntryBreaks = pgTable(
  "time_entry_breaks",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: varchar("company_id", { length: 255 })
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    timeEntryId: varchar("time_entry_id", { length: 255 })
      .notNull()
      .references(() => timeEntries.id, { onDelete: "cascade" }),
    breakStart: timestamp("break_start").notNull(),
    breakEnd: timestamp("break_end"),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyEntryIdx: index("time_entry_breaks_company_entry_idx").on(t.companyId, t.timeEntryId),
  })
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimecardSettings = typeof timecardSettings.$inferSelect;
export type NewTimecardSettings = typeof timecardSettings.$inferInsert;

export type TimecardPeriod = typeof timecardPeriods.$inferSelect;
export type NewTimecardPeriod = typeof timecardPeriods.$inferInsert;

export type TimeEntryBreak = typeof timeEntryBreaks.$inferSelect;
export type NewTimeEntryBreak = typeof timeEntryBreaks.$inferInsert;

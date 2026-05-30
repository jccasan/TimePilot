import { db } from "../db";
import { eq, and, isNull, isNotNull, gte, lte, inArray, sql } from "drizzle-orm";
import {
  timecardSettings,
  timecardPeriods,
  timeEntryBreaks,
  type TimecardSettings,
  type NewTimecardSettings,
  type TimecardPeriod,
  type NewTimecardPeriod,
  type TimeEntryBreak,
  type NewTimeEntryBreak,
} from "@shared/timecard-schema";
import { timeEntries, companyUsers, users } from "@shared/schema";
import { storage } from "../storage";

// ─── Period Boundary Calculation ──────────────────────────────────────────────

export function getPeriodBoundaries(
  date: Date,
  settings: TimecardSettings
): { periodStart: Date; periodEnd: Date } {
  const anchor = new Date(settings.payPeriodAnchorDate + "T00:00:00");
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  switch (settings.payPeriodType) {
    case "weekly": {
      // Find the most recent anchor-weekday on or before d
      const anchorDow = anchor.getDay();
      const dDow = d.getDay();
      const diff = ((dDow - anchorDow) + 7) % 7;
      const periodStart = new Date(d);
      periodStart.setDate(d.getDate() - diff);
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodStart.getDate() + 6);
      return { periodStart, periodEnd };
    }
    case "bi-weekly": {
      const anchorDow = anchor.getDay();
      const dDow = d.getDay();
      // Days since anchor
      const msSinceAnchor = d.getTime() - anchor.getTime();
      const daysSinceAnchor = Math.floor(msSinceAnchor / 86400000);
      const offsetInPeriod = ((daysSinceAnchor % 14) + 14) % 14;
      const periodStart = new Date(d);
      periodStart.setDate(d.getDate() - offsetInPeriod);
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodStart.getDate() + 13);
      void anchorDow; void dDow;
      return { periodStart, periodEnd };
    }
    case "semi-monthly": {
      const year = d.getFullYear();
      const month = d.getMonth();
      if (d.getDate() <= 15) {
        return {
          periodStart: new Date(year, month, 1),
          periodEnd: new Date(year, month, 15),
        };
      } else {
        const lastDay = new Date(year, month + 1, 0).getDate();
        return {
          periodStart: new Date(year, month, 16),
          periodEnd: new Date(year, month, lastDay),
        };
      }
    }
    case "monthly": {
      const year = d.getFullYear();
      const month = d.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();
      return {
        periodStart: new Date(year, month, 1),
        periodEnd: new Date(year, month, lastDay),
      };
    }
  }
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── TimecardRepository ────────────────────────────────────────────────────────

export class TimecardRepository {
  // ── Settings ────────────────────────────────────────────────────────────────

  async getOrCreateSettings(companyId: string): Promise<TimecardSettings> {
    const [existing] = await db
      .select()
      .from(timecardSettings)
      .where(eq(timecardSettings.companyId, companyId));
    if (existing) return existing;

    const [created] = await db
      .insert(timecardSettings)
      .values({
        companyId,
        payPeriodAnchorDate: toDateStr(new Date()),
      } as NewTimecardSettings)
      .returning();
    return created;
  }

  async updateSettings(
    companyId: string,
    data: Partial<Omit<TimecardSettings, "id" | "companyId" | "createdAt">>
  ): Promise<TimecardSettings> {
    const [updated] = await db
      .update(timecardSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(timecardSettings.companyId, companyId))
      .returning();
    return updated;
  }

  // ── Periods ─────────────────────────────────────────────────────────────────

  async getOrCreatePeriod(
    companyId: string,
    userId: string,
    date: Date
  ): Promise<TimecardPeriod> {
    const settings = await this.getOrCreateSettings(companyId);
    const { periodStart, periodEnd } = getPeriodBoundaries(date, settings);
    const startStr = toDateStr(periodStart);
    const endStr = toDateStr(periodEnd);

    const [existing] = await db
      .select()
      .from(timecardPeriods)
      .where(
        and(
          eq(timecardPeriods.companyId, companyId),
          eq(timecardPeriods.userId, userId),
          eq(timecardPeriods.periodStart, startStr)
        )
      );
    if (existing) return existing;

    const [created] = await db
      .insert(timecardPeriods)
      .values({
        companyId,
        userId,
        periodStart: startStr,
        periodEnd: endStr,
      } as NewTimecardPeriod)
      .returning();
    return created;
  }

  async getPeriod(companyId: string, periodId: string): Promise<TimecardPeriod | null> {
    const [row] = await db
      .select()
      .from(timecardPeriods)
      .where(
        and(eq(timecardPeriods.id, periodId), eq(timecardPeriods.companyId, companyId))
      );
    return row ?? null;
  }

  async listPeriods(
    companyId: string,
    filters?: { userId?: string; status?: string; from?: Date; to?: Date }
  ): Promise<TimecardPeriod[]> {
    const conditions = [eq(timecardPeriods.companyId, companyId)];
    if (filters?.userId) conditions.push(eq(timecardPeriods.userId, filters.userId));
    if (filters?.status)
      conditions.push(eq(timecardPeriods.status, filters.status as any));
    if (filters?.from)
      conditions.push(gte(timecardPeriods.periodStart, toDateStr(filters.from)));
    if (filters?.to)
      conditions.push(lte(timecardPeriods.periodEnd, toDateStr(filters.to)));

    return db
      .select()
      .from(timecardPeriods)
      .where(and(...conditions))
      .orderBy(timecardPeriods.periodStart);
  }

  async submitPeriod(
    companyId: string,
    periodId: string,
    userId: string
  ): Promise<TimecardPeriod> {
    const period = await this.getPeriod(companyId, periodId);
    if (!period) throw Object.assign(new Error("Period not found"), { status: 404 });
    if (period.status !== "draft")
      throw Object.assign(new Error("Period is not in draft status"), { status: 400 });
    if (period.userId !== userId)
      throw Object.assign(new Error("Cannot submit another user's timecard"), { status: 403 });

    const completedEntries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.periodId, periodId),
          isNotNull(timeEntries.clockOut)
        )
      );
    if (completedEntries.length === 0)
      throw Object.assign(new Error("No completed entries in this period"), { status: 400 });

    const [updated] = await db
      .update(timecardPeriods)
      .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(timecardPeriods.id, periodId))
      .returning();

    // Notify all admins/owners
    const adminUsers = await db
      .select({ userId: companyUsers.userId })
      .from(companyUsers)
      .where(
        and(
          eq(companyUsers.companyId, companyId),
          inArray(companyUsers.role, ["owner", "admin"]),
          eq(companyUsers.isActive, true)
        )
      );

    const [submitter] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, userId));
    const name = submitter
      ? `${submitter.firstName} ${submitter.lastName}`.trim()
      : "A technician";

    const periodLabel = `${period.periodStart} – ${period.periodEnd}`;
    await Promise.all(
      adminUsers.map((u) =>
        storage.createNotification({
          companyId,
          title: "Timecard Submitted",
          message: `${name} submitted their timecard for ${periodLabel}`,
          type: "general",
        })
      )
    );
    void adminUsers;

    return updated;
  }

  async approvePeriod(
    companyId: string,
    periodId: string,
    approvedByUserId: string
  ): Promise<TimecardPeriod> {
    const period = await this.getPeriod(companyId, periodId);
    if (!period) throw Object.assign(new Error("Period not found"), { status: 404 });
    if (period.status !== "submitted")
      throw Object.assign(new Error("Period is not submitted"), { status: 400 });

    const totals = await this.calculatePeriodTotals(companyId, periodId);

    const [updated] = await db
      .update(timecardPeriods)
      .set({
        status: "approved",
        approvedBy: approvedByUserId,
        approvedAt: new Date(),
        totalRegularMinutes: totals.totalRegularMinutes,
        totalOvertimeMinutes: totals.totalOvertimeMinutes,
        totalBreakMinutes: totals.totalBreakMinutes,
        updatedAt: new Date(),
      })
      .where(eq(timecardPeriods.id, periodId))
      .returning();

    await storage.createNotification({
      companyId,
      title: "Timecard Approved",
      message: `Your timecard for ${period.periodStart} – ${period.periodEnd} has been approved`,
      type: "general",
    });

    return updated;
  }

  async rejectPeriod(
    companyId: string,
    periodId: string,
    rejectedByUserId: string,
    notes: string
  ): Promise<TimecardPeriod> {
    const period = await this.getPeriod(companyId, periodId);
    if (!period) throw Object.assign(new Error("Period not found"), { status: 404 });

    const [updated] = await db
      .update(timecardPeriods)
      .set({
        status: "rejected",
        rejectedBy: rejectedByUserId,
        rejectedAt: new Date(),
        rejectionNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(timecardPeriods.id, periodId))
      .returning();

    await storage.createNotification({
      companyId,
      title: "Timecard Returned",
      message: `Your timecard for ${period.periodStart} – ${period.periodEnd} was returned: ${notes}`,
      type: "general",
    });

    return updated;
  }

  async reopenPeriod(companyId: string, periodId: string): Promise<TimecardPeriod> {
    const period = await this.getPeriod(companyId, periodId);
    if (!period) throw Object.assign(new Error("Period not found"), { status: 404 });

    const [updated] = await db
      .update(timecardPeriods)
      .set({
        status: "draft",
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionNotes: null,
        totalRegularMinutes: null,
        totalOvertimeMinutes: null,
        totalBreakMinutes: null,
        updatedAt: new Date(),
      })
      .where(eq(timecardPeriods.id, periodId))
      .returning();

    return updated;
  }

  // ── Breaks ───────────────────────────────────────────────────────────────────

  async startBreak(companyId: string, timeEntryId: string): Promise<TimeEntryBreak> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(
        and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId))
      );
    if (!entry) throw Object.assign(new Error("Time entry not found"), { status: 404 });
    if (entry.clockOut)
      throw Object.assign(new Error("Cannot start break on a completed entry"), { status: 400 });

    const activeBreak = await this.getActiveBreak(companyId, timeEntryId);
    if (activeBreak)
      throw Object.assign(new Error("An active break already exists"), { status: 400 });

    const [created] = await db
      .insert(timeEntryBreaks)
      .values({ companyId, timeEntryId, breakStart: new Date() } as NewTimeEntryBreak)
      .returning();
    return created;
  }

  async endBreak(companyId: string, timeEntryId: string): Promise<TimeEntryBreak> {
    const active = await this.getActiveBreak(companyId, timeEntryId);
    if (!active) throw Object.assign(new Error("No active break found"), { status: 400 });

    const breakEnd = new Date();
    const durationMinutes = Math.round(
      (breakEnd.getTime() - new Date(active.breakStart).getTime()) / 60000
    );

    const [updated] = await db
      .update(timeEntryBreaks)
      .set({ breakEnd, durationMinutes })
      .where(eq(timeEntryBreaks.id, active.id))
      .returning();
    return updated;
  }

  async getBreaks(companyId: string, timeEntryId: string): Promise<TimeEntryBreak[]> {
    return db
      .select()
      .from(timeEntryBreaks)
      .where(
        and(
          eq(timeEntryBreaks.companyId, companyId),
          eq(timeEntryBreaks.timeEntryId, timeEntryId)
        )
      )
      .orderBy(timeEntryBreaks.breakStart);
  }

  async getActiveBreak(
    companyId: string,
    timeEntryId: string
  ): Promise<TimeEntryBreak | null> {
    const [row] = await db
      .select()
      .from(timeEntryBreaks)
      .where(
        and(
          eq(timeEntryBreaks.companyId, companyId),
          eq(timeEntryBreaks.timeEntryId, timeEntryId),
          isNull(timeEntryBreaks.breakEnd)
        )
      );
    return row ?? null;
  }

  // ── Totals ───────────────────────────────────────────────────────────────────

  async calculatePeriodTotals(
    companyId: string,
    periodId: string
  ): Promise<{
    totalRegularMinutes: number;
    totalOvertimeMinutes: number;
    totalBreakMinutes: number;
    dailyBreakdown: Array<{
      date: string;
      regularMinutes: number;
      overtimeMinutes: number;
      breakMinutes: number;
    }>;
  }> {
    const settings = await this.getOrCreateSettings(companyId);
    const weeklyOtThreshold = parseFloat(settings.overtimeWeeklyHours as string) * 60;
    const dailyOtThreshold = settings.overtimeDailyHours
      ? parseFloat(settings.overtimeDailyHours as string) * 60
      : null;

    const entries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.periodId, periodId),
          isNotNull(timeEntries.clockOut)
        )
      );

    // Map entryId → breaks
    const allBreaks =
      entries.length > 0
        ? await db
            .select()
            .from(timeEntryBreaks)
            .where(
              and(
                eq(timeEntryBreaks.companyId, companyId),
                inArray(
                  timeEntryBreaks.timeEntryId,
                  entries.map((e) => e.id)
                )
              )
            )
        : [];

    const breaksByEntry = new Map<string, typeof allBreaks>();
    for (const b of allBreaks) {
      if (!breaksByEntry.has(b.timeEntryId)) breaksByEntry.set(b.timeEntryId, []);
      breaksByEntry.get(b.timeEntryId)!.push(b);
    }

    // Build daily buckets: date → worked minutes
    const dailyWorked = new Map<string, number>();
    const dailyBreakMins = new Map<string, number>();
    let totalBreakMinutes = 0;

    for (const entry of entries) {
      const date = toDateStr(new Date(entry.clockIn));
      const breaks = breaksByEntry.get(entry.id) ?? [];
      const breakMins = breaks.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);
      const gross = entry.durationMinutes ?? 0;
      const net = Math.max(0, gross - breakMins);

      totalBreakMinutes += breakMins;
      dailyWorked.set(date, (dailyWorked.get(date) ?? 0) + net);
      dailyBreakMins.set(date, (dailyBreakMins.get(date) ?? 0) + breakMins);
    }

    // Apply daily OT first
    let totalRegularMinutes = 0;
    let totalOvertimeMinutes = 0;

    const dailyBreakdown: Array<{
      date: string;
      regularMinutes: number;
      overtimeMinutes: number;
      breakMinutes: number;
    }> = [];

    for (const [date, worked] of Array.from(dailyWorked.entries()).sort()) {
      let regular = worked;
      let overtime = 0;
      if (dailyOtThreshold !== null && worked > dailyOtThreshold) {
        overtime = worked - dailyOtThreshold;
        regular = dailyOtThreshold;
      }
      totalRegularMinutes += regular;
      totalOvertimeMinutes += overtime;
      dailyBreakdown.push({
        date,
        regularMinutes: regular,
        overtimeMinutes: overtime,
        breakMinutes: dailyBreakMins.get(date) ?? 0,
      });
    }

    // Apply weekly OT to remaining regular minutes
    if (totalRegularMinutes > weeklyOtThreshold) {
      const weeklyOt = totalRegularMinutes - weeklyOtThreshold;
      totalOvertimeMinutes += weeklyOt;
      totalRegularMinutes = weeklyOtThreshold;
    }

    return { totalRegularMinutes, totalOvertimeMinutes, totalBreakMinutes, dailyBreakdown };
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  async generateExportCSV(
    companyId: string,
    periodIds: string[],
    templateId: string
  ): Promise<string> {
    const settings = await this.getOrCreateSettings(companyId);
    const templates = (settings.exportTemplates as Array<{
      id: string;
      name: string;
      fields: Array<{ field: string; columnName: string }>;
    }>) ?? [];

    const template = templates.find((t) => t.id === templateId);
    if (!template) throw Object.assign(new Error("Template not found"), { status: 404 });

    const periods = await db
      .select()
      .from(timecardPeriods)
      .where(
        and(
          eq(timecardPeriods.companyId, companyId),
          inArray(timecardPeriods.id, periodIds)
        )
      );

    const unapproved = periods.filter((p) => p.status !== "approved");
    if (unapproved.length > 0)
      throw Object.assign(new Error("All periods must be approved before export"), {
        status: 400,
      });

    const periodMap = new Map(periods.map((p) => [p.id, p]));

    const entries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          inArray(timeEntries.periodId, periodIds)
        )
      )
      .orderBy(timeEntries.clockIn);

    const userIds = [...new Set(entries.map((e) => e.userId))];
    const userRows =
      userIds.length > 0
        ? await db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
            })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
    const userMap = new Map(userRows.map((u) => [u.id, u]));

    const entryIds = entries.map((e) => e.id);
    const allBreaks =
      entryIds.length > 0
        ? await db
            .select()
            .from(timeEntryBreaks)
            .where(
              and(
                eq(timeEntryBreaks.companyId, companyId),
                inArray(timeEntryBreaks.timeEntryId, entryIds)
              )
            )
        : [];
    const breaksByEntry = new Map<string, typeof allBreaks>();
    for (const b of allBreaks) {
      if (!breaksByEntry.has(b.timeEntryId)) breaksByEntry.set(b.timeEntryId, []);
      breaksByEntry.get(b.timeEntryId)!.push(b);
    }

    const fields = template.fields;
    const csvHeader = fields.map((f) => `"${f.columnName}"`).join(",");

    const rows = entries.map((entry) => {
      const user = userMap.get(entry.userId);
      const period = periodMap.get(entry.periodId!);
      const breaks = breaksByEntry.get(entry.id) ?? [];
      const breakMins = breaks.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);
      const gross = entry.durationMinutes ?? 0;
      const net = Math.max(0, gross - breakMins);
      // Simple OT: net above 8h per day counts as OT for export row
      const regularMins = Math.min(net, 480);
      const otMins = Math.max(0, net - 480);

      const fieldValues: Record<string, string> = {
        employee_first_name: user?.firstName ?? "",
        employee_last_name: user?.lastName ?? "",
        employee_full_name: user
          ? `${user.firstName} ${user.lastName}`.trim()
          : "",
        employee_id: entry.userId,
        period_start: period?.periodStart ?? "",
        period_end: period?.periodEnd ?? "",
        date: toDateStr(new Date(entry.clockIn)),
        clock_in: entry.clockIn.toISOString(),
        clock_out: entry.clockOut ? new Date(entry.clockOut).toISOString() : "",
        regular_hours: (regularMins / 60).toFixed(2),
        overtime_hours: (otMins / 60).toFixed(2),
        break_minutes: String(breakMins),
        total_hours_worked: (net / 60).toFixed(2),
        notes: entry.notes ?? "",
      };

      return fields.map((f) => `"${(fieldValues[f.field] ?? "").replace(/"/g, '""')}"`).join(",");
    });

    return [csvHeader, ...rows].join("\n");
  }
}

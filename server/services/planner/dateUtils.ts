// Date utilities for planning windows.
// All dates are treated as UTC date-only ISO strings (YYYY-MM-DD) for portability.

import type { PlanningWindow, RoutePlannerSettings } from "./types";

export function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): Date {
  // Accept YYYY-MM-DD or full ISO strings; normalize to UTC midnight.
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function diffDays(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Monday=1 ... Sunday=7
function isoWeekday(date: Date): number {
  const day = date.getUTCDay(); // 0..6 (Sun..Sat)
  return day === 0 ? 7 : day;
}

export function startOfWeekMonday(date: Date): Date {
  const wd = isoWeekday(date);
  return addDays(date, -(wd - 1));
}

export function nextMonday(date: Date): Date {
  const wd = isoWeekday(date);
  if (wd === 1) return addDays(date, 7);
  return addDays(date, 8 - wd);
}

export function getPlanningStartDate(todayDate: Date, settings: RoutePlannerSettings): Date {
  const today = new Date(
    Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate())
  );

  switch (settings.planningStartMode) {
    case "custom_start_date": {
      if (!settings.customStartDate) {
        // Fall back to default behavior if custom date missing.
        return defaultStartBehavior(today);
      }
      return parseIsoDate(settings.customStartDate);
    }
    case "next_monday":
      return nextMonday(today);
    case "current_monday_if_today_is_monday":
    default:
      return defaultStartBehavior(today);
  }
}

function defaultStartBehavior(today: Date): Date {
  const wd = isoWeekday(today);
  if (wd === 1) return today;
  return nextMonday(today);
}

export function getWeekDateRange(startDate: Date, weekOffset: number): { start: Date; end: Date } {
  const start = addDays(startDate, weekOffset * 7);
  const end = addDays(start, 6);
  return { start, end };
}

export function buildPlanningWindow(startDate: Date, planningWeeks: number): PlanningWindow {
  const weeks = [];
  for (let i = 0; i < planningWeeks; i++) {
    const { start, end } = getWeekDateRange(startDate, i);
    weeks.push({
      weekNumber: (i + 1) as 1 | 2 | 3 | 4 | number,
      weekStartDate: toIsoDate(start),
      weekEndDate: toIsoDate(end),
      dueCustomers: [],
      routableCustomers: [],
      excludedCustomers: [],
      plannedRoutes: [],
      summary: {
        routeCount: 0,
        stopCount: 0,
        totalRouteMinutes: 0,
        totalRevenue: 0,
        totalGrossProfit: 0,
        averageProfitMargin: 0,
        excludedCount: 0,
        needsReviewCount: 0,
      },
    });
  }
  return {
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(addDays(startDate, planningWeeks * 7 - 1)),
    weeks,
  };
}

export function isWithinRange(target: Date, start: Date, end: Date): boolean {
  return target.getTime() >= start.getTime() && target.getTime() <= end.getTime();
}

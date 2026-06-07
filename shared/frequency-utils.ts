// Pure, dependency-free helpers for service-frequency math.
// Kept free of DB/server imports so it is safe to use from both client and
// server and easy to unit test.

/**
 * Average number of visits per calendar month for a given service frequency.
 * Used by MRR / revenue projections.
 */
export function frequencyVisitsPerMonth(frequency: string): number {
  switch (frequency) {
    case "weekly":
      return 4.33;
    case "biweekly":
      return 2.17;
    case "monthly":
      return 1;
    case "semi_monthly":
      return 2;
    case "onetime":
      return 1;
    default:
      return 4.33;
  }
}

/**
 * Compute the visit dates (YYYY-MM-DD, UTC) for a semi-monthly plan within an
 * inclusive [effectiveStart, effectiveEnd] range. A visit is placed on day1 and
 * day2 of each calendar month; if a requested day exceeds the month's length
 * (e.g. day 31 in February) the last day of that month is used instead.
 */
export function computeSemiMonthlyVisitDates(
  effectiveStart: Date,
  effectiveEnd: Date,
  day1: number,
  day2: number
): string[] {
  const dates: string[] = [];
  if (effectiveStart > effectiveEnd) return dates;

  let monthCursor = new Date(
    Date.UTC(effectiveStart.getUTCFullYear(), effectiveStart.getUTCMonth(), 1)
  );
  while (monthCursor <= effectiveEnd) {
    const year = monthCursor.getUTCFullYear();
    const month = monthCursor.getUTCMonth();
    // Last day of this month (day 0 of next month).
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    for (const dom of [day1, day2]) {
      // If the requested day doesn't exist this month, use the last day.
      const clampedDom = Math.min(dom, lastDayOfMonth);
      const visitDate = new Date(Date.UTC(year, month, clampedDom));
      if (visitDate < effectiveStart || visitDate > effectiveEnd) continue;
      const dateStr = visitDate.toISOString().split("T")[0];
      // Guard against emitting the same date twice (e.g. day1 === clamped day2).
      if (!dates.includes(dateStr)) dates.push(dateStr);
    }

    monthCursor = new Date(Date.UTC(year, month + 1, 1));
  }
  return dates;
}

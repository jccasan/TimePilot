/**
 * Returns the date of the Nth occurrence of a given weekday in a UTC calendar month.
 *
 * ordinal: "first" | "second" | "third" | "fourth" | "last"
 * weekday: 0 (Sun) – 6 (Sat), matching Date.getUTCDay()
 *
 * Returns null when the ordinal does not exist in that month
 * (e.g. "fourth" Monday in a month where the 4th Monday would fall in the next month).
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number, // 0-based (Jan = 0)
  weekday: number, // 0 = Sun … 6 = Sat
  ordinal: string
): Date | null {
  if (ordinal === "last") {
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const diff = (lastDay.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month, lastDay.getUTCDate() - diff));
  }
  const ordinalMap: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
  };
  const n = ordinalMap[ordinal];
  if (!n) return null;
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstWeekday = firstOfMonth.getUTCDay();
  const daysUntilTarget = (weekday - firstWeekday + 7) % 7;
  const day = 1 + daysUntilTarget + (n - 1) * 7;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (day > lastDayOfMonth) return null;
  return new Date(Date.UTC(year, month, day));
}

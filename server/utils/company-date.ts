export function getCompanyToday(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

export function getCompanyDayOfWeek(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    });
    const dayName = formatter.format(new Date());
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[dayName] ?? new Date().getDay();
  } catch {
    return new Date().getDay();
  }
}

export function getCompanyDayOfMonth(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      day: "numeric",
    });
    return parseInt(formatter.format(new Date()), 10);
  } catch {
    return new Date().getDate();
  }
}

export function getCompanyMonthStart(timezone: string): string {
  const today = getCompanyToday(timezone);
  return today.slice(0, 8) + "01";
}

export function getCompanyMonthEnd(timezone: string): string {
  const today = getCompanyToday(timezone);
  const year = parseInt(today.slice(0, 4), 10);
  const month = parseInt(today.slice(5, 7), 10);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function getCompanyWeekStart(timezone: string): string {
  const today = getCompanyToday(timezone);
  const dow = getCompanyDayOfWeek(timezone);
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().split("T")[0];
}

export function getCompanyWeekEnd(timezone: string): string {
  const today = getCompanyToday(timezone);
  const dow = getCompanyDayOfWeek(timezone);
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + (6 - dow));
  return d.toISOString().split("T")[0];
}

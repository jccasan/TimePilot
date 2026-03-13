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
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
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

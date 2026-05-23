import { ICalCalendar, ICalCalendarMethod } from "ical-generator";

interface Company {
  id: string;
  name: string;
  timezone: string;
  calendarFeedMode: "summary" | "detailed";
}

export interface CalendarVisit {
  id: string;
  scheduledDate: string;
  routeId: string | null;
  propertyId: string;
  servicePlanId: string;
  timeWindowType: "anytime" | "morning" | "afternoon" | "specific";
  scheduledTimeStart: string | null;
  scheduledTimeEnd: string | null;
  stopOrder?: number | null;
  property?: {
    id: string;
    streetAddress: string;
    city: string;
    state: string;
    contactId: string;
    numberOfDogs: number | null;
    yardSize: string | null;
    gateCode: string | null;
    specialInstructions: string | null;
  } | null;
  contact?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  route?: {
    id: string;
    name: string;
    date: string | null;
  } | null;
}

/**
 * Convert a local date+time string in the given IANA timezone to a UTC Date.
 * Uses the Intl API for offset calculation — no external libraries needed.
 */
function localToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const isoStr = `${dateStr}T${timeStr}`;
  const naive = new Date(isoStr + "Z");

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(naive);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";

  const tzYear = get("year");
  const tzMonth = get("month");
  const tzDay = get("day");
  const tzHour = get("hour") === "24" ? "00" : get("hour");
  const tzMinute = get("minute");
  const tzSecond = get("second");

  const tzEquiv = new Date(`${tzYear}-${tzMonth}-${tzDay}T${tzHour}:${tzMinute}:${tzSecond}Z`);
  const offsetMs = naive.getTime() - tzEquiv.getTime();
  return new Date(naive.getTime() + offsetMs);
}

interface EventTimes {
  start: Date;
  end: Date;
  allDay: boolean;
  timezone?: string;
}

function getEventTimes(visit: CalendarVisit, timezone: string): EventTimes {
  const date = visit.scheduledDate;

  if (visit.timeWindowType === "anytime") {
    const start = new Date(date + "T00:00:00Z");
    return { start, end: start, allDay: true };
  }

  if (visit.timeWindowType === "morning") {
    const start = localToUtc(date, "07:00:00", timezone);
    const end = localToUtc(date, "12:00:00", timezone);
    return { start, end, allDay: false, timezone };
  }

  if (visit.timeWindowType === "afternoon") {
    const start = localToUtc(date, "12:00:00", timezone);
    const end = localToUtc(date, "17:00:00", timezone);
    return { start, end, allDay: false, timezone };
  }

  if (visit.timeWindowType === "specific" && visit.scheduledTimeStart && visit.scheduledTimeEnd) {
    const start = localToUtc(date, visit.scheduledTimeStart, timezone);
    const end = localToUtc(date, visit.scheduledTimeEnd, timezone);
    return { start, end, allDay: false, timezone };
  }

  const start = new Date(date + "T00:00:00Z");
  return { start, end: start, allDay: true };
}

export function generateIcsForCompany(company: Company, visits: CalendarVisit[]): string {
  const cal = new ICalCalendar({
    name: `${company.name} — Service Schedule`,
    timezone: company.timezone,
    method: ICalCalendarMethod.PUBLISH,
  });

  if (company.calendarFeedMode === "summary") {
    generateSummaryEvents(cal, company, visits);
  } else {
    generateDetailedEvents(cal, company, visits);
  }

  return cal.toString();
}

function generateSummaryEvents(cal: ICalCalendar, company: Company, visits: CalendarVisit[]): void {
  const byRouteDay = new Map<string, CalendarVisit[]>();

  for (const v of visits) {
    const routeId = v.routeId ?? "__no_route__";
    const key = `${routeId}::${v.scheduledDate}`;
    if (!byRouteDay.has(key)) byRouteDay.set(key, []);
    byRouteDay.get(key)!.push(v);
  }

  for (const [key, groupVisits] of byRouteDay) {
    const [routeId, date] = key.split("::");
    const routeName = groupVisits[0]?.route?.name ?? "Route";
    const n = groupVisits.length;
    const summary = `${routeName} — ${n} stop${n !== 1 ? "s" : ""}`;

    const sorted = [...groupVisits].sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
    const stopLines = sorted.map((v, i) => {
      const addr = v.property?.streetAddress ?? "Unknown address";
      const name = v.contact ? `${v.contact.firstName} ${v.contact.lastName}`.trim() : "";
      return `${i + 1}. ${name ? `${name} — ` : ""}${addr}`;
    });
    const description = stopLines.join("\n");

    const uid = `route-${routeId}-${date}-${company.id}@scoopilot`;

    const firstVisit = groupVisits[0];
    const times = getEventTimes(firstVisit, company.timezone);

    if (times.allDay) {
      cal.createEvent({
        id: uid,
        summary,
        description,
        start: times.start,
        end: times.end,
        allDay: true,
      });
    } else {
      cal.createEvent({
        id: uid,
        summary,
        description,
        start: times.start,
        end: times.end,
        timezone: times.timezone,
      });
    }
  }
}

function generateDetailedEvents(
  cal: ICalCalendar,
  company: Company,
  visits: CalendarVisit[]
): void {
  for (const v of visits) {
    const contactName = v.contact
      ? `${v.contact.firstName} ${v.contact.lastName}`.trim()
      : "Client";
    const street = v.property?.streetAddress ?? "Unknown address";
    const summary = `${contactName} — ${street}`;

    const descParts: string[] = [];
    if (v.property?.numberOfDogs) {
      descParts.push(`Dogs: ${v.property.numberOfDogs}`);
    }
    if (v.property?.yardSize) {
      descParts.push(`Yard size: ${v.property.yardSize}`);
    }
    if (v.property?.gateCode) {
      descParts.push(`Gate code: ${v.property.gateCode}`);
    }
    if (v.property?.specialInstructions) {
      descParts.push(`Notes: ${v.property.specialInstructions}`);
    }
    const description = descParts.join("\n");

    const uid = `visit-${v.id}-${company.id}@scoopilot`;
    const times = getEventTimes(v, company.timezone);

    if (times.allDay) {
      cal.createEvent({
        id: uid,
        summary,
        description,
        start: times.start,
        end: times.end,
        allDay: true,
      });
    } else {
      cal.createEvent({
        id: uid,
        summary,
        description,
        start: times.start,
        end: times.end,
        timezone: times.timezone,
      });
    }
  }
}

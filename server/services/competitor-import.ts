import { parseCSV, normalizePhone, splitFullName } from "./import-transforms";

export type Platform = "sweepandgo" | "jobber" | "unknown";

export interface ParsedContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  streetAddress: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  numberOfDogs: number | null;
  yardSize: string;
  serviceFrequency: string;
  serviceDay: string;
  gateCode: string;
  notes: string;
  leadSource: string;
  status: string;
  tags: string;
}

export interface DetectResult {
  platform: Platform;
  platformLabel: string;
  totalRows: number;
  fieldMapping: Record<string, string>;
  preview: ParsedContact[];
  warnings: string[];
  errors: Array<{ row: number; message: string }>;
}

const SWEEPANDGO_HEADERS: Record<string, string[]> = {
  firstName: ["first name", "firstname", "first_name", "fname"],
  lastName: ["last name", "lastname", "last_name", "lname"],
  email: ["email", "e-mail", "email address", "customer email"],
  phone: ["phone", "phone number", "telephone", "cell", "cell phone", "mobile", "phone_number"],
  streetAddress: ["address", "street", "street address", "street_address", "address1", "address 1"],
  address2: ["address 2", "address2", "apt", "suite", "unit"],
  city: ["city"],
  state: ["state", "st", "province"],
  zipCode: ["zip", "zip code", "zipcode", "zip_code", "postal code", "postal_code"],
  numberOfDogs: [
    "# of dogs",
    "# dogs",
    "number of dogs",
    "dogs",
    "dog count",
    "num dogs",
    "number_of_dogs",
    "numberof dogs",
  ],
  yardSize: ["yard size", "yard_size", "lot size", "yard"],
  serviceFrequency: [
    "frequency",
    "service frequency",
    "service_frequency",
    "svc frequency",
    "svc freq",
  ],
  serviceDay: ["service day", "service_day", "day", "svc day", "day of week", "preferred day"],
  gateCode: ["gate code", "gate_code", "gate", "access code", "entry code"],
  notes: ["notes", "comments", "memo", "special instructions"],
  status: ["status", "customer status", "client status"],
  leadSource: ["lead source", "lead_source", "source", "referral source", "how did you hear"],
};

const JOBBER_HEADERS: Record<string, string[]> = {
  firstName: ["client first name", "client firstname", "first name", "firstname"],
  lastName: ["client last name", "client lastname", "last name", "lastname"],
  email: ["client email", "email", "client email address", "email address"],
  phone: [
    "client phone number",
    "client phone",
    "phone number",
    "phone",
    "home phone",
    "mobile phone",
    "cell phone",
  ],
  streetAddress: [
    "property street 1",
    "property address",
    "property street",
    "street 1",
    "address line 1",
    "street address",
  ],
  address2: ["property street 2", "street 2", "address line 2", "unit", "apt"],
  city: ["property city", "city"],
  state: ["property state/province", "property state", "state/province", "state", "province"],
  zipCode: ["property postal code", "property zip", "postal code", "zip code", "zip"],
  numberOfDogs: ["# of dogs", "number of dogs", "dogs", "dog count"],
  yardSize: ["yard size", "lot size"],
  serviceFrequency: ["service frequency", "frequency"],
  serviceDay: ["service day", "day of week", "preferred day"],
  gateCode: ["gate code", "access code"],
  notes: ["notes", "client notes", "internal notes", "job notes", "comments"],
  status: ["status", "client status"],
  tags: ["tags", "labels"],
  leadSource: ["lead source", "source", "referral source"],
};

function detectPlatform(headers: string[]): Platform {
  const normalized = headers.map((h) => h.toLowerCase().trim());

  const jobberSignals = [
    "client first name",
    "client last name",
    "client email",
    "client phone number",
    "property street 1",
    "property city",
    "property state/province",
    "property postal code",
  ];
  const jobberMatches = jobberSignals.filter((s) => normalized.includes(s)).length;
  if (jobberMatches >= 3) return "jobber";

  const sweepandgoSignals = [
    "first name",
    "last name",
    "gate code",
    "# of dogs",
    "yard size",
    "service day",
    "service frequency",
  ];
  const sweepandgoMatches = sweepandgoSignals.filter((s) => normalized.includes(s)).length;
  if (sweepandgoMatches >= 3) return "sweepandgo";

  if (
    normalized.some((h) => h.includes("client ")) ||
    normalized.some((h) => h.includes("property "))
  ) {
    return "jobber";
  }

  return "sweepandgo";
}

function mapHeaders(
  headers: string[],
  headerMap: Record<string, string[]>
): Record<string, number> {
  const mapping: Record<string, number> = {};
  const normalized = headers.map((h) => h.toLowerCase().trim());

  for (const [field, aliases] of Object.entries(headerMap)) {
    for (let i = 0; i < normalized.length; i++) {
      if (aliases.includes(normalized[i])) {
        mapping[field] = i;
        break;
      }
    }
  }

  return mapping;
}

function getVal(row: string[], mapping: Record<string, number>, field: string): string {
  const idx = mapping[field];
  if (idx === undefined || idx >= row.length) return "";
  return (row[idx] || "").trim();
}

function normalizeFrequency(value: string): string {
  const v = value.toLowerCase().trim();
  if (!v) return "";
  if (v.includes("week") && !v.includes("bi")) return "weekly";
  if (
    v.includes("biweek") ||
    v.includes("bi-week") ||
    v.includes("every other") ||
    v.includes("2 week") ||
    v.includes("every 2")
  )
    return "biweekly";
  if (v.includes("month")) return "monthly";
  if (v.includes("one") || v.includes("once") || v.includes("single")) return "onetime";
  return v;
}

function normalizeDay(value: string): string {
  const v = value.toLowerCase().trim();
  if (!v) return "";
  const days: Record<string, string> = {
    mon: "monday",
    tue: "tuesday",
    wed: "wednesday",
    thu: "thursday",
    fri: "friday",
    sat: "saturday",
    sun: "sunday",
    monday: "monday",
    tuesday: "tuesday",
    wednesday: "wednesday",
    thursday: "thursday",
    friday: "friday",
    saturday: "saturday",
    sunday: "sunday",
    tbd: "tbd",
  };
  for (const [key, val] of Object.entries(days)) {
    if (v.startsWith(key)) return val;
  }
  return "tbd";
}

function normalizeStatus(value: string): string {
  const v = value.toLowerCase().trim();
  if (!v) return "lead";
  if (v === "active" || v === "current" || v === "subscribed") return "active";
  if (v === "paused" || v === "on hold" || v === "suspended" || v === "inactive") return "paused";
  if (v === "cancelled" || v === "canceled" || v === "deleted" || v === "removed")
    return "cancelled";
  if (v === "estimate" || v === "quote" || v === "pending") return "estimate";
  return "lead";
}

export function parseCompetitorCSV(
  csvText: string,
  platformOverride?: Platform,
  previewLimit?: number
): DetectResult {
  const { headers, rows } = parseCSV(csvText);

  if (headers.length === 0) {
    return {
      platform: "unknown",
      platformLabel: "Unknown",
      totalRows: 0,
      fieldMapping: {},
      preview: [],
      warnings: [],
      errors: [{ row: 0, message: "No headers found in CSV" }],
    };
  }

  const platform = platformOverride || detectPlatform(headers);
  const headerMap = platform === "jobber" ? JOBBER_HEADERS : SWEEPANDGO_HEADERS;
  const mapping = mapHeaders(headers, headerMap);

  const fieldMapping: Record<string, string> = {};
  for (const [field, idx] of Object.entries(mapping)) {
    fieldMapping[field] = headers[idx];
  }

  const warnings: string[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  if (mapping.firstName === undefined && mapping.lastName === undefined) {
    const nameIdx = headers.findIndex((h) => {
      const n = h.toLowerCase().trim();
      return (
        n === "name" ||
        n === "full name" ||
        n === "client name" ||
        n === "customer name" ||
        n === "customer"
      );
    });
    if (nameIdx >= 0) {
      mapping["fullName"] = nameIdx;
      fieldMapping["fullName"] = headers[nameIdx];
      warnings.push(
        `No separate first/last name columns found. Using "${headers[nameIdx]}" and splitting automatically.`
      );
    } else {
      errors.push({
        row: 0,
        message: "No name columns found in CSV. At least a first name column is required.",
      });
    }
  }

  const contacts: ParsedContact[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    let firstName = getVal(row, mapping, "firstName");
    let lastName = getVal(row, mapping, "lastName");

    if (!firstName && !lastName && mapping["fullName"] !== undefined) {
      const fullName = getVal(row, mapping, "fullName");
      const split = splitFullName(fullName);
      firstName = split.firstName;
      lastName = split.lastName;
    }

    if (!firstName) {
      errors.push({ row: i + 2, message: "Missing first name, row will be skipped" });
      continue;
    }

    const dogsVal = getVal(row, mapping, "numberOfDogs");
    let numberOfDogs: number | null = null;
    if (dogsVal) {
      const parsed = parseInt(dogsVal, 10);
      if (!isNaN(parsed)) numberOfDogs = parsed;
    }

    const tags = getVal(row, mapping, "tags");

    contacts.push({
      firstName,
      lastName,
      email: getVal(row, mapping, "email").toLowerCase(),
      phone: normalizePhone(getVal(row, mapping, "phone")),
      streetAddress: getVal(row, mapping, "streetAddress"),
      address2: getVal(row, mapping, "address2"),
      city: getVal(row, mapping, "city"),
      state: getVal(row, mapping, "state"),
      zipCode: getVal(row, mapping, "zipCode"),
      numberOfDogs,
      yardSize: getVal(row, mapping, "yardSize"),
      serviceFrequency: normalizeFrequency(getVal(row, mapping, "serviceFrequency")),
      serviceDay: normalizeDay(getVal(row, mapping, "serviceDay")),
      gateCode: getVal(row, mapping, "gateCode"),
      notes: getVal(row, mapping, "notes"),
      leadSource: getVal(row, mapping, "leadSource"),
      status: normalizeStatus(getVal(row, mapping, "status")),
      tags,
    });
  }

  const platformLabels: Record<Platform, string> = {
    sweepandgo: "Sweep & Go",
    jobber: "Jobber",
    unknown: "Unknown",
  };

  if (mapping.email === undefined)
    warnings.push("No email column detected. Duplicate detection by email will not be available.");
  if (mapping.streetAddress === undefined)
    warnings.push("No address column detected. Properties will not be created.");
  if (mapping.numberOfDogs === undefined) warnings.push("No dog count column detected.");

  const limit = previewLimit ?? 10;

  return {
    platform,
    platformLabel: platformLabels[platform],
    totalRows: contacts.length,
    fieldMapping,
    preview: limit === 0 ? contacts : contacts.slice(0, limit),
    warnings,
    errors,
  };
}

export function splitFullName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function normalizePhone(value: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function parseDate(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    let year = usMatch[3];
    if (year.length === 2) year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    return `${year}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }

  const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashMatch) {
    let year = dashMatch[3];
    if (year.length === 2) year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    return `${year}-${dashMatch[1].padStart(2, "0")}-${dashMatch[2].padStart(2, "0")}`;
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }

  return null;
}

export function parseCurrency(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
}

export function parseCurrencyCents(value: string): number | null {
  const dollars = parseCurrency(value);
  if (dollars === null) return null;
  return Math.round(dollars * 100);
}

const FREQUENCY_MAP: Record<string, string> = {
  weekly: "weekly",
  "every week": "weekly",
  "once a week": "weekly",
  "1x/week": "weekly",
  "once per week": "weekly",
  biweekly: "biweekly",
  "bi-weekly": "biweekly",
  "every other week": "biweekly",
  "every 2 weeks": "biweekly",
  "2x/month": "biweekly",
  monthly: "monthly",
  "once a month": "monthly",
  "1x/month": "monthly",
  "once per month": "monthly",
  "one time": "onetime",
  onetime: "onetime",
  "one-time": "onetime",
  "single visit": "onetime",
};

export function inferFrequency(value: string): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  return FREQUENCY_MAP[normalized] || null;
}

const STATUS_MAP: Record<string, string> = {
  lead: "lead",
  new: "lead",
  prospect: "lead",
  estimate: "estimate",
  quoted: "estimate",
  active: "active",
  current: "active",
  paused: "paused",
  "on hold": "paused",
  hold: "paused",
  suspended: "paused",
  cancelled: "cancelled",
  canceled: "cancelled",
  inactive: "cancelled",
  closed: "cancelled",
};

export function mapStatus(value: string): string | null {
  if (!value) return null;
  return STATUS_MAP[value.toLowerCase().trim()] || null;
}

const INVOICE_STATUS_MAP: Record<string, string> = {
  paid: "paid",
  "fully paid": "paid",
  unpaid: "pending",
  outstanding: "pending",
  pending: "pending",
  open: "pending",
  overdue: "pending",
  "past due": "pending",
  "partially paid": "pending",
  partial: "pending",
  void: "voided",
  voided: "voided",
  cancelled: "voided",
  canceled: "voided",
  draft: "draft",
  refunded: "refunded",
};

export function mapInvoiceStatus(value: string): string | null {
  if (!value) return null;
  return INVOICE_STATUS_MAP[value.toLowerCase().trim()] || null;
}

export function validateEmail(value: string): boolean {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validatePhone(value: string): boolean {
  if (!value) return true;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export interface ValidationError {
  row: number;
  field: string;
  value: string;
  message: string;
}

export interface TransformedRow {
  rowIndex: number;
  original: Record<string, string>;
  transformed: Record<string, any>;
  errors: ValidationError[];
  isValid: boolean;
}

export function applyTransformations(
  rows: string[][],
  headers: string[],
  mappings: Array<{ csvColumn: string; internalField: string }>,
  transformations: Array<{ field: string; type: string; params?: Record<string, any> }>,
  requiredFields: string[] = []
): TransformedRow[] {
  const results: TransformedRow[] = [];
  const columnIndex: Record<string, number> = {};
  headers.forEach((h, i) => { columnIndex[h] = i; });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const original: Record<string, string> = {};
    headers.forEach((h, idx) => { original[h] = row[idx] || ""; });

    const transformed: Record<string, any> = {};
    const errors: ValidationError[] = [];

    for (const mapping of mappings) {
      const colIdx = columnIndex[mapping.csvColumn];
      if (colIdx === undefined) continue;
      let value = (row[colIdx] || "").trim();
      transformed[mapping.internalField] = value;
    }

    for (const transform of transformations) {
      const value = transformed[transform.field];
      if (value === undefined || value === null || value === "") continue;

      switch (transform.type) {
        case "split_name": {
          const { firstName, lastName } = splitFullName(value);
          transformed.firstName = firstName;
          transformed.lastName = lastName;
          delete transformed.fullName;
          break;
        }
        case "normalize_phone":
          transformed[transform.field] = normalizePhone(value);
          break;
        case "parse_date": {
          const parsed = parseDate(value);
          if (parsed) {
            transformed[transform.field] = parsed;
          } else {
            errors.push({ row: i, field: transform.field, value, message: `Unable to parse date: "${value}"` });
          }
          break;
        }
        case "parse_currency": {
          const parsed = parseCurrency(value);
          if (parsed !== null) {
            transformed[transform.field] = parsed;
          } else {
            errors.push({ row: i, field: transform.field, value, message: `Unable to parse currency: "${value}"` });
          }
          break;
        }
        case "trim":
          transformed[transform.field] = String(value).trim();
          break;
        case "infer_frequency": {
          const freq = inferFrequency(value);
          if (freq) {
            transformed[transform.field] = freq;
          } else {
            errors.push({ row: i, field: transform.field, value, message: `Unknown frequency: "${value}"` });
          }
          break;
        }
        case "map_status": {
          const mapped = mapStatus(value);
          if (mapped) {
            transformed[transform.field] = mapped;
          } else {
            errors.push({ row: i, field: transform.field, value, message: `Unknown status: "${value}"` });
          }
          break;
        }
      }
    }

    if (transformed.email && !validateEmail(transformed.email)) {
      errors.push({ row: i, field: "email", value: transformed.email, message: "Invalid email format" });
    }
    if (transformed.phone && !validatePhone(transformed.phone)) {
      errors.push({ row: i, field: "phone", value: transformed.phone, message: "Invalid phone format" });
    }

    for (const req of requiredFields) {
      if (!transformed[req] || String(transformed[req]).trim() === "") {
        errors.push({ row: i, field: req, value: "", message: `Required field "${req}" is missing` });
      }
    }

    results.push({
      rowIndex: i,
      original,
      transformed,
      errors,
      isValid: errors.length === 0,
    });
  }

  return results;
}

export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

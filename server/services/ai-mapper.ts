import OpenAI from "openai";
import crypto from "crypto";

const KNOWN_ALIASES: Record<string, string[]> = {
  firstName: ["first name", "first_name", "firstname", "fname", "given name", "given_name"],
  lastName: [
    "last name",
    "last_name",
    "lastname",
    "lname",
    "surname",
    "family name",
    "family_name",
  ],
  fullName: [
    "full name",
    "full_name",
    "fullname",
    "name",
    "customer name",
    "client name",
    "customer",
    "client",
  ],
  email: ["email", "e-mail", "email address", "e-mail address", "emailaddress"],
  phone: [
    "phone",
    "phone number",
    "telephone",
    "tel",
    "cell",
    "cell phone",
    "mobile",
    "mobile phone",
    "phone_number",
  ],
  streetAddress: [
    "street address",
    "street_address",
    "address",
    "address1",
    "address 1",
    "street",
    "service address",
  ],
  address2: ["address 2", "address2", "address_2", "apt", "suite", "unit"],
  city: ["city", "town"],
  state: ["state", "st", "province"],
  zipCode: ["zip", "zip code", "zip_code", "zipcode", "postal code", "postal_code", "postalcode"],
  numberOfDogs: [
    "number of dogs",
    "dogs",
    "num_dogs",
    "number_of_dogs",
    "pet count",
    "pets",
    "# of dogs",
    "dog count",
  ],
  yardSize: ["yard size", "yard_size", "lot size", "lot_size", "property size"],
  serviceFrequency: [
    "frequency",
    "service frequency",
    "service_frequency",
    "schedule",
    "service schedule",
  ],
  leadSource: [
    "lead source",
    "lead_source",
    "referral source",
    "referral_source",
    "source",
    "how did you hear about us",
  ],
  status: ["status", "lead status", "lead_status", "customer status"],
  notes: ["notes", "note", "comments", "comment", "special instructions"],
  gateCode: ["gate code", "gate_code", "gatecode", "access code", "access_code"],
  serviceDay: ["service day", "service_day", "day of week", "day", "preferred day"],
  invoiceNumber: ["invoice number", "invoice_number", "invoice #", "invoice no", "inv #", "inv no"],
  invoiceDate: ["invoice date", "invoice_date", "date", "issued date", "issued_date", "issue date"],
  dueDate: ["due date", "due_date", "payment due", "payment due date"],
  paidDate: ["paid date", "paid_date", "payment date", "payment_date", "date paid"],
  invoiceTotal: ["total", "invoice total", "amount", "invoice amount", "amount due", "balance"],
  invoiceStatus: ["status", "invoice status", "payment status"],
  description: ["description", "line item", "service", "service description", "item"],
  quantity: ["quantity", "qty", "count"],
  unitPrice: ["unit price", "unit_price", "price", "rate", "price per unit"],
  lineTotal: ["line total", "line_total", "item total", "subtotal", "sub total"],
  taxAmount: ["tax", "tax amount", "tax_amount", "sales tax"],
  taxRate: ["tax rate", "tax_rate", "tax %", "tax percent"],
  discountAmount: ["discount", "discount amount", "discount_amount"],
  paymentAmount: ["payment amount", "payment_amount", "amount paid", "paid amount"],
  paymentMethod: ["payment method", "payment_method", "method", "pay method"],
  paymentReference: ["reference", "payment reference", "check number", "check #", "transaction id"],
  routeName: ["route", "route name", "route_name"],
};

export interface FieldMapping {
  csvColumn: string;
  internalField: string;
  confidence: number;
  reason: string;
}

export interface TransformSuggestion {
  field: string;
  type:
    | "split_name"
    | "normalize_phone"
    | "parse_date"
    | "parse_currency"
    | "trim"
    | "infer_frequency"
    | "map_status";
  params?: Record<string, any>;
}

export interface MappingResult {
  mappings: FieldMapping[];
  transformations: TransformSuggestion[];
  warnings: string[];
}

function deterministicMap(headers: string[], targetFields: string[]): MappingResult {
  const mappings: FieldMapping[] = [];
  const transformations: TransformSuggestion[] = [];
  const warnings: string[] = [];
  const usedFields = new Set<string>();

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    let bestMatch: { field: string; confidence: number } | null = null;

    for (const [field, aliases] of Object.entries(KNOWN_ALIASES)) {
      if (!targetFields.includes(field) && field !== "fullName") continue;

      if (aliases.includes(normalized) || normalized === field.toLowerCase()) {
        bestMatch = { field, confidence: 0.95 };
        break;
      }

      for (const alias of aliases) {
        if (normalized.includes(alias) || alias.includes(normalized)) {
          if (!bestMatch || bestMatch.confidence < 0.7) {
            bestMatch = { field, confidence: 0.7 };
          }
        }
      }
    }

    if (bestMatch && !usedFields.has(bestMatch.field)) {
      usedFields.add(bestMatch.field);

      if (bestMatch.field === "fullName") {
        mappings.push({
          csvColumn: header,
          internalField: "fullName",
          confidence: bestMatch.confidence,
          reason: `Header "${header}" appears to be a full name that will be split into first and last name`,
        });
        transformations.push({ field: "fullName", type: "split_name" });
      } else {
        mappings.push({
          csvColumn: header,
          internalField: bestMatch.field,
          confidence: bestMatch.confidence,
          reason: `Header "${header}" matches known alias for ${bestMatch.field}`,
        });
      }

      if (["phone"].includes(bestMatch.field)) {
        transformations.push({ field: bestMatch.field, type: "normalize_phone" });
      }
      if (["invoiceDate", "dueDate", "paidDate"].includes(bestMatch.field)) {
        transformations.push({ field: bestMatch.field, type: "parse_date" });
      }
      if (
        [
          "invoiceTotal",
          "unitPrice",
          "lineTotal",
          "taxAmount",
          "discountAmount",
          "paymentAmount",
        ].includes(bestMatch.field)
      ) {
        transformations.push({ field: bestMatch.field, type: "parse_currency" });
      }
      if (bestMatch.field === "serviceFrequency") {
        transformations.push({ field: bestMatch.field, type: "infer_frequency" });
      }
    } else if (!bestMatch) {
      warnings.push(`Column "${header}" could not be automatically mapped`);
    }
  }

  return { mappings, transformations, warnings };
}

const mappingCache = new Map<string, { result: MappingResult; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000;

export function hashFileContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function aiMapColumns(
  headers: string[],
  sampleRows: string[][],
  targetSchema: string,
  targetFields: string[]
): Promise<MappingResult> {
  const cacheKey = crypto
    .createHash("sha256")
    .update(JSON.stringify({ headers, targetSchema }))
    .digest("hex");
  const cached = mappingCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const prompt = `You are a data mapping assistant. Given CSV column headers and sample data, map each CSV column to the most appropriate internal field.

Target schema: ${targetSchema}
Available internal fields: ${targetFields.join(", ")}

CSV Headers: ${JSON.stringify(headers)}
Sample rows (first ${sampleRows.length}):
${sampleRows
  .slice(0, 5)
  .map((r, i) => `Row ${i + 1}: ${JSON.stringify(r)}`)
  .join("\n")}

For each CSV column, provide:
1. The best matching internal field (or "unmapped" if no match)
2. A confidence score from 0 to 1
3. A short reason explaining the mapping
4. Any suggested transformations (split_name, normalize_phone, parse_date, parse_currency, trim, infer_frequency, map_status)

Respond with ONLY valid JSON in this exact format:
{
  "mappings": [
    {"csvColumn": "header name", "internalField": "fieldName", "confidence": 0.95, "reason": "explanation"}
  ],
  "transformations": [
    {"field": "fieldName", "type": "transform_type"}
  ],
  "warnings": ["any warnings"]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");

    const parsed = JSON.parse(content) as MappingResult;

    if (!Array.isArray(parsed.mappings)) throw new Error("Invalid mappings format");
    for (const m of parsed.mappings) {
      if (
        typeof m.csvColumn !== "string" ||
        typeof m.internalField !== "string" ||
        typeof m.confidence !== "number"
      ) {
        throw new Error("Invalid mapping entry format");
      }
      m.confidence = Math.min(1, Math.max(0, m.confidence));
    }
    if (!Array.isArray(parsed.transformations)) parsed.transformations = [];
    if (!Array.isArray(parsed.warnings)) parsed.warnings = [];

    parsed.mappings = parsed.mappings.filter((m) => m.internalField !== "unmapped");

    mappingCache.set(cacheKey, { result: parsed, timestamp: Date.now() });
    return parsed;
  } catch (error) {
    console.error("[AI Mapper] AI mapping failed, falling back to deterministic:", error);
    const fallback = deterministicMap(headers, targetFields);
    fallback.warnings.push("AI mapping unavailable, using deterministic fallback");
    mappingCache.set(cacheKey, { result: fallback, timestamp: Date.now() });
    return fallback;
  }
}

export function getDeterministicMapping(headers: string[], targetFields: string[]): MappingResult {
  return deterministicMap(headers, targetFields);
}

export const CONTACT_FIELDS = [
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "streetAddress",
  "address2",
  "city",
  "state",
  "zipCode",
  "numberOfDogs",
  "yardSize",
  "serviceFrequency",
  "leadSource",
  "status",
  "notes",
  "gateCode",
  "serviceDay",
];

export const INVOICE_FIELDS = [
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "paidDate",
  "invoiceTotal",
  "invoiceStatus",
  "description",
  "quantity",
  "unitPrice",
  "lineTotal",
  "taxAmount",
  "taxRate",
  "discountAmount",
  "paymentAmount",
  "paymentMethod",
  "paymentReference",
  "firstName",
  "lastName",
  "fullName",
  "email",
];

export const ROUTE_FIELDS = [
  "routeName",
  "firstName",
  "lastName",
  "fullName",
  "email",
  "streetAddress",
  "city",
  "state",
  "zipCode",
];

/**
 * Airtable integration service for Lead Response operator sync.
 *
 * On each call, looks up the existing row by OperatorID (company ID) first.
 * PATCHes if found, POSTs if not.
 * Default values (ReminderTiming1, ReminderTiming2, Status, SetupComplete) are
 * set on row creation only.
 *
 * Credentials are read from env: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_OPERATOR_TABLE_ID
 */

import type { LeadResponseConfig } from "@shared/schema";
import type { Company } from "@shared/schema";

interface AirtableFieldMap {
  [key: string]: unknown;
}

function getAirtableCredentials(): { apiKey: string; baseId: string; tableId: string } | null {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_OPERATOR_TABLE_ID;
  if (!apiKey || !baseId || !tableId) return null;
  return { apiKey, baseId, tableId };
}

function buildAirtableFields(
  company: Pick<Company, "id" | "name" | "email" | "phone">,
  config: Partial<LeadResponseConfig>,
  isCreate: boolean
): AirtableFieldMap {
  const tiers = config.pricingTiers ?? [];

  const fields: AirtableFieldMap = {
    OperatorID: company.id,
    BusinessName: company.name,
    Email: company.email ?? null,
    Phone: company.phone ?? null,
    TelnyxNumber: config.lrPhoneNumber ?? null,
    BillingMode: config.billingMode ?? null,
    DepositPercent:
      config.depositPercent != null ? parseFloat(String(config.depositPercent)) : null,
    SchedulingPlatform: config.schedulingPlatform ?? null,
    ServiceZipCodes: config.serviceZipCodes ?? null,
    OutOfAreaMessage: config.outOfAreaMessage ?? null,
    Tier1Label: tiers[0]?.label ?? null,
    Tier1Price: tiers[0]?.pricePerVisit ?? null,
    Tier2Label: tiers[1]?.label ?? null,
    Tier2Price: tiers[1]?.pricePerVisit ?? null,
    Tier3Label: tiers[2]?.label ?? null,
    Tier3Price: tiers[2]?.pricePerVisit ?? null,
    Tier4Label: tiers[3]?.label ?? null,
    Tier4Price: tiers[3]?.pricePerVisit ?? null,
    Tier5Label: tiers[4]?.label ?? null,
    Tier5Price: tiers[4]?.pricePerVisit ?? null,
    Tier6Label: tiers[5]?.label ?? null,
    Tier6Price: tiers[5]?.pricePerVisit ?? null,
    PerDogAdder: config.perDogAdder != null ? parseFloat(String(config.perDogAdder)) : null,
    FirstTimeCleanupFee:
      config.firstTimeCleanupFee != null ? parseFloat(String(config.firstTimeCleanupFee)) : null,
  };

  if (isCreate) {
    fields.ReminderTiming1 = 48;
    fields.ReminderTiming2 = 24;
    fields.Status = "Active";
    fields.SetupComplete = false;
  }

  // Remove null values so Airtable doesn't error on unset optional fields
  for (const key of Object.keys(fields)) {
    if (fields[key] === null || fields[key] === undefined) {
      delete fields[key];
    }
  }
  // But always include OperatorID and BusinessName
  fields.OperatorID = company.id;
  fields.BusinessName = company.name;

  return fields;
}

async function findAirtableRowByOperatorId(
  creds: { apiKey: string; baseId: string; tableId: string },
  operatorId: string
): Promise<{ recordId: string } | null> {
  const url = new URL(
    `https://api.airtable.com/v0/${creds.baseId}/${encodeURIComponent(creds.tableId)}`
  );
  url.searchParams.set("filterByFormula", `{OperatorID}="${operatorId}"`);
  url.searchParams.set("maxRecords", "1");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[Airtable] Failed to query records: ${res.status} ${body}`);
    return null;
  }

  const data = (await res.json()) as { records: { id: string }[] };
  if (data.records && data.records.length > 0) {
    return { recordId: data.records[0].id };
  }
  return null;
}

async function patchAirtableRow(
  creds: { apiKey: string; baseId: string; tableId: string },
  recordId: string,
  fields: AirtableFieldMap
): Promise<string> {
  const url = `https://api.airtable.com/v0/${creds.baseId}/${encodeURIComponent(creds.tableId)}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airtable PATCH failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

async function createAirtableRow(
  creds: { apiKey: string; baseId: string; tableId: string },
  fields: AirtableFieldMap
): Promise<string> {
  const url = `https://api.airtable.com/v0/${creds.baseId}/${encodeURIComponent(creds.tableId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airtable POST failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Sync an operator's Lead Response config to Airtable.
 * Returns the Airtable record ID if successful, null if credentials not configured.
 * Throws on API errors.
 */
export async function syncLeadResponseConfigToAirtable(
  company: Pick<Company, "id" | "name" | "email" | "phone">,
  config: Partial<LeadResponseConfig>,
  _existingAirtableId?: string | null
): Promise<string | null> {
  const creds = getAirtableCredentials();
  if (!creds) {
    console.log("[Airtable] Credentials not configured — skipping sync");
    return null;
  }

  // Always query by OperatorID on each sync call to guarantee correctness
  // even if a cached ID has gone stale or the row was deleted in Airtable.
  const existing = await findAirtableRowByOperatorId(creds, company.id);
  const recordId = existing?.recordId ?? null;

  const isCreate = !recordId;
  const fields = buildAirtableFields(company, config, isCreate);

  if (recordId) {
    await patchAirtableRow(creds, recordId, fields);
    console.log(`[Airtable] PATCH operator ${company.id} record ${recordId}`);
    return recordId;
  } else {
    const newId = await createAirtableRow(creds, fields);
    console.log(`[Airtable] POST operator ${company.id} → new record ${newId}`);
    return newId;
  }
}

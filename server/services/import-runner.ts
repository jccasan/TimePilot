import { anthropic, CLAUDE_FAST_MODEL } from "./claude";
import { storage } from "../storage";
import { db } from "../db";
import { contacts, properties, routes } from "@shared/schema";
import type { ImportRow, InsertImportRow } from "@shared/schema";
import { geocodeAddress } from "./geocode";
import { applyTransformations } from "./import-transforms";
import type { ParsedContact } from "./competitor-import";

type ImportError = { row: number; field?: string; message: string };
type ContactStatus = "lead" | "estimate" | "active" | "paused" | "cancelled";
type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday"
  | "tbd";
type PaymentMethod = "cash" | "check" | "card" | "ach" | "other" | "imported";
type PaymentSource = "stripe" | "manual" | "imported";
type InvoiceStatus = "draft" | "sent" | "pending" | "paid" | "failed" | "refunded" | "voided";

const VALID_CONTACT_STATUSES = new Set<ContactStatus>([
  "lead",
  "estimate",
  "active",
  "paused",
  "cancelled",
]);
const VALID_DAY_OF_WEEK = new Set<DayOfWeek>([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "tbd",
]);
const VALID_INVOICE_STATUSES = new Set<InvoiceStatus>([
  "draft",
  "sent",
  "pending",
  "paid",
  "failed",
  "refunded",
  "voided",
]);

function toContactStatus(val: unknown): ContactStatus {
  return VALID_CONTACT_STATUSES.has(val as ContactStatus) ? (val as ContactStatus) : "lead";
}
function toDayOfWeek(val: unknown): DayOfWeek | null {
  return VALID_DAY_OF_WEEK.has(val as DayOfWeek) ? (val as DayOfWeek) : null;
}
function toInvoiceStatus(val: unknown): InvoiceStatus {
  return VALID_INVOICE_STATUSES.has(val as InvoiceStatus) ? (val as InvoiceStatus) : "pending";
}

const BATCH_SIZE = 250;
const GEOCODE_CONCURRENCY = 10;

class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];
  constructor(max: number) {
    this.count = max;
  }
  acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.count++;
    }
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function geocodeBatch(
  items: Array<{ id: string; street: string; city: string; state: string; zip: string }>,
  concurrency = GEOCODE_CONCURRENCY
): Promise<Map<string, { latitude: string; longitude: string } | null>> {
  const sem = new Semaphore(concurrency);
  const results = new Map<string, { latitude: string; longitude: string } | null>();

  await Promise.all(
    items.map(async (item) => {
      await sem.acquire();
      try {
        const coords = await geocodeAddress(item.street, item.city, item.state, item.zip);
        results.set(item.id, coords);
      } catch {
        results.set(item.id, null);
      } finally {
        sem.release();
      }
    })
  );

  return results;
}

async function updateProgress(
  jobId: string,
  importedRows: number,
  skippedRows: number,
  errors?: ImportError[]
): Promise<void> {
  await storage
    .updateImportRun(jobId, { importedRows, skippedRows, errors: errors ?? null })
    .catch(console.error);
}

export interface CompetitorImportPayload {
  companyId: string;
  jobId: string;
  contacts: ParsedContact[];
  platform: string;
  platformLabel: string;
  duplicateHandling: "skip" | "update";
  leadSourceName: string;
}

export async function enqueueCompetitorImport(payload: CompetitorImportPayload): Promise<void> {
  runCompetitorImport(payload).catch(async (err) => {
    console.error(`[import-runner] Competitor import ${payload.jobId} failed:`, err);
    const fatalError: ImportError[] = [{ row: 0, message: (err as Error)?.message || String(err) }];
    await storage
      .updateImportRun(payload.jobId, {
        status: "failed",
        errors: fatalError,
        completedAt: new Date(),
      })
      .catch(console.error);
  });
}

async function runCompetitorImport(payload: CompetitorImportPayload): Promise<void> {
  const { companyId, jobId, contacts: allContacts, duplicateHandling, leadSourceName } = payload;

  const existingContacts = await storage.getContacts(companyId, {});
  const emailSet = new Set<string>();
  const addressSet = new Set<string>();
  const emailToContactMap = new Map<string, (typeof existingContacts)[0]>();
  const addressToContactMap = new Map<string, (typeof existingContacts)[0]>();

  for (const c of existingContacts) {
    if (c.email) {
      const key = c.email.toLowerCase();
      emailSet.add(key);
      emailToContactMap.set(key, c);
    }
    if (c.streetAddress && c.city && c.state) {
      const key = `${c.streetAddress}|${c.city}|${c.state}|${c.zipCode ?? ""}`.toLowerCase();
      addressSet.add(key);
      addressToContactMap.set(key, c);
    }
  }

  let imported = 0;
  let skipped = 0;
  let updated = 0;
  const importErrors: Array<{ row: number; message: string }> = [];

  const batches = chunkArray(allContacts, BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const toInsert: Array<{ pc: ParsedContact; rowNum: number }> = [];
    const toUpdate: Array<{ pc: ParsedContact; existingId: string; rowNum: number }> = [];

    for (let i = 0; i < batch.length; i++) {
      const pc = batch[i];
      const globalRowNum = batchIdx * BATCH_SIZE + i + 2;
      const email = pc.email?.toLowerCase() || "";
      const addressKey =
        pc.streetAddress && pc.city && pc.state
          ? `${pc.streetAddress}|${pc.city}|${pc.state}|${pc.zipCode ?? ""}`.toLowerCase()
          : "";

      const isDuplicateEmail = email && emailSet.has(email);
      const isDuplicateAddress = addressKey && addressSet.has(addressKey);

      if (isDuplicateEmail || isDuplicateAddress) {
        if (duplicateHandling === "update") {
          const existing = isDuplicateEmail
            ? emailToContactMap.get(email)
            : addressKey
              ? addressToContactMap.get(addressKey)
              : undefined;
          if (existing) {
            toUpdate.push({ pc, existingId: existing.id, rowNum: globalRowNum });
            continue;
          }
        }
        skipped++;
        continue;
      }

      toInsert.push({ pc, rowNum: globalRowNum });
    }

    for (const { pc, existingId } of toUpdate) {
      try {
        const updates: Record<string, unknown> = {};
        if (pc.phone && !emailToContactMap.get(pc.email?.toLowerCase() || "")?.phone)
          updates.phone = pc.phone;
        if (pc.email && !emailToContactMap.get(pc.email.toLowerCase())?.email)
          updates.email = pc.email;
        if (pc.streetAddress) updates.streetAddress = pc.streetAddress;
        if (pc.city) updates.city = pc.city;
        if (pc.state) updates.state = pc.state;
        if (pc.zipCode) updates.zipCode = pc.zipCode;
        if (pc.numberOfDogs != null) updates.numberOfDogs = pc.numberOfDogs;
        if (pc.notes) updates.notes = pc.notes;
        if (pc.serviceFrequency) updates.serviceFrequency = pc.serviceFrequency;
        if (pc.serviceDay) updates.serviceDay = pc.serviceDay;
        if (Object.keys(updates).length > 0) {
          await storage.updateContact(existingId, companyId, updates);
        }
        updated++;
      } catch (err: unknown) {
        importErrors.push({
          row: 0,
          message: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (toInsert.length > 0) {
      const contactValues = toInsert.map(({ pc }) => ({
        companyId,
        firstName: pc.firstName,
        lastName: pc.lastName || "",
        email: pc.email || undefined,
        phone: pc.phone || undefined,
        streetAddress: pc.streetAddress || undefined,
        address2: pc.address2 || undefined,
        city: pc.city || undefined,
        state: pc.state || undefined,
        zipCode: pc.zipCode || undefined,
        numberOfDogs: pc.numberOfDogs ?? undefined,
        yardSize: pc.yardSize || undefined,
        serviceFrequency: pc.serviceFrequency || undefined,
        serviceDay: toDayOfWeek(pc.serviceDay) ?? undefined,
        notes: pc.notes || undefined,
        leadSource: pc.leadSource || leadSourceName || undefined,
        status: toContactStatus(pc.status),
      }));

      type ContactRow = typeof contacts.$inferSelect;
      let insertedContacts: ContactRow[] = [];
      try {
        const subBatches = chunkArray(contactValues, BATCH_SIZE);
        for (const sub of subBatches) {
          const rows = await db
            .insert(contacts)
            .values(sub as Array<typeof contacts.$inferInsert>)
            .returning();
          insertedContacts = insertedContacts.concat(rows);
        }
      } catch (err: unknown) {
        importErrors.push({
          row: batchIdx * BATCH_SIZE + 2,
          message: `Bulk insert failed: ${(err as Error).message}`,
        });
        skipped += toInsert.length;
        await updateProgress(jobId, imported + updated, skipped, importErrors);
        continue;
      }

      for (const c of insertedContacts) {
        if (c.email) emailSet.add(c.email.toLowerCase());
        const addressKey =
          c.streetAddress && c.city && c.state
            ? `${c.streetAddress}|${c.city}|${c.state}|${c.zipCode ?? ""}`.toLowerCase()
            : "";
        if (addressKey) addressSet.add(addressKey);
      }

      const addressItems: Array<{
        id: string;
        street: string;
        city: string;
        state: string;
        zip: string;
        pcIdx: number;
      }> = [];
      for (let i = 0; i < toInsert.length; i++) {
        const { pc } = toInsert[i];
        const contactId = insertedContacts[i]?.id;
        if (!contactId) continue;
        if (pc.streetAddress && pc.city && pc.state && pc.zipCode) {
          addressItems.push({
            id: contactId,
            street: pc.streetAddress,
            city: pc.city,
            state: pc.state,
            zip: pc.zipCode,
            pcIdx: i,
          });
        }
      }

      if (addressItems.length > 0) {
        const geocodedMap = await geocodeBatch(addressItems);

        const propertyValues = addressItems.map((addr) => {
          const { pc } = toInsert[addr.pcIdx];
          const coords = geocodedMap.get(addr.id);
          return {
            companyId,
            contactId: addr.id,
            streetAddress: pc.streetAddress,
            city: pc.city,
            state: pc.state,
            zipCode: pc.zipCode,
            numberOfDogs: pc.numberOfDogs ?? 1,
            yardSize: pc.yardSize || null,
            gateCode: pc.gateCode || null,
            latitude: coords?.latitude ?? null,
            longitude: coords?.longitude ?? null,
          };
        });

        const propSubBatches = chunkArray(propertyValues, BATCH_SIZE);
        for (const sub of propSubBatches) {
          await db
            .insert(properties)
            .values(sub as Array<typeof properties.$inferInsert>)
            .catch((err: unknown) => {
              importErrors.push({
                row: 0,
                message: `Property insert failed: ${(err as Error).message}`,
              });
            });
        }
      }

      imported += insertedContacts.length;
    }

    await updateProgress(
      jobId,
      imported + updated,
      skipped,
      importErrors.length > 0 ? importErrors : undefined
    );
  }

  await storage.updateImportRun(jobId, {
    status: "completed",
    importedRows: imported + updated,
    skippedRows: skipped,
    errors: importErrors.length > 0 ? importErrors : null,
    completedAt: new Date(),
  });
}

export interface CsvContactsPayload {
  companyId: string;
  jobId: string;
  headers: string[];
  rows: string[][];
  mappings: Array<{ csvColumn: string; internalField: string }>;
  transformations: Array<{ field: string; type: string; params?: Record<string, unknown> }>;
  skippedRows: number[];
  editedCells: Record<string, string>;
}

export async function enqueueCsvContactsImport(payload: CsvContactsPayload): Promise<void> {
  runCsvContactsImport(payload).catch(async (err) => {
    console.error(`[import-runner] CSV import ${payload.jobId} failed:`, err);
    const fatalError: ImportError[] = [{ row: 0, message: (err as Error)?.message || String(err) }];
    await storage
      .updateImportRun(payload.jobId, {
        status: "failed",
        errors: fatalError,
        completedAt: new Date(),
      })
      .catch(console.error);
  });
}

async function runCsvContactsImport(payload: CsvContactsPayload): Promise<void> {
  const {
    companyId,
    jobId,
    headers,
    rows: rawRows,
    mappings,
    transformations,
    skippedRows: skippedRowIndices,
    editedCells,
  } = payload;

  const rows = rawRows.map((row) => [...row]);
  for (const [key, value] of Object.entries(editedCells)) {
    const parts = key.split(":");
    const rowIdx = parseInt(parts[0]);
    const colName = parts[1];
    const colIdx = headers.indexOf(colName);
    if (rows[rowIdx] && colIdx >= 0) {
      rows[rowIdx][colIdx] = String(value);
    } else if (rows[rowIdx]) {
      const altParts = key.split("-").map(Number);
      if (altParts.length === 2 && rows[altParts[0]] && altParts[1] < rows[altParts[0]].length) {
        rows[altParts[0]][altParts[1]] = String(value);
      }
    }
  }

  const skipSet = new Set(skippedRowIndices);
  const transformed = applyTransformations(rows, headers, mappings, transformations, ["firstName"]);

  const existingContacts = await storage.getContacts(companyId, {});
  const emailSet = new Set<string>(
    existingContacts.map((c) => c.email?.toLowerCase()).filter(Boolean) as string[]
  );

  let imported = 0;
  let skipped = 0;
  const importErrors: Array<{ row: number; message: string }> = [];

  const validRows = transformed.filter((r) => !skipSet.has(r.rowIndex) && r.isValid);
  const invalidRows = transformed.filter((r) => !skipSet.has(r.rowIndex) && !r.isValid);
  const skippedManualRows = transformed.filter((r) => skipSet.has(r.rowIndex));

  skipped += skippedManualRows.length;
  for (const r of invalidRows) {
    skipped++;
    importErrors.push(
      ...r.errors.map((e) => ({ row: e.row + 2, message: `${e.field}: ${e.message}` }))
    );
  }

  const batches = chunkArray(validRows, BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const contactValues = batch.map((row) => {
      const t = row.transformed;
      return {
        companyId,
        firstName: String(t.firstName || "Unknown"),
        lastName: String(t.lastName || ""),
        email: t.email ? String(t.email) : null,
        phone: t.phone ? String(t.phone) : null,
        streetAddress: t.streetAddress ? String(t.streetAddress) : null,
        address2: t.address2 ? String(t.address2) : null,
        city: t.city ? String(t.city) : null,
        state: t.state ? String(t.state) : null,
        zipCode: t.zipCode ? String(t.zipCode) : null,
        numberOfDogs: t.numberOfDogs ? parseInt(String(t.numberOfDogs)) : null,
        yardSize: t.yardSize ? String(t.yardSize) : null,
        serviceFrequency: t.serviceFrequency ? String(t.serviceFrequency) : null,
        leadSource: t.leadSource ? String(t.leadSource) : null,
        status: toContactStatus(t.status),
        notes: t.notes ? String(t.notes) : null,
        serviceDay: toDayOfWeek(t.serviceDay) ?? undefined,
        gateCode: t.gateCode ? String(t.gateCode) : null,
      };
    });

    let insertedContacts: Array<typeof contacts.$inferSelect> = [];
    try {
      const subBatches = chunkArray(contactValues, BATCH_SIZE);
      for (const sub of subBatches) {
        const rows2 = await db
          .insert(contacts)
          .values(sub as Array<typeof contacts.$inferInsert>)
          .returning();
        insertedContacts = insertedContacts.concat(rows2);
      }
    } catch (err: unknown) {
      importErrors.push({
        row: batchIdx * BATCH_SIZE + 2,
        message: `Bulk insert failed: ${(err as Error).message}`,
      });
      skipped += batch.length;
      await updateProgress(jobId, imported, skipped, importErrors);
      continue;
    }

    for (const c of insertedContacts) {
      if (c.email) emailSet.add(c.email.toLowerCase());
    }

    const addressItems: Array<{
      id: string;
      street: string;
      city: string;
      state: string;
      zip: string;
      batchIdx: number;
    }> = [];
    for (let i = 0; i < insertedContacts.length; i++) {
      const c = insertedContacts[i];
      const bRow = batch[i];
      const t = bRow?.transformed;
      if (c.streetAddress && c.city && c.state && c.zipCode) {
        addressItems.push({
          id: c.id,
          street: c.streetAddress,
          city: c.city,
          state: c.state,
          zip: c.zipCode,
          batchIdx: i,
        });
      } else if (t?.streetAddress && t?.city && t?.state && t?.zipCode) {
        addressItems.push({
          id: c.id,
          street: String(t.streetAddress),
          city: String(t.city),
          state: String(t.state),
          zip: String(t.zipCode),
          batchIdx: i,
        });
      }
    }

    if (addressItems.length > 0) {
      const geocodedMap = await geocodeBatch(addressItems);

      const propertyValues = addressItems.map((addr) => {
        const coords = geocodedMap.get(addr.id);
        return {
          companyId,
          contactId: addr.id,
          streetAddress: addr.street,
          city: addr.city,
          state: addr.state,
          zipCode: addr.zip,
          numberOfDogs: 1,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        };
      });

      const propSubBatches = chunkArray(propertyValues, BATCH_SIZE);
      for (const sub of propSubBatches) {
        await db
          .insert(properties)
          .values(sub as Array<typeof properties.$inferInsert>)
          .catch((err: unknown) => {
            importErrors.push({
              row: 0,
              message: `Property insert failed: ${(err as Error).message}`,
            });
          });
      }
    }

    imported += insertedContacts.length;
    await updateProgress(
      jobId,
      imported,
      skipped,
      importErrors.length > 0 ? importErrors : undefined
    );
  }

  await storage.updateImportRun(jobId, {
    status: "completed",
    importedRows: imported,
    skippedRows: skipped,
    errors: importErrors.length > 0 ? importErrors : null,
    completedAt: new Date(),
  });
}

// ================ Staged CSV Contacts Import ================

export interface StagedCsvContactsPayload {
  companyId: string;
  jobId: string;
  batchId: string;
  headers: string[];
  rows: string[][];
  mappings: Array<{ csvColumn: string; internalField: string }>;
  transformations: Array<{ field: string; type: string; params?: Record<string, unknown> }>;
  skippedRows: number[];
  editedCells: Record<string, string>;
  /** How service days are assigned: preserve CSV value, rebuild via AI, or hybrid */
  routePreference?: "preserve" | "rebuild" | "hybrid" | null;
  /** Source platform identifier from the import wizard */
  platform?: string | null;
  /** Whether the user confirmed they know the next service date for their customers */
  knowsNextServiceDate?: boolean | null;
}

export async function enqueueStagedCsvContactsImport(
  payload: StagedCsvContactsPayload
): Promise<void> {
  runStagedCsvContactsImport(payload).catch(async (err) => {
    console.error(`[import-runner] Staged CSV import ${payload.jobId} failed:`, err);
    const fatalError: ImportError[] = [{ row: 0, message: (err as Error)?.message || String(err) }];
    await storage
      .updateImportRun(payload.jobId, {
        status: "failed",
        errors: fatalError,
        completedAt: new Date(),
      })
      .catch(console.error);
    await storage
      .updateImportBatch(payload.batchId, { status: "failed", completedAt: new Date() })
      .catch(console.error);
  });
}

// ---------------------------------------------------------------------------
// AI inference: derives service cadence from raw row text using OpenAI.
// Returns confidence 0-100 and a human-readable reason.
// Any error is surfaced as a low-confidence "could not infer" result so the
// caller can still fall back to catalog defaults.
// ---------------------------------------------------------------------------
type RowServiceInference = {
  suggestedFrequency: string | null;
  suggestedServiceDay: string | null;
  suggestedNextDate: string | null;
  confidenceScore: number;
  reason: string;
};

async function inferRowServiceLogic(row: ImportRow): Promise<RowServiceInference> {
  const raw = (row.rawJson ?? {}) as Record<string, string>;
  const mapped = (row.mappedContactJson ?? {}) as Record<string, unknown>;
  const service = (row.mappedServiceJson ?? {}) as Record<string, unknown>;

  // Gather every text field that could hint at frequency / schedule.
  // __importPlatform is stored by the import runner when the user selects a source
  // platform in the wizard (e.g. "sweepandgo", "jobber") — include it so the AI
  // can apply platform-specific scheduling conventions in its inference.
  const platformHint = raw.__importPlatform ? `source platform: ${raw.__importPlatform}` : null;
  const textHints = [
    raw.notes,
    raw.frequency,
    raw.service_frequency,
    raw.serviceFrequency,
    raw.schedule,
    raw.service_day,
    raw.serviceDay,
    raw.next_service,
    raw.nextService,
    service.serviceFrequency,
    service.serviceDay,
    mapped.notes,
    platformHint,
  ]
    .filter(Boolean)
    .join("; ");

  const today = new Date().toISOString().slice(0, 10);

  const defaultResult: RowServiceInference = {
    suggestedFrequency: null,
    suggestedServiceDay: null,
    suggestedNextDate: null,
    confidenceScore: 0,
    reason: "No service cadence hints found in row data.",
  };

  if (!textHints.trim()) return defaultResult;

  try {
    const prompt = `You are a pet waste removal scheduling assistant. Analyze the following customer record text and infer the service cadence.

Customer data hints: "${textHints}"
Today's date: ${today}

Respond with ONLY valid JSON:
{
  "suggestedFrequency": "<weekly|biweekly|monthly|onetime|null>",
  "suggestedServiceDay": "<monday|tuesday|wednesday|thursday|friday|saturday|sunday|null>",
  "suggestedNextDate": "<YYYY-MM-DD or null>",
  "confidenceScore": <0-100>,
  "reason": "<one sentence explanation>"
}

Rules:
- Set suggestedNextDate to the nearest future date matching suggestedServiceDay (within 14 days of today), or null if day is unknown.
- confidenceScore >= 80 means the data clearly states frequency/day; 50-79 means inferred; < 50 means guessing.
- If no frequency information exists at all, set all fields to null and confidenceScore to 0.`;

    const response = await anthropic.messages.create({
      model: CLAUDE_FAST_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0]?.type === "text" ? response.content[0].text : null;
    if (!content) return defaultResult;

    const parsed = JSON.parse(content) as {
      suggestedFrequency?: string | null;
      suggestedServiceDay?: string | null;
      suggestedNextDate?: string | null;
      confidenceScore?: number;
      reason?: string;
    };

    const VALID_FREQUENCIES = ["weekly", "biweekly", "monthly", "onetime"];
    const VALID_DAYS = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];

    return {
      suggestedFrequency:
        typeof parsed.suggestedFrequency === "string" &&
        VALID_FREQUENCIES.includes(parsed.suggestedFrequency)
          ? parsed.suggestedFrequency
          : null,
      suggestedServiceDay:
        typeof parsed.suggestedServiceDay === "string" &&
        VALID_DAYS.includes(parsed.suggestedServiceDay)
          ? parsed.suggestedServiceDay
          : null,
      suggestedNextDate:
        typeof parsed.suggestedNextDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed.suggestedNextDate)
          ? parsed.suggestedNextDate
          : null,
      confidenceScore:
        typeof parsed.confidenceScore === "number"
          ? Math.min(100, Math.max(0, Math.round(parsed.confidenceScore)))
          : 0,
      reason: typeof parsed.reason === "string" ? parsed.reason : "AI inference completed.",
    };
  } catch (err: unknown) {
    console.warn(
      "[import-runner] AI cadence inference failed:",
      err instanceof Error ? err.message : String(err)
    );
    return defaultResult;
  }
}

async function runStagedCsvContactsImport(payload: StagedCsvContactsPayload): Promise<void> {
  const {
    companyId,
    jobId,
    batchId,
    headers,
    rows: rawRows,
    mappings,
    transformations,
    skippedRows: skippedRowIndices,
    editedCells,
    routePreference,
    platform,
    knowsNextServiceDate,
  } = payload;

  await storage.updateImportBatch(batchId, { status: "processing" });

  const rows = rawRows.map((row) => [...row]);
  for (const [key, value] of Object.entries(editedCells)) {
    const parts = key.split(":");
    const rowIdx = parseInt(parts[0]);
    const colName = parts[1];
    const colIdx = headers.indexOf(colName);
    if (rows[rowIdx] && colIdx >= 0) {
      rows[rowIdx][colIdx] = String(value);
    } else if (rows[rowIdx]) {
      const altParts = key.split("-").map(Number);
      if (altParts.length === 2 && rows[altParts[0]] && altParts[1] < rows[altParts[0]].length) {
        rows[altParts[0]][altParts[1]] = String(value);
      }
    }
  }

  const skipSet = new Set(skippedRowIndices);
  const transformed = applyTransformations(rows, headers, mappings, transformations, ["firstName"]);

  // Build import_mappings records (deduped)
  const uniqueMappings = mappings.filter(
    (m, idx, arr) => arr.findIndex((x) => x.internalField === m.internalField) === idx
  );
  await storage.bulkCreateImportMappings(
    uniqueMappings.map((m) => ({
      batchId,
      sourceColumn: m.csvColumn,
      targetField: m.internalField,
      confidence: 80,
      isUserOverride: false,
    }))
  );

  const importRowsToInsert: InsertImportRow[] = [];

  for (const r of transformed) {
    const isSkipped = skipSet.has(r.rowIndex);
    if (isSkipped) continue;

    const t = r.transformed as Record<string, unknown>;
    const raw = r.original;

    // Build contact json
    const mappedContactJson: Record<string, unknown> = {
      firstName: t.firstName || null,
      lastName: t.lastName || null,
      email: t.email || null,
      phone: t.phone || null,
      streetAddress: t.streetAddress || null,
      address2: t.address2 || null,
      city: t.city || null,
      state: t.state || null,
      zipCode: t.zipCode || null,
      numberOfDogs: t.numberOfDogs || null,
      yardSize: t.yardSize || null,
      notes: t.notes || null,
      leadSource: t.leadSource || null,
      status: t.status || "lead",
      gateCode: t.gateCode || null,
    };

    // Apply any internal-field overrides from editedCells written by the wizard's step-5
    // day-reassignment panel. These use internal names ("serviceDay") rather than raw CSV
    // column headers, so they are NOT caught by the header-index lookup above and must
    // be applied here, post-transform, directly on the service/contact values.
    const INTERNAL_FIELD_OVERRIDE_KEYS = ["serviceDay", "serviceFrequency"];
    const internalOverrides: Record<string, string> = {};
    for (const fieldName of INTERNAL_FIELD_OVERRIDE_KEYS) {
      const cellKey = `${r.rowIndex}:${fieldName}`;
      if (Object.prototype.hasOwnProperty.call(editedCells, cellKey)) {
        internalOverrides[fieldName] = editedCells[cellKey];
      }
    }

    // Build service json — routePreference controls how serviceDay is handled:
    // "preserve"  → keep whatever the CSV says (or flag if absent)
    // "rebuild"   → always clear serviceDay so the resolver AI assigns it fresh
    // "hybrid"/null → keep present values, flag absent ones for review (default)
    // Internal field overrides from the wizard's day-panel take precedence over routePreference.
    const csvServiceDay = internalOverrides["serviceDay"] ?? t.serviceDay ?? null;
    const csvServiceFreq = internalOverrides["serviceFrequency"] ?? t.serviceFrequency ?? null;
    const effectiveServiceDay =
      routePreference === "rebuild" && !internalOverrides["serviceDay"] ? null : csvServiceDay;

    const mappedServiceJson: Record<string, unknown> = {
      serviceFrequency: csvServiceFreq || null,
      serviceDay: effectiveServiceDay,
    };

    // Compute missing service fields
    const missingFields: string[] = [];
    if (!mappedServiceJson.serviceFrequency) missingFields.push("frequency");
    // For "preserve", only flag serviceDay missing if it was truly absent in CSV.
    // For "rebuild", always flag serviceDay so the resolver fills it via AI.
    if (!mappedServiceJson.serviceDay || routePreference === "rebuild") {
      missingFields.push("serviceDay");
    }
    // price and billingRule are not in CSV but tracked as missing
    missingFields.push("price");
    missingFields.push("billingRule");

    // Validation errors from transform
    const validationErrors = r.errors.map((e) => ({ field: e.field, message: e.message }));

    const rowStatus: InsertImportRow["status"] =
      r.isValid && missingFields.length === 0 ? "ready" : "needs_review";

    // Store platform in rawJson as a hint field so it is available to the AI
    // inference step and for audit/debugging — competitor-specific scheduling
    // patterns (e.g. Sweep & Go biweekly cadences) are picked up from this.
    const rawWithPlatform = {
      ...(raw as Record<string, string>),
      ...(platform ? { __importPlatform: platform } : {}),
    };

    importRowsToInsert.push({
      batchId,
      companyId,
      rowIndex: r.rowIndex,
      rawJson: rawWithPlatform,
      mappedContactJson,
      mappedServiceJson,
      confidenceJson: {},
      missingFields,
      validationErrors,
      status: rowStatus,
      createdContactId: null,
      needsServiceSetup: missingFields.length > 0,
    });
  }

  const insertedRows = await storage.bulkCreateImportRows(importRowsToInsert);

  // Generate AI-inferred service cadence suggestions per needs_review row,
  // supplemented by rules-based pricing defaults from the company catalog.
  try {
    const pricingItems = await storage.getServicePricing(companyId);
    const activePricing = pricingItems.filter((item) => item.isActive);
    const defaultPricingItem =
      activePricing.length > 0
        ? activePricing.reduce((best, item) =>
            parseFloat(String(item.basePrice ?? "9999")) <
            parseFloat(String(best.basePrice ?? "9999"))
              ? item
              : best
          )
        : null;

    const unitToBillingRule: Record<string, string> = {
      per_visit: "per_visit",
      monthly: "monthly_flat",
      monthly_flat: "monthly_flat",
      per_dog: "per_dog",
    };

    const reviewRows = insertedRows.filter(
      (r) => r.status === "needs_review" && (r.missingFields || []).length > 0
    );

    for (const row of reviewRows) {
      const aiSuggestion = await inferRowServiceLogic(row);

      // Merge AI suggestion with pricing defaults for price/billingRule
      const missing = row.missingFields || [];
      const suggestion: {
        suggestedFrequency?: string;
        suggestedServiceDay?: string;
        suggestedNextDate?: string;
        suggestedPriceCents?: number;
        suggestedBillingRule?: string;
        confidenceScore: number;
        reason: string;
      } = {
        confidenceScore: aiSuggestion.confidenceScore,
        reason: aiSuggestion.reason,
      };

      if (missing.includes("frequency") && aiSuggestion.suggestedFrequency) {
        suggestion.suggestedFrequency = aiSuggestion.suggestedFrequency;
      }
      if (missing.includes("serviceDay") && aiSuggestion.suggestedServiceDay) {
        suggestion.suggestedServiceDay = aiSuggestion.suggestedServiceDay;
      }
      // If the user confirmed they know the next service date, boost confidence and expose
      // suggestedNextDate even when the AI has low confidence so the resolver can use it.
      if (aiSuggestion.suggestedNextDate) {
        suggestion.suggestedNextDate = aiSuggestion.suggestedNextDate;
        if (knowsNextServiceDate === true && suggestion.confidenceScore < 70) {
          suggestion.confidenceScore = Math.max(suggestion.confidenceScore, 70);
          suggestion.reason = `${suggestion.reason} (user confirmed next service date is known)`;
        }
      }

      // Fill price/billing from pricing catalog when AI cannot infer them
      if (missing.includes("price") && defaultPricingItem) {
        const cents = Math.round(parseFloat(String(defaultPricingItem.basePrice || "0")) * 100);
        if (cents > 0) suggestion.suggestedPriceCents = cents;
      }
      if (missing.includes("billingRule") && defaultPricingItem) {
        suggestion.suggestedBillingRule = unitToBillingRule[defaultPricingItem.unit] ?? "per_visit";
      }

      const hasAnySuggestion =
        suggestion.suggestedFrequency ||
        suggestion.suggestedServiceDay ||
        suggestion.suggestedNextDate ||
        suggestion.suggestedPriceCents ||
        suggestion.suggestedBillingRule;
      if (!hasAnySuggestion) continue;

      await storage.createImportRuleSuggestion({
        batchId,
        rowId: row.id,
        ...suggestion,
        isAccepted: false,
      });
    }
  } catch (suggestionErr: unknown) {
    // Non-fatal: suggestion failure must not block staging
    console.warn(
      "[import-runner] Suggestion generation failed:",
      suggestionErr instanceof Error ? suggestionErr.message : String(suggestionErr)
    );
  }

  const readyCount = insertedRows.filter((r) => r.status === "ready").length;
  const needsReviewCount = insertedRows.filter((r) => r.status === "needs_review").length;

  await storage.updateImportBatch(batchId, {
    status: "staged",
    totalRows: insertedRows.length,
    stagedRows: insertedRows.length,
    readyRows: readyCount,
    needsReviewRows: needsReviewCount,
    completedAt: new Date(),
  });

  await storage.updateImportRun(jobId, {
    status: "completed",
    importedRows: 0,
    skippedRows: transformed.filter((r) => skipSet.has(r.rowIndex)).length,
    errors: null,
    completedAt: new Date(),
  });
}

export interface CsvRoutesPayload {
  companyId: string;
  jobId: string;
  headers: string[];
  rows: string[][];
  mappings: Array<{ csvColumn: string; internalField: string }>;
  transformations: Array<{ field: string; type: string; params?: Record<string, unknown> }>;
  skippedRows: number[];
  editedCells: Record<string, string>;
}

export async function enqueueCsvRoutesImport(payload: CsvRoutesPayload): Promise<void> {
  runCsvRoutesImport(payload).catch(async (err) => {
    console.error(`[import-runner] CSV routes import ${payload.jobId} failed:`, err);
    const fatalError: ImportError[] = [{ row: 0, message: (err as Error)?.message || String(err) }];
    await storage
      .updateImportRun(payload.jobId, {
        status: "failed",
        errors: fatalError,
        completedAt: new Date(),
      })
      .catch(console.error);
  });
}

async function runCsvRoutesImport(payload: CsvRoutesPayload): Promise<void> {
  const { companyId, jobId, headers, rows, mappings, transformations, skippedRows, editedCells } =
    payload;

  const skipSet = new Set<number>(skippedRows);
  const mutableRows = rows.map((r) => [...r]);
  for (const [key, value] of Object.entries(editedCells)) {
    const [rowIdx, colIdx] = key.split("-").map(Number);
    if (mutableRows[rowIdx] && colIdx < (mutableRows[rowIdx]?.length ?? 0)) {
      mutableRows[rowIdx][colIdx] = String(value);
    }
  }

  const { applyTransformations } = await import("./import-transforms");
  const transformed = applyTransformations(mutableRows, headers, mappings, transformations, [
    "routeName",
  ]);

  const validRows = transformed.filter((r) => !skipSet.has(r.rowIndex) && r.isValid);
  const importErrors: ImportError[] = [];

  for (const r of transformed) {
    if (!skipSet.has(r.rowIndex) && !r.isValid) {
      importErrors.push(...r.errors.map((e) => ({ row: r.rowIndex + 2, message: e.message })));
    }
  }

  let imported = 0;
  const skipped = transformed.length - validRows.length;

  const batches = chunkArray(validRows, BATCH_SIZE);
  for (const batch of batches) {
    const routeValues = batch
      .map((r) => {
        const t = r.transformed as Record<string, unknown>;
        return {
          companyId,
          name: String(t.routeName || t.name || ""),
          dayOfWeek: toDayOfWeek(t.dayOfWeek),
          date: t.date ? String(t.date) : null,
          color: t.color ? String(t.color) : "#3b82f6",
          isLocked: false,
        };
      })
      .filter((v) => v.name);

    if (routeValues.length === 0) continue;

    try {
      const inserted = await db
        .insert(routes)
        .values(routeValues as Array<typeof routes.$inferInsert>)
        .returning();
      imported += inserted.length;
    } catch (err: unknown) {
      importErrors.push({ row: 0, message: `Route insert failed: ${(err as Error).message}` });
    }

    await updateProgress(
      jobId,
      imported,
      skipped,
      importErrors.length > 0 ? importErrors : undefined
    );
  }

  await storage.updateImportRun(jobId, {
    status: "completed",
    importedRows: imported,
    skippedRows: skipped,
    errors: importErrors.length > 0 ? importErrors : null,
    completedAt: new Date(),
  });
}

export interface SweepAndGoInvoicesPayload {
  companyId: string;
  jobId: string;
  csvText: string;
  allowDuplicates: boolean;
  includeInReminders: boolean;
}

export async function enqueueSweepAndGoInvoicesImport(
  payload: SweepAndGoInvoicesPayload
): Promise<void> {
  runSweepAndGoInvoicesImport(payload).catch(async (err) => {
    console.error(`[import-runner] S&G invoices import ${payload.jobId} failed:`, err);
    const fatalError: ImportError[] = [{ row: 0, message: (err as Error)?.message || String(err) }];
    await storage
      .updateImportRun(payload.jobId, {
        status: "failed",
        errors: fatalError,
        completedAt: new Date(),
      })
      .catch(console.error);
  });
}

async function runSweepAndGoInvoicesImport(payload: SweepAndGoInvoicesPayload): Promise<void> {
  const { companyId, jobId, csvText, allowDuplicates, includeInReminders } = payload;

  const { parseSweepAndGoInvoices } = await import("./sweepandgo-parser");
  const parseResult = parseSweepAndGoInvoices(csvText);

  await storage.updateImportRun(jobId, {
    totalRows: parseResult.invoices.length,
  });

  let imported = 0;
  let skipped = 0;
  const importErrors: Array<{ row: number; message: string }> = [];

  const allContacts = await storage.getContacts(companyId);
  const emailToContact = new Map<string, (typeof allContacts)[0]>();
  const nameToContact = new Map<string, (typeof allContacts)[0]>();

  for (const c of allContacts) {
    if (c.email) emailToContact.set(c.email.toLowerCase(), c);
    const nameKey = `${c.firstName} ${c.lastName}`.toLowerCase().trim();
    nameToContact.set(nameKey, c);
  }

  const batches = chunkArray(parseResult.invoices, BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    for (const inv of batch) {
      try {
        const existing = await storage.getInvoiceByExternalId(
          companyId,
          "sweepandgo",
          inv.externalId
        );
        if (existing && !allowDuplicates) {
          skipped++;
          continue;
        }

        let contactId: string | null = null;
        if (inv.contactEmail) {
          const match = emailToContact.get(inv.contactEmail.toLowerCase());
          if (match) contactId = match.id;
        }
        if (!contactId && inv.contactName) {
          const match = nameToContact.get(inv.contactName.toLowerCase().trim());
          if (match) contactId = match.id;
        }

        if (!contactId) {
          importErrors.push({
            row: 0,
            message: `Could not match invoice ${inv.invoiceNumber} to existing contact`,
          });
          skipped++;
          continue;
        }

        let invoiceNum = inv.invoiceNumber;
        if (existing && allowDuplicates) invoiceNum = `${inv.invoiceNumber}-imp-${Date.now()}`;

        const invoice = await storage.createInvoice({
          companyId,
          contactId,
          invoiceNumber: invoiceNum,
          dueDate: inv.dueDate,
          subtotal: String(inv.subtotal),
          taxRate: String(inv.taxRate),
          tax: String(inv.tax),
          discountAmount: String(inv.discountAmount),
          total: String(inv.total),
          status: toInvoiceStatus(inv.status),
          source: "imported",
          externalSource: "sweepandgo",
          externalId: inv.externalId,
          importRunId: jobId,
          issuedDate: inv.issuedDate || null,
          notes: inv.notes || null,
          excludeFromReminders: !includeInReminders,
          paidAt:
            inv.status === "paid" && inv.payments.length > 0
              ? new Date(inv.payments[0].paidAt)
              : null,
        });

        for (const li of inv.lineItems) {
          await storage.createInvoiceLineItem({
            invoiceId: invoice.id,
            description: li.description,
            quantity: li.quantity,
            unitPrice: String(li.unitPrice),
            total: String(li.total),
          });
        }

        for (let pIdx = 0; pIdx < inv.payments.length; pIdx++) {
          const payment = inv.payments[pIdx];
          const paymentExtId = `sweepandgo-payment-${inv.externalId}-${pIdx}`;
          const existingPayment = await storage.getInvoicePaymentByExternalId(
            companyId,
            paymentExtId
          );
          if (existingPayment) continue;
          await storage.createInvoicePayment({
            companyId,
            invoiceId: invoice.id,
            amountCents: payment.amountCents,
            paidAt: new Date(payment.paidAt),
            method: "imported" as PaymentMethod,
            reference: payment.reference || null,
            source: "imported" as PaymentSource,
            externalId: paymentExtId,
            importRunId: jobId,
          });
        }

        imported++;
      } catch (invErr: unknown) {
        importErrors.push({
          row: 0,
          message: `Invoice ${inv.invoiceNumber}: ${(invErr as Error).message}`,
        });
        skipped++;
      }
    }

    await updateProgress(
      jobId,
      imported,
      skipped,
      importErrors.length > 0 ? importErrors : undefined
    );
  }

  await storage.updateImportRun(jobId, {
    status: "completed",
    totalRows: parseResult.invoices.length,
    importedRows: imported,
    skippedRows: skipped,
    errors: importErrors.length > 0 ? importErrors : null,
    completedAt: new Date(),
  });
}

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { contacts, properties, servicePlans, importRows } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { geocodeAddress } from "../services/geocode";

import { isAuthenticated, getCompanyContext, requireRole, handleError, p } from "./shared";

type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday"
  | "tbd";

type ServiceFrequency = "weekly" | "biweekly" | "monthly" | "onetime";

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

const VALID_SERVICE_FREQUENCY = new Set<ServiceFrequency>([
  "weekly",
  "biweekly",
  "monthly",
  "onetime",
]);

function toDayOfWeek(val: unknown): DayOfWeek | null {
  return VALID_DAY_OF_WEEK.has(val as DayOfWeek) ? (val as DayOfWeek) : null;
}

function toServiceFrequency(val: unknown): ServiceFrequency | null {
  const s = String(val || "")
    .toLowerCase()
    .trim();
  if (VALID_SERVICE_FREQUENCY.has(s as ServiceFrequency)) return s as ServiceFrequency;
  if (s === "bi-weekly" || s === "every_2_weeks" || s === "every 2 weeks") return "biweekly";
  if (s === "as-needed" || s === "onetime" || s === "one-time") return "onetime";
  return null;
}

type ImportRowStatus = "needs_review" | "ready" | "ignored" | "imported";

type ServiceField = "frequency" | "serviceDay" | "price" | "billingRule";

function computeHealthScore(rows: Awaited<ReturnType<typeof storage.getImportRows>>) {
  const total = rows.length;
  if (total === 0) {
    return {
      overall: 100,
      categories: {
        names: 100,
        addresses: 100,
        contactInfo: 100,
        frequency: 100,
        serviceDay: 100,
        price: 100,
        billingRule: 100,
      },
      counts: {
        missingFrequency: 0,
        missingServiceDay: 0,
        missingPrice: 0,
        missingBillingRule: 0,
      },
    };
  }

  let namesOk = 0;
  let addressesOk = 0;
  let contactInfoOk = 0;
  let frequencyOk = 0;
  let serviceDayOk = 0;
  let priceOk = 0;
  let billingRuleOk = 0;

  for (const row of rows) {
    const c = (row.mappedContactJson || {}) as Record<string, unknown>;
    const s = (row.mappedServiceJson || {}) as Record<string, unknown>;

    if (c.firstName && String(c.firstName).trim()) namesOk++;
    if (c.streetAddress && c.city && c.state) addressesOk++;
    if (c.email || c.phone) contactInfoOk++;
    if (s.serviceFrequency || c.serviceFrequency) frequencyOk++;
    if (s.serviceDay || c.serviceDay) serviceDayOk++;
    if (s.priceCents) priceOk++;
    if (s.billingRule) billingRuleOk++;
  }

  const pct = (n: number) => Math.round((n / total) * 100);

  const categories = {
    names: pct(namesOk),
    addresses: pct(addressesOk),
    contactInfo: pct(contactInfoOk),
    frequency: pct(frequencyOk),
    serviceDay: pct(serviceDayOk),
    price: pct(priceOk),
    billingRule: pct(billingRuleOk),
  };

  const overall = Math.round(
    (categories.names * 2 +
      categories.addresses * 2 +
      categories.contactInfo +
      categories.frequency +
      categories.serviceDay +
      categories.price +
      categories.billingRule) /
      9
  );

  return {
    overall,
    categories,
    counts: {
      missingFrequency: total - frequencyOk,
      missingServiceDay: total - serviceDayOk,
      missingPrice: total - priceOk,
      missingBillingRule: total - billingRuleOk,
    },
  };
}

function recomputeMissingFields(
  contactJson: Record<string, unknown>,
  serviceJson: Record<string, unknown>
): string[] {
  const missingFields: string[] = [];
  if (!serviceJson.serviceFrequency && !contactJson.serviceFrequency)
    missingFields.push("frequency");
  if (!serviceJson.serviceDay && !contactJson.serviceDay) missingFields.push("serviceDay");
  if (!serviceJson.priceCents) missingFields.push("price");
  if (!serviceJson.billingRule) missingFields.push("billingRule");
  return missingFields;
}

export async function registerImportBatchesRoutes(app: Express): Promise<void> {
  // GET /api/import-batches - list batches for company
  app.get("/api/import-batches", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const batches = await storage.getImportBatches(companyId);
      res.json(batches);
    } catch (err) {
      handleError(res, err);
    }
  });

  // GET /api/import-batches/:batchId - get single batch
  app.get("/api/import-batches/:batchId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const batch = await storage.getImportBatch(p(req.params.batchId), companyId);
      if (!batch) return res.status(404).json({ error: "Import batch not found" });
      res.json(batch);
    } catch (err) {
      handleError(res, err);
    }
  });

  // GET /api/import-batches/:batchId/health - import health score
  app.get(
    "/api/import-batches/:batchId/health",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const batch = await storage.getImportBatch(p(req.params.batchId), companyId);
        if (!batch) return res.status(404).json({ error: "Import batch not found" });

        const rows = await storage.getImportRows(batch.id, companyId);
        const health = computeHealthScore(rows);

        const readyCount = rows.filter((r) => r.status === "ready").length;
        const needsReviewCount = rows.filter((r) => r.status === "needs_review").length;
        const ignoredCount = rows.filter((r) => r.status === "ignored").length;
        const importedCount = rows.filter((r) => r.status === "imported").length;

        const company = await storage.getCompany(companyId).catch(() => null);
        const pricingConfig = company?.pricingConfig as
          | { pricingRules?: unknown }
          | null
          | undefined;
        const pricingRules = pricingConfig?.pricingRules ?? null;

        res.json({
          batchId: batch.id,
          status: batch.status,
          totalRows: rows.length,
          readyRows: readyCount,
          needsReviewRows: needsReviewCount,
          ignoredRows: ignoredCount,
          importedRows: importedCount,
          health,
          pricingRules,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // GET /api/import-batches/:batchId/resolver - staged rows grouped by missing field
  app.get(
    "/api/import-batches/:batchId/resolver",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const batch = await storage.getImportBatch(p(req.params.batchId), companyId);
        if (!batch) return res.status(404).json({ error: "Import batch not found" });

        const statusFilter = (req.query.status as string) || undefined;
        const missingFieldFilter = (req.query.missingField as string) || undefined;

        const rows = await storage.getImportRows(batch.id, companyId, {
          status: statusFilter,
          missingField: missingFieldFilter,
        });

        const suggestions = await storage.getImportRuleSuggestions(batch.id);
        const suggestionByRowId = new Map(suggestions.map((s) => [s.rowId, s]));

        const enriched = rows.map((row) => ({
          ...row,
          suggestion: suggestionByRowId.get(row.id) || null,
        }));

        // Group by missing fields
        const grouped: Record<ServiceField, typeof enriched> = {
          frequency: [],
          serviceDay: [],
          price: [],
          billingRule: [],
        };

        for (const row of enriched) {
          for (const field of row.missingFields || []) {
            if (field in grouped) {
              grouped[field as ServiceField].push(row);
            }
          }
        }

        res.json({
          rows: enriched,
          grouped,
          missingFieldCounts: {
            frequency: grouped.frequency.length,
            serviceDay: grouped.serviceDay.length,
            price: grouped.price.length,
            billingRule: grouped.billingRule.length,
          },
          statusCounts: {
            needs_review: rows.filter((r) => r.status === "needs_review").length,
            ready: rows.filter((r) => r.status === "ready").length,
            ignored: rows.filter((r) => r.status === "ignored").length,
            imported: rows.filter((r) => r.status === "imported").length,
          },
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // PATCH /api/import-batches/:batchId/rows/bulk - bulk update selected rows
  app.patch(
    "/api/import-batches/:batchId/rows/bulk",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const batch = await storage.getImportBatch(p(req.params.batchId), companyId);
        if (!batch) return res.status(404).json({ error: "Import batch not found" });

        const body = req.body as {
          rowIds?: unknown;
          updates?: {
            serviceFrequency?: string;
            serviceDay?: string;
            price?: number;
            billingRule?: string;
            status?: string;
            yardSizeTier?: number;
            billingTerms?: string;
          };
        };

        if (!Array.isArray(body.rowIds) || body.rowIds.length === 0) {
          return res.status(400).json({ error: "rowIds array is required" });
        }

        const rowIds = body.rowIds.filter((id): id is string => typeof id === "string");
        const updates = body.updates || {};

        const VALID_STATUSES: ImportRowStatus[] = ["needs_review", "ready", "ignored", "imported"];
        if (updates.status && !VALID_STATUSES.includes(updates.status as ImportRowStatus)) {
          return res.status(400).json({ error: "Invalid status value" });
        }

        // Fetch rows to merge updates into mappedServiceJson
        const existingRows = await storage.getImportRows(batch.id, companyId);
        const rowMap = new Map(existingRows.map((r) => [r.id, r]));

        for (const rowId of rowIds) {
          const row = rowMap.get(rowId);
          if (!row) continue;

          const currentService = (row.mappedServiceJson || {}) as Record<string, unknown>;
          const updatedService = { ...currentService };

          if (updates.serviceFrequency) updatedService.serviceFrequency = updates.serviceFrequency;
          if (updates.serviceDay) updatedService.serviceDay = updates.serviceDay;
          if (updates.price != null) updatedService.priceCents = Math.round(updates.price * 100);
          if (updates.billingRule) updatedService.billingRule = updates.billingRule;
          if (updates.billingTerms) updatedService.billingTerms = updates.billingTerms;

          const currentContact = (row.mappedContactJson || {}) as Record<string, unknown>;
          const updatedContact = { ...currentContact };
          if (updates.yardSizeTier != null) updatedContact.yardSizeTier = updates.yardSizeTier;
          const missingFields = recomputeMissingFields(updatedContact, updatedService);

          const newStatus: ImportRowStatus =
            (updates.status as ImportRowStatus) ||
            (missingFields.length === 0
              ? "ready"
              : row.status === "ignored"
                ? "ignored"
                : "needs_review");

          await storage.updateImportRow(rowId, companyId, {
            mappedContactJson: updatedContact,
            mappedServiceJson: updatedService,
            missingFields,
            status: newStatus,
          });
        }

        // Refresh batch counts
        const allRows = await storage.getImportRows(batch.id, companyId);
        await storage.updateImportBatch(batch.id, {
          readyRows: allRows.filter((r) => r.status === "ready").length,
          needsReviewRows: allRows.filter((r) => r.status === "needs_review").length,
          ignoredRows: allRows.filter((r) => r.status === "ignored").length,
        });

        res.json({ updated: rowIds.length });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // PATCH /api/import-batches/:batchId/rows/:rowId - update individual row
  app.patch(
    "/api/import-batches/:batchId/rows/:rowId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const batch = await storage.getImportBatch(p(req.params.batchId), companyId);
        if (!batch) return res.status(404).json({ error: "Import batch not found" });

        const rowId = p(req.params.rowId);
        const body = req.body as {
          status?: string;
          mappedContactJson?: Record<string, unknown>;
          mappedServiceJson?: Record<string, unknown>;
        };

        const VALID_STATUSES: ImportRowStatus[] = ["needs_review", "ready", "ignored", "imported"];
        if (body.status && !VALID_STATUSES.includes(body.status as ImportRowStatus)) {
          return res.status(400).json({ error: "Invalid status value" });
        }

        const row = await storage.getImportRow(rowId, companyId);
        if (!row || row.batchId !== batch.id)
          return res.status(404).json({ error: "Row not found" });

        const updateData: {
          status?: ImportRowStatus;
          mappedContactJson?: Record<string, unknown>;
          mappedServiceJson?: Record<string, unknown>;
          missingFields?: string[];
        } = {};

        if (body.status) updateData.status = body.status as ImportRowStatus;
        if (body.mappedContactJson) updateData.mappedContactJson = body.mappedContactJson;

        if (body.mappedServiceJson) {
          updateData.mappedServiceJson = body.mappedServiceJson;
          const currentContact = (row.mappedContactJson || {}) as Record<string, unknown>;
          const missingFields = recomputeMissingFields(currentContact, body.mappedServiceJson);
          updateData.missingFields = missingFields;
          if (!body.status) {
            updateData.status = missingFields.length === 0 ? "ready" : "needs_review";
          }
        }

        const updated = await storage.updateImportRow(rowId, companyId, updateData);

        // Refresh batch counts
        const allRows = await storage.getImportRows(batch.id, companyId);
        await storage.updateImportBatch(batch.id, {
          readyRows: allRows.filter((r) => r.status === "ready").length,
          needsReviewRows: allRows.filter((r) => r.status === "needs_review").length,
          ignoredRows: allRows.filter((r) => r.status === "ignored").length,
        });

        res.json(updated);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // POST /api/import-batches/:batchId/accept-suggestions - accept high-confidence suggestions
  app.post(
    "/api/import-batches/:batchId/accept-suggestions",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const batch = await storage.getImportBatch(p(req.params.batchId), companyId);
        if (!batch) return res.status(404).json({ error: "Import batch not found" });

        const threshold = typeof req.body.threshold === "number" ? req.body.threshold : 75;
        const suggestions = await storage.getImportRuleSuggestions(batch.id);
        const highConfidence = suggestions.filter(
          (s) => s.confidenceScore >= threshold && !s.isAccepted
        );

        let accepted = 0;
        for (const suggestion of highConfidence) {
          const row = await storage.getImportRow(suggestion.rowId, companyId);
          if (!row) continue;

          const currentService = (row.mappedServiceJson || {}) as Record<string, unknown>;
          const updatedService = { ...currentService };

          if (suggestion.suggestedFrequency)
            updatedService.serviceFrequency = suggestion.suggestedFrequency;
          if (suggestion.suggestedServiceDay)
            updatedService.serviceDay = suggestion.suggestedServiceDay;
          if (suggestion.suggestedPriceCents)
            updatedService.priceCents = suggestion.suggestedPriceCents;
          if (suggestion.suggestedBillingRule)
            updatedService.billingRule = suggestion.suggestedBillingRule;

          const currentContact = (row.mappedContactJson || {}) as Record<string, unknown>;
          const missingFields = recomputeMissingFields(currentContact, updatedService);

          await storage.updateImportRow(suggestion.rowId, companyId, {
            mappedServiceJson: updatedService,
            missingFields,
            status: missingFields.length === 0 ? "ready" : "needs_review",
          });

          await storage.updateImportRuleSuggestion(suggestion.id, { isAccepted: true });
          accepted++;
        }

        // Refresh batch counts
        const allRows = await storage.getImportRows(batch.id, companyId);
        await storage.updateImportBatch(batch.id, {
          readyRows: allRows.filter((r) => r.status === "ready").length,
          needsReviewRows: allRows.filter((r) => r.status === "needs_review").length,
          ignoredRows: allRows.filter((r) => r.status === "ignored").length,
        });

        res.json({ accepted });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // POST /api/import-batches/:batchId/commit - commit READY rows to production
  app.post(
    "/api/import-batches/:batchId/commit",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const batch = await storage.getImportBatch(p(req.params.batchId), companyId);
        if (!batch) return res.status(404).json({ error: "Import batch not found" });

        if (batch.status === "committed") {
          return res.status(400).json({ error: "Batch has already been committed" });
        }

        const allRows = await storage.getImportRows(batch.id, companyId);
        // Commit ready rows fully; needs_review rows get a contact but no service plan.
        // Ignored rows are counted but never touched.
        const committableRows = allRows.filter(
          (r) => r.status === "ready" || r.status === "needs_review"
        );
        const ignoredRows = allRows.filter((r) => r.status === "ignored");

        let createdContacts = 0;
        let createdServicePlans = 0;
        let needsSetup = 0;

        // All-or-nothing transaction: any row failure rolls back all inserts
        await db.transaction(async (tx) => {
          for (const row of committableRows) {
            const isReady = row.status === "ready";
            const contactData = (row.mappedContactJson || {}) as Record<string, unknown>;
            const serviceData = (row.mappedServiceJson || {}) as Record<string, unknown>;

            const firstName = String(contactData.firstName || "Unknown");
            const lastName = String(contactData.lastName || "");
            const email = contactData.email ? String(contactData.email) : null;
            const phone = contactData.phone ? String(contactData.phone) : null;
            const streetAddress = contactData.streetAddress
              ? String(contactData.streetAddress)
              : null;
            const city = contactData.city ? String(contactData.city) : null;
            const state = contactData.state ? String(contactData.state) : null;
            const zipCode = contactData.zipCode ? String(contactData.zipCode) : null;
            const notes = contactData.notes ? String(contactData.notes) : null;
            const leadSource = contactData.leadSource ? String(contactData.leadSource) : null;
            const numberOfDogs = contactData.numberOfDogs ? Number(contactData.numberOfDogs) : null;
            const yardSize = contactData.yardSize ? String(contactData.yardSize) : null;
            const serviceFreqRaw =
              serviceData.serviceFrequency || contactData.serviceFrequency || null;
            const serviceDay = toDayOfWeek(serviceData.serviceDay || contactData.serviceDay);

            // Create contact — throws on failure, rolling back the whole transaction
            const [insertedContact] = await tx
              .insert(contacts)
              .values({
                companyId,
                firstName,
                lastName,
                email,
                phone,
                streetAddress,
                city,
                state,
                zipCode,
                numberOfDogs,
                yardSize,
                notes,
                leadSource,
                status: "active",
                serviceFrequency: serviceFreqRaw ? String(serviceFreqRaw) : null,
                serviceDay,
              })
              .returning();

            createdContacts++;

            // Create property (geocode failure is non-fatal; the insert itself must succeed)
            let propertyId: string | null = null;
            if (streetAddress && city && state && zipCode) {
              let coords: { latitude: string; longitude: string } | null = null;
              try {
                coords = await geocodeAddress(streetAddress, city, state, zipCode);
              } catch {
                // geocode is best-effort; missing coords do not block the commit
              }

              const [insertedProperty] = await tx
                .insert(properties)
                .values({
                  companyId,
                  contactId: insertedContact.id,
                  streetAddress,
                  city,
                  state,
                  zipCode,
                  numberOfDogs: numberOfDogs ?? 1,
                  yardSize: yardSize || null,
                  latitude: coords?.latitude ?? null,
                  longitude: coords?.longitude ?? null,
                })
                .returning();

              propertyId = insertedProperty.id;
            }

            // Only create a service plan for ready rows that have complete service data
            const validFrequency = isReady ? toServiceFrequency(serviceFreqRaw) : null;
            const priceCents = isReady ? Number(serviceData.priceCents || 0) : 0;
            const rowNeedsServiceSetup =
              !isReady || !propertyId || !validFrequency || priceCents === 0;

            if (!rowNeedsServiceSetup && propertyId && validFrequency) {
              const today = new Date().toISOString().slice(0, 10);
              await tx.insert(servicePlans).values({
                companyId,
                contactId: insertedContact.id,
                propertyId,
                frequency: validFrequency,
                dayOfWeek: serviceDay,
                pricePerVisit: (priceCents / 100).toFixed(2),
                isActive: true,
                startDate: today,
              });
              createdServicePlans++;
            } else {
              needsSetup++;
            }

            // Mark the import row as imported using tx directly so the update is
            // part of the same atomic transaction — storage.updateImportRow uses
            // the global db connection and would escape the tx scope.
            await tx
              .update(importRows)
              .set({
                status: "imported",
                createdContactId: insertedContact.id,
                needsServiceSetup: rowNeedsServiceSetup,
              })
              .where(and(eq(importRows.id, row.id), eq(importRows.companyId, companyId)));
          }
        });

        // Mark batch committed and update counts — only reached if transaction succeeded
        await storage.updateImportBatch(batch.id, {
          status: "committed",
          completedAt: new Date(),
          importedRows: createdContacts,
          ignoredRows: ignoredRows.length,
          readyRows: 0,
        });

        res.json({
          committed: true,
          createdContacts,
          createdServicePlans,
          needsSetup,
          ignored: ignoredRows.length,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );
}

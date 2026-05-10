import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { contacts } from "@shared/schema";
import { isStripeConfigured, createStripeCustomer } from "../services/stripe";
import {
  TIER_CONFIG,
  insertContactSchema,
  insertTagSchema,
  insertServicePlanSchema,
} from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  getBaseUrl,
  handleError,
  sanitizeDecimal,
  auditLog,
  p,
  notify,
  qboAutoSync,
  createPropertyWithGeocode,
  getStopOnlyOnlyContactIds,
  provisionPortalAccess,
  validateAndResolveAddOns,
} from "./shared";

export async function registerContactsRoutes(app: Express): Promise<void> {
  // ================ Contact Routes ================

  const csvContactHeaders = [
    "firstName",
    "lastName",
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
    "serviceDay",
    "leadSource",
    "referralSource",
    "status",
    "notes",
  ];

  app.get("/api/contacts/export/csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactsList = await storage.getContacts(companyId);
      const csvRows = [csvContactHeaders.join(",")];
      for (const c of contactsList) {
        csvRows.push(
          csvContactHeaders
            .map((h) => {
              const val = (c as Record<string, unknown>)[h] ?? "";
              return `"${String(val).replace(/"/g, '""')}"`;
            })
            .join(",")
        );
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=contacts.csv");
      res.send(csvRows.join("\n"));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/contacts/sample-csv", isAuthenticated, async (_req: Request, res: Response) => {
    const sampleRows = [
      csvContactHeaders.join(","),
      '"Jane","Doe","jane@example.com","555-123-4567","123 Main St","Apt 2","Springfield","IL","62701","2","medium","weekly","monday","website","John Smith","active","Backyard only"',
      '"Bob","Smith","bob@example.com","555-987-6543","456 Oak Ave","","Denver","CO","80202","1","large","biweekly","thursday","referral","Jane Doe","lead",""',
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=contacts-sample.csv");
    res.send(sampleRows.join("\n"));
  });

  app.post("/api/contacts/validate-csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const csvText = typeof req.body === "string" ? req.body : req.body?.csv;
      if (!csvText) return res.status(400).json({ error: "No CSV data provided" });

      const parseCsvLine = (line: string): string[] => {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let j = 0; j < line.length; j++) {
          const ch = line[j];
          if (inQuotes) {
            if (ch === '"' && line[j + 1] === '"') {
              current += '"';
              j++;
            } else if (ch === '"') {
              inQuotes = false;
            } else {
              current += ch;
            }
          } else {
            if (ch === '"') {
              inQuotes = true;
            } else if (ch === ",") {
              result.push(current.trim());
              current = "";
            } else {
              current += ch;
            }
          }
        }
        result.push(current.trim());
        return result;
      };

      const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
      if (lines.length < 2)
        return res.status(400).json({ error: "CSV must have headers and at least one row" });

      const rawHeaders = parseCsvLine(lines[0]).map((h: string) => h.replace(/"/g, "").trim());

      const knownFields = new Set(csvContactHeaders);
      const headerAliases: Record<string, string> = {
        "first name": "firstName",
        first_name: "firstName",
        firstname: "firstName",
        first: "firstName",
        "last name": "lastName",
        last_name: "lastName",
        lastname: "lastName",
        last: "lastName",
        "email address": "email",
        "e-mail": "email",
        emailaddress: "email",
        "phone number": "phone",
        phonenumber: "phone",
        telephone: "phone",
        tel: "phone",
        mobile: "phone",
        cell: "phone",
        "street address": "streetAddress",
        street_address: "streetAddress",
        address: "streetAddress",
        address1: "streetAddress",
        street: "streetAddress",
        "address 2": "address2",
        apt: "address2",
        suite: "address2",
        unit: "address2",
        zip: "zipCode",
        zip_code: "zipCode",
        postal: "zipCode",
        postal_code: "zipCode",
        postalcode: "zipCode",
        zipcode: "zipCode",
        dogs: "numberOfDogs",
        number_of_dogs: "numberOfDogs",
        "numberof dogs": "numberOfDogs",
        "num dogs": "numberOfDogs",
        "# dogs": "numberOfDogs",
        numdogs: "numberOfDogs",
        yard: "yardSize",
        yard_size: "yardSize",
        frequency: "serviceFrequency",
        service_frequency: "serviceFrequency",
        "svc frequency": "serviceFrequency",
        day: "serviceDay",
        service_day: "serviceDay",
        "svc day": "serviceDay",
        "lead source": "leadSource",
        lead_source: "leadSource",
        source: "leadSource",
        "referral source": "referralSource",
        referral_source: "referralSource",
        referral: "referralSource",
        "referred by": "referralSource",
        note: "notes",
        comment: "notes",
        comments: "notes",
      };

      const columnMapping: { csvHeader: string; mappedField: string }[] = rawHeaders.map((h) => {
        if (knownFields.has(h)) return { csvHeader: h, mappedField: h };
        const normalized = h
          .toLowerCase()
          .replace(/[^a-z0-9 #]/g, "")
          .trim();
        if (headerAliases[normalized])
          return { csvHeader: h, mappedField: headerAliases[normalized] };
        return { csvHeader: h, mappedField: "" };
      });

      const existingSources = await storage.getLeadSources(companyId);
      const sourceNames = new Set(existingSources.map((s) => s.name.toLowerCase()));

      const rows: Record<string, string>[] = [];
      const rawRows: string[][] = [];
      const issues: { row: number; field: string; message: string }[] = [];
      const newLeadSources: string[] = [];
      const newLeadSourceSet = new Set<string>();

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]).map((v) => v.replace(/^"|"$/g, ""));
        rawRows.push(values);
        const row: Record<string, string> = {};
        columnMapping.forEach((col, idx) => {
          if (col.mappedField) {
            row[col.mappedField] = values[idx] || "";
          }
        });

        const rowIssues: string[] = [];
        if (!row.firstName) rowIssues.push("Missing first name");

        if (row.numberOfDogs && isNaN(parseInt(row.numberOfDogs, 10))) {
          rowIssues.push(`Invalid number of dogs: "${row.numberOfDogs}"`);
        }

        if (rowIssues.length > 0) {
          rowIssues.forEach((msg) => issues.push({ row: i + 1, field: "", message: msg }));
        }

        if (
          row.leadSource &&
          !sourceNames.has(row.leadSource.toLowerCase()) &&
          !newLeadSourceSet.has(row.leadSource.toLowerCase())
        ) {
          newLeadSources.push(row.leadSource);
          newLeadSourceSet.add(row.leadSource.toLowerCase());
        }

        rows.push(row);
      }

      const validCount = rows.filter((r) => r.firstName && r.lastName).length;
      const invalidCount = rows.length - validCount;

      res.json({
        totalRows: rows.length,
        validCount,
        invalidCount,
        issues,
        newLeadSources,
        headers: csvContactHeaders,
        columnMapping,
        rows,
        rawRows,
        csvHeaders: rawHeaders,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/contacts/import/json", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ error: "No rows provided" });

      const _importCompany = await storage.getCompany(companyId);
      const _importTier = (_importCompany?.subscriptionTier ||
        "tier_1") as keyof typeof TIER_CONFIG;
      const _importMaxContacts = TIER_CONFIG[_importTier]?.maxContacts ?? null;
      let _importCurrentCount = 0;
      if (_importMaxContacts !== null) {
        const [{ total }] = await db
          .select({ total: sql<number>`count(*)` })
          .from(contacts)
          .where(eq(contacts.companyId, companyId));
        _importCurrentCount = Number(total);
        if (_importCurrentCount >= _importMaxContacts) {
          return res.status(400).json({
            error: `Contact limit reached (${_importCurrentCount}/${_importMaxContacts}). Upgrade your plan to import more customers.`,
          });
        }
      }

      const existingSources = await storage.getLeadSources(companyId);
      const sourceNames = new Set(existingSources.map((s) => s.name.toLowerCase()));
      const imported: Record<string, unknown>[] = [];
      const errors: string[] = [];
      const addedLeadSources: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.firstName) {
          errors.push(`Row ${i + 1}: missing firstName, skipped`);
          continue;
        }

        if (row.leadSource && !sourceNames.has(row.leadSource.toLowerCase())) {
          await storage.createLeadSource({ companyId, name: row.leadSource });
          sourceNames.add(row.leadSource.toLowerCase());
          addedLeadSources.push(row.leadSource);
        }

        try {
          const contact = await storage.createContact({
            companyId,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email || null,
            phone: row.phone || null,
            streetAddress: row.streetAddress || null,
            address2: row.address2 || null,
            city: row.city || null,
            state: row.state || null,
            zipCode: row.zipCode || null,
            numberOfDogs: row.numberOfDogs ? parseInt(row.numberOfDogs, 10) || null : null,
            yardSize: row.yardSize || null,
            serviceFrequency: row.serviceFrequency || null,
            serviceDay: row.serviceDay || null,
            leadSource: row.leadSource || null,
            referralSource: row.referralSource || null,
            status: row.status || "lead",
            notes: row.notes || null,
          } as unknown as import("@shared/schema").InsertContact);

          if (contact.streetAddress && contact.city && contact.state && contact.zipCode) {
            await createPropertyWithGeocode({
              companyId,
              contactId: contact.id,
              streetAddress: contact.streetAddress,
              city: contact.city,
              state: contact.state,
              zipCode: contact.zipCode,
              numberOfDogs: contact.numberOfDogs ?? 1,
              yardSize: contact.yardSize ?? null,
            });
          }

          imported.push(contact);
        } catch (rowErr: unknown) {
          errors.push(`Row ${i + 1}: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`);
        }
      }

      res.json({ imported: imported.length, errors, addedLeadSources });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/contacts/import/csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const csvText = typeof req.body === "string" ? req.body : req.body?.csv;
      if (!csvText) return res.status(400).json({ error: "No CSV data provided" });

      const parseCsvLine = (line: string): string[] => {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let j = 0; j < line.length; j++) {
          const ch = line[j];
          if (inQuotes) {
            if (ch === '"' && line[j + 1] === '"') {
              current += '"';
              j++;
            } else if (ch === '"') {
              inQuotes = false;
            } else {
              current += ch;
            }
          } else {
            if (ch === '"') {
              inQuotes = true;
            } else if (ch === ",") {
              result.push(current.trim());
              current = "";
            } else {
              current += ch;
            }
          }
        }
        result.push(current.trim());
        return result;
      };

      const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
      if (lines.length < 2)
        return res.status(400).json({ error: "CSV must have headers and at least one row" });

      const _csvImportCompany = await storage.getCompany(companyId);
      const _csvImportTier = (_csvImportCompany?.subscriptionTier ||
        "tier_1") as keyof typeof TIER_CONFIG;
      const _csvImportMaxContacts = TIER_CONFIG[_csvImportTier]?.maxContacts ?? null;
      if (_csvImportMaxContacts !== null) {
        const [{ total }] = await db
          .select({ total: sql<number>`count(*)` })
          .from(contacts)
          .where(eq(contacts.companyId, companyId));
        const _csvCurrentCount = Number(total);
        if (_csvCurrentCount >= _csvImportMaxContacts) {
          return res.status(400).json({
            error: `Contact limit reached (${_csvCurrentCount}/${_csvImportMaxContacts}). Upgrade your plan to import more customers.`,
          });
        }
      }

      const headers = parseCsvLine(lines[0]).map((h: string) => h.replace(/"/g, "").trim());
      const imported: Record<string, unknown>[] = [];
      const errors: string[] = [];
      const addedLeadSources: string[] = [];

      const existingSources = await storage.getLeadSources(companyId);
      const sourceNames = new Set(existingSources.map((s) => s.name.toLowerCase()));

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((h: string, idx: number) => {
          row[h] = values[idx] || "";
        });

        if (!row.firstName) {
          errors.push(`Row ${i + 1}: missing firstName, skipped`);
          continue;
        }

        if (row.leadSource && !sourceNames.has(row.leadSource.toLowerCase())) {
          await storage.createLeadSource({ companyId, name: row.leadSource });
          sourceNames.add(row.leadSource.toLowerCase());
          addedLeadSources.push(row.leadSource);
        }

        try {
          const contact = await storage.createContact({
            companyId,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email || null,
            phone: row.phone || null,
            streetAddress: row.streetAddress || null,
            address2: row.address2 || null,
            city: row.city || null,
            state: row.state || null,
            zipCode: row.zipCode || null,
            numberOfDogs: row.numberOfDogs ? parseInt(row.numberOfDogs, 10) || null : null,
            yardSize: row.yardSize || null,
            serviceFrequency: row.serviceFrequency || null,
            serviceDay: row.serviceDay || null,
            leadSource: row.leadSource || null,
            referralSource: row.referralSource || null,
            status: row.status || "lead",
            notes: row.notes || null,
          } as unknown as import("@shared/schema").InsertContact);

          if (contact.streetAddress && contact.city && contact.state && contact.zipCode) {
            await createPropertyWithGeocode({
              companyId,
              contactId: contact.id,
              streetAddress: contact.streetAddress,
              city: contact.city,
              state: contact.state,
              zipCode: contact.zipCode,
              numberOfDogs: contact.numberOfDogs ?? 1,
              yardSize: contact.yardSize ?? null,
            });
          }

          imported.push(contact);
        } catch (rowErr: unknown) {
          errors.push(`Row ${i + 1}: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`);
        }
      }

      res
        .status(201)
        .json({ imported: imported.length, errors, addedLeadSources, contacts: imported });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/contacts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { status?: string; search?: string } = {};
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.search) filters.search = (req.query.search as string).replace(/\0/g, "");

      const rawPage = parseInt(req.query.page as string);
      const rawLimit = parseInt(req.query.limit as string);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 0;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 0;

      const [activePlans, contactsResult] = await Promise.all([
        storage.getServicePlans(companyId, { isActive: true }),
        page > 0 && limit > 0
          ? storage.getContactsPage(companyId, filters, page, limit)
          : storage.getContacts(companyId, filters).then((data) => ({
              data,
              total: data.length,
            })),
      ]);

      const contactsList = contactsResult.data;
      const stopOnlyOnlyIds = getStopOnlyOnlyContactIds(activePlans);

      let onboardingMap = new Map<string, { pending: boolean; completed: boolean }>();
      {
        const onboardingRows = await db.execute(sql`
          SELECT DISTINCT ON (contact_id) contact_id,
            onboarding_completed_at IS NULL AS pending,
            onboarding_completed_at IS NOT NULL AS completed
          FROM properties
          WHERE company_id = ${companyId}
          ORDER BY contact_id, onboarding_completed_at DESC NULLS LAST
        `);
        for (const row of onboardingRows.rows as {
          contact_id: string;
          pending: boolean;
          completed: boolean;
        }[]) {
          onboardingMap.set(row.contact_id, { pending: !!row.pending, completed: !!row.completed });
        }
      }

      const enriched = contactsList.map((c) => ({
        ...c,
        isStopOnlyContact: stopOnlyOnlyIds.has(c.id),
        onboardingStatus: onboardingMap.get(c.id) || null,
      }));

      if (page > 0 && limit > 0) {
        res.json({
          contacts: enriched,
          total: contactsResult.total,
          page,
          pageSize: limit,
        });
      } else {
        res.json(enriched);
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/contacts/unscheduled", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const importRunId = req.query.importRunId as string | undefined;

      const allPlans = await storage.getServicePlans(companyId);
      const contactsWithPlans = new Set(allPlans.map((p) => p.contactId));

      const allContacts = await storage.getContacts(companyId);

      let importWindowStart: Date | null = null;
      let importWindowEnd: Date | null = null;
      if (importRunId) {
        const importRun = await storage.getImportRun(importRunId, companyId);
        if (importRun) {
          importWindowStart = new Date(importRun.createdAt);
          if (importRun.completedAt) {
            const end = new Date(importRun.completedAt);
            end.setMinutes(end.getMinutes() + 2);
            importWindowEnd = end;
          }
        }
      }

      const allProperties = await storage.getProperties(companyId);
      const propertiesByContact = new Map<string, (typeof allProperties)[0][]>();
      for (const prop of allProperties) {
        if (!propertiesByContact.has(prop.contactId)) propertiesByContact.set(prop.contactId, []);
        propertiesByContact.get(prop.contactId)!.push(prop);
      }

      const unscheduled = allContacts.filter((c) => {
        if (contactsWithPlans.has(c.id)) return false;
        if (importWindowStart) {
          const ct = new Date(c.createdAt);
          if (ct < importWindowStart) return false;
          if (importWindowEnd && ct > importWindowEnd) return false;
        }
        return true;
      });

      const result = unscheduled.map((contact) => {
        const contactProps = propertiesByContact.get(contact.id) || [];
        const primaryProperty = contactProps[0] || null;
        const hasProperty = !!primaryProperty;
        const hasAddress = !!(contact.streetAddress || primaryProperty?.streetAddress);
        const hasFrequency = !!contact.serviceFrequency;
        const issues: string[] = [];
        if (!hasProperty) issues.push("Missing property");
        else if (!hasAddress) issues.push("Missing address");
        if (!hasFrequency) issues.push("Missing frequency");
        if (!contact.serviceDay) issues.push("Missing service day");
        return {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          serviceFrequency: contact.serviceFrequency,
          serviceDay: contact.serviceDay,
          streetAddress: contact.streetAddress || primaryProperty?.streetAddress || null,
          city: contact.city || primaryProperty?.city || null,
          state: contact.state || primaryProperty?.state || null,
          zipCode: contact.zipCode || primaryProperty?.zipCode || null,
          propertyId: primaryProperty?.id || null,
          hasProperty,
          hasAddress,
          hasFrequency,
          issues,
          createdAt: contact.createdAt,
        };
      });

      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(p(req.params.id), companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      res.json(contact);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/contacts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const suppressNotifications = req.body.suppressNotifications === true;

      const _company = await storage.getCompany(companyId);
      const _tier = (_company?.subscriptionTier || "tier_1") as keyof typeof TIER_CONFIG;
      const _maxContacts = TIER_CONFIG[_tier]?.maxContacts ?? null;
      if (_maxContacts !== null) {
        const [{ total: _contactCount }] = await db
          .select({ total: sql<number>`count(*)` })
          .from(contacts)
          .where(eq(contacts.companyId, companyId));
        if (Number(_contactCount) >= _maxContacts) {
          return res.status(400).json({
            error: `Contact limit reached (${_contactCount}/${_maxContacts}). Upgrade your plan to add more customers.`,
          });
        }
      }

      const { suppressNotifications: _sn, ...bodyWithoutFlag } = req.body;
      const parsed = insertContactSchema.parse({ ...bodyWithoutFlag, companyId });
      const contact = await storage.createContact(parsed);

      let propertyCreated = false;
      const hasFullAddress = !!(
        contact.streetAddress &&
        contact.city &&
        contact.state &&
        contact.zipCode
      );
      const hasPartialAddress = !!contact.streetAddress && !hasFullAddress;

      if (hasFullAddress) {
        await createPropertyWithGeocode({
          companyId,
          contactId: contact.id,
          streetAddress: contact.streetAddress!,
          city: contact.city,
          state: contact.state,
          zipCode: contact.zipCode,
          numberOfDogs: contact.numberOfDogs ?? 1,
          yardSize: contact.yardSize ?? null,
        });
        propertyCreated = true;
      }

      if (contact.email && isStripeConfigured()) {
        try {
          const companyForStripe = await storage.getCompany(companyId);
          const connectAcct = companyForStripe?.stripeConnectOnboarded
            ? companyForStripe.stripeConnectAccountId
            : null;
          const stripeCustomerId = await createStripeCustomer({
            email: contact.email,
            name: `${contact.firstName} ${contact.lastName}`.trim(),
            phone: contact.phone || undefined,
            metadata: { contactId: contact.id, companyId },
            stripeAccount: connectAcct,
          });
          await storage.updateContact(contact.id, companyId, { stripeCustomerId });
        } catch (stripeErr) {
          console.error("[auto-stripe] Customer creation failed:", stripeErr);
        }
      }

      if (!suppressNotifications && contact.status === "lead") {
        notify(
          companyId,
          "new_lead",
          "New Lead",
          `${contact.firstName} ${contact.lastName} was added as a new lead.`,
          `/contacts/${contact.id}`
        );
        try {
          const { fireAutomationTrigger } = await import("../services/automation-runner");
          await fireAutomationTrigger("lead_created", companyId, {
            contactId: contact.id,
            status: contact.status,
          });
        } catch (autoErr) {
          console.error("[automation] lead_created trigger error:", autoErr);
        }
      }

      if (!suppressNotifications && contact.email && contact.status !== "lead") {
        provisionPortalAccess(contact.id, companyId, getBaseUrl(req)).catch((err) =>
          console.error("[auto-portal] Failed to provision portal access for new contact:", err)
        );
      }

      qboAutoSync(companyId, contact.id, "contact");
      res.status(201).json({ ...contact, _meta: { propertyCreated, hasPartialAddress } });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const existing = await storage.getContact(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Contact not found" });
      const validStatuses = ["lead", "estimate", "active", "paused", "cancelled"];
      if (req.body.status && !validStatuses.includes(req.body.status)) {
        return res
          .status(400)
          .json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }
      const { costOverrides: _stripCostOverrides, ...safeBody } = req.body;
      const contact = await storage.updateContact(p(req.params.id), companyId, safeBody);
      auditLog(
        companyId,
        userId,
        "contact",
        p(req.params.id),
        "update",
        { old: existing, new: contact },
        req.ip
      );

      if (contact.streetAddress && contact.city && contact.state && contact.zipCode) {
        const existingProperties = await storage.getProperties(companyId, contact.id);
        if (existingProperties.length === 0) {
          await createPropertyWithGeocode({
            companyId,
            contactId: contact.id,
            streetAddress: contact.streetAddress,
            city: contact.city,
            state: contact.state,
            zipCode: contact.zipCode,
            numberOfDogs: contact.numberOfDogs ?? 1,
            yardSize: contact.yardSize ?? null,
          });
        }
      }

      if (
        req.body.status === "active" &&
        existing.status !== "active" &&
        contact.email &&
        !contact.hasPortalAccess
      ) {
        provisionPortalAccess(contact.id, companyId, getBaseUrl(req)).catch((err) =>
          console.error("[auto-portal] Failed to provision portal access on status change:", err)
        );
      }

      qboAutoSync(companyId, contact.id, "contact");
      res.json(contact);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const existing = await storage.getContact(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Contact not found" });
      await storage.deleteContact(p(req.params.id), companyId);
      auditLog(
        companyId,
        userId,
        "contact",
        p(req.params.id),
        "delete",
        { deleted: existing },
        req.ip
      );
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/contacts/bulk-update", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { ids, status, tagId } = req.body;
      if (!Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ error: "ids array is required" });
      let updated = 0;
      for (const id of ids) {
        const existing = await storage.getContact(id, companyId);
        if (!existing) continue;
        if (status) {
          await storage.updateContact(id, companyId, { status });
          updated++;
        }
        if (tagId) {
          await storage.addTagToContact(id, tagId);
          updated++;
        }
      }
      res.json({ success: true, updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/contacts/bulk-update-service-plans",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { ids, dayOfWeek, frequency } = req.body;
        if (!Array.isArray(ids) || ids.length === 0)
          return res.status(400).json({ error: "ids array is required" });

        const validDays = [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
          "tbd",
        ];
        const validFrequencies = ["weekly", "biweekly", "monthly", "onetime"];
        if (dayOfWeek && !validDays.includes(dayOfWeek))
          return res.status(400).json({ error: "Invalid dayOfWeek" });
        if (frequency && !validFrequencies.includes(frequency))
          return res.status(400).json({ error: "Invalid frequency" });
        if (!dayOfWeek && !frequency)
          return res
            .status(400)
            .json({ error: "At least one of dayOfWeek or frequency is required" });

        let plansUpdated = 0;
        for (const contactId of ids) {
          const contact = await storage.getContact(contactId, companyId);
          if (!contact) continue;
          const plans = await storage.getServicePlans(companyId, { contactId, isActive: true });
          for (const plan of plans) {
            const updates: Record<string, unknown> = {};
            if (frequency) updates.frequency = frequency;
            if (dayOfWeek) {
              updates.dayOfWeek = dayOfWeek;
              if (!req.body.keepRoute) {
                const dayRoutes = await storage.getRoutes(companyId, dayOfWeek);
                const matchingRoute = dayRoutes.find((r) => !r.date);
                if (matchingRoute) updates.routeId = matchingRoute.id;
              }
            }
            await storage.updateServicePlan(plan.id, companyId, updates);
            plansUpdated++;
          }
        }
        res.json({ success: true, plansUpdated });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/contacts/bulk-delete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ error: "ids array is required" });
      let deleted = 0;
      for (const id of ids) {
        const existing = await storage.getContact(id, companyId);
        if (!existing) continue;
        await storage.deleteContact(id, companyId);
        deleted++;
      }
      res.json({ success: true, deleted });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Tag Routes ================

  app.get("/api/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const tagsList = await storage.getTags(companyId);
      res.json(tagsList);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertTagSchema.parse({ ...req.body, companyId });
      const tag = await storage.createTag(parsed);
      res.status(201).json(tag);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/tags/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteTag(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Lead Source Routes ================

  app.get("/api/lead-sources", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const sources = await storage.getLeadSources(companyId);
      res.json(sources);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/lead-sources", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Name is required" });
      }
      const source = await storage.createLeadSource({ companyId, name: name.trim() });
      res.status(201).json(source);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/lead-sources/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteLeadSource(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/contacts/:id/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { tagId } = req.body;
      if (!tagId) return res.status(400).json({ error: "tagId is required" });
      const contact = await storage.getContact(p(req.params.id), companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const companyTags = await storage.getTags(companyId);
      if (!companyTags.find((t) => t.id === tagId))
        return res.status(404).json({ error: "Tag not found" });
      await storage.addTagToContact(p(req.params.id), tagId);
      res.status(201).json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete(
    "/api/contacts/:id/tags/:tagId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        await storage.removeTagFromContact(p(req.params.id), p(req.params.tagId));
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/contacts/:id/activity", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(p(req.params.id), companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const logs = await storage.getActivityLogs(companyId, p(req.params.id), limit, offset);
      res.json(logs);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/contacts/:id/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(p(req.params.id), companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const contactTags = await storage.getContactTags(p(req.params.id));
      res.json(contactTags);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/contacts/:id/opportunities",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        const { getOpportunitiesForContact } = await import("../services/opportunity-engine");
        const opps = await getOpportunitiesForContact(p(req.params.id), companyId);
        res.json(opps);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/contacts/:id/dismiss-opportunity",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        const { key } = req.body;
        if (!key || typeof key !== "string")
          return res.status(400).json({ error: "key is required" });
        const current: string[] = (contact.dismissedOpportunities as string[] | null) ?? [];
        if (!current.includes(key)) {
          const updated = [...current, key];
          await storage.updateContact(p(req.params.id), companyId, {
            dismissedOpportunities: updated,
          });
        }
        res.json({ ok: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/contacts/:id/services", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const contact = await storage.getContact(p(req.params.id), companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const {
        frequency,
        dayOfWeek,
        startDate,
        pricePerVisit,
        discount,
        propertyId,
        serviceName,
        addOns,
      } = req.body;
      if (!frequency || !startDate || !pricePerVisit || !propertyId) {
        return res
          .status(400)
          .json({ error: "frequency, startDate, pricePerVisit, and propertyId are required" });
      }

      const parsed = insertServicePlanSchema.parse({
        companyId,
        contactId: p(req.params.id),
        propertyId,
        frequency,
        dayOfWeek: dayOfWeek || null,
        startDate,
        pricePerVisit: sanitizeDecimal(pricePerVisit),
        discount: discount || null,
        serviceName: serviceName || null,
        isActive: true,
      });

      const plan = await storage.createServicePlan(parsed);
      auditLog(
        companyId,
        userId,
        "service_plan",
        plan.id,
        "create",
        { new: { contactId: p(req.params.id), frequency, dayOfWeek } },
        req.ip || undefined
      );

      if (contact.status === "lead" || contact.status === "estimate") {
        await storage.updateContact(p(req.params.id), companyId, { status: "active" });
        if (contact.email && !contact.hasPortalAccess) {
          provisionPortalAccess(p(req.params.id), companyId, getBaseUrl(req)).catch((err) =>
            console.error("[auto-portal] Failed to provision portal access:", err)
          );
        }
      }

      if (!contact.stripeCustomerId && contact.email) {
        (async () => {
          try {
            const co = await storage.getCompany(companyId);
            const acct = co?.stripeConnectOnboarded ? co.stripeConnectAccountId : null;
            const stripeCustomerId = await createStripeCustomer({
              email: contact.email!,
              name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.email!,
              metadata: { scoopilotContactId: contact.id, companyId },
              stripeAccount: acct,
            });
            await storage.updateContact(p(req.params.id), companyId, { stripeCustomerId });
          } catch (err) {
            console.error("[auto-stripe] Failed to auto-create Stripe customer:", err);
          }
        })();
      }

      let planAddOns: unknown[] = [];
      if (addOns && Array.isArray(addOns)) {
        const validatedAddOns = await validateAndResolveAddOns(addOns, companyId);
        planAddOns = await storage.setServicePlanAddOns(plan.id, validatedAddOns);
      }

      try {
        const { generateVisitsForPlans } = await import("../jobs/auto-visits");
        const today = new Date();
        const planStart = plan.startDate ? new Date(plan.startDate + "T00:00:00") : today;
        const anchor = planStart > today ? planStart : today;
        const sixMonthsOut = new Date(anchor);
        sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
        await generateVisitsForPlans(
          companyId,
          [plan.id],
          anchor.toISOString().split("T")[0],
          sixMonthsOut.toISOString().split("T")[0]
        );
      } catch (genErr) {
        console.error("[contact-service] Failed to auto-generate visits:", genErr);
      }

      res.status(201).json({ ...plan, addOns: planAddOns });
    } catch (err) {
      handleError(res, err);
    }
  });
}

import type { Express, Request } from "express";
import multer from "multer";
import { db } from "../db";
import { sql, eq, and, ilike, desc, or, isNull } from "drizzle-orm";
import { isAuthenticated, getCompanyContext } from "./shared";
import {
  isValidEmail,
  normalizePhone,
  isValidNumericValue,
  isValidDate,
} from "../lib/import-validators";

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (vals[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}
import {
  crmContacts,
  crmCompanies,
  crmDeals,
  crmTasks,
  crmActivities,
  crmNotes,
  crmEmails,
  crmDocuments,
  crmQuotes,
  crmProjects,
  crmProjectTasks,
  crmEmailCampaigns,
  crmCampaignRecipients,
  crmAutomations,
  crmAuditLogs,
  crmSequences,
  crmSequenceSteps,
  crmSequenceEnrollments,
  crmLeadScoringRules,
  crmNotifications,
  crmWebhooks,
  crmWebhookDeliveries,
  crmWebForms,
  crmFormSubmissions,
  insertCrmContactSchema,
  insertCrmCompanySchema,
  insertCrmDealSchema,
  insertCrmTaskSchema,
  insertCrmActivitySchema,
  insertCrmNoteSchema,
  insertCrmEmailSchema,
  insertCrmDocumentSchema,
  insertCrmQuoteSchema,
  insertCrmProjectSchema,
  insertCrmProjectTaskSchema,
  insertCrmEmailCampaignSchema,
  insertCrmCampaignRecipientSchema,
  insertCrmAutomationSchema,
  insertCrmSequenceSchema,
  insertCrmSequenceStepSchema,
  insertCrmSequenceEnrollmentSchema,
  insertCrmLeadScoringRuleSchema,
  insertCrmNotificationSchema,
  insertCrmWebhookSchema,
  insertCrmWebhookDeliverySchema,
  insertCrmWebFormSchema,
  type CrmPaginatedResult,
} from "@shared/crm-schema";
import { fromError } from "zod-validation-error";

function getCompanyId(req: Request): string {
  return req.crmCompanyId ?? "";
}

function buildPaginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): CrmPaginatedResult<T> {
  return { data, total, page, totalPages: Math.ceil(total / limit) || 1 };
}

async function logCrmAudit(
  req: Request,
  action: string,
  entity: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  const companyId = getCompanyId(req);
  const userId = req.session.userId ?? "unknown";
  await db.insert(crmAuditLogs).values({
    companyId,
    action,
    entity,
    entityId: entityId ?? null,
    details: details ?? {},
    userId,
  });
}

export function registerCrmRoutes(app: Express) {
  app.use("/api/crm", isAuthenticated, async (req, res, next) => {
    try {
      const ctx = await getCompanyContext(req);
      req.crmCompanyId = ctx.companyId;
      next();
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status ?? 500).json({ message: e.message ?? "Internal error" });
    }
  });

  // ─── CRM Stats ─────────────────────────────────────────
  app.get("/api/crm/stats", async (req, res) => {
    const c = getCompanyId(req);
    const [[contacts], [companies], [deals], [tasks]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(crmContacts)
        .where(eq(crmContacts.companyId, c)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(crmCompanies)
        .where(eq(crmCompanies.companyId, c)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(crmDeals)
        .where(eq(crmDeals.companyId, c)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(crmTasks)
        .where(eq(crmTasks.companyId, c)),
    ]);
    const [[emails], [documents], [projects], [pipelineVal], [wonDeals]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(crmEmails)
        .where(eq(crmEmails.companyId, c)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(crmDocuments)
        .where(eq(crmDocuments.companyId, c)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(crmProjects)
        .where(eq(crmProjects.companyId, c)),
      db
        .select({ total: sql<number>`coalesce(sum(value), 0)` })
        .from(crmDeals)
        .where(and(eq(crmDeals.status, "open"), eq(crmDeals.companyId, c))),
      db
        .select({ count: sql<number>`count(*)` })
        .from(crmDeals)
        .where(and(eq(crmDeals.stage, "closed_won"), eq(crmDeals.companyId, c))),
    ]);
    res.json({
      contacts: Number(contacts.count),
      companies: Number(companies.count),
      deals: Number(deals.count),
      tasks: Number(tasks.count),
      emails: Number(emails.count),
      documents: Number(documents.count),
      projects: Number(projects.count),
      pipelineValue: Number(pipelineVal.total),
      wonDeals: Number(wonDeals.count),
    });
  });

  // ─── Reports ──────────────────────────────────────────
  app.get("/api/crm/reports/pipeline", async (req, res) => {
    const c = getCompanyId(req);
    const stages = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"];
    const result = await Promise.all(
      stages.map(async (stage) => {
        const [r] = await db
          .select({ count: sql<number>`count(*)`, value: sql<number>`coalesce(sum(value), 0)` })
          .from(crmDeals)
          .where(and(eq(crmDeals.stage, stage), eq(crmDeals.companyId, c)));
        return { stage, count: Number(r.count), value: Number(r.value) };
      })
    );
    res.json(result);
  });

  app.get("/api/crm/reports/tasks", async (req, res) => {
    const c = getCompanyId(req);
    const statuses = ["pending", "in_progress", "completed"];
    const result = await Promise.all(
      statuses.map(async (status) => {
        const [r] = await db
          .select({ count: sql<number>`count(*)` })
          .from(crmTasks)
          .where(and(eq(crmTasks.status, status), eq(crmTasks.companyId, c)));
        return { status, count: Number(r.count) };
      })
    );
    res.json(result);
  });

  app.get("/api/crm/reports/deals", async (req, res) => {
    const c = getCompanyId(req);
    const all = await db.select().from(crmDeals).where(eq(crmDeals.companyId, c));
    const months: Record<string, { won: number; lost: number }> = {};
    for (const d of all) {
      if (d.stage === "closed_won" || d.stage === "closed_lost") {
        const date = d.createdAt ? new Date(d.createdAt) : new Date();
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (!months[key]) months[key] = { won: 0, lost: 0 };
        if (d.stage === "closed_won") months[key].won++;
        else months[key].lost++;
      }
    }
    const result = Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));
    res.json(result);
  });

  app.get("/api/crm/reports/contacts", async (req, res) => {
    const c = getCompanyId(req);
    const sources = ["manual", "web_form", "import", "referral", "campaign"];
    const result = await Promise.all(
      sources.map(async (source) => {
        const [r] = await db
          .select({ count: sql<number>`count(*)` })
          .from(crmContacts)
          .where(and(eq(crmContacts.source, source), eq(crmContacts.companyId, c)));
        return { source, count: Number(r.count) };
      })
    );
    res.json(result);
  });

  app.get("/api/crm/activities", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmActivities)
        .where(eq(crmActivities.companyId, c))
        .orderBy(desc(crmActivities.createdAt))
    );
  });

  // ─── Contacts ─────────────────────────────────────────
  app.get("/api/crm/contacts", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmContacts.companyId, c)];
    if (req.query.search) {
      const t = `%${req.query.search}%`;
      conditions.push(
        or(
          ilike(crmContacts.firstName, t),
          ilike(crmContacts.lastName, t),
          ilike(crmContacts.email, t)
        )!
      );
    }
    if (req.query.status) conditions.push(eq(crmContacts.status, req.query.status as string));
    if (req.query.source) conditions.push(eq(crmContacts.source, req.query.source as string));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmContacts)
      .where(where);
    const data = await db
      .select()
      .from(crmContacts)
      .where(where)
      .orderBy(desc(crmContacts.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.get("/api/crm/contacts/:id", async (req, res) => {
    const [c] = await db
      .select()
      .from(crmContacts)
      .where(and(eq(crmContacts.id, req.params.id), eq(crmContacts.companyId, getCompanyId(req))));
    if (!c) return res.status(404).json({ message: "Contact not found" });
    res.json(c);
  });

  app.get("/api/crm/contacts/:id/timeline", async (req, res) => {
    const c = getCompanyId(req);
    const id = req.params.id;
    const [acts, nts, ems] = await Promise.all([
      db
        .select()
        .from(crmActivities)
        .where(and(eq(crmActivities.contactId, id), eq(crmActivities.companyId, c)))
        .orderBy(desc(crmActivities.createdAt)),
      db
        .select()
        .from(crmNotes)
        .where(and(eq(crmNotes.contactId, id), eq(crmNotes.companyId, c)))
        .orderBy(desc(crmNotes.createdAt)),
      db
        .select()
        .from(crmEmails)
        .where(and(eq(crmEmails.contactId, id), eq(crmEmails.companyId, c)))
        .orderBy(desc(crmEmails.createdAt)),
    ]);
    const timeline = [
      ...acts.map((a) => ({ ...a, _type: "activity" })),
      ...nts.map((n) => ({ ...n, _type: "note" })),
      ...ems.map((e) => ({ ...e, _type: "email" })),
    ].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    res.json(timeline);
  });

  app.get("/api/crm/contacts/:id/deals", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.contactId, req.params.id), eq(crmDeals.companyId, c)))
        .orderBy(desc(crmDeals.createdAt))
    );
  });

  app.get("/api/crm/contacts/:id/tasks", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmTasks)
        .where(and(eq(crmTasks.contactId, req.params.id), eq(crmTasks.companyId, c)))
        .orderBy(desc(crmTasks.createdAt))
    );
  });

  app.get("/api/crm/contacts/:id/notes", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmNotes)
        .where(and(eq(crmNotes.contactId, req.params.id), eq(crmNotes.companyId, c)))
        .orderBy(desc(crmNotes.createdAt))
    );
  });

  app.get("/api/crm/contacts/:id/emails", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmEmails)
        .where(and(eq(crmEmails.contactId, req.params.id), eq(crmEmails.companyId, c)))
        .orderBy(crmEmails.createdAt)
    );
  });

  app.get("/api/crm/contacts/:id/documents", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmDocuments)
        .where(and(eq(crmDocuments.contactId, req.params.id), eq(crmDocuments.companyId, c)))
        .orderBy(desc(crmDocuments.createdAt))
    );
  });

  app.post("/api/crm/contacts", async (req, res) => {
    const parsed = insertCrmContactSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [contact] = await db
      .insert(crmContacts)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    await logCrmAudit(req, "created", "contact", contact.id, {
      name: `${contact.firstName} ${contact.lastName}`,
    });
    res.status(201).json(contact);
  });

  app.patch("/api/crm/contacts/:id", async (req, res) => {
    const [c] = await db
      .update(crmContacts)
      .set(req.body)
      .where(and(eq(crmContacts.id, req.params.id), eq(crmContacts.companyId, getCompanyId(req))))
      .returning();
    if (!c) return res.status(404).json({ message: "Contact not found" });
    res.json(c);
  });

  app.delete("/api/crm/contacts/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmContacts)
      .where(and(eq(crmContacts.id, req.params.id), eq(crmContacts.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ message: "Contact not found" });
    await logCrmAudit(req, "delete", "contact", existing.id, {
      name: `${existing.firstName} ${existing.lastName}`,
    });
    await db
      .delete(crmContacts)
      .where(and(eq(crmContacts.id, req.params.id), eq(crmContacts.companyId, getCompanyId(req))));
    res.status(204).send();
  });

  app.get("/api/crm/contacts/export/csv", async (req, res) => {
    const c = getCompanyId(req);
    const all = await db.select().from(crmContacts).where(eq(crmContacts.companyId, c));
    const rows = all.map((ct) =>
      [
        ct.firstName,
        ct.lastName,
        ct.email,
        ct.phone || "",
        ct.company || "",
        ct.title || "",
        ct.status,
        ct.source || "",
      ].join(",")
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="crm_contacts.csv"');
    res.send(["firstName,lastName,email,phone,company,title,status,source", ...rows].join("\n"));
  });

  app.get("/api/crm/contacts/import/template", async (_req, res) => {
    const header =
      "first_name,last_name,email,phone,company,title,status,source,lead_score,assigned_to,tags";
    const example =
      "Jane,Smith,jane@example.com,5551234567,Acme Corp,Manager,active,referral,75,john@myco.com,vip;priority";
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="contacts_import_template.csv"');
    res.send([header, example].join("\n"));
  });

  function safeImportError(e: unknown): string {
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    if (msg.includes("unique") || msg.includes("duplicate"))
      return "Duplicate entry — row already exists";
    if (msg.includes("foreign key") || msg.includes("violates foreign key"))
      return "Invalid reference — related record not found";
    if (msg.includes("not null") || msg.includes("null value")) return "Required field is missing";
    if (msg.includes("invalid input syntax") || msg.includes("invalid input value"))
      return "Invalid value format";
    if (msg.includes("check constraint")) return "Value out of allowed range";
    return "Could not import this row";
  }

  app.post("/api/crm/contacts/import", csvUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const companyId = getCompanyId(req);
    const rows = parseCSV(req.file.buffer.toString("utf-8"));
    const created: string[] = [];
    let duplicates = 0;
    const skipped: { row: number; reason: string; data?: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const rowData = {
        first_name: r.first_name || "",
        last_name: r.last_name || "",
        email: r.email || "",
        phone: r.phone || "",
        company: r.company || "",
        title: r.title || "",
        status: r.status || "",
        source: r.source || "",
        lead_score: r.lead_score || "",
        assigned_to: r.assigned_to || "",
        tags: r.tags || "",
      };
      if (!r.first_name) {
        skipped.push({ row: rowNum, reason: "Missing first_name", data: rowData });
        continue;
      }
      if (!r.last_name) {
        skipped.push({ row: rowNum, reason: "Missing last_name", data: rowData });
        continue;
      }
      if (!r.email) {
        skipped.push({ row: rowNum, reason: "Missing email", data: rowData });
        continue;
      }
      if (!isValidEmail(r.email)) {
        skipped.push({ row: rowNum, reason: `Invalid email format: "${r.email}"`, data: rowData });
        continue;
      }
      let normalizedPhone: string | null = null;
      if (r.phone) {
        normalizedPhone = normalizePhone(r.phone);
        if (normalizedPhone === null) {
          skipped.push({
            row: rowNum,
            reason: `Invalid phone number: "${r.phone}" — expected 10 digits (US) or leave blank`,
            data: rowData,
          });
          continue;
        }
      }
      if (r.lead_score && !isValidNumericValue(r.lead_score)) {
        skipped.push({
          row: rowNum,
          reason: `lead_score must be a number, got: "${r.lead_score}"`,
          data: rowData,
        });
        continue;
      }
      const normalizedEmail = r.email.trim().toLowerCase();
      const [existing] = await db
        .select({ id: crmContacts.id })
        .from(crmContacts)
        .where(and(eq(crmContacts.companyId, companyId), eq(crmContacts.email, normalizedEmail)))
        .limit(1);
      if (existing) {
        duplicates++;
        continue;
      }
      try {
        const tags = r.tags
          ? r.tags
              .split(";")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const [ct] = await db
          .insert(crmContacts)
          .values({
            companyId,
            firstName: r.first_name,
            lastName: r.last_name,
            email: normalizedEmail,
            phone: normalizedPhone,
            company: r.company || null,
            title: r.title || null,
            status: r.status || "active",
            source: r.source || "import",
            leadScore: r.lead_score ? parseInt(r.lead_score) || 0 : 0,
            assignedTo: r.assigned_to || null,
            tags,
          })
          .returning({ id: crmContacts.id });
        created.push(ct.id);
      } catch (e: unknown) {
        skipped.push({ row: rowNum, reason: safeImportError(e), data: rowData });
      }
    }
    res.json({ created: created.length, duplicates, skipped });
  });

  app.post("/api/crm/contacts/import/retry", csvUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const companyId = getCompanyId(req);
    const rows = parseCSV(req.file.buffer.toString("utf-8"));
    const created: string[] = [];
    const skipped: { row: number; reason: string; data?: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const rowData = {
        first_name: r.first_name || "",
        last_name: r.last_name || "",
        email: r.email || "",
        phone: r.phone || "",
        company: r.company || "",
        title: r.title || "",
        status: r.status || "",
        source: r.source || "",
        lead_score: r.lead_score || "",
        assigned_to: r.assigned_to || "",
        tags: r.tags || "",
      };
      if (!r.first_name) {
        skipped.push({ row: rowNum, reason: "Missing first_name", data: rowData });
        continue;
      }
      if (!r.last_name) {
        skipped.push({ row: rowNum, reason: "Missing last_name", data: rowData });
        continue;
      }
      if (!r.email) {
        skipped.push({ row: rowNum, reason: "Missing email", data: rowData });
        continue;
      }
      if (!isValidEmail(r.email)) {
        skipped.push({ row: rowNum, reason: `Invalid email format: "${r.email}"`, data: rowData });
        continue;
      }
      let normalizedPhone: string | null = null;
      if (r.phone) {
        normalizedPhone = normalizePhone(r.phone);
        if (normalizedPhone === null) {
          skipped.push({
            row: rowNum,
            reason: `Invalid phone number: "${r.phone}" — expected 10 digits (US) or leave blank`,
            data: rowData,
          });
          continue;
        }
      }
      if (r.lead_score && !isValidNumericValue(r.lead_score)) {
        skipped.push({
          row: rowNum,
          reason: `lead_score must be a number, got: "${r.lead_score}"`,
          data: rowData,
        });
        continue;
      }
      try {
        const tags = r.tags
          ? r.tags
              .split(";")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const [ct] = await db
          .insert(crmContacts)
          .values({
            companyId,
            firstName: r.first_name,
            lastName: r.last_name,
            email: r.email.trim().toLowerCase(),
            phone: normalizedPhone,
            company: r.company || null,
            title: r.title || null,
            status: r.status || "active",
            source: r.source || "import",
            leadScore: r.lead_score ? parseInt(r.lead_score) || 0 : 0,
            assignedTo: r.assigned_to || null,
            tags,
          })
          .returning({ id: crmContacts.id });
        created.push(ct.id);
      } catch (e: unknown) {
        skipped.push({ row: rowNum, reason: safeImportError(e), data: rowData });
      }
    }
    res.json({ created: created.length, updated: 0, skipped });
  });

  // ─── CRM Companies ────────────────────────────────────
  app.get("/api/crm/companies", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmCompanies.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmCompanies.name, `%${req.query.search}%`));
    if (req.query.industry)
      conditions.push(eq(crmCompanies.industry, req.query.industry as string));
    if (req.query.status) conditions.push(eq(crmCompanies.status, req.query.status as string));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmCompanies)
      .where(where);
    const data = await db
      .select()
      .from(crmCompanies)
      .where(where)
      .orderBy(desc(crmCompanies.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.get("/api/crm/companies/:id", async (req, res) => {
    const [c] = await db
      .select()
      .from(crmCompanies)
      .where(
        and(eq(crmCompanies.id, req.params.id), eq(crmCompanies.companyId, getCompanyId(req)))
      );
    if (!c) return res.status(404).json({ message: "Company not found" });
    res.json(c);
  });

  app.post("/api/crm/companies", async (req, res) => {
    const parsed = insertCrmCompanySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [comp] = await db
      .insert(crmCompanies)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    await logCrmAudit(req, "created", "company", comp.id, { name: comp.name });
    res.status(201).json(comp);
  });

  app.patch("/api/crm/companies/:id", async (req, res) => {
    const [c] = await db
      .update(crmCompanies)
      .set(req.body)
      .where(and(eq(crmCompanies.id, req.params.id), eq(crmCompanies.companyId, getCompanyId(req))))
      .returning();
    if (!c) return res.status(404).json({ message: "Company not found" });
    res.json(c);
  });

  app.delete("/api/crm/companies/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmCompanies)
      .where(
        and(eq(crmCompanies.id, req.params.id), eq(crmCompanies.companyId, getCompanyId(req)))
      );
    if (!existing) return res.status(404).json({ message: "Company not found" });
    await logCrmAudit(req, "delete", "company", existing.id, { name: existing.name });
    await db
      .delete(crmCompanies)
      .where(
        and(eq(crmCompanies.id, req.params.id), eq(crmCompanies.companyId, getCompanyId(req)))
      );
    res.status(204).send();
  });

  app.get("/api/crm/companies/import/template", async (_req, res) => {
    const header = "name,domain,industry,size,status";
    const example = "Acme Corp,acme.com,technology,11-50,active";
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="companies_import_template.csv"');
    res.send([header, example].join("\n"));
  });

  app.post("/api/crm/companies/import", csvUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const companyId = getCompanyId(req);
    const rows = parseCSV(req.file.buffer.toString("utf-8"));
    const created: string[] = [];
    const skipped: { row: number; reason: string; data?: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const rowData = {
        name: r.name || "",
        domain: r.domain || "",
        industry: r.industry || "",
        size: r.size || "",
        status: r.status || "",
      };
      if (!r.name) {
        skipped.push({ row: rowNum, reason: "Missing name", data: rowData });
        continue;
      }
      if (
        r.domain &&
        !/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/.test(r.domain.trim())
      ) {
        skipped.push({
          row: rowNum,
          reason: `Invalid domain format: "${r.domain}"`,
          data: rowData,
        });
        continue;
      }
      try {
        const [co] = await db
          .insert(crmCompanies)
          .values({
            companyId,
            name: r.name,
            domain: r.domain || null,
            industry: r.industry || null,
            size: r.size || null,
            status: r.status || "active",
          })
          .returning({ id: crmCompanies.id });
        created.push(co.id);
      } catch (e: unknown) {
        skipped.push({ row: rowNum, reason: safeImportError(e), data: rowData });
      }
    }
    res.json({ created: created.length, updated: 0, skipped });
  });

  app.post("/api/crm/companies/import/retry", csvUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const companyId = getCompanyId(req);
    const rows = parseCSV(req.file.buffer.toString("utf-8"));
    const created: string[] = [];
    const skipped: { row: number; reason: string; data?: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const rowData = {
        name: r.name || "",
        domain: r.domain || "",
        industry: r.industry || "",
        size: r.size || "",
        status: r.status || "",
      };
      if (!r.name) {
        skipped.push({ row: rowNum, reason: "Missing name", data: rowData });
        continue;
      }
      if (
        r.domain &&
        !/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/.test(r.domain.trim())
      ) {
        skipped.push({
          row: rowNum,
          reason: `Invalid domain format: "${r.domain}"`,
          data: rowData,
        });
        continue;
      }
      try {
        const [existing] = await db
          .select({ id: crmCompanies.id })
          .from(crmCompanies)
          .where(and(eq(crmCompanies.companyId, companyId), ilike(crmCompanies.name, r.name)));
        if (existing) {
          skipped.push({ row: rowNum, reason: "Duplicate: company already exists", data: rowData });
          continue;
        }
        const [co] = await db
          .insert(crmCompanies)
          .values({
            companyId,
            name: r.name,
            domain: r.domain || null,
            industry: r.industry || null,
            size: r.size || null,
            status: r.status || "active",
          })
          .returning({ id: crmCompanies.id });
        created.push(co.id);
      } catch (e: unknown) {
        skipped.push({ row: rowNum, reason: safeImportError(e), data: rowData });
      }
    }
    res.json({ created: created.length, updated: 0, skipped });
  });

  app.get("/api/crm/companies/:id/contacts", async (req, res) => {
    const companyId = getCompanyId(req);
    const [co] = await db
      .select()
      .from(crmCompanies)
      .where(and(eq(crmCompanies.id, req.params.id), eq(crmCompanies.companyId, companyId)));
    if (!co) return res.status(404).json({ message: "Company not found" });
    const contacts = await db
      .select()
      .from(crmContacts)
      .where(and(eq(crmContacts.companyId, companyId), ilike(crmContacts.company, co.name)))
      .orderBy(crmContacts.lastName);
    res.json(contacts);
  });

  app.get("/api/crm/companies/:id/deals", async (req, res) => {
    const companyId = getCompanyId(req);
    const deals = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.companyId, companyId), eq(crmDeals.crmCompanyId, req.params.id)))
      .orderBy(desc(crmDeals.createdAt));
    res.json(deals);
  });

  app.get("/api/crm/companies/:id/notes", async (req, res) => {
    const companyId = getCompanyId(req);
    const notes = await db
      .select()
      .from(crmNotes)
      .where(and(eq(crmNotes.companyId, companyId), eq(crmNotes.crmCompanyId, req.params.id)))
      .orderBy(desc(crmNotes.createdAt));
    res.json(notes);
  });

  app.post("/api/crm/companies/:id/notes", async (req, res) => {
    const companyId = getCompanyId(req);
    const [co] = await db
      .select({ id: crmCompanies.id })
      .from(crmCompanies)
      .where(and(eq(crmCompanies.id, req.params.id), eq(crmCompanies.companyId, companyId)));
    if (!co) return res.status(404).json({ message: "Company not found" });
    const [note] = await db
      .insert(crmNotes)
      .values({ content: req.body.content, crmCompanyId: req.params.id, companyId })
      .returning();
    res.status(201).json(note);
  });

  app.get("/api/crm/companies/:id/activity", async (req, res) => {
    const companyId = getCompanyId(req);
    const logs = await db
      .select()
      .from(crmAuditLogs)
      .where(
        and(
          eq(crmAuditLogs.companyId, companyId),
          eq(crmAuditLogs.entity, "company"),
          eq(crmAuditLogs.entityId, req.params.id)
        )
      )
      .orderBy(desc(crmAuditLogs.createdAt))
      .limit(50);
    res.json(logs);
  });

  // ─── CRM Deals ────────────────────────────────────────
  app.get("/api/crm/deals", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmDeals.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmDeals.title, `%${req.query.search}%`));
    if (req.query.stage) conditions.push(eq(crmDeals.stage, req.query.stage as string));
    if (req.query.status) conditions.push(eq(crmDeals.status, req.query.status as string));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmDeals)
      .where(where);
    const data = await db
      .select()
      .from(crmDeals)
      .where(where)
      .orderBy(desc(crmDeals.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.get("/api/crm/deals/:id", async (req, res) => {
    const [d] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, req.params.id), eq(crmDeals.companyId, getCompanyId(req))));
    if (!d) return res.status(404).json({ message: "Deal not found" });
    res.json(d);
  });

  app.get("/api/crm/deals/:id/timeline", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmActivities)
        .where(and(eq(crmActivities.dealId, req.params.id), eq(crmActivities.companyId, c)))
        .orderBy(desc(crmActivities.createdAt))
    );
  });

  app.get("/api/crm/deals/:id/notes", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmNotes)
        .where(and(eq(crmNotes.dealId, req.params.id), eq(crmNotes.companyId, c)))
        .orderBy(desc(crmNotes.createdAt))
    );
  });

  app.get("/api/crm/deals/:id/tasks", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmTasks)
        .where(and(eq(crmTasks.dealId, req.params.id), eq(crmTasks.companyId, c)))
        .orderBy(desc(crmTasks.createdAt))
    );
  });

  app.get("/api/crm/deals/:id/emails", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmEmails)
        .where(and(eq(crmEmails.dealId, req.params.id), eq(crmEmails.companyId, c)))
        .orderBy(crmEmails.createdAt)
    );
  });

  app.get("/api/crm/deals/:id/documents", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmDocuments)
        .where(and(eq(crmDocuments.dealId, req.params.id), eq(crmDocuments.companyId, c)))
        .orderBy(desc(crmDocuments.createdAt))
    );
  });

  app.get("/api/crm/deals/:id/quotes", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmQuotes)
        .where(and(eq(crmQuotes.dealId, req.params.id), eq(crmQuotes.companyId, c)))
        .orderBy(desc(crmQuotes.createdAt))
    );
  });

  app.post("/api/crm/deals", async (req, res) => {
    const parsed = insertCrmDealSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [deal] = await db
      .insert(crmDeals)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    await logCrmAudit(req, "created", "deal", deal.id, { title: deal.title });
    res.status(201).json(deal);
  });

  app.patch("/api/crm/deals/:id", async (req, res) => {
    const [d] = await db
      .update(crmDeals)
      .set(req.body)
      .where(and(eq(crmDeals.id, req.params.id), eq(crmDeals.companyId, getCompanyId(req))))
      .returning();
    if (!d) return res.status(404).json({ message: "Deal not found" });
    await logCrmAudit(req, "updated", "deal", d.id, { stage: d.stage });
    res.json(d);
  });

  app.delete("/api/crm/deals/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, req.params.id), eq(crmDeals.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ message: "Deal not found" });
    await logCrmAudit(req, "delete", "deal", existing.id, { title: existing.title });
    await db
      .delete(crmDeals)
      .where(and(eq(crmDeals.id, req.params.id), eq(crmDeals.companyId, getCompanyId(req))));
    res.status(204).send();
  });

  app.get("/api/crm/deals/import/template", async (_req, res) => {
    const header =
      "title,value,currency,stage,probability,expected_close_date,description,assigned_to,contact_email,company_name";
    const example =
      "New Website Project,5000,USD,proposal,60,2026-09-30,Redesign project,sales@myco.com,jane@acme.com,Acme Corp";
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="deals_import_template.csv"');
    res.send([header, example].join("\n"));
  });

  app.post("/api/crm/deals/import", csvUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const companyId = getCompanyId(req);
    const rows = parseCSV(req.file.buffer.toString("utf-8"));
    const created: string[] = [];
    const skipped: { row: number; reason: string; data?: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const rowData = {
        title: r.title || "",
        value: r.value || "",
        stage: r.stage || "",
        probability: r.probability || "",
        expected_close_date: r.expected_close_date || "",
        currency: r.currency || "",
        description: r.description || "",
        assigned_to: r.assigned_to || "",
        contact_email: r.contact_email || "",
        company_name: r.company_name || "",
      };
      if (!r.title) {
        skipped.push({ row: rowNum, reason: "Missing title", data: rowData });
        continue;
      }
      if (r.value && !isValidNumericValue(r.value)) {
        skipped.push({
          row: rowNum,
          reason: `value must be a number, got: "${r.value}"`,
          data: rowData,
        });
        continue;
      }
      if (r.probability) {
        if (!isValidNumericValue(r.probability)) {
          skipped.push({
            row: rowNum,
            reason: `probability must be a number (0–100), got: "${r.probability}"`,
            data: rowData,
          });
          continue;
        }
        const probNum = parseFloat(r.probability);
        if (probNum < 0 || probNum > 100) {
          skipped.push({
            row: rowNum,
            reason: `probability must be between 0 and 100, got: "${r.probability}"`,
            data: rowData,
          });
          continue;
        }
      }
      if (r.contact_email && !isValidEmail(r.contact_email)) {
        skipped.push({
          row: rowNum,
          reason: `Invalid contact_email format: "${r.contact_email}"`,
          data: rowData,
        });
        continue;
      }
      if (r.expected_close_date && isNaN(Date.parse(r.expected_close_date))) {
        skipped.push({
          row: rowNum,
          reason: `Invalid expected_close_date: "${r.expected_close_date}" — use YYYY-MM-DD`,
          data: rowData,
        });
        continue;
      }
      try {
        let contactId: string | null = null;
        if (r.contact_email) {
          const [ct] = await db
            .select({ id: crmContacts.id })
            .from(crmContacts)
            .where(
              and(eq(crmContacts.companyId, companyId), eq(crmContacts.email, r.contact_email))
            );
          if (ct) contactId = ct.id;
        }
        let crmCompanyId: string | null = null;
        if (r.company_name) {
          const [co] = await db
            .select({ id: crmCompanies.id })
            .from(crmCompanies)
            .where(
              and(eq(crmCompanies.companyId, companyId), ilike(crmCompanies.name, r.company_name))
            );
          if (co) crmCompanyId = co.id;
        }
        const valueInCents = r.value ? Math.round(parseFloat(r.value) * 100) : 0;
        const expectedCloseDate = r.expected_close_date ? new Date(r.expected_close_date) : null;
        const [deal] = await db
          .insert(crmDeals)
          .values({
            companyId,
            title: r.title,
            value: valueInCents,
            currency: r.currency || "USD",
            stage: r.stage || "lead",
            probability: r.probability ? parseInt(r.probability) || 0 : 0,
            expectedCloseDate,
            description: r.description || null,
            assignedTo: r.assigned_to || null,
            contactId,
            crmCompanyId,
          })
          .returning({ id: crmDeals.id });
        created.push(deal.id);
      } catch (e: unknown) {
        skipped.push({ row: rowNum, reason: safeImportError(e), data: rowData });
      }
    }
    res.json({ created: created.length, updated: 0, skipped });
  });

  app.post("/api/crm/deals/import/retry", csvUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const companyId = getCompanyId(req);
    const rows = parseCSV(req.file.buffer.toString("utf-8"));
    const created: string[] = [];
    const skipped: { row: number; reason: string; data?: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const rowData = {
        title: r.title || "",
        value: r.value || "",
        stage: r.stage || "",
        probability: r.probability || "",
        expected_close_date: r.expected_close_date || "",
        currency: r.currency || "",
        description: r.description || "",
        assigned_to: r.assigned_to || "",
        contact_email: r.contact_email || "",
        company_name: r.company_name || "",
      };
      if (!r.title) {
        skipped.push({ row: rowNum, reason: "Missing title", data: rowData });
        continue;
      }
      if (r.value && !isValidNumericValue(r.value)) {
        skipped.push({
          row: rowNum,
          reason: `value must be a number, got: "${r.value}"`,
          data: rowData,
        });
        continue;
      }
      if (r.probability) {
        if (!isValidNumericValue(r.probability)) {
          skipped.push({
            row: rowNum,
            reason: `probability must be a number (0–100), got: "${r.probability}"`,
            data: rowData,
          });
          continue;
        }
        const probNum = parseFloat(r.probability);
        if (probNum < 0 || probNum > 100) {
          skipped.push({
            row: rowNum,
            reason: `probability must be between 0 and 100, got: "${r.probability}"`,
            data: rowData,
          });
          continue;
        }
      }
      if (r.contact_email && !isValidEmail(r.contact_email)) {
        skipped.push({
          row: rowNum,
          reason: `Invalid contact_email format: "${r.contact_email}"`,
          data: rowData,
        });
        continue;
      }
      if (r.expected_close_date && !isValidDate(r.expected_close_date)) {
        skipped.push({
          row: rowNum,
          reason: `Invalid expected_close_date: "${r.expected_close_date}" — use YYYY-MM-DD`,
          data: rowData,
        });
        continue;
      }
      try {
        let contactId: string | null = null;
        if (r.contact_email) {
          const [ct] = await db
            .select({ id: crmContacts.id })
            .from(crmContacts)
            .where(
              and(eq(crmContacts.companyId, companyId), eq(crmContacts.email, r.contact_email))
            );
          if (ct) contactId = ct.id;
        }
        const dupConditions = [
          eq(crmDeals.companyId, companyId),
          ilike(crmDeals.title, r.title),
          contactId ? eq(crmDeals.contactId, contactId) : isNull(crmDeals.contactId),
        ];
        const [existingDeal] = await db
          .select({ id: crmDeals.id })
          .from(crmDeals)
          .where(and(...dupConditions));
        if (existingDeal) {
          skipped.push({
            row: rowNum,
            reason: "Duplicate: deal already exists for this contact",
            data: rowData,
          });
          continue;
        }
        let crmCompanyId: string | null = null;
        if (r.company_name) {
          const [co] = await db
            .select({ id: crmCompanies.id })
            .from(crmCompanies)
            .where(
              and(eq(crmCompanies.companyId, companyId), ilike(crmCompanies.name, r.company_name))
            );
          if (co) crmCompanyId = co.id;
        }
        const valueInCents = r.value ? Math.round(parseFloat(r.value) * 100) : 0;
        const expectedCloseDate = r.expected_close_date ? new Date(r.expected_close_date) : null;
        const [deal] = await db
          .insert(crmDeals)
          .values({
            companyId,
            title: r.title,
            value: valueInCents,
            currency: r.currency || "USD",
            stage: r.stage || "lead",
            probability: r.probability ? parseInt(r.probability) || 0 : 0,
            expectedCloseDate,
            description: r.description || null,
            assignedTo: r.assigned_to || null,
            contactId,
            crmCompanyId,
          })
          .returning({ id: crmDeals.id });
        created.push(deal.id);
      } catch (e: unknown) {
        skipped.push({ row: rowNum, reason: safeImportError(e), data: rowData });
      }
    }
    res.json({ created: created.length, updated: 0, skipped });
  });

  // ─── CRM Tasks ────────────────────────────────────────
  app.get("/api/crm/tasks", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmTasks.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmTasks.title, `%${req.query.search}%`));
    if (req.query.status) conditions.push(eq(crmTasks.status, req.query.status as string));
    if (req.query.priority) conditions.push(eq(crmTasks.priority, req.query.priority as string));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmTasks)
      .where(where);
    const data = await db
      .select()
      .from(crmTasks)
      .where(where)
      .orderBy(desc(crmTasks.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.get("/api/crm/tasks/:id", async (req, res) => {
    const [t] = await db
      .select()
      .from(crmTasks)
      .where(and(eq(crmTasks.id, req.params.id), eq(crmTasks.companyId, getCompanyId(req))));
    if (!t) return res.status(404).json({ message: "Task not found" });
    res.json(t);
  });

  app.post("/api/crm/tasks", async (req, res) => {
    const parsed = insertCrmTaskSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [task] = await db
      .insert(crmTasks)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(task);
  });

  app.patch("/api/crm/tasks/:id", async (req, res) => {
    const data = { ...req.body };
    if (data.status === "completed" && !data.completedAt) data.completedAt = new Date();
    const [t] = await db
      .update(crmTasks)
      .set(data)
      .where(and(eq(crmTasks.id, req.params.id), eq(crmTasks.companyId, getCompanyId(req))))
      .returning();
    if (!t) return res.status(404).json({ message: "Task not found" });
    res.json(t);
  });

  app.delete("/api/crm/tasks/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmTasks)
      .where(and(eq(crmTasks.id, req.params.id), eq(crmTasks.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ message: "Task not found" });
    await logCrmAudit(req, "delete", "task", existing.id, { title: existing.title });
    await db
      .delete(crmTasks)
      .where(and(eq(crmTasks.id, req.params.id), eq(crmTasks.companyId, getCompanyId(req))));
    res.status(204).send();
  });

  app.get("/api/crm/tasks/import/template", async (_req, res) => {
    const header =
      "title,description,type,priority,status,due_date,assigned_to,contact_email,deal_title,company_name";
    const example =
      "Follow up call,Discuss renewal options,call,high,pending,2026-08-15,sales@myco.com,jane@acme.com,Acme Renewal,Acme Corp";
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="tasks_import_template.csv"');
    res.send([header, example].join("\n"));
  });

  app.post("/api/crm/tasks/import", csvUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const companyId = getCompanyId(req);
    const rows = parseCSV(req.file.buffer.toString("utf-8"));
    const created: string[] = [];
    const skipped: { row: number; reason: string; data?: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const rowData = {
        title: r.title || "",
        description: r.description || "",
        type: r.type || "",
        priority: r.priority || "",
        status: r.status || "",
        due_date: r.due_date || "",
        assigned_to: r.assigned_to || "",
        contact_email: r.contact_email || "",
        deal_title: r.deal_title || "",
        company_name: r.company_name || "",
      };
      if (!r.title) {
        skipped.push({ row: rowNum, reason: "Missing title", data: rowData });
        continue;
      }
      if (r.contact_email && !isValidEmail(r.contact_email)) {
        skipped.push({
          row: rowNum,
          reason: `Invalid contact_email format: "${r.contact_email}"`,
          data: rowData,
        });
        continue;
      }
      if (r.assigned_to && !isValidEmail(r.assigned_to)) {
        skipped.push({
          row: rowNum,
          reason: `Invalid assigned_to email format: "${r.assigned_to}"`,
          data: rowData,
        });
        continue;
      }
      if (r.due_date && !isValidDate(r.due_date)) {
        skipped.push({
          row: rowNum,
          reason: `Invalid due_date: "${r.due_date}" — use YYYY-MM-DD`,
          data: rowData,
        });
        continue;
      }
      try {
        let contactId: string | null = null;
        if (r.contact_email) {
          const [ct] = await db
            .select({ id: crmContacts.id })
            .from(crmContacts)
            .where(
              and(eq(crmContacts.companyId, companyId), eq(crmContacts.email, r.contact_email))
            );
          if (ct) contactId = ct.id;
        }
        const dupConditions = [
          eq(crmTasks.companyId, companyId),
          ilike(crmTasks.title, r.title),
          contactId ? eq(crmTasks.contactId, contactId) : isNull(crmTasks.contactId),
        ];
        const [existingTask] = await db
          .select({ id: crmTasks.id })
          .from(crmTasks)
          .where(and(...dupConditions));
        if (existingTask) {
          skipped.push({
            row: rowNum,
            reason: "Duplicate: task already exists for this contact",
            data: rowData,
          });
          continue;
        }
        let dealId: string | null = null;
        if (r.deal_title) {
          const [dl] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.companyId, companyId), ilike(crmDeals.title, r.deal_title)));
          if (dl) dealId = dl.id;
        }
        let crmCompanyId: string | null = null;
        if (r.company_name) {
          const [co] = await db
            .select({ id: crmCompanies.id })
            .from(crmCompanies)
            .where(
              and(eq(crmCompanies.companyId, companyId), ilike(crmCompanies.name, r.company_name))
            );
          if (co) crmCompanyId = co.id;
        }
        const dueDate = r.due_date ? new Date(r.due_date) : null;
        const [task] = await db
          .insert(crmTasks)
          .values({
            companyId,
            title: r.title,
            description: r.description || null,
            type: r.type || "todo",
            priority: r.priority || "medium",
            status: r.status || "pending",
            dueDate,
            assignedTo: r.assigned_to || null,
            contactId,
            dealId,
            crmCompanyId,
          })
          .returning({ id: crmTasks.id });
        created.push(task.id);
      } catch (e: unknown) {
        skipped.push({ row: rowNum, reason: safeImportError(e), data: rowData });
      }
    }
    res.json({ created: created.length, updated: 0, skipped });
  });

  app.post("/api/crm/tasks/import/retry", csvUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const companyId = getCompanyId(req);
    const rows = parseCSV(req.file.buffer.toString("utf-8"));
    const created: string[] = [];
    const skipped: { row: number; reason: string; data?: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const rowData = {
        title: r.title || "",
        description: r.description || "",
        type: r.type || "",
        priority: r.priority || "",
        status: r.status || "",
        due_date: r.due_date || "",
        assigned_to: r.assigned_to || "",
        contact_email: r.contact_email || "",
        deal_title: r.deal_title || "",
        company_name: r.company_name || "",
      };
      if (!r.title) {
        skipped.push({ row: rowNum, reason: "Missing title", data: rowData });
        continue;
      }
      try {
        let contactId: string | null = null;
        if (r.contact_email) {
          const [ct] = await db
            .select({ id: crmContacts.id })
            .from(crmContacts)
            .where(
              and(eq(crmContacts.companyId, companyId), eq(crmContacts.email, r.contact_email))
            );
          if (ct) contactId = ct.id;
        }
        let dealId: string | null = null;
        if (r.deal_title) {
          const [dl] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.companyId, companyId), ilike(crmDeals.title, r.deal_title)));
          if (dl) dealId = dl.id;
        }
        let crmCompanyId: string | null = null;
        if (r.company_name) {
          const [co] = await db
            .select({ id: crmCompanies.id })
            .from(crmCompanies)
            .where(
              and(eq(crmCompanies.companyId, companyId), ilike(crmCompanies.name, r.company_name))
            );
          if (co) crmCompanyId = co.id;
        }
        const dueDate = r.due_date ? new Date(r.due_date) : null;
        const [task] = await db
          .insert(crmTasks)
          .values({
            companyId,
            title: r.title,
            description: r.description || null,
            type: r.type || "todo",
            priority: r.priority || "medium",
            status: r.status || "pending",
            dueDate,
            assignedTo: r.assigned_to || null,
            contactId,
            dealId,
            crmCompanyId,
          })
          .returning({ id: crmTasks.id });
        created.push(task.id);
      } catch (e: unknown) {
        skipped.push({ row: rowNum, reason: safeImportError(e), data: rowData });
      }
    }
    res.json({ created: created.length, updated: 0, skipped });
  });

  // ─── CRM Notes ────────────────────────────────────────
  app.get("/api/crm/notes", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmNotes)
        .where(eq(crmNotes.companyId, c))
        .orderBy(desc(crmNotes.createdAt))
    );
  });

  app.post("/api/crm/notes", async (req, res) => {
    const parsed = insertCrmNoteSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [note] = await db
      .insert(crmNotes)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(note);
  });

  app.patch("/api/crm/notes/:id", async (req, res) => {
    const [n] = await db
      .update(crmNotes)
      .set({ content: req.body.content })
      .where(and(eq(crmNotes.id, req.params.id), eq(crmNotes.companyId, getCompanyId(req))))
      .returning();
    if (!n) return res.status(404).json({ message: "Note not found" });
    await logCrmAudit(req, "updated", "note", n.id);
    res.json(n);
  });

  app.delete("/api/crm/notes/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmNotes)
      .where(and(eq(crmNotes.id, req.params.id), eq(crmNotes.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ message: "Note not found" });
    await logCrmAudit(req, "delete", "note", existing.id, {
      preview: existing.content?.slice(0, 80) ?? "",
    });
    await db
      .delete(crmNotes)
      .where(and(eq(crmNotes.id, req.params.id), eq(crmNotes.companyId, getCompanyId(req))));
    res.status(204).send();
  });

  // ─── CRM Activities ───────────────────────────────────
  app.post("/api/crm/activities", async (req, res) => {
    const parsed = insertCrmActivitySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [act] = await db
      .insert(crmActivities)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(act);
  });

  // ─── CRM Emails ───────────────────────────────────────
  app.get("/api/crm/emails", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmEmails.companyId, c)];
    if (req.query.search)
      conditions.push(
        or(
          ilike(crmEmails.subject, `%${req.query.search}%`),
          ilike(crmEmails.toAddress, `%${req.query.search}%`)
        )!
      );
    if (req.query.direction)
      conditions.push(eq(crmEmails.direction, req.query.direction as string));
    if (req.query.status) conditions.push(eq(crmEmails.status, req.query.status as string));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmEmails)
      .where(where);
    const data = await db
      .select()
      .from(crmEmails)
      .where(where)
      .orderBy(desc(crmEmails.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.post("/api/crm/emails", async (req, res) => {
    const parsed = insertCrmEmailSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [email] = await db
      .insert(crmEmails)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(email);
  });

  // ─── CRM Documents ────────────────────────────────────
  app.get("/api/crm/documents", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmDocuments.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmDocuments.name, `%${req.query.search}%`));
    if (req.query.type) conditions.push(eq(crmDocuments.type, req.query.type as string));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmDocuments)
      .where(where);
    const data = await db
      .select()
      .from(crmDocuments)
      .where(where)
      .orderBy(desc(crmDocuments.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.post("/api/crm/documents", async (req, res) => {
    const parsed = insertCrmDocumentSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [doc] = await db
      .insert(crmDocuments)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(doc);
  });

  app.patch("/api/crm/documents/:id", async (req, res) => {
    const allowed: Record<string, unknown> = {};
    if (req.body.name !== undefined) allowed.name = req.body.name;
    if (req.body.url !== undefined) allowed.url = req.body.url;
    if (req.body.type !== undefined) allowed.type = req.body.type;
    const [doc] = await db
      .update(crmDocuments)
      .set(allowed)
      .where(and(eq(crmDocuments.id, req.params.id), eq(crmDocuments.companyId, getCompanyId(req))))
      .returning();
    if (!doc) return res.status(404).json({ message: "Document not found" });
    await logCrmAudit(req, "updated", "document", doc.id, { name: doc.name });
    res.json(doc);
  });

  app.delete("/api/crm/documents/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmDocuments)
      .where(
        and(eq(crmDocuments.id, req.params.id), eq(crmDocuments.companyId, getCompanyId(req)))
      );
    if (!existing) return res.status(404).json({ message: "Document not found" });
    await logCrmAudit(req, "delete", "document", existing.id, { name: existing.name });
    await db
      .delete(crmDocuments)
      .where(
        and(eq(crmDocuments.id, req.params.id), eq(crmDocuments.companyId, getCompanyId(req)))
      );
    res.status(204).send();
  });

  // ─── CRM Web Forms ────────────────────────────────────
  app.get("/api/crm/forms", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmWebForms)
        .where(eq(crmWebForms.companyId, c))
        .orderBy(desc(crmWebForms.createdAt))
    );
  });

  app.post("/api/crm/forms", async (req, res) => {
    const parsed = insertCrmWebFormSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [form] = await db
      .insert(crmWebForms)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(form);
  });

  app.patch("/api/crm/forms/:id", async (req, res) => {
    const [f] = await db
      .update(crmWebForms)
      .set(req.body)
      .where(and(eq(crmWebForms.id, req.params.id), eq(crmWebForms.companyId, getCompanyId(req))))
      .returning();
    if (!f) return res.status(404).json({ message: "Form not found" });
    res.json(f);
  });

  app.delete("/api/crm/forms/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmWebForms)
      .where(and(eq(crmWebForms.id, req.params.id), eq(crmWebForms.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ message: "Form not found" });
    await logCrmAudit(req, "delete", "form", existing.id, { name: existing.name });
    await db
      .delete(crmWebForms)
      .where(and(eq(crmWebForms.id, req.params.id), eq(crmWebForms.companyId, getCompanyId(req))));
    res.status(204).send();
  });

  app.get("/api/crm/forms/:id/submissions", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmFormSubmissions)
        .where(
          and(eq(crmFormSubmissions.formId, req.params.id), eq(crmFormSubmissions.companyId, c))
        )
        .orderBy(desc(crmFormSubmissions.createdAt))
    );
  });

  // ─── CRM Quotes ───────────────────────────────────────
  app.get("/api/crm/quotes", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmQuotes.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmQuotes.title, `%${req.query.search}%`));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmQuotes)
      .where(where);
    const data = await db
      .select()
      .from(crmQuotes)
      .where(where)
      .orderBy(desc(crmQuotes.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.get("/api/crm/quotes/:id", async (req, res) => {
    const [q] = await db
      .select()
      .from(crmQuotes)
      .where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.companyId, getCompanyId(req))));
    if (!q) return res.status(404).json({ message: "Quote not found" });
    res.json(q);
  });

  app.post("/api/crm/quotes", async (req, res) => {
    const parsed = insertCrmQuoteSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [quote] = await db
      .insert(crmQuotes)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    await logCrmAudit(req, "created", "quote", quote.id, { title: quote.title });
    res.status(201).json(quote);
  });

  app.patch("/api/crm/quotes/:id", async (req, res) => {
    const [q] = await db
      .update(crmQuotes)
      .set(req.body)
      .where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.companyId, getCompanyId(req))))
      .returning();
    if (!q) return res.status(404).json({ message: "Quote not found" });
    await logCrmAudit(req, "updated", "quote", q.id, { title: q.title });
    res.json(q);
  });

  app.delete("/api/crm/quotes/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmQuotes)
      .where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ message: "Quote not found" });
    await logCrmAudit(req, "delete", "quote", existing.id, { title: existing.title });
    await db
      .delete(crmQuotes)
      .where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.companyId, getCompanyId(req))));
    res.status(204).send();
  });

  // ─── CRM Projects ─────────────────────────────────────
  app.get("/api/crm/projects", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmProjects.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmProjects.name, `%${req.query.search}%`));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmProjects)
      .where(where);
    const data = await db
      .select()
      .from(crmProjects)
      .where(where)
      .orderBy(desc(crmProjects.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.get("/api/crm/projects/:id", async (req, res) => {
    const [p] = await db
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, req.params.id), eq(crmProjects.companyId, getCompanyId(req))));
    if (!p) return res.status(404).json({ message: "Project not found" });
    res.json(p);
  });

  app.get("/api/crm/projects/:id/tasks", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmProjectTasks)
        .where(and(eq(crmProjectTasks.projectId, req.params.id), eq(crmProjectTasks.companyId, c)))
        .orderBy(crmProjectTasks.createdAt)
    );
  });

  app.post("/api/crm/projects", async (req, res) => {
    const parsed = insertCrmProjectSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [proj] = await db
      .insert(crmProjects)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(proj);
  });

  app.patch("/api/crm/projects/:id", async (req, res) => {
    const [p] = await db
      .update(crmProjects)
      .set(req.body)
      .where(and(eq(crmProjects.id, req.params.id), eq(crmProjects.companyId, getCompanyId(req))))
      .returning();
    if (!p) return res.status(404).json({ message: "Project not found" });
    await logCrmAudit(req, "updated", "project", p.id, { name: p.name });
    res.json(p);
  });

  app.delete("/api/crm/projects/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, req.params.id), eq(crmProjects.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ message: "Project not found" });
    await logCrmAudit(req, "delete", "project", existing.id, { name: existing.name });
    await db
      .delete(crmProjects)
      .where(and(eq(crmProjects.id, req.params.id), eq(crmProjects.companyId, getCompanyId(req))));
    res.status(204).send();
  });

  app.post("/api/crm/projects/:id/tasks", async (req, res) => {
    const parsed = insertCrmProjectTaskSchema.safeParse({ ...req.body, projectId: req.params.id });
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [t] = await db
      .insert(crmProjectTasks)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(t);
  });

  app.patch("/api/crm/project-tasks/:id", async (req, res) => {
    const [t] = await db
      .update(crmProjectTasks)
      .set(req.body)
      .where(
        and(eq(crmProjectTasks.id, req.params.id), eq(crmProjectTasks.companyId, getCompanyId(req)))
      )
      .returning();
    if (!t) return res.status(404).json({ message: "Task not found" });
    res.json(t);
  });

  app.delete("/api/crm/project-tasks/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmProjectTasks)
      .where(
        and(eq(crmProjectTasks.id, req.params.id), eq(crmProjectTasks.companyId, getCompanyId(req)))
      );
    if (!existing) return res.status(404).json({ message: "Task not found" });
    await logCrmAudit(req, "delete", "project_task", existing.id, { title: existing.title });
    await db
      .delete(crmProjectTasks)
      .where(
        and(eq(crmProjectTasks.id, req.params.id), eq(crmProjectTasks.companyId, getCompanyId(req)))
      );
    res.status(204).send();
  });

  // ─── CRM Campaigns ────────────────────────────────────
  app.get("/api/crm/campaigns", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmEmailCampaigns.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmEmailCampaigns.name, `%${req.query.search}%`));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmEmailCampaigns)
      .where(where);
    const data = await db
      .select()
      .from(crmEmailCampaigns)
      .where(where)
      .orderBy(desc(crmEmailCampaigns.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.get("/api/crm/campaigns/:id", async (req, res) => {
    const [c] = await db
      .select()
      .from(crmEmailCampaigns)
      .where(
        and(
          eq(crmEmailCampaigns.id, req.params.id),
          eq(crmEmailCampaigns.companyId, getCompanyId(req))
        )
      );
    if (!c) return res.status(404).json({ message: "Campaign not found" });
    res.json(c);
  });

  app.get("/api/crm/campaigns/:id/recipients", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmCampaignRecipients)
        .where(
          and(
            eq(crmCampaignRecipients.campaignId, req.params.id),
            eq(crmCampaignRecipients.companyId, c)
          )
        )
    );
  });

  app.post("/api/crm/campaigns", async (req, res) => {
    const parsed = insertCrmEmailCampaignSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [camp] = await db
      .insert(crmEmailCampaigns)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(camp);
  });

  app.patch("/api/crm/campaigns/:id", async (req, res) => {
    const [c] = await db
      .update(crmEmailCampaigns)
      .set(req.body)
      .where(
        and(
          eq(crmEmailCampaigns.id, req.params.id),
          eq(crmEmailCampaigns.companyId, getCompanyId(req))
        )
      )
      .returning();
    if (!c) return res.status(404).json({ message: "Campaign not found" });
    await logCrmAudit(req, "updated", "campaign", c.id, { name: c.name });
    res.json(c);
  });

  app.delete("/api/crm/campaigns/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmEmailCampaigns)
      .where(
        and(
          eq(crmEmailCampaigns.id, req.params.id),
          eq(crmEmailCampaigns.companyId, getCompanyId(req))
        )
      );
    if (!existing) return res.status(404).json({ message: "Campaign not found" });
    await logCrmAudit(req, "delete", "campaign", existing.id, { name: existing.name });
    await db
      .delete(crmEmailCampaigns)
      .where(
        and(
          eq(crmEmailCampaigns.id, req.params.id),
          eq(crmEmailCampaigns.companyId, getCompanyId(req))
        )
      );
    res.status(204).send();
  });

  app.post("/api/crm/campaigns/:id/recipients", async (req, res) => {
    const parsed = insertCrmCampaignRecipientSchema.safeParse({
      ...req.body,
      campaignId: req.params.id,
    });
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [r] = await db
      .insert(crmCampaignRecipients)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(r);
  });

  // ─── CRM Automations ──────────────────────────────────
  app.get("/api/crm/automations", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmAutomations.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmAutomations.name, `%${req.query.search}%`));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmAutomations)
      .where(where);
    const data = await db
      .select()
      .from(crmAutomations)
      .where(where)
      .orderBy(desc(crmAutomations.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.post("/api/crm/automations", async (req, res) => {
    const parsed = insertCrmAutomationSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [a] = await db
      .insert(crmAutomations)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(a);
  });

  app.patch("/api/crm/automations/:id", async (req, res) => {
    const [a] = await db
      .update(crmAutomations)
      .set(req.body)
      .where(
        and(eq(crmAutomations.id, req.params.id), eq(crmAutomations.companyId, getCompanyId(req)))
      )
      .returning();
    if (!a) return res.status(404).json({ message: "Automation not found" });
    res.json(a);
  });

  app.delete("/api/crm/automations/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmAutomations)
      .where(
        and(eq(crmAutomations.id, req.params.id), eq(crmAutomations.companyId, getCompanyId(req)))
      );
    if (!existing) return res.status(404).json({ message: "Automation not found" });
    await logCrmAudit(req, "delete", "automation", existing.id, { name: existing.name });
    await db
      .delete(crmAutomations)
      .where(
        and(eq(crmAutomations.id, req.params.id), eq(crmAutomations.companyId, getCompanyId(req)))
      );
    res.status(204).send();
  });

  // ─── CRM Sequences ────────────────────────────────────
  app.get("/api/crm/sequences", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmSequences)
        .where(eq(crmSequences.companyId, c))
        .orderBy(desc(crmSequences.createdAt))
    );
  });

  app.get("/api/crm/sequences/:id/steps", async (req, res) => {
    const c = getCompanyId(req);
    const [seq] = await db
      .select()
      .from(crmSequences)
      .where(and(eq(crmSequences.id, req.params.id), eq(crmSequences.companyId, c)));
    if (!seq) return res.status(404).json({ message: "Sequence not found" });
    res.json(
      await db
        .select()
        .from(crmSequenceSteps)
        .where(eq(crmSequenceSteps.sequenceId, req.params.id))
        .orderBy(crmSequenceSteps.stepNumber)
    );
  });

  app.get("/api/crm/sequences/:id/enrollments", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmSequenceEnrollments)
        .where(
          and(
            eq(crmSequenceEnrollments.sequenceId, req.params.id),
            eq(crmSequenceEnrollments.companyId, c)
          )
        )
    );
  });

  app.post("/api/crm/sequences", async (req, res) => {
    const parsed = insertCrmSequenceSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [seq] = await db
      .insert(crmSequences)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(seq);
  });

  app.patch("/api/crm/sequences/:id", async (req, res) => {
    const [s] = await db
      .update(crmSequences)
      .set(req.body)
      .where(and(eq(crmSequences.id, req.params.id), eq(crmSequences.companyId, getCompanyId(req))))
      .returning();
    if (!s) return res.status(404).json({ message: "Sequence not found" });
    res.json(s);
  });

  app.delete("/api/crm/sequences/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmSequences)
      .where(
        and(eq(crmSequences.id, req.params.id), eq(crmSequences.companyId, getCompanyId(req)))
      );
    if (!existing) return res.status(404).json({ message: "Sequence not found" });
    await logCrmAudit(req, "delete", "sequence", existing.id, { name: existing.name });
    await db
      .delete(crmSequences)
      .where(
        and(eq(crmSequences.id, req.params.id), eq(crmSequences.companyId, getCompanyId(req)))
      );
    res.status(204).send();
  });

  app.post("/api/crm/sequences/:id/steps", async (req, res) => {
    const c = getCompanyId(req);
    const [seq] = await db
      .select()
      .from(crmSequences)
      .where(and(eq(crmSequences.id, req.params.id), eq(crmSequences.companyId, c)));
    if (!seq) return res.status(403).json({ message: "Forbidden" });
    const parsed = insertCrmSequenceStepSchema.safeParse({
      ...req.body,
      sequenceId: req.params.id,
    });
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [step] = await db
      .insert(crmSequenceSteps)
      .values({ ...parsed.data, companyId: c })
      .returning();
    res.status(201).json(step);
  });

  app.delete("/api/crm/sequence-steps/:id", async (req, res) => {
    const c = getCompanyId(req);
    const [step] = await db
      .select()
      .from(crmSequenceSteps)
      .where(eq(crmSequenceSteps.id, req.params.id));
    if (!step) return res.status(404).json({ message: "Step not found" });
    const [seq] = await db
      .select()
      .from(crmSequences)
      .where(and(eq(crmSequences.id, step.sequenceId), eq(crmSequences.companyId, c)));
    if (!seq) return res.status(403).json({ message: "Forbidden" });
    await logCrmAudit(req, "delete", "sequence_step", step.id, {
      sequenceId: step.sequenceId,
      stepNumber: step.stepNumber,
    });
    await db.delete(crmSequenceSteps).where(eq(crmSequenceSteps.id, req.params.id));
    res.status(204).send();
  });

  app.post("/api/crm/sequences/:id/enroll", async (req, res) => {
    const parsed = insertCrmSequenceEnrollmentSchema.safeParse({
      ...req.body,
      sequenceId: req.params.id,
      companyId: getCompanyId(req),
    });
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [enr] = await db.insert(crmSequenceEnrollments).values(parsed.data).returning();
    res.status(201).json(enr);
  });

  // ─── CRM Audit Logs ───────────────────────────────────
  app.get("/api/crm/audit-logs", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmAuditLogs.companyId, c)];
    if (req.query.search) conditions.push(ilike(crmAuditLogs.action, `%${req.query.search}%`));
    if (req.query.entity) conditions.push(eq(crmAuditLogs.entity, req.query.entity as string));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmAuditLogs)
      .where(where);
    const data = await db
      .select()
      .from(crmAuditLogs)
      .where(where)
      .orderBy(desc(crmAuditLogs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  // ─── CRM Lead Scoring Rules ───────────────────────────
  app.get("/api/crm/lead-scoring-rules", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db.select().from(crmLeadScoringRules).where(eq(crmLeadScoringRules.companyId, c))
    );
  });

  app.post("/api/crm/lead-scoring-rules", async (req, res) => {
    const parsed = insertCrmLeadScoringRuleSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [r] = await db
      .insert(crmLeadScoringRules)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(r);
  });

  app.patch("/api/crm/lead-scoring-rules/:id", async (req, res) => {
    const [r] = await db
      .update(crmLeadScoringRules)
      .set(req.body)
      .where(
        and(
          eq(crmLeadScoringRules.id, req.params.id),
          eq(crmLeadScoringRules.companyId, getCompanyId(req))
        )
      )
      .returning();
    if (!r) return res.status(404).json({ message: "Rule not found" });
    res.json(r);
  });

  app.delete("/api/crm/lead-scoring-rules/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmLeadScoringRules)
      .where(
        and(
          eq(crmLeadScoringRules.id, req.params.id),
          eq(crmLeadScoringRules.companyId, getCompanyId(req))
        )
      );
    if (!existing) return res.status(404).json({ message: "Rule not found" });
    await logCrmAudit(req, "delete", "lead_scoring_rule", existing.id, { field: existing.field });
    await db
      .delete(crmLeadScoringRules)
      .where(
        and(
          eq(crmLeadScoringRules.id, req.params.id),
          eq(crmLeadScoringRules.companyId, getCompanyId(req))
        )
      );
    res.status(204).send();
  });

  // ─── CRM Notifications ────────────────────────────────────
  app.get("/api/crm/notifications", async (req, res) => {
    const c = getCompanyId(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const conditions = [eq(crmNotifications.companyId, c)];
    if (req.query.read !== undefined)
      conditions.push(eq(crmNotifications.read, req.query.read === "true"));
    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmNotifications)
      .where(where);
    const data = await db
      .select()
      .from(crmNotifications)
      .where(where)
      .orderBy(desc(crmNotifications.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.post("/api/crm/notifications", async (req, res) => {
    const parsed = insertCrmNotificationSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [n] = await db
      .insert(crmNotifications)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(n);
  });

  app.patch("/api/crm/notifications/:id", async (req, res) => {
    const c = getCompanyId(req);
    const [n] = await db
      .update(crmNotifications)
      .set(req.body)
      .where(and(eq(crmNotifications.id, req.params.id), eq(crmNotifications.companyId, c)))
      .returning();
    if (!n) return res.status(404).json({ message: "Notification not found" });
    res.json(n);
  });

  app.delete("/api/crm/notifications/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmNotifications)
      .where(
        and(
          eq(crmNotifications.id, req.params.id),
          eq(crmNotifications.companyId, getCompanyId(req))
        )
      );
    if (!existing) return res.status(404).json({ message: "Notification not found" });
    await logCrmAudit(req, "delete", "notification", existing.id, { title: existing.title });
    await db
      .delete(crmNotifications)
      .where(
        and(
          eq(crmNotifications.id, req.params.id),
          eq(crmNotifications.companyId, getCompanyId(req))
        )
      );
    res.status(204).send();
  });

  // ─── CRM Webhooks ─────────────────────────────────────────
  app.get("/api/crm/webhooks", async (req, res) => {
    const c = getCompanyId(req);
    res.json(
      await db
        .select()
        .from(crmWebhooks)
        .where(eq(crmWebhooks.companyId, c))
        .orderBy(desc(crmWebhooks.createdAt))
    );
  });

  app.post("/api/crm/webhooks", async (req, res) => {
    const parsed = insertCrmWebhookSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const [w] = await db
      .insert(crmWebhooks)
      .values({ ...parsed.data, companyId: getCompanyId(req) })
      .returning();
    res.status(201).json(w);
  });

  app.patch("/api/crm/webhooks/:id", async (req, res) => {
    const c = getCompanyId(req);
    const [w] = await db
      .update(crmWebhooks)
      .set(req.body)
      .where(and(eq(crmWebhooks.id, req.params.id), eq(crmWebhooks.companyId, c)))
      .returning();
    if (!w) return res.status(404).json({ message: "Webhook not found" });
    res.json(w);
  });

  app.delete("/api/crm/webhooks/:id", async (req, res) => {
    const [existing] = await db
      .select()
      .from(crmWebhooks)
      .where(and(eq(crmWebhooks.id, req.params.id), eq(crmWebhooks.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ message: "Webhook not found" });
    await logCrmAudit(req, "delete", "webhook", existing.id, { url: existing.url });
    await db
      .delete(crmWebhooks)
      .where(and(eq(crmWebhooks.id, req.params.id), eq(crmWebhooks.companyId, getCompanyId(req))));
    res.status(204).send();
  });

  // ─── CRM Webhook Deliveries ───────────────────────────────
  app.get("/api/crm/webhooks/:id/deliveries", async (req, res) => {
    const c = getCompanyId(req);
    const [wh] = await db
      .select()
      .from(crmWebhooks)
      .where(and(eq(crmWebhooks.id, req.params.id), eq(crmWebhooks.companyId, c)));
    if (!wh) return res.status(403).json({ message: "Forbidden" });
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const where = eq(crmWebhookDeliveries.webhookId, req.params.id);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(crmWebhookDeliveries)
      .where(where);
    const data = await db
      .select()
      .from(crmWebhookDeliveries)
      .where(where)
      .orderBy(desc(crmWebhookDeliveries.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json(buildPaginated(data, Number(count), page, limit));
  });

  app.post("/api/crm/webhook-deliveries", async (req, res) => {
    const parsed = insertCrmWebhookDeliverySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: fromError(parsed.error).toString() });
    const c = getCompanyId(req);
    const [wh] = await db
      .select()
      .from(crmWebhooks)
      .where(and(eq(crmWebhooks.id, parsed.data.webhookId), eq(crmWebhooks.companyId, c)));
    if (!wh) return res.status(403).json({ message: "Forbidden" });
    const [d] = await db.insert(crmWebhookDeliveries).values(parsed.data).returning();
    res.status(201).json(d);
  });
}

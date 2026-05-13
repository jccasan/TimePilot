import type { Express, Request } from "express";
import { db } from "../db";
import { sql, eq, and, ilike, desc, or } from "drizzle-orm";
import { isAuthenticated, getCompanyContext } from "./shared";
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
    const r = await db
      .delete(crmContacts)
      .where(and(eq(crmContacts.id, req.params.id), eq(crmContacts.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Contact not found" });
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
    const r = await db
      .delete(crmCompanies)
      .where(and(eq(crmCompanies.id, req.params.id), eq(crmCompanies.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Company not found" });
    res.status(204).send();
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
    const r = await db
      .delete(crmDeals)
      .where(and(eq(crmDeals.id, req.params.id), eq(crmDeals.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Deal not found" });
    res.status(204).send();
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
    const r = await db
      .delete(crmTasks)
      .where(and(eq(crmTasks.id, req.params.id), eq(crmTasks.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Task not found" });
    res.status(204).send();
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

  app.delete("/api/crm/notes/:id", async (req, res) => {
    const r = await db
      .delete(crmNotes)
      .where(and(eq(crmNotes.id, req.params.id), eq(crmNotes.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Note not found" });
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

  app.delete("/api/crm/documents/:id", async (req, res) => {
    const r = await db
      .delete(crmDocuments)
      .where(and(eq(crmDocuments.id, req.params.id), eq(crmDocuments.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Document not found" });
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
    const r = await db
      .delete(crmWebForms)
      .where(and(eq(crmWebForms.id, req.params.id), eq(crmWebForms.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Form not found" });
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
    res.json(q);
  });

  app.delete("/api/crm/quotes/:id", async (req, res) => {
    const r = await db
      .delete(crmQuotes)
      .where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Quote not found" });
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
    res.json(p);
  });

  app.delete("/api/crm/projects/:id", async (req, res) => {
    const r = await db
      .delete(crmProjects)
      .where(and(eq(crmProjects.id, req.params.id), eq(crmProjects.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Project not found" });
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
    const r = await db
      .delete(crmProjectTasks)
      .where(
        and(eq(crmProjectTasks.id, req.params.id), eq(crmProjectTasks.companyId, getCompanyId(req)))
      )
      .returning();
    if (!r.length) return res.status(404).json({ message: "Task not found" });
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
    res.json(c);
  });

  app.delete("/api/crm/campaigns/:id", async (req, res) => {
    const r = await db
      .delete(crmEmailCampaigns)
      .where(
        and(
          eq(crmEmailCampaigns.id, req.params.id),
          eq(crmEmailCampaigns.companyId, getCompanyId(req))
        )
      )
      .returning();
    if (!r.length) return res.status(404).json({ message: "Campaign not found" });
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
    const r = await db
      .delete(crmAutomations)
      .where(
        and(eq(crmAutomations.id, req.params.id), eq(crmAutomations.companyId, getCompanyId(req)))
      )
      .returning();
    if (!r.length) return res.status(404).json({ message: "Automation not found" });
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
    const r = await db
      .delete(crmSequences)
      .where(and(eq(crmSequences.id, req.params.id), eq(crmSequences.companyId, getCompanyId(req))))
      .returning();
    if (!r.length) return res.status(404).json({ message: "Sequence not found" });
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
    const result = await db
      .delete(crmLeadScoringRules)
      .where(
        and(
          eq(crmLeadScoringRules.id, req.params.id),
          eq(crmLeadScoringRules.companyId, getCompanyId(req))
        )
      )
      .returning();
    if (!result.length) return res.status(404).json({ message: "Rule not found" });
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
    const result = await db
      .delete(crmNotifications)
      .where(
        and(
          eq(crmNotifications.id, req.params.id),
          eq(crmNotifications.companyId, getCompanyId(req))
        )
      )
      .returning();
    if (!result.length) return res.status(404).json({ message: "Notification not found" });
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
    const result = await db
      .delete(crmWebhooks)
      .where(and(eq(crmWebhooks.id, req.params.id), eq(crmWebhooks.companyId, getCompanyId(req))))
      .returning();
    if (!result.length) return res.status(404).json({ message: "Webhook not found" });
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

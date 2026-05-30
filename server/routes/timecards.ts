import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, isNotNull } from "drizzle-orm";
import { storage } from "../storage";
import { timeEntries } from "@shared/schema";
import { timecardRepo } from "../repositories";
import { isAuthenticated, getCompanyContext, handleError, requireRole } from "./shared";

// ─── Stripe product IDs eligible for timecards ─────────────────────────────

const TIMECARD_ELIGIBLE_PRODUCTS = [
  "prod_UQx7ys3uxkPE1W", // Crew ($59/mo)
  "prod_UQyL8P28F1RgPC", // Team ($99/mo)
  "prod_UQyP66Ygt4daN3", // Agency ($219/mo)
];

// ─── Middleware ────────────────────────────────────────────────────────────────

async function requireTimecards(req: Request, res: Response, next: NextFunction) {
  try {
    const { companyId } = await getCompanyContext(req);
    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    const withinTrial = company.timecardTrialEndsAt
      ? new Date() < new Date(company.timecardTrialEndsAt)
      : false;

    const onEligibleTier = TIMECARD_ELIGIBLE_PRODUCTS.includes(
      (company as any).stripePriceId ?? ""
    );

    if (!company.timecardEnabled && !withinTrial && !onEligibleTier) {
      // Auto-start 14-day trial on first access
      if (!company.timecardTrialEndsAt) {
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 14);
        await storage.updateCompany(companyId, { timecardTrialEndsAt: trialEnd });
        return next();
      }
      return res.status(403).json({ error: "Timecards add-on required", upgrade: true });
    }

    next();
  } catch (err) {
    handleError(res, err);
  }
}

// ─── Route Registration ────────────────────────────────────────────────────────

export async function registerTimecardRoutes(app: Express): Promise<void> {
  const auth = [isAuthenticated, requireTimecards] as any[];

  // ── Settings ──────────────────────────────────────────────────────────────

  app.get("/api/timecards/settings", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const settings = await timecardRepo.getOrCreateSettings(companyId);
      res.json(settings);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/timecards/settings", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const schema = z.object({
        payPeriodType: z.enum(["weekly", "bi-weekly", "semi-monthly", "monthly"]).optional(),
        payPeriodAnchorDate: z.string().optional(),
        overtimeWeeklyHours: z.string().optional(),
        overtimeDailyHours: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const settings = await timecardRepo.updateSettings(companyId, data as any);
      res.json(settings);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/timecards/settings/preview",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const settings = await timecardRepo.getOrCreateSettings(companyId);
        const { getPeriodBoundaries } = await import("../repositories/TimecardRepository");
        const periods: Array<{ periodStart: string; periodEnd: string }> = [];
        let cursor = new Date();
        for (let i = 0; i < 3; i++) {
          const { periodStart, periodEnd } = getPeriodBoundaries(cursor, settings);
          periods.push({
            periodStart: periodStart.toISOString().slice(0, 10),
            periodEnd: periodEnd.toISOString().slice(0, 10),
          });
          cursor = new Date(periodEnd);
          cursor.setDate(cursor.getDate() + 1);
        }
        res.json(periods);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ── Export Templates ───────────────────────────────────────────────────────

  const templateSchema = z.object({
    name: z.string().min(1),
    fields: z.array(
      z.object({ field: z.string(), columnName: z.string() })
    ),
  });

  app.get(
    "/api/timecards/settings/templates",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const settings = await timecardRepo.getOrCreateSettings(companyId);
        let templates = (settings.exportTemplates as any[]) ?? [];

        // Auto-create default template if none exist
        if (templates.length === 0) {
          const defaultTemplate = {
            id: crypto.randomUUID(),
            name: "Default",
            fields: [
              { field: "employee_full_name", columnName: "Employee Name" },
              { field: "date", columnName: "Date" },
              { field: "clock_in", columnName: "Clock In" },
              { field: "clock_out", columnName: "Clock Out" },
              { field: "regular_hours", columnName: "Regular Hours" },
              { field: "overtime_hours", columnName: "Overtime Hours" },
            ],
          };
          templates = [defaultTemplate];
          await timecardRepo.updateSettings(companyId, {
            exportTemplates: templates as any,
          });
        }

        res.json(templates);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/timecards/settings/templates",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const { name, fields } = templateSchema.parse(req.body);
        const settings = await timecardRepo.getOrCreateSettings(companyId);
        const templates = (settings.exportTemplates as any[]) ?? [];
        const newTemplate = { id: crypto.randomUUID(), name, fields };
        await timecardRepo.updateSettings(companyId, {
          exportTemplates: [...templates, newTemplate] as any,
        });
        res.status(201).json(newTemplate);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/timecards/settings/templates/:id",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const { name, fields } = templateSchema.parse(req.body);
        const settings = await timecardRepo.getOrCreateSettings(companyId);
        const templates = (settings.exportTemplates as any[]) ?? [];
        const idx = templates.findIndex((t) => t.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: "Template not found" });
        templates[idx] = { ...templates[idx], name, fields };
        await timecardRepo.updateSettings(companyId, {
          exportTemplates: templates as any,
        });
        res.json(templates[idx]);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete(
    "/api/timecards/settings/templates/:id",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const settings = await timecardRepo.getOrCreateSettings(companyId);
        const templates = (settings.exportTemplates as any[]) ?? [];
        const filtered = templates.filter((t) => t.id !== req.params.id);
        await timecardRepo.updateSettings(companyId, {
          exportTemplates: filtered as any,
        });
        res.status(204).end();
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ── Tech: own timecards ────────────────────────────────────────────────────

  app.get("/api/timecards/my/current", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const period = await timecardRepo.getOrCreatePeriod(companyId, userId, new Date());
      const entries = await db
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.companyId, companyId),
            eq(timeEntries.periodId, period.id)
          )
        )
        .orderBy(timeEntries.clockIn);

      const entriesWithBreaks = await Promise.all(
        entries.map(async (entry) => ({
          ...entry,
          breaks: await timecardRepo.getBreaks(companyId, entry.id),
        }))
      );

      const totals = await timecardRepo.calculatePeriodTotals(companyId, period.id);
      res.json({ ...period, entries: entriesWithBreaks, totals });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/timecards/my", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const status = req.query.status as string | undefined;
      const periods = await timecardRepo.listPeriods(companyId, { userId, status });
      res.json(periods);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/timecards/my/:periodId", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const period = await timecardRepo.getPeriod(companyId, req.params.periodId);
      if (!period || period.userId !== userId)
        return res.status(404).json({ error: "Period not found" });

      const entries = await db
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.companyId, companyId),
            eq(timeEntries.periodId, period.id)
          )
        )
        .orderBy(timeEntries.clockIn);

      const entriesWithBreaks = await Promise.all(
        entries.map(async (entry) => ({
          ...entry,
          breaks: await timecardRepo.getBreaks(companyId, entry.id),
        }))
      );

      const totals = await timecardRepo.calculatePeriodTotals(companyId, period.id);
      res.json({ ...period, entries: entriesWithBreaks, totals });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/timecards/my/:periodId/submit",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId } = await getCompanyContext(req);
        const period = await timecardRepo.submitPeriod(
          companyId,
          req.params.periodId,
          userId
        );
        res.json(period);
      } catch (err: any) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        handleError(res, err);
      }
    }
  );

  // ── Office: all timecards ──────────────────────────────────────────────────

  app.get("/api/timecards", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const filters = {
        userId: req.query.userId as string | undefined,
        status: req.query.status as string | undefined,
        from: req.query.from ? new Date(req.query.from as string) : undefined,
        to: req.query.to ? new Date(req.query.to as string) : undefined,
      };
      const periods = await timecardRepo.listPeriods(companyId, filters);
      res.json(periods);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/timecards/:periodId", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const period = await timecardRepo.getPeriod(companyId, req.params.periodId);
      if (!period) return res.status(404).json({ error: "Period not found" });

      const entries = await db
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.companyId, companyId),
            eq(timeEntries.periodId, period.id)
          )
        )
        .orderBy(timeEntries.clockIn);

      const entriesWithBreaks = await Promise.all(
        entries.map(async (entry) => ({
          ...entry,
          breaks: await timecardRepo.getBreaks(companyId, entry.id),
        }))
      );

      const totals = await timecardRepo.calculatePeriodTotals(companyId, period.id);
      res.json({ ...period, entries: entriesWithBreaks, totals });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/timecards/:periodId/approve",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        requireRole(role);
        const period = await timecardRepo.approvePeriod(
          companyId,
          req.params.periodId,
          userId
        );
        res.json(period);
      } catch (err: any) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/timecards/:periodId/reject",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        requireRole(role);
        const { notes } = z.object({ notes: z.string().min(1) }).parse(req.body);
        const period = await timecardRepo.rejectPeriod(
          companyId,
          req.params.periodId,
          userId,
          notes
        );
        res.json(period);
      } catch (err: any) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/timecards/:periodId/reopen",
    ...auth,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const period = await timecardRepo.reopenPeriod(companyId, req.params.periodId);
        res.json(period);
      } catch (err: any) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        handleError(res, err);
      }
    }
  );

  // ── Office: manual entry ───────────────────────────────────────────────────

  app.post("/api/time-entries/manual", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, userId: requestingUserId, role } = await getCompanyContext(req);
      requireRole(role);
      const schema = z.object({
        userId: z.string(),
        clockIn: z.string(),
        clockOut: z.string().optional(),
        notes: z.string().optional(),
        periodId: z.string().optional(),
      });
      const body = schema.parse(req.body);
      const clockIn = new Date(body.clockIn);
      const clockOut = body.clockOut ? new Date(body.clockOut) : undefined;
      const durationMinutes = clockOut
        ? Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)
        : undefined;

      // Resolve period if not provided
      let periodId = body.periodId;
      if (!periodId) {
        const period = await timecardRepo.getOrCreatePeriod(
          companyId,
          body.userId,
          clockIn
        );
        periodId = period.id;
      }

      const entry = await storage.createTimeEntry({
        companyId,
        userId: body.userId,
        clockIn,
        clockOut,
        durationMinutes,
        notes: body.notes,
        periodId,
        editedBy: requestingUserId,
        editedAt: new Date(),
      } as any);
      res.status(201).json(entry);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Office: edit entry ─────────────────────────────────────────────────────

  app.patch("/api/time-entries/:id", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, userId: requestingUserId, role } = await getCompanyContext(req);
      requireRole(role);
      const schema = z.object({
        clockIn: z.string().optional(),
        clockOut: z.string().optional(),
        notes: z.string().optional(),
      });
      const body = schema.parse(req.body);
      const updates: Record<string, any> = {
        editedBy: requestingUserId,
        editedAt: new Date(),
      };
      if (body.clockIn) updates.clockIn = new Date(body.clockIn);
      if (body.clockOut) updates.clockOut = new Date(body.clockOut);
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.clockIn && body.clockOut) {
        updates.durationMinutes = Math.round(
          (new Date(body.clockOut).getTime() - new Date(body.clockIn).getTime()) / 60000
        );
      }

      // If period is submitted, reopen to draft
      const [existing] = await db
        .select()
        .from(timeEntries)
        .where(
          and(eq(timeEntries.id, req.params.id), eq(timeEntries.companyId, companyId))
        );
      if (!existing) return res.status(404).json({ error: "Entry not found" });

      if (existing.periodId) {
        const period = await timecardRepo.getPeriod(companyId, existing.periodId);
        if (period?.status === "submitted") {
          await timecardRepo.reopenPeriod(companyId, period.id);
          await storage.createNotification({
            companyId,
            title: "Timecard Returned to Draft",
            message:
              "Your timecard was edited by office and returned to draft for review",
            type: "general",
          });
        }
      }

      const entry = await storage.updateTimeEntry(req.params.id, companyId, updates);
      res.json(entry);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Breaks ─────────────────────────────────────────────────────────────────

  app.post(
    "/api/time-entries/:id/breaks/start",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const breakEntry = await timecardRepo.startBreak(companyId, req.params.id);
        res.status(201).json(breakEntry);
      } catch (err: any) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/time-entries/:id/breaks/end",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const breakEntry = await timecardRepo.endBreak(companyId, req.params.id);
        res.json(breakEntry);
      } catch (err: any) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/time-entries/:id/breaks",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const breaks = await timecardRepo.getBreaks(companyId, req.params.id);
        res.json(breaks);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ── Export ─────────────────────────────────────────────────────────────────

  app.post("/api/timecards/export", ...auth, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { periodIds, templateId } = z
        .object({ periodIds: z.array(z.string()).min(1), templateId: z.string() })
        .parse(req.body);
      const csv = await timecardRepo.generateExportCSV(companyId, periodIds, templateId);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ScooPilot_Payroll_Export.csv"`
      );
      res.send(csv);
    } catch (err: any) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      handleError(res, err);
    }
  });

  // ── Stripe add-on checkout ─────────────────────────────────────────────────

  app.post(
    "/api/timecards/subscribe",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const company = await storage.getCompany(companyId);
        if (!company) return res.status(404).json({ error: "Company not found" });
        // Caller creates Stripe session via billing route; return 501 if not wired
        res
          .status(501)
          .json({ error: "Configure Stripe checkout session in billing routes" });
      } catch (err) {
        handleError(res, err);
      }
    }
  );
}

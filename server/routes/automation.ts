import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { automationEventLogs } from "@shared/schema";
import { insertAutomationRuleSchema } from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  handleError,
  auditLog,
  p,
  suggestServiceDay,
} from "./shared";

export async function registerAutomationRoutes(app: Express): Promise<void> {
  // ================ Automation Rule Routes ================

  app.get("/api/automation-rules", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const rules = await storage.getAutomationRules(companyId);
      res.json(rules);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/automation-rules", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertAutomationRuleSchema.parse({ ...req.body, companyId });
      const rule = await storage.createAutomationRule(parsed);
      res.status(201).json(rule);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/automation-rules/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getAutomationRules(companyId);
      if (!existing.find((r) => r.id === p(req.params.id)))
        return res.status(404).json({ error: "Rule not found" });
      const rule = await storage.updateAutomationRule(p(req.params.id), companyId, req.body);
      res.json(rule);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/automation-rules/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteAutomationRule(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/automation-rules/:id/logs",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const ruleId = p(req.params.id);
        const logs = await db
          .select()
          .from(automationEventLogs)
          .where(
            and(
              eq(automationEventLogs.companyId, companyId),
              eq(automationEventLogs.ruleId, ruleId)
            )
          )
          .orderBy(automationEventLogs.createdAt);
        res.json(logs);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ API Key Routes ================

  app.get("/api/api-keys", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const keys = await storage.getApiKeys(companyId);
      const masked = keys.map((k) => ({
        ...k,
        keyHash: undefined,
        keyPrefix: k.keyPrefix,
        maskedKey: `${k.keyPrefix}...`,
      }));
      res.json(masked);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/api-keys", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const rawKey = crypto.randomBytes(32).toString("hex");
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.substring(0, 8);

      const apiKey = await storage.createApiKey({
        companyId,
        name: req.body.name || "API Key",
        keyHash,
        keyPrefix,
        scopes: req.body.scopes || [],
        isActive: true,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
      } as any);

      const { userId } = await getCompanyContext(req);
      auditLog(
        companyId,
        userId,
        "api_key",
        apiKey.id,
        "create",
        { new: { name: apiKey.name, keyPrefix, scopes: req.body.scopes || [] } },
        req.ip || undefined
      );
      res.status(201).json({ ...apiKey, rawKey });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/api-keys/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role);
      const existingKeys = await storage.getApiKeys(companyId);
      const existingKey = existingKeys.find((k) => k.id === p(req.params.id));
      await storage.deleteApiKey(p(req.params.id), companyId);
      auditLog(
        companyId,
        userId,
        "api_key",
        p(req.params.id),
        "delete",
        { deleted: { name: existingKey?.name, keyPrefix: existingKey?.keyPrefix } },
        req.ip || undefined
      );
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Route Day Suggestion ================

  app.get("/api/routes/suggest-day", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      if (isNaN(lat) || isNaN(lng))
        return res.status(400).json({ error: "lat and lng are required" });
      const result = await suggestServiceDay(companyId, lat, lng);
      res.json(result ?? null);
    } catch (err) {
      handleError(res, err);
    }
  });
}

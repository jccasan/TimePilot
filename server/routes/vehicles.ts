import type { Express, Request, Response } from "express";
import multer from "multer";
import { isAuthenticated, getCompanyContext, requireRole, handleError, p } from "./shared";
import { ObjectStorageService } from "../replit_integrations/object_storage";
import { VehicleRepository } from "../repositories/VehicleRepository";
import { storage } from "../storage";
import {
  insertVehicleSchema,
  insertOdometerLogSchema,
  insertMaintenanceLogSchema,
  insertFuelLogSchema,
  insertRepairLogSchema,
} from "@shared/vehicle-schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { companies } from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_DOC_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const objStorage = new ObjectStorageService();
const repo = new VehicleRepository();

async function requireVehicleTracker(
  req: Request,
  res: Response
): Promise<{ companyId: string; role: string } | null> {
  try {
    const ctx = await getCompanyContext(req);
    const company = await storage.getCompany(ctx.companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return null;
    }

    const now = new Date();
    const trialActive =
      company.vehicleTrackerTrialEndsAt && company.vehicleTrackerTrialEndsAt > now;
    const hasAccess = company.vehicleTrackerEnabled || trialActive;

    if (!hasAccess) {
      if (!company.vehicleTrackerTrialEndsAt) {
        const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        await db
          .update(companies)
          .set({ vehicleTrackerTrialEndsAt: trialEndsAt, updatedAt: new Date() })
          .where(eq(companies.id, ctx.companyId));
        console.log(`[Fleet] Auto-started 14-day trial for company ${ctx.companyId}`);
      } else {
        res.status(403).json({ error: "FleetPilot subscription required", upgrade: true });
        return null;
      }
    }

    return ctx;
  } catch (err) {
    console.error("[Fleet] requireVehicleTracker error:", err);
    res.status(500).json({ error: "Internal server error" });
    return null;
  }
}

export async function registerVehicleRoutes(app: Express): Promise<void> {
  // ── Fleet access info ──────────────────────────────────────────────────────

  app.get("/api/vehicles/access", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      let company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const now = new Date();
      // Auto-start 14-day trial on first access if never tried before
      if (!company.vehicleTrackerEnabled && !company.vehicleTrackerTrialEndsAt) {
        const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        await db
          .update(companies)
          .set({ vehicleTrackerTrialEndsAt: trialEndsAt, updatedAt: new Date() })
          .where(eq(companies.id, companyId));
        company = { ...company, vehicleTrackerTrialEndsAt: trialEndsAt };
        console.log(`[Fleet] Auto-started 14-day trial for company ${companyId}`);
      }
      const trialActive =
        company.vehicleTrackerTrialEndsAt && company.vehicleTrackerTrialEndsAt > now;
      const hasAccess = company.vehicleTrackerEnabled || !!trialActive;
      const daysLeftInTrial =
        trialActive && company.vehicleTrackerTrialEndsAt
          ? Math.ceil((company.vehicleTrackerTrialEndsAt.getTime() - now.getTime()) / 86400000)
          : null;
      res.json({
        enabled: company.vehicleTrackerEnabled,
        trialEndsAt: company.vehicleTrackerTrialEndsAt,
        trialActive: !!trialActive,
        hasAccess,
        daysLeftInTrial,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Vehicles CRUD ──────────────────────────────────────────────────────────

  app.get("/api/vehicles", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const vehicleList = await repo.listVehicles(ctx.companyId);
      res.json(vehicleList);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/vehicles", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      requireRole(ctx.role, ["owner", "admin"]);
      const parsed = insertVehicleSchema.parse({ ...req.body, companyId: ctx.companyId });
      const vehicle = await repo.createVehicle(parsed);
      res.status(201).json(vehicle);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Static fleet-wide routes (must be before /:id) ─────────────────────────

  app.get("/api/vehicles/fleet-summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      const summary = await repo.getFleetSummary(ctx.companyId, startDate, endDate);
      res.json(summary);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/vehicles/fleet-alerts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const alerts = await repo.getFleetAlerts(ctx.companyId);
      res.json(alerts);
    } catch (err) {
      handleError(res, err);
    }
  });

  async function handleFleetCheckout(req: Request, res: Response) {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (company.vehicleTrackerEnabled)
        return res.status(400).json({ error: "Fleet plan already active" });
      const priceId = process.env.STRIPE_FLEET_PRICE_ID;
      if (!priceId)
        return res.status(400).json({ error: "Fleet pricing not configured. Contact support." });
      const { createFleetPlanCheckout, isStripeConfigured } = await import("../services/stripe");
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe not configured" });
      const { getBaseUrl } = await import("./shared");
      const baseUrl = getBaseUrl(req);
      const session = await createFleetPlanCheckout({
        tenantId: companyId,
        priceId,
        customerEmail: company.email || "",
        successUrl: `${baseUrl}/fleet?fleet_success=1`,
        cancelUrl: `${baseUrl}/fleet`,
        customerId: company.stripeCustomerId || undefined,
      });
      res.json({ url: session.url });
    } catch (err) {
      handleError(res, err);
    }
  }

  app.post("/api/vehicles/fleet-checkout", isAuthenticated, handleFleetCheckout);
  app.post("/api/vehicles/subscribe", isAuthenticated, handleFleetCheckout);

  // ── Per-vehicle routes (dynamic /:id below this line) ──────────────────────

  app.get("/api/vehicles/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const vehicle = await repo.getVehicle(p(req.params.id), ctx.companyId);
      if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
      res.json(vehicle);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/vehicles/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      requireRole(ctx.role, ["owner", "admin"]);
      const id = p(req.params.id);
      const existing = await repo.getVehicle(id, ctx.companyId);
      if (!existing) return res.status(404).json({ error: "Vehicle not found" });
      const updated = await repo.updateVehicle(id, ctx.companyId, req.body);
      res.json(updated);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/vehicles/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      requireRole(ctx.role, ["owner", "admin"]);
      const id = p(req.params.id);
      const existing = await repo.getVehicle(id, ctx.companyId);
      if (!existing) return res.status(404).json({ error: "Vehicle not found" });
      await repo.softDeleteVehicle(id, ctx.companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Odometer logs ──────────────────────────────────────────────────────────

  app.get("/api/vehicles/:id/odometer", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const logs = await repo.listOdometerLogs(p(req.params.id), ctx.companyId);
      res.json(logs);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/vehicles/:id/odometer", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const vehicleId = p(req.params.id);
      const vehicle = await repo.getVehicle(vehicleId, ctx.companyId);
      if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
      const parsed = insertOdometerLogSchema.parse({
        ...req.body,
        vehicleId,
        companyId: ctx.companyId,
      });
      const log = await repo.createOdometerLog(parsed);
      res.status(201).json(log);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete(
    "/api/vehicles/:id/odometer/:logId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        await repo.deleteOdometerLog(p(req.params.logId), ctx.companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ── Maintenance logs ───────────────────────────────────────────────────────

  app.get("/api/vehicles/:id/maintenance", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const logs = await repo.listMaintenanceLogs(p(req.params.id), ctx.companyId);
      res.json(logs);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/vehicles/:id/maintenance",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        const vehicleId = p(req.params.id);
        const vehicle = await repo.getVehicle(vehicleId, ctx.companyId);
        if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
        const parsed = insertMaintenanceLogSchema.parse({
          ...req.body,
          vehicleId,
          companyId: ctx.companyId,
        });
        const log = await repo.createMaintenanceLog(parsed);
        res.status(201).json(log);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/vehicles/:id/maintenance/:logId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        const log = await repo.updateMaintenanceLog(p(req.params.logId), ctx.companyId, req.body);
        res.json(log);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete(
    "/api/vehicles/:id/maintenance/:logId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        await repo.deleteMaintenanceLog(p(req.params.logId), ctx.companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ── Fuel logs ──────────────────────────────────────────────────────────────

  app.get("/api/vehicles/:id/fuel", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const logs = await repo.listFuelLogs(p(req.params.id), ctx.companyId);
      const { perFillup, rollingAverage } = repo.calculateMPG(logs);
      res.json({ logs, mpg: { perFillup, rollingAverage } });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/vehicles/:id/fuel", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const vehicleId = p(req.params.id);
      const vehicle = await repo.getVehicle(vehicleId, ctx.companyId);
      if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
      const parsed = insertFuelLogSchema.parse({
        ...req.body,
        vehicleId,
        companyId: ctx.companyId,
      });
      const log = await repo.createFuelLog(parsed);
      res.status(201).json(log);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(
    "/api/vehicles/:id/fuel/:logId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        const log = await repo.updateFuelLog(p(req.params.logId), ctx.companyId, req.body);
        res.json(log);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete(
    "/api/vehicles/:id/fuel/:logId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        await repo.deleteFuelLog(p(req.params.logId), ctx.companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ── Repair logs ────────────────────────────────────────────────────────────

  app.get("/api/vehicles/:id/repairs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const logs = await repo.listRepairLogs(p(req.params.id), ctx.companyId);
      res.json(logs);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/vehicles/:id/repairs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const vehicleId = p(req.params.id);
      const vehicle = await repo.getVehicle(vehicleId, ctx.companyId);
      if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
      const parsed = insertRepairLogSchema.parse({
        ...req.body,
        vehicleId,
        companyId: ctx.companyId,
      });
      const log = await repo.createRepairLog(parsed);
      res.status(201).json(log);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(
    "/api/vehicles/:id/repairs/:logId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        const log = await repo.updateRepairLog(p(req.params.logId), ctx.companyId, req.body);
        res.json(log);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete(
    "/api/vehicles/:id/repairs/:logId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        await repo.deleteRepairLog(p(req.params.logId), ctx.companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ── Documents ──────────────────────────────────────────────────────────────

  app.get("/api/vehicles/:id/documents", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const docs = await repo.listDocuments(p(req.params.id), ctx.companyId);
      const docsWithUrls = await Promise.all(
        docs.map(async (d) => {
          try {
            const signedUrl = await objStorage.getObjectEntityFile(d.filePath);
            const url = signedUrl ? `/objects/${d.filePath.replace(/^\/objects\//, "")}` : null;
            return { ...d, downloadUrl: url };
          } catch {
            return { ...d, downloadUrl: null };
          }
        })
      );
      res.json(docsWithUrls);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/vehicles/:id/documents",
    isAuthenticated,
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        const vehicleId = p(req.params.id);
        const vehicle = await repo.getVehicle(vehicleId, ctx.companyId);
        if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });

        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file provided" });
        if (!ALLOWED_DOC_MIMES.has(file.mimetype))
          return res.status(400).json({ error: "Only PDF, JPG, and PNG files are allowed" });

        const name = (req.body.name as string) || file.originalname;
        const documentType = (req.body.documentType as string) || "other";
        const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined;
        const notes = req.body.notes as string | undefined;

        const { randomUUID } = await import("crypto");
        const ext =
          file.mimetype === "application/pdf"
            ? "pdf"
            : file.mimetype === "image/jpeg"
              ? "jpg"
              : "png";
        const uuid = randomUUID();
        const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
        if (!privateDir) return res.status(500).json({ error: "Storage not configured" });
        const dir = privateDir.endsWith("/") ? privateDir : privateDir + "/";
        const objectEntityPath = `${dir}vehicles/${ctx.companyId}/${vehicleId}/documents/${uuid}.${ext}`;
        const pathParts = objectEntityPath.replace(/^\//, "").split("/");
        const bucketName = pathParts[0];
        const objectName = pathParts.slice(1).join("/");
        const { objectStorageClient } = await import("../replit_integrations/object_storage");
        await objectStorageClient.bucket(bucketName).file(objectName).save(file.buffer, {
          contentType: file.mimetype,
        });
        const filePath = `/objects/vehicles/${ctx.companyId}/${vehicleId}/documents/${uuid}.${ext}`;

        const doc = await repo.createDocument({
          vehicleId,
          companyId: ctx.companyId,
          name,
          documentType,
          filePath,
          fileSize: file.size,
          mimeType: file.mimetype,
          expiresAt: expiresAt ?? null,
          notes: notes ?? null,
        });
        res.status(201).json(doc);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete(
    "/api/vehicles/:id/documents/:docId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const ctx = await requireVehicleTracker(req, res);
        if (!ctx) return;
        requireRole(ctx.role, ["owner", "admin"]);
        await repo.deleteDocument(p(req.params.docId), ctx.companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ── Per-vehicle summary ────────────────────────────────────────────────────

  app.get("/api/vehicles/:id/summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ctx = await requireVehicleTracker(req, res);
      if (!ctx) return;
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      const summary = await repo.getVehicleSummary(
        p(req.params.id),
        ctx.companyId,
        startDate,
        endDate
      );
      res.json(summary);
    } catch (err) {
      handleError(res, err);
    }
  });
}

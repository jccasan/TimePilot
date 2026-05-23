import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { geocodeAddress } from "../services/geocode";
import { insertPropertySchema } from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  handleError,
  p,
  resolveCoordinatesForAddress,
} from "./shared";

export async function registerPropertiesRoutes(app: Express): Promise<void> {
  // ================ Property Routes ================

  app.get("/api/properties", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactId = req.query.contactId as string | undefined;
      const propertiesList = await storage.getProperties(companyId, contactId);
      res.json(propertiesList);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const property = await storage.getProperty(p(req.params.id), companyId);
      if (!property) return res.status(404).json({ error: "Property not found" });
      res.json(property);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/properties", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertPropertySchema.parse({ ...req.body, companyId });
      let geocodeFailed = false;
      if (!parsed.latitude && !parsed.longitude && parsed.streetAddress) {
        const company = await storage.getCompany(companyId);
        const coords = await geocodeAddress(
          parsed.streetAddress,
          parsed.city,
          parsed.state,
          parsed.zipCode,
          company?.country ?? null,
          companyId
        );
        if (coords) {
          (parsed as Record<string, unknown>).latitude = coords.latitude;
          (parsed as Record<string, unknown>).longitude = coords.longitude;
        } else {
          geocodeFailed = true;
        }
      }
      const property = await storage.createProperty(parsed);
      res.status(201).json({ ...property, geocodeFailed });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getProperty(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Property not found" });
      const addressChanged =
        (req.body.streetAddress !== undefined &&
          req.body.streetAddress !== existing.streetAddress) ||
        (req.body.city !== undefined && req.body.city !== existing.city) ||
        (req.body.state !== undefined && req.body.state !== existing.state) ||
        (req.body.zipCode !== undefined && req.body.zipCode !== existing.zipCode);
      const updateData = { ...req.body };
      let geocodeFailed = false;
      if (addressChanged) {
        const merged = {
          streetAddress: req.body.streetAddress ?? existing.streetAddress,
          city: req.body.city ?? existing.city,
          state: req.body.state ?? existing.state,
          zipCode: req.body.zipCode ?? existing.zipCode,
        };
        if (merged.streetAddress) {
          const company = await storage.getCompany(companyId);
          const coords = await geocodeAddress(
            merged.streetAddress,
            merged.city,
            merged.state,
            merged.zipCode,
            company?.country ?? null,
            companyId
          );
          if (coords) {
            updateData.latitude = coords.latitude;
            updateData.longitude = coords.longitude;
          } else {
            geocodeFailed = true;
          }
        }
      }
      const property = await storage.updateProperty(p(req.params.id), companyId, updateData);
      res.json({ ...property, geocodeFailed });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/properties/geocode-all", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const allProperties = await storage.getProperties(companyId);
      const needsGeocode = allProperties.filter(
        (p) => p.streetAddress && (!p.latitude || !p.longitude)
      );
      let geocoded = 0;
      for (const prop of needsGeocode) {
        const coords = await resolveCoordinatesForAddress(
          companyId,
          prop.streetAddress!,
          prop.city,
          prop.state,
          prop.zipCode,
          allProperties
        );
        if (coords) {
          await storage.updateProperty(prop.id, companyId, {
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          prop.latitude = coords.latitude;
          prop.longitude = coords.longitude;
          geocoded++;
        }
      }
      res.json({ total: allProperties.length, needsGeocode: needsGeocode.length, geocoded });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getProperty(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Property not found" });
      await storage.deleteProperty(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });
}

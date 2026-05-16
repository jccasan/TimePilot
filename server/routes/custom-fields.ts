import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { getCompanyContext, isAuthenticated, handleError, p } from "./shared";

const createFieldSchema = z.object({
  label: z.string().min(1).max(100),
  fieldType: z.enum(["text", "number", "select", "checkbox", "date"]),
  entityType: z.enum(["contact", "property"]),
  options: z.array(z.string()).optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const updateFieldSchema = createFieldSchema.partial();

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function registerCustomFieldsRoutes(app: Express) {
  app.get("/api/custom-field-definitions", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const entityType =
        typeof req.query.entityType === "string" ? req.query.entityType : undefined;
      const defs = await storage.getCustomFieldDefinitions(companyId, entityType);
      res.json(defs);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/custom-field-definitions",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const parsed = createFieldSchema.parse(req.body);
        const key = slugify(parsed.label) || `field_${Date.now()}`;
        const def = await storage.createCustomFieldDefinition({
          companyId,
          label: parsed.label,
          key,
          fieldType: parsed.fieldType,
          entityType: parsed.entityType,
          options: parsed.options ?? null,
          sortOrder: parsed.sortOrder ?? 0,
        });
        res.status(201).json(def);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/custom-field-definitions/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const parsed = updateFieldSchema.parse(req.body);
        const def = await storage.updateCustomFieldDefinition(p(req.params.id), companyId, parsed);
        res.json(def);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete(
    "/api/custom-field-definitions/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        await storage.deleteCustomFieldDefinition(p(req.params.id), companyId);
        res.status(204).end();
      } catch (err) {
        handleError(res, err);
      }
    }
  );
}

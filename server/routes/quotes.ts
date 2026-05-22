import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { maskEmail } from "../utils/pii";
import { storage } from "../storage";
import { companies } from "@shared/schema";
import { z } from "zod";
import {
  getUserByEmail,
  createUserWithTempPassword,
  claimOnboardingEmailSend,
  resetOnboardingEmailSent,
} from "../services/app-auth";
import { sendEmail, buildWelcomeEmailContent } from "../services/email";
import { sendSmsForCompany, isSmsConfiguredForCompany } from "../services/sms";
import {
  calculateQuotePricing,
  renderResidentialProposalHtml,
  renderCommercialProposalHtml,
  renderQuoteSmsText,
  type ResidentialQuoteInput,
  type CommercialQuoteInput,
} from "../services/quote-pricing";
import { generateQuotePdf, generateQuoteDocx } from "../services/quote-document";
import { type InsertQuote } from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  getBaseUrl,
  p,
  seedDefaultLeadSources,
  normalizeQuoteFrequency,
} from "./shared";

export async function registerQuotesRoutes(app: Express): Promise<void> {
  // ================ Tenant Provisioning (marketing site → app) ================

  app.post("/api/create-tenant", async (req: Request, res: Response) => {
    try {
      const apiKey = (req.headers["x-api-key"] ||
        req.headers["authorization"]?.replace(/^Bearer\s+/i, "")) as string | undefined;
      const expectedKey = process.env.SCOOPILOT_API_KEY;
      if (!expectedKey || !apiKey || apiKey !== expectedKey) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const {
        email,
        first_name,
        last_name,
        company,
        phone,
        plan,
        domain,
        stripe_customer_id,
        stripe_subscription_id,
      } = req.body;

      if (!email || !first_name || !company) {
        return res
          .status(400)
          .json({ error: "Missing required fields: email, first_name, company" });
      }

      const existingUser = await getUserByEmail(email);

      if (existingUser) {
        const existingCompanies = await storage.getCompaniesForUser(existingUser.id);
        if (existingCompanies.length > 0) {
          const existingCompany = await storage.getCompany(existingCompanies[0].companyId);
          if (existingCompany) {
            const updateData: Partial<Record<string, unknown>> = {};
            if (stripe_subscription_id) updateData.stripeSubscriptionId = stripe_subscription_id;
            if (plan) updateData.subscriptionTier = plan;
            updateData.subscriptionStatus = "trialing";
            if (Object.keys(updateData).length > 0) {
              await storage.updateCompany(
                existingCompany.id,
                updateData as Partial<typeof companies.$inferInsert>
              );
            }
            console.log(
              `[Create Tenant] Updated existing company "${existingCompany.name}" (${existingCompany.id}) for ${email}`
            );
            return res.json({
              success: true,
              tenant_id: existingCompany.id,
              user_id: existingUser.id,
              existing: true,
            });
          }
        }
      }

      const crypto = await import("crypto");
      const tempPassword = crypto.randomBytes(6).toString("base64url");
      let user = existingUser;
      if (!user) {
        user = await createUserWithTempPassword(email, first_name, last_name || "", tempPassword);
      }

      const tierMap: Record<string, string> = {
        free_trial: "free_trial",
        tier_starter: "tier_starter",
        tier_1: "tier_1",
        tier_1_3: "tier_1_3",
        tier_3_5: "tier_3_5",
        tier_6_10: "tier_6_10",
        tier_10_plus: "tier_10_plus",
      };
      const subscriptionTier = tierMap[plan] || "free_trial";

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);

      const createData: Record<string, unknown> = {
        name: company.trim(),
        email,
        phone: phone || "",
        subscriptionTier,
        subscriptionStatus: "trialing",
        trialEndsAt: trialEnd,
      };
      if (stripe_customer_id) createData.stripeCustomerId = stripe_customer_id;
      if (stripe_subscription_id) createData.stripeSubscriptionId = stripe_subscription_id;
      if (domain) createData.website = domain;

      const newCompany = await storage.createCompany(createData as typeof companies.$inferInsert);
      await storage.addUserToCompany(user.id, newCompany.id, "owner");
      await seedDefaultLeadSources(newCompany.id);
      await storage.seedDefaultPricing(newCompany.id);

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "app.scoopilot.com";
      const appUrl = `${protocol}://${host}`;

      const tenantClaimed = await claimOnboardingEmailSend(user.id).catch(() => false);
      if (!tenantClaimed) {
        console.log(
          `[Create Tenant] Onboarding email already sent for ${maskEmail(email)}, skipping.`
        );
      } else {
        try {
          const _tenantWelcome = buildWelcomeEmailContent({
            firstName: first_name,
            companyName: company,
            appUrl,
            email,
            tempPassword,
          });
          await sendEmail({
            companyId: newCompany.id,
            to: email,
            subject: _tenantWelcome.subject,
            text: _tenantWelcome.text,
            html: _tenantWelcome.html,
          });
          console.log(`[Create Tenant] Welcome email sent to ${maskEmail(email)}`);
        } catch (emailErr) {
          console.error(
            `[Create Tenant] Failed to send welcome email to ${maskEmail(email)}, resetting flag:`,
            emailErr
          );
          await resetOnboardingEmailSent(user.id).catch(() => {});
        }
      }

      console.log(
        `[Create Tenant] Provisioned new tenant "${company}" (${newCompany.id}) for ${maskEmail(email)}`
      );
      return res.json({
        success: true,
        tenant_id: newCompany.id,
        user_id: user.id,
        existing: false,
      });
    } catch (err) {
      console.error("[Create Tenant] Error:", err);
      return res.status(500).json({ error: "Tenant creation failed" });
    }
  });

  // ================ Quotes ================

  app.post(
    "/api/quotes/generate-yard-image",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId } = await getCompanyContext(req);
        const {
          propertyId,
          caption,
          polygon: directPolygon,
          lat: directLat,
          lng: directLng,
          sqft: directSqft,
        } = req.body;

        let polygon: number[][] | null = null;
        let lat: number | null = null;
        let lng: number | null = null;
        let sqft: number | undefined;

        if (
          directPolygon &&
          Array.isArray(directPolygon) &&
          directPolygon.length >= 3 &&
          directLat &&
          directLng
        ) {
          polygon = directPolygon;
          lat = parseFloat(String(directLat));
          lng = parseFloat(String(directLng));
          sqft = directSqft ? Number(directSqft) : undefined;
        } else if (propertyId) {
          const property = await storage.getProperty(propertyId, companyId);
          if (!property) {
            return res.status(404).json({ error: "Property not found" });
          }
          polygon = property.yardPolygon as number[][] | null;
          lat = property.latitude ? parseFloat(String(property.latitude)) : null;
          lng = property.longitude ? parseFloat(String(property.longitude)) : null;
          sqft = property.measuredYardSqft ? Number(property.measuredYardSqft) : undefined;
        }

        if (!polygon || polygon.length < 3 || !lat || !lng) {
          return res
            .status(400)
            .json({ error: "Must provide a polygon with at least 3 points and coordinates" });
        }

        const mapboxToken = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
        if (!mapboxToken) {
          return res.status(500).json({ error: "Mapbox token not configured" });
        }

        const width = 800;
        const height = 600;

        const closedPoly = [...polygon];
        if (
          closedPoly[0][0] !== closedPoly[closedPoly.length - 1][0] ||
          closedPoly[0][1] !== closedPoly[closedPoly.length - 1][1]
        ) {
          closedPoly.push(closedPoly[0]);
        }

        const geoJson = {
          type: "Feature",
          properties: {
            stroke: "#22c55e",
            "stroke-width": 3,
            "stroke-opacity": 0.9,
            fill: "#22c55e",
            "fill-opacity": 0.25,
          },
          geometry: {
            type: "Polygon",
            coordinates: [closedPoly],
          },
        };

        const geoJsonEncoded = encodeURIComponent(JSON.stringify(geoJson));
        const staticUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/geojson(${geoJsonEncoded})/auto/${width}x${height}@2x?padding=40&access_token=${mapboxToken}&attribution=false&logo=false`;

        const imgResponse = await fetch(staticUrl);
        if (!imgResponse.ok) {
          const errText = await imgResponse.text();
          console.error("Mapbox Static API error:", errText);
          return res.status(502).json({ error: "Failed to generate satellite image" });
        }

        const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

        const { ObjectStorageService } =
          await import("../replit_integrations/object_storage/objectStorage");
        const objStorage = new ObjectStorageService();
        const uploadURL = await objStorage.getObjectEntityUploadURL();
        const objectPath = objStorage.normalizeObjectEntityPath(uploadURL);

        const putResponse = await fetch(uploadURL, {
          method: "PUT",
          body: imgBuffer,
          headers: { "Content-Type": "image/png" },
        });

        if (!putResponse.ok) {
          throw new Error(`Storage upload failed: ${putResponse.status}`);
        }

        await objStorage
          .trySetObjectEntityAclPolicy(uploadURL, { owner: userId, visibility: "public" })
          .catch(() => {
            /* non-fatal — image will still be accessible to authenticated staff */
          });

        const autoCaption =
          caption ||
          `Yard measurement${
            sqft
              ? ` — ${Number(sqft).toLocaleString()} sq ft / ${(Number(sqft) / 43560).toFixed(2)} ${Number(sqft) / 43560 >= 2 ? "acres" : "acre"}`
              : ""
          }`;

        res.json({
          url: objectPath,
          caption: autoCaption,
          sqft: sqft || null,
          width,
          height,
        });
      } catch (err: unknown) {
        console.error("Error generating yard image:", err);
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.get("/api/quotes/calculate-pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) {
        console.warn(`[calculate-pricing] company not found for companyId=${companyId}`);
        return res.status(404).json({ error: "Company not found" });
      }
      const companyQuoteDefaults = company.quoteDefaults ?? null;
      const companyPricingConfig = company.pricingConfig as
        | {
            pricingRules?: {
              yardSizeTiers?: { name?: string; upToAcres: number | null; surcharge: number }[];
            };
          }
        | null
        | undefined;
      const companyYardSizeTiers = companyPricingConfig?.pricingRules?.yardSizeTiers ?? null;

      const type = req.query.type as string;
      if (type === "residential") {
        const yardSize = (req.query.yardSize as string) || "Standard";
        const frequency = (req.query.frequency as string) || "weekly";
        const input: ResidentialQuoteInput = {
          type: "residential",
          dogCount: parseInt(req.query.dogCount as string) || 1,
          yardSize,
          frequency: frequency as ResidentialQuoteInput["frequency"],
          isFirstTime: req.query.isFirstTime === "true",
        };
        const pricing = calculateQuotePricing(input, companyQuoteDefaults, companyYardSizeTiers);
        res.json(pricing);
      } else if (type === "commercial") {
        const frequency = (req.query.frequency as string) || "1x_weekly";
        const input: CommercialQuoteInput = {
          type: "commercial",
          stationCount: (() => {
            const v = parseInt(req.query.stationCount as string);
            return isNaN(v) ? 0 : v;
          })(),
          commonAreaMinutes: parseInt(req.query.commonAreaMinutes as string) || 30,
          frequency: frequency as CommercialQuoteInput["frequency"],
          timePerStation: parseInt(req.query.timePerStation as string) || 10,
          mileageDistance: parseFloat(req.query.mileageDistance as string) || 0,
          dumpFee: Number.isFinite(parseFloat(req.query.dumpFee as string))
            ? parseFloat(req.query.dumpFee as string)
            : 25,
          crewSize: parseInt(req.query.crewSize as string) || 1,
          siteSqft: parseInt(req.query.siteSqft as string) || 0,
          isInitialClean: req.query.isInitialClean === "true",
          markupPct: Number.isFinite(parseFloat(req.query.markupPct as string))
            ? parseFloat(req.query.markupPct as string)
            : 20,
        };
        const pricing = calculateQuotePricing(input, companyQuoteDefaults);
        res.json(pricing);
      } else {
        res
          .status(400)
          .json({ error: "Invalid quote type. Must be 'residential' or 'commercial'." });
      }
    } catch (err: unknown) {
      console.error("Error calculating pricing:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/quotes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { status?: string; type?: string; contactId?: string } = {};
      if (req.query.status) filters.status = String(req.query.status);
      if (req.query.type) filters.type = String(req.query.type);
      if (req.query.contactId) filters.contactId = String(req.query.contactId);
      const quotesList = await storage.getQuotes(companyId, filters);
      res.json(quotesList);
    } catch (err: unknown) {
      console.error("Error listing quotes:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/quotes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(p(req.params.id), companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      res.json(quote);
    } catch (err: unknown) {
      console.error("Error getting quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const createQuoteBodySchema = z.object({
    type: z.enum(["residential", "commercial"]),
    quoteNumber: z.string().max(50).nullable().optional(),
    contactId: z.string().nullable().optional(),
    propertyId: z.string().nullable().optional(),
    contactName: z.string().min(1, "Contact name is required").max(255),
    contactEmail: z.string().email().max(255).nullable().optional(),
    contactPhone: z.string().max(50).nullable().optional(),
    propertyAddress: z.string().nullable().optional(),
    dogCount: z.number().int().min(0).max(50).nullable().optional(),
    yardSize: z.string().max(50).nullable().optional(),
    stationCount: z.number().int().min(0).max(200).nullable().optional(),
    commonAreaMinutes: z.number().int().min(0).max(600).nullable().optional(),
    timePerStation: z.number().int().min(0).max(120).nullable().optional(),
    mileageDistance: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    dumpFee: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    crewSize: z.number().int().min(1).max(20).nullable().optional(),
    siteSqft: z.number().int().min(0).nullable().optional(),
    frequency: z.string().max(50).nullable().optional(),
    isFirstTime: z.boolean().optional(),
    essentialPrice: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    premiumPrice: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    deluxePrice: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    initialCleanFee: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    essentialFeatures: z.array(z.string()).nullable().optional(),
    premiumFeatures: z.array(z.string()).nullable().optional(),
    deluxeFeatures: z.array(z.string()).nullable().optional(),
    pricingBreakdown: z.record(z.any()).nullable().optional(),
    images: z
      .array(
        z.object({ url: z.string(), caption: z.string(), sqft: z.number().nullable().optional() })
      )
      .nullable()
      .optional(),
    lineItems: z
      .array(
        z.object({
          pricingItemId: z.string(),
          name: z.string(),
          unitPrice: z.number(),
          quantity: z.number(),
        })
      )
      .nullable()
      .optional(),
    notes: z.string().max(5000).nullable().optional(),
    internalNotes: z.string().max(5000).nullable().optional(),
    expiresAt: z.string().nullable().optional(),
  });

  app.post("/api/quotes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const suppressNotifications = req.body.suppressNotifications === true;
      const bodyWithoutFlag = { ...req.body };
      delete bodyWithoutFlag.suppressNotifications;

      const parsed = createQuoteBodySchema.safeParse(bodyWithoutFlag);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid quote data", details: parsed.error.flatten() });
      }

      const quoteNumber = parsed.data.quoteNumber || (await storage.getNextQuoteNumber(companyId));

      let contactId = parsed.data.contactId || null;
      if (!contactId && parsed.data.contactName) {
        try {
          const newContact = await storage.createContact({
            companyId,
            firstName: parsed.data.contactName.split(" ")[0],
            lastName: parsed.data.contactName.split(" ").slice(1).join(" ") || "",
            email: parsed.data.contactEmail || null,
            phone: parsed.data.contactPhone || null,
            status: "lead",
          });
          contactId = String(newContact.id);
        } catch (contactErr) {
          console.error("Failed to create lead from quote:", contactErr);
        }
      }

      let propertyId = parsed.data.propertyId || null;
      if (!propertyId && parsed.data.propertyAddress && contactId) {
        try {
          const newProperty = await storage.createProperty({
            companyId,
            contactId,
            streetAddress: parsed.data.propertyAddress,
            city: "",
            state: "",
            zipCode: "",
          });
          propertyId = String(newProperty.id);
        } catch (propErr) {
          console.error("Failed to create property from quote:", propErr);
        }
      }

      const quoteData = {
        ...parsed.data,
        companyId,
        quoteNumber,
        contactId,
        propertyId,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        images: parsed.data.images?.map((img) => ({ ...img, sqft: img.sqft ?? undefined })),
      };

      const quote = await storage.createQuote(quoteData);
      if (!suppressNotifications) {
        try {
          const { fireAutomationTrigger } = await import("../services/automation-runner");
          await fireAutomationTrigger("quote_created", companyId, {
            quoteId: quote.id,
            contactId: quote.contactId,
          });
        } catch (autoErr) {
          console.error("[automation] quote_created trigger error:", autoErr);
        }
      }
      res.status(201).json(quote);
    } catch (err: unknown) {
      console.error("Error creating quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch("/api/quotes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getQuote(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Quote not found" });

      const parsed = createQuoteBodySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid quote data", details: parsed.error.flatten() });
      }

      const updateData = { ...parsed.data } as Record<string, unknown>;
      if (updateData.quoteNumber === null || updateData.quoteNumber === undefined) {
        delete updateData.quoteNumber;
      }

      const quote = await storage.updateQuote(
        p(req.params.id),
        companyId,
        updateData as Partial<InsertQuote>
      );
      res.json(quote);
    } catch (err: unknown) {
      console.error("Error updating quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/quotes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getQuote(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Quote not found" });
      await storage.deleteQuote(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err: unknown) {
      console.error("Error deleting quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/quotes/:id/accept", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(p(req.params.id), companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      const tier = req.body.tier as string;
      if (!tier || !["essential", "premium", "deluxe"].includes(tier)) {
        return res.status(400).json({ error: "Must select a tier: essential, premium, or deluxe" });
      }

      if (quote.status === "accepted") {
        return res.status(400).json({ error: "Quote already accepted" });
      }

      const priceMap: Record<string, string | null> = {
        essential: quote.essentialPrice,
        premium: quote.premiumPrice,
        deluxe: quote.deluxePrice,
      };
      const selectedPrice = priceMap[tier] || "0";

      const updatedQuote = await storage.updateQuote(p(req.params.id), companyId, {
        status: "accepted",
        selectedTier: tier as "essential" | "premium" | "deluxe",
        selectedPrice,
        acceptedAt: new Date(),
        acceptedVia: "staff",
      } as Partial<import("@shared/schema").InsertQuote>);

      if (quote.contactId) {
        const contact = await storage.getContactById(quote.contactId);
        if (contact && contact.status === "lead") {
          await storage.updateContact(quote.contactId, companyId, { status: "active" });
        }
      }

      let servicePlan = null;
      if (quote.contactId && quote.propertyId) {
        try {
          const today = new Date().toISOString().split("T")[0];
          const svcName = `${tier.charAt(0).toUpperCase() + tier.slice(1)} Service (Quote #${quote.quoteNumber})`;
          servicePlan = await storage.createServicePlan({
            companyId,
            contactId: quote.contactId,
            propertyId: quote.propertyId,
            frequency: normalizeQuoteFrequency(quote.frequency),
            pricePerVisit: selectedPrice,
            startDate: today,
            isActive: true,
            serviceName: svcName,
            jobType: "recurring",
            jobStatus: "active",
            stopOrder: 0,
          });
          if (servicePlan) {
            await storage.updateQuote(p(req.params.id), companyId, {
              convertedServicePlanId: servicePlan.id,
            } as Partial<InsertQuote>);
          }
        } catch (spErr) {
          console.error("Failed to create service plan from accepted quote:", spErr);
        }
      }

      res.json({ quote: updatedQuote, servicePlan });
    } catch (err: unknown) {
      console.error("Error accepting quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post(
    "/api/quotes/:id/convert-to-plan",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const quote = await storage.getQuote(p(req.params.id), companyId);
        if (!quote) return res.status(404).json({ error: "Quote not found" });

        if (quote.type !== "residential") {
          return res
            .status(400)
            .json({ error: "Only residential quotes can be converted to a service plan" });
        }
        if (quote.status !== "accepted") {
          return res
            .status(400)
            .json({ error: "Only accepted quotes can be converted to a service plan" });
        }
        if (!quote.contactId || !quote.propertyId) {
          return res.status(400).json({ error: "Quote must be linked to a contact and property" });
        }
        if (quote.convertedServicePlanId) {
          return res
            .status(409)
            .json({ error: "This quote has already been converted to a service plan" });
        }

        const bodySchema = z.object({
          frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]),
          pricePerVisit: z.string().regex(/^\d+(\.\d{1,2})?$/),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          dayOfWeek: z
            .enum([
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
              "tbd",
            ])
            .nullable()
            .optional(),
          serviceName: z.string().max(255).nullable().optional(),
        });

        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
        }

        const svcName = parsed.data.serviceName || `Service Plan (Quote #${quote.quoteNumber})`;

        const servicePlan = await storage.createServicePlan({
          companyId,
          contactId: quote.contactId,
          propertyId: quote.propertyId,
          frequency: parsed.data.frequency,
          pricePerVisit: parsed.data.pricePerVisit,
          startDate: parsed.data.startDate,
          dayOfWeek: parsed.data.dayOfWeek || null,
          isActive: true,
          serviceName: svcName,
          jobType: "recurring",
          jobStatus: "active",
          stopOrder: 0,
        });

        const updatedQuote = await storage.updateQuote(p(req.params.id), companyId, {
          status: "converted",
          convertedServicePlanId: servicePlan.id,
        } as Partial<InsertQuote>);

        try {
          const { generateVisitsForPlans } = await import("../jobs/auto-visits");
          const today = new Date();
          const planStart = new Date(parsed.data.startDate + "T00:00:00");
          const anchor = planStart > today ? planStart : today;
          const sixMonthsOut = new Date(anchor);
          sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
          await generateVisitsForPlans(
            companyId,
            [servicePlan.id],
            planStart.toISOString().split("T")[0],
            sixMonthsOut.toISOString().split("T")[0]
          );
        } catch (genErr) {
          console.error("[convert-to-plan] Failed to auto-generate visits:", genErr);
        }

        res.json({ quote: updatedQuote, servicePlan });
      } catch (err: unknown) {
        console.error("Error converting quote to service plan:", err);
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post("/api/quotes/:id/send", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(p(req.params.id), companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      if (quote.status !== "draft" && quote.status !== "sent") {
        return res.status(400).json({ error: "Only draft or sent quotes can be sent" });
      }

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const pricing = {
        essential: parseFloat(quote.essentialPrice || "0"),
        premium: parseFloat(quote.premiumPrice || "0"),
        deluxe: parseFloat(quote.deluxePrice || "0"),
        initialCleanFee: parseFloat(quote.initialCleanFee || "0"),
        essentialFeatures: (quote.essentialFeatures as string[]) || [],
        premiumFeatures: (quote.premiumFeatures as string[]) || [],
        deluxeFeatures: (quote.deluxeFeatures as string[]) || [],
        breakdown: (quote.pricingBreakdown as Record<string, unknown>) || {},
      };

      const slug = ((company as Record<string, unknown>).slug as string) || companyId;
      const quoteToken =
        ((quote as Record<string, unknown>).quoteToken as string | null | undefined) ||
        randomUUID();
      if (!(quote as Record<string, unknown>).quoteToken) {
        await storage.updateQuote(p(req.params.id), companyId, {
          quoteToken,
        } as Partial<import("@shared/schema").InsertQuote>);
      }
      const acceptUrl = `${req.protocol}://${req.get("host")}/portal/${slug}/quotes/${quote.id}?token=${encodeURIComponent(quoteToken)}`;

      const rawLogoUrlSend = company?.logoUrl ?? null;
      const logoUrl = rawLogoUrlSend
        ? /^https?:\/\//i.test(rawLogoUrlSend)
          ? rawLogoUrlSend
          : `${getBaseUrl(req)}${rawLogoUrlSend}`
        : undefined;

      const renderData = {
        companyName: company.name,
        companyEmail:
          ((company as Record<string, unknown>).email as string | undefined) || undefined,
        companyPhone: company.phone || undefined,
        companyLogo: logoUrl,
        contactName: quote.contactName || "Customer",
        quoteNumber: quote.quoteNumber,
        propertyAddress: quote.propertyAddress || undefined,
        pricing,
        frequency: quote.frequency || "weekly",
        expiresAt: quote.expiresAt?.toISOString() || undefined,
        notes: quote.notes || undefined,
        acceptUrl,
        images: (quote.images as { url: string; caption: string; sqft?: number }[]) || undefined,
        baseUrl: getBaseUrl(req),
        lineItems:
          (quote.lineItems as {
            pricingItemId: string;
            name: string;
            unitPrice: number;
            quantity: number;
          }[]) || undefined,
      };

      const html =
        quote.type === "commercial"
          ? renderCommercialProposalHtml(renderData)
          : renderResidentialProposalHtml(renderData);

      const sendVia = req.body.sendVia || "email";
      const results: { sent: string[]; emailError?: string; smsError?: string } = { sent: [] };

      if ((sendVia === "email" || sendVia === "both") && quote.contactEmail) {
        try {
          await sendEmail({
            companyId: companyId,
            contactId: quote.contactId || undefined,
            to: quote.contactEmail,
            subject: `${company.name} — Service ${quote.type === "commercial" ? "Proposal" : "Quote"} #${quote.quoteNumber}`,
            text: `Please see your ${quote.type === "commercial" ? "proposal" : "quote"} #${quote.quoteNumber} from ${company.name}.`,
            html,
            senderName: company.name,
            replyTo: company.email || undefined,
          });
          results.sent.push("email");
        } catch (emailErr: unknown) {
          console.error("Failed to send quote email:", emailErr);
          results.emailError = emailErr instanceof Error ? emailErr.message : String(emailErr);
        }
      }

      if ((sendVia === "sms" || sendVia === "both") && quote.contactPhone) {
        try {
          const smsText = renderQuoteSmsText({
            companyName: company.name,
            contactName: quote.contactName || "Customer",
            quoteNumber: quote.quoteNumber,
            pricing,
            type: quote.type,
            frequency: quote.frequency || "weekly",
            acceptUrl,
          });
          const smsConfigured = await isSmsConfiguredForCompany(companyId);
          if (smsConfigured) {
            await sendSmsForCompany({
              to: quote.contactPhone,
              body: smsText,
              companyId,
              contactId: quote.contactId || undefined,
            });
          }
          results.sent.push("sms");
        } catch (smsErr: unknown) {
          console.error("Failed to send quote SMS:", smsErr);
          results.smsError = smsErr instanceof Error ? smsErr.message : String(smsErr);
        }
      }

      const expiresAt = quote.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const approvalEnabledFlag = req.body.approvalEnabled === false ? false : true;
      const updatedQuote = await storage.updateQuote(p(req.params.id), companyId, {
        status: "sent",
        sentAt: new Date(),
        expiresAt,
        approvalEnabled: approvalEnabledFlag,
      } as Partial<import("@shared/schema").InsertQuote>);

      res.json({ ...results, quote: updatedQuote });
    } catch (err: unknown) {
      console.error("Error sending quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/quotes/:id/preview", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(p(req.params.id), companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!company.name || company.name === "User's Company") {
        console.warn(
          `[quotes/preview] Company ${companyId} has placeholder name "${company.name}" — owner should update it in Settings`
        );
      }

      const pricing = {
        essential: parseFloat(quote.essentialPrice || "0"),
        premium: parseFloat(quote.premiumPrice || "0"),
        deluxe: parseFloat(quote.deluxePrice || "0"),
        initialCleanFee: parseFloat(quote.initialCleanFee || "0"),
        essentialFeatures: (quote.essentialFeatures as string[]) || [],
        premiumFeatures: (quote.premiumFeatures as string[]) || [],
        deluxeFeatures: (quote.deluxeFeatures as string[]) || [],
        breakdown: (quote.pricingBreakdown as Record<string, unknown>) || {},
      };

      const rawLogoUrlPreview = company?.logoUrl ?? null;
      const logoUrl = rawLogoUrlPreview
        ? /^https?:\/\//i.test(rawLogoUrlPreview)
          ? rawLogoUrlPreview
          : `${getBaseUrl(req)}${rawLogoUrlPreview}`
        : undefined;

      const renderData = {
        companyName: company.name,
        companyEmail:
          ((company as Record<string, unknown>).email as string | undefined) || undefined,
        companyPhone: company.phone || undefined,
        companyLogo: logoUrl,
        contactName: quote.contactName || "Customer",
        quoteNumber: quote.quoteNumber,
        propertyAddress: quote.propertyAddress || undefined,
        pricing,
        frequency: quote.frequency || "weekly",
        expiresAt: quote.expiresAt?.toISOString() || undefined,
        notes: quote.notes || undefined,
        images: (quote.images as { url: string; caption: string; sqft?: number }[]) || undefined,
        baseUrl: getBaseUrl(req),
        lineItems:
          (quote.lineItems as {
            pricingItemId: string;
            name: string;
            unitPrice: number;
            quantity: number;
          }[]) || undefined,
      };

      const html =
        quote.type === "commercial"
          ? renderCommercialProposalHtml(renderData)
          : renderResidentialProposalHtml(renderData);

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err: unknown) {
      console.error("Error previewing quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(
    "/api/quotes/:id/download/:format",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const quote = await storage.getQuote(p(req.params.id), companyId);
        if (!quote) return res.status(404).json({ error: "Quote not found" });
        const company = await storage.getCompany(companyId);
        if (!company) return res.status(404).json({ error: "Company not found" });

        const pricing = {
          essential: parseFloat(quote.essentialPrice || "0"),
          premium: parseFloat(quote.premiumPrice || "0"),
          deluxe: parseFloat(quote.deluxePrice || "0"),
          initialCleanFee: parseFloat(quote.initialCleanFee || "0"),
          essentialFeatures: (quote.essentialFeatures as string[]) || [],
          premiumFeatures: (quote.premiumFeatures as string[]) || [],
          deluxeFeatures: (quote.deluxeFeatures as string[]) || [],
          breakdown: (quote.pricingBreakdown as Record<string, unknown>) || {},
        };

        const rawLogoUrl = company?.logoUrl ?? null;
        const logoUrl = rawLogoUrl
          ? /^https?:\/\//i.test(rawLogoUrl)
            ? rawLogoUrl
            : `${getBaseUrl(req)}${rawLogoUrl}`
          : undefined;

        const docData = {
          companyName: company.name,
          companyEmail:
            ((company as Record<string, unknown>).email as string | undefined) || undefined,
          companyPhone: company.phone || undefined,
          logoUrl,
          contactName: quote.contactName || "Customer",
          quoteNumber: quote.quoteNumber,
          propertyAddress: quote.propertyAddress || undefined,
          type: quote.type || "residential",
          frequency: quote.frequency || "weekly",
          expiresAt: quote.expiresAt?.toISOString() || undefined,
          notes: quote.notes || undefined,
          essentialPrice: pricing.essential,
          premiumPrice: pricing.premium,
          deluxePrice: pricing.deluxe,
          initialCleanFee: pricing.initialCleanFee,
          essentialFeatures: pricing.essentialFeatures,
          premiumFeatures: pricing.premiumFeatures,
          deluxeFeatures: pricing.deluxeFeatures,
          breakdown: pricing.breakdown,
          images: (quote.images as { url: string; caption: string; sqft?: number }[]) || undefined,
          baseUrl: getBaseUrl(req),
          lineItems:
            (quote.lineItems as {
              pricingItemId: string;
              name: string;
              unitPrice: number;
              quantity: number;
            }[]) || undefined,
        };

        const safeName = `Quote-${quote.quoteNumber}`.replace(/[^a-zA-Z0-9-_]/g, "_");

        if (p(req.params.format) === "pdf") {
          const pdfBuffer = await generateQuotePdf(docData);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
          res.send(pdfBuffer);
        } else if (p(req.params.format) === "docx") {
          const docxBuffer = await generateQuoteDocx(docData);
          res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          );
          res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
          res.send(docxBuffer);
        } else {
          res.status(400).json({ error: "Invalid format. Use 'pdf' or 'docx'." });
        }
      } catch (err: unknown) {
        console.error("Error generating quote download:", err);
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );
}

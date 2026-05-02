import type { Express, Request, Response } from "express";
import type sgMailT from "@sendgrid/mail";
import { storage } from "../storage";
import {
  DEFAULT_PRICING_CONFIG,
  type PricingConfig,
  type PricingRulesConfig,
  DEFAULT_PRICING_RULES,
} from "@shared/schema";
import {
  calculatePrice,
  sqftToAcres,
  yardSizeLabelToAcres,
  parseLotSizeStringToAcres,
  type PriceCalculatorInputs,
} from "../services/pricing-calculator";
import { z } from "zod";
import { calculateTotalDistance, getRouteMetricsWithLegs } from "../services/route-optimizer";
import { insertServicePricingSchema, insertServicePackageSchema } from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  handleError,
  sanitizeDecimal,
  p,
} from "./shared";

export async function registerPricingRoutes(app: Express): Promise<void> {
  // ================ Service Pricing ================
  app.get("/api/pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const category = req.query.category as string | undefined;
      const items = await storage.getServicePricing(companyId, category);
      res.json(items);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const body = { ...req.body, companyId };
      if (body.basePrice !== undefined) body.basePrice = sanitizeDecimal(body.basePrice);
      const parsed = insertServicePricingSchema.parse(body);
      const item = await storage.createServicePricingItem(parsed);
      res.status(201).json(item);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/pricing/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const body = { ...req.body };
      if (body.basePrice !== undefined) body.basePrice = sanitizeDecimal(body.basePrice);
      const parsed = insertServicePricingSchema.partial().parse(body);
      const item = await storage.updateServicePricingItem(p(req.params.id), companyId, parsed);
      res.json(item);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/pricing/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      await storage.deleteServicePricingItem(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/service-billing-rules", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const rules = await storage.getServiceBillingRules(companyId);
      res.json(rules);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put(
    "/api/service-billing-rules/:servicePricingId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const validCadences = ["per_visit", "weekly", "monthly", "manual"];
        const validTriggers = ["after_job", "end_of_week", "end_of_month", "manual"];
        const validBehaviors = [
          "autopay_immediate",
          "autopay_scheduled",
          "send_invoice",
          "review_only",
        ];
        const pricingItems = await storage.getServicePricing(companyId);
        if (!pricingItems.some((item) => item.id === p(req.params.servicePricingId))) {
          return res.status(404).json({ error: "Service pricing item not found" });
        }
        const { billingCadence, billingTrigger, paymentBehavior } = req.body;
        if (billingCadence && !validCadences.includes(billingCadence))
          return res.status(400).json({ error: "Invalid billingCadence" });
        if (billingTrigger && !validTriggers.includes(billingTrigger))
          return res.status(400).json({ error: "Invalid billingTrigger" });
        if (paymentBehavior && !validBehaviors.includes(paymentBehavior))
          return res.status(400).json({ error: "Invalid paymentBehavior" });
        const rule = await storage.upsertServiceBillingRule(
          companyId,
          p(req.params.servicePricingId),
          {
            billingCadence: billingCadence || null,
            billingTrigger: billingTrigger || null,
            paymentBehavior: paymentBehavior || null,
          }
        );
        res.json(rule);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete(
    "/api/service-billing-rules/:servicePricingId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        await storage.deleteServiceBillingRule(companyId, p(req.params.servicePricingId));
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/pricing/seed", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      await storage.seedDefaultPricing(companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/pricing/generate-from-rules",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);

        const rulesSchema = z.object({
          basePrices: z.object({
            weekly: z.number().min(0),
            biWeekly: z.number().min(0),
            twiceWeekly: z.number().min(0),
          }),
          perDogRule: z.object({
            incrementDogs: z.number().int().min(1),
            surchargeAmount: z.number().min(0),
            maxDogs: z.number().int().min(1).max(20),
          }),
          yardSizeTiers: z.array(
            z.object({
              upToAcres: z.number().min(0),
              surcharge: z.number().min(0),
            })
          ),
        });

        const rules: PricingRulesConfig = rulesSchema.parse(req.body);

        const company = await storage.getCompany(companyId);
        if (!company) return res.status(404).json({ error: "Company not found" });
        const existingConfig: PricingConfig = {
          ...DEFAULT_PRICING_CONFIG,
          ...(company.pricingConfig || {}),
        };
        await storage.updateCompany(companyId, {
          pricingConfig: { ...existingConfig, pricingRules: rules },
        });

        const existingPricing = await storage.getServicePricing(companyId, "recurring_service");
        const existingByName = new Map<string, (typeof existingPricing)[0]>();
        for (const item of existingPricing) {
          existingByName.set(item.name, item);
        }

        const frequencies = [
          {
            key: "weekly",
            label: "Weekly Scooping",
            base: rules.basePrices.weekly,
            unit: "per_week",
          },
          {
            key: "twiceWeekly",
            label: "Twice Weekly Scooping",
            base: rules.basePrices.twiceWeekly,
            unit: "per_visit",
          },
          {
            key: "biWeekly",
            label: "Bi-Weekly Scooping",
            base: rules.basePrices.biWeekly,
            unit: "per_visit",
          },
        ];

        let sortOrder = 1;
        const generatedNames = new Set<string>();
        const inc = rules.perDogRule.incrementDogs;

        for (const freq of frequencies) {
          for (let dogs = 1; dogs <= rules.perDogRule.maxDogs; dogs++) {
            const surchargeSteps = Math.floor((dogs - 1) / inc);
            const price = freq.base + surchargeSteps * rules.perDogRule.surchargeAmount;
            const name = `${freq.label} ${dogs} ${dogs === 1 ? "Dog" : "Dogs"}`;
            generatedNames.add(name);

            const existing = existingByName.get(name);
            if (existing) {
              const isOverridden =
                (existing.metadata as Record<string, unknown>)?.manualOverride === true;
              if (!isOverridden) {
                await storage.updateServicePricingItem(existing.id, companyId, {
                  basePrice: price.toFixed(2),
                  sortOrder,
                  unit: freq.unit,
                  metadata: {
                    ...((existing.metadata as Record<string, unknown>) || {}),
                    callForQuote: false,
                    ruleGenerated: true,
                  },
                });
              } else {
                await storage.updateServicePricingItem(existing.id, companyId, {
                  sortOrder,
                });
              }
            } else {
              await storage.createServicePricingItem({
                companyId,
                category: "recurring_service",
                name,
                description: `${freq.label.replace("Scooping", "").trim()} service for ${dogs} ${dogs === 1 ? "dog" : "dogs"}`,
                basePrice: price.toFixed(2),
                unit: freq.unit,
                sortOrder,
                metadata: { ruleGenerated: true },
              });
            }
            sortOrder++;
          }

          const callName = `${freq.label} ${rules.perDogRule.maxDogs + 1}+ Dogs`;
          generatedNames.add(callName);
          const existingCall = existingByName.get(callName);
          if (existingCall) {
            await storage.updateServicePricingItem(existingCall.id, companyId, {
              sortOrder,
              metadata: {
                ...((existingCall.metadata as Record<string, unknown>) || {}),
                callForQuote: true,
                ruleGenerated: true,
              },
            });
          } else {
            await storage.createServicePricingItem({
              companyId,
              category: "recurring_service",
              name: callName,
              description: `${freq.label.replace("Scooping", "").trim()} service for ${rules.perDogRule.maxDogs + 1}+ dogs - call for quote`,
              basePrice: "0.00",
              unit: freq.unit,
              sortOrder,
              metadata: { callForQuote: true, ruleGenerated: true },
            });
          }
          sortOrder++;
        }

        for (const item of existingPricing) {
          const meta = (item.metadata as Record<string, unknown>) || {};
          if (!generatedNames.has(item.name) && meta.ruleGenerated && !meta.manualOverride) {
            await storage.deleteServicePricingItem(item.id, companyId);
          }
        }

        const allAddOns = await storage.getServicePricing(companyId, "add_on");

        const parseLotAcres = (name: string): number | null => {
          const m = name.match(/Lot Size up to\s+([.\d]+)\s*Acre/i);
          return m ? parseFloat(m[1]) : null;
        };
        const existingLotByAcres = new Map<number, (typeof allAddOns)[0]>();
        const existingAddOnsByName = new Map<string, (typeof allAddOns)[0]>();
        for (const a of allAddOns) {
          existingAddOnsByName.set(a.name, a);
          const acres = parseLotAcres(a.name);
          if (acres !== null) existingLotByAcres.set(acres, a);
        }
        const generatedYardAcres = new Set<number>();
        let yardSort = 100;
        for (const tier of rules.yardSizeTiers) {
          const tierName = `Lot Size up to ${tier.upToAcres} Acre`;
          generatedYardAcres.add(tier.upToAcres);
          const existingAddon =
            existingLotByAcres.get(tier.upToAcres) || existingAddOnsByName.get(tierName);
          if (existingAddon) {
            const isOverridden =
              (existingAddon.metadata as Record<string, unknown>)?.manualOverride === true;
            if (!isOverridden) {
              await storage.updateServicePricingItem(existingAddon.id, companyId, {
                basePrice: tier.surcharge.toFixed(2),
                sortOrder: yardSort,
                metadata: {
                  ...((existingAddon.metadata as Record<string, unknown>) || {}),
                  ruleGenerated: true,
                },
              });
            }
          } else {
            await storage.createServicePricingItem({
              companyId,
              category: "add_on",
              name: tierName,
              description:
                tier.surcharge === 0
                  ? `No additional charge for lots up to ${tier.upToAcres} acre`
                  : `Additional charge for lots up to ${tier.upToAcres} acre`,
              basePrice: tier.surcharge.toFixed(2),
              unit: "per_visit",
              sortOrder: yardSort,
              metadata: { ruleGenerated: true },
            });
          }
          yardSort++;
        }

        for (const addon of allAddOns) {
          const addonMeta = (addon.metadata as Record<string, unknown>) || {};
          const addonAcres = parseLotAcres(addon.name);
          if (
            addonAcres !== null &&
            !generatedYardAcres.has(addonAcres) &&
            addonMeta.ruleGenerated &&
            !addonMeta.manualOverride
          ) {
            await storage.deleteServicePricingItem(addon.id, companyId);
          }
        }

        const updatedPricing = await storage.getServicePricing(companyId, "recurring_service");
        res.json({ success: true, itemsGenerated: generatedNames.size, items: updatedPricing });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Service Packages ================
  app.get("/api/packages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const packages = await storage.getServicePackages(companyId);
      res.json(packages);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/packages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const parsed = insertServicePackageSchema.parse({ ...req.body, companyId });
      const pkg = await storage.createServicePackage(parsed);
      res.status(201).json(pkg);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/packages/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const parsed = insertServicePackageSchema.partial().parse(req.body);
      const pkg = await storage.updateServicePackage(p(req.params.id), companyId, parsed);
      res.json(pkg);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/packages/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      await storage.deleteServicePackage(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/pricing/confirm-and-generate-packages",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const pricing = await storage.getServicePricing(companyId);
        const recurringItems = pricing.filter(
          (p) =>
            p.category === "recurring_service" &&
            p.isActive &&
            !(p.metadata as Record<string, unknown>)?.callForQuote
        );

        const existingPackages = await storage.getServicePackages(companyId);
        for (const pkg of existingPackages) {
          await storage.deleteServicePackage(pkg.id, companyId);
        }

        const addOns = pricing.filter((p) => p.category === "add_on" && p.isActive);
        const lotAddOn = addOns.find((a) => a.name.toLowerCase().includes("lot size"));
        const wasteAddOn = addOns.find((a) => a.name.toLowerCase().includes("waste"));
        const deodorizingAddOn = addOns.find((a) => a.name.toLowerCase().includes("deodori"));

        const frequencyGroups: Record<string, typeof recurringItems> = {};
        for (const item of recurringItems) {
          const nameLower = item.name.toLowerCase();
          let freq = "weekly";
          if (nameLower.includes("twice")) freq = "twice_weekly";
          else if (nameLower.includes("bi-weekly") || nameLower.includes("biweekly"))
            freq = "biweekly";
          if (!frequencyGroups[freq]) frequencyGroups[freq] = [];
          frequencyGroups[freq].push(item);
        }

        let sortOrder = 1;
        for (const [freq, items] of Object.entries(frequencyGroups)) {
          const freqLabel =
            freq === "twice_weekly" ? "Twice Weekly" : freq === "biweekly" ? "Bi-Weekly" : "Weekly";
          const displayFreq = freq === "twice_weekly" ? "weekly" : freq;

          for (const item of items) {
            const includedItems: string[] = [item.name];
            if (lotAddOn) includedItems.push(lotAddOn.name);

            const dogMatch = item.name.match(/(\d+)\+?\s*Dogs?/i);
            const dogCount = dogMatch ? parseInt(dogMatch[1]) : 1;

            let totalPrice = parseFloat(item.basePrice);
            if (freq === "twice_weekly") totalPrice = totalPrice * 2;

            if (dogCount >= 3 && wasteAddOn) {
              includedItems.push(wasteAddOn.name);
              totalPrice += parseFloat(wasteAddOn.basePrice);
            }
            if (dogCount >= 4 && deodorizingAddOn) {
              includedItems.push(deodorizingAddOn.name);
              totalPrice += parseFloat(deodorizingAddOn.basePrice);
            }

            await storage.createServicePackage({
              companyId,
              name: `${freqLabel} - ${dogMatch ? dogMatch[0] : "1 Dog"}`,
              description: `${freqLabel} service for ${dogMatch ? dogMatch[0].toLowerCase() : "1 dog"}`,
              frequency: displayFreq,
              basePrice: totalPrice.toFixed(2),
              includedItems,
              sortOrder: sortOrder++,
            });
          }
        }

        const newPackages = await storage.getServicePackages(companyId);
        res.json({ success: true, packagesCreated: newPackages.length, packages: newPackages });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Pricing Calculator ================

  app.get("/api/pricing-config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const raw = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
      if (!raw.pricingRules) {
        raw.pricingRules = DEFAULT_PRICING_RULES;
      }
      res.json(raw);
    } catch (err) {
      handleError(res, err);
    }
  });

  const pricingRulesSchema = z
    .object({
      basePrices: z.object({
        weekly: z.number().min(0),
        biWeekly: z.number().min(0),
        twiceWeekly: z.number().min(0),
      }),
      perDogRule: z.object({
        incrementDogs: z.number().int().min(1),
        surchargeAmount: z.number().min(0),
        maxDogs: z.number().int().min(1).max(20),
      }),
      yardSizeTiers: z.array(
        z.object({
          upToAcres: z.number().min(0),
          surcharge: z.number().min(0),
        })
      ),
    })
    .optional();

  const pricingConfigSchema = z.object({
    pricingRules: pricingRulesSchema,
    techHourlyWageCents: z.number().min(0).optional(),
    burdenMultiplier: z.number().min(1).max(5).optional(),
    averageGasPriceCentsPerGallon: z.number().min(0).optional(),
    vehicleMPG: z.number().min(0).nullable().optional(),
    vehicleCostPerMileCents: z.number().min(0).optional(),
    baseTimePerTenthAcreMinutes: z.number().min(1).max(120).optional(),
    extraDogMinutesAfterFirst: z.number().min(0).max(60).optional(),
    driveSpeedAverageMph: z.number().min(5).max(80).optional(),
    minimumServiceMinutesFloor: z.number().min(1).max(120).optional(),
    weeklyMultiplier: z.number().min(0.1).max(5).optional(),
    biweeklyMultiplier: z.number().min(0.1).max(5).optional(),
    monthlyMultiplier: z.number().min(0.1).max(5).optional(),
    oneTimeMultiplier: z.number().min(0.1).max(5).optional(),
    difficultyFlat: z.number().min(0.5).max(3).optional(),
    difficultyModerate: z.number().min(0.5).max(3).optional(),
    difficultyDifficult: z.number().min(0.5).max(3).optional(),
    advertisingCents: z.number().min(0).optional(),
    payrollProviderCents: z.number().min(0).optional(),
    benefitsCents: z.number().min(0).optional(),
    insuranceCents: z.number().min(0).optional(),
    softwareCents: z.number().min(0).optional(),
    otherOverheadCents: z.number().min(0).optional(),
    disinfectantCents: z.number().min(0).optional(),
    deodorizerCents: z.number().min(0).optional(),
    bagsCents: z.number().min(0).optional(),
    localMarketAverageWeeklyPriceCents: z.number().min(0).nullable().optional(),
    marketAnchorTolerancePct: z.number().min(0).max(100).optional(),
    targetProfitMarginPct: z.number().min(0).max(90).optional(),
    premiumMarginPct: z.number().min(0).max(90).optional(),
    pricingMode: z.enum(["aggressive", "standard", "premium"]).optional(),
    clusterDiscountPct: z.number().min(0).max(50).optional(),
    clusterDiscountPct2: z.number().min(0).max(50).optional(),
    estimatedMonthlyStops: z.number().min(1).optional(),
  });

  const calcInputSchema = z.object({
    yardSizeAcres: z.number().min(0.001).max(100).optional(),
    yardSizeSqft: z.number().min(0).optional(),
    yardSizeLabel: z.string().optional(),
    dogCount: z.number().int().min(1).max(50).default(1),
    serviceFrequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]).default("weekly"),
    yardDifficulty: z.enum(["flat", "moderate", "difficult"]).default("flat"),
    distanceFromNearestStopMiles: z.number().min(0).max(100).default(1),
    routeStopsPerMile: z.number().min(0).optional(),
    currentPriceCents: z.number().min(0).optional(),
    propertyId: z.string().optional(),
    pricingModeOverride: z.enum(["aggressive", "standard", "premium"]).optional(),
    routeId: z.string().optional(),
  });

  app.put("/api/pricing-config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const existing = (company.pricingConfig || {}) as Record<string, unknown>;
      const config = pricingConfigSchema.parse(req.body);
      const merged: PricingConfig = { ...DEFAULT_PRICING_CONFIG, ...existing, ...config };
      await storage.updateCompany(companyId, { pricingConfig: merged });
      res.json(merged);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/pricing-config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const existing: PricingConfig = {
        ...DEFAULT_PRICING_CONFIG,
        ...(company.pricingConfig || {}),
      };
      const updates = pricingConfigSchema.parse(req.body);
      const merged: PricingConfig = { ...existing, ...updates };
      await storage.updateCompany(companyId, { pricingConfig: merged });
      res.json(merged);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/pricing/calculate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const body = calcInputSchema.parse(req.body);

      let acres = body.yardSizeAcres;
      if (!acres && body.yardSizeSqft) acres = sqftToAcres(body.yardSizeSqft);
      if (!acres && body.yardSizeLabel) acres = yardSizeLabelToAcres(body.yardSizeLabel);
      if (!acres && body.propertyId) {
        const prop = await storage.getProperty(body.propertyId, companyId);
        if (prop) {
          if (prop.measuredYardSqft) {
            acres = sqftToAcres(prop.measuredYardSqft);
          } else {
            const parsed = parseLotSizeStringToAcres(
              (prop as Record<string, unknown>).lotSize as string | undefined
            );
            acres = parsed !== null ? parsed : yardSizeLabelToAcres(prop.yardSize);
          }
        }
      }
      if (!acres) acres = 0.1;

      let tenantConfig = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
      if (body.pricingModeOverride) {
        tenantConfig.pricingMode = body.pricingModeOverride;
      }

      const inputs: PriceCalculatorInputs = {
        yardSizeAcres: acres,
        dogCount: body.dogCount,
        serviceFrequency: body.serviceFrequency,
        yardDifficulty: body.yardDifficulty,
        distanceFromNearestStopMiles: body.distanceFromNearestStopMiles,
        routeStopsPerMile: body.routeStopsPerMile,
        currentPriceCents: body.currentPriceCents,
      };

      const result = calculatePrice(inputs, tenantConfig);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/pricing/calculate-and-save",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId } = await getCompanyContext(req);
        const company = await storage.getCompany(companyId);
        if (!company) return res.status(404).json({ error: "Company not found" });

        const body = calcInputSchema.parse(req.body);

        let acres = body.yardSizeAcres;
        if (!acres && body.yardSizeSqft) acres = sqftToAcres(body.yardSizeSqft);
        if (!acres && body.yardSizeLabel) acres = yardSizeLabelToAcres(body.yardSizeLabel);
        if (!acres && body.propertyId) {
          const prop = await storage.getProperty(body.propertyId, companyId);
          if (prop) {
            if (prop.measuredYardSqft) {
              acres = sqftToAcres(prop.measuredYardSqft);
            } else {
              const parsed = parseLotSizeStringToAcres(
                (prop as Record<string, unknown>).lotSize as string | undefined
              );
              acres = parsed !== null ? parsed : yardSizeLabelToAcres(prop.yardSize);
            }
          }
        }
        if (!acres) acres = 0.1;

        let tenantConfig = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
        if (body.pricingModeOverride) {
          tenantConfig.pricingMode = body.pricingModeOverride;
        }

        const inputs: PriceCalculatorInputs = {
          yardSizeAcres: acres,
          dogCount: body.dogCount,
          serviceFrequency: body.serviceFrequency,
          yardDifficulty: body.yardDifficulty,
          distanceFromNearestStopMiles: body.distanceFromNearestStopMiles,
          routeStopsPerMile: body.routeStopsPerMile,
          currentPriceCents: body.currentPriceCents,
        };

        const result = calculatePrice(inputs, tenantConfig);

        const rec = await storage.createPriceRecommendation({
          companyId,
          propertyId: body.propertyId || null,
          serviceFrequency: body.serviceFrequency,
          yardSizeAcres: String(acres),
          dogCount: body.dogCount,
          yardDifficulty: body.yardDifficulty,
          routeId: body.routeId || null,
          minimumPriceCents: result.minimumPriceCents,
          recommendedPriceCents: result.recommendedPriceCents,
          premiumPriceCents: result.premiumPriceCents,
          jobMinutes: String(result.derived.jobMinutes),
          serviceMinutes: String(result.breakdown.serviceMinutes),
          travelMinutes: String(result.breakdown.travelMinutes),
          densityMultiplier: String(result.breakdown.densityMultiplier),
          breakdownJson: result.breakdown as unknown as Record<string, unknown>,
          inputsJson: result.inputsUsed as unknown as Record<string, unknown>,
          calculationVersion: "1.0",
          createdByUserId: userId,
          source: "manual",
        });

        res.json({ ...result, recommendationId: rec.id });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/pricing/recommendations/:propertyId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const recs = await storage.getPriceRecommendations(companyId, p(req.params.propertyId));
        res.json(recs);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Customer Profitability ================

  app.get("/api/profitability/summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { calculateAllCustomerProfitability } =
        await import("../services/profitability-calculator");
      const results = await calculateAllCustomerProfitability(companyId);
      res.json(results);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ─── Business Overview ────────────────────────────────────────────────────
  app.get("/api/business-overview", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const now = new Date();

      const allContactsRaw = await storage.getContacts(companyId);
      const allInvoices = await storage.getInvoices(companyId);
      const allPlansRaw = await storage.getServicePlans(companyId, {});
      const allActivePlans = allPlansRaw.filter((p) => p.isActive && !p.isStopOnly);

      const analyticsPlanPriceMap = new Map(
        allPlansRaw.map((p) => [p.id, parseFloat(p.pricePerVisit) || 0])
      );

      // 12-month revenue
      const monthlyRevenue: { month: string; revenue: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = d.toISOString().split("T")[0];
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
        let revenue = await storage.getRevenueForPeriod(companyId, start, end, tz);
        if (revenue === 0) {
          const periodVisits = await storage.getVisitsForDateRange(companyId, start, end);
          for (const v of periodVisits) {
            if (v.status === "completed")
              revenue += analyticsPlanPriceMap.get(v.servicePlanId) || 0;
          }
          revenue = Math.round(revenue * 100) / 100;
        }
        monthlyRevenue.push({
          month: d.toLocaleString("default", { month: "short", year: "2-digit" }),
          revenue,
        });
      }

      // Customer acquisition (12 months)
      const customerAcquisition: { month: string; newClients: number; total: number }[] = [];
      const contactsByCreatedMonth: Record<string, number> = {};
      for (const c of allContactsRaw) {
        const created = new Date(c.createdAt);
        const key = `${created.getFullYear()}-${String(created.getMonth()).padStart(2, "0")}`;
        contactsByCreatedMonth[key] = (contactsByCreatedMonth[key] || 0) + 1;
      }
      const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      let runningTotal = allContactsRaw.filter((c) => new Date(c.createdAt) < windowStart).length;
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
        const newClients = contactsByCreatedMonth[key] || 0;
        runningTotal += newClients;
        customerAcquisition.push({
          month: d.toLocaleString("default", { month: "short", year: "2-digit" }),
          newClients,
          total: runningTotal,
        });
      }

      // Profitability mix
      const { calculateAllCustomerProfitability } =
        await import("../services/profitability-calculator");
      const profitResults = await calculateAllCustomerProfitability(companyId);
      let profitableCount = 0,
        marginalCount = 0,
        unprofitableCount = 0;
      let totalMonthlyRevenueCents = 0,
        totalMonthlyCostCents = 0;
      for (const p of profitResults) {
        if (p.status === "profitable") profitableCount++;
        else if (p.status === "marginal") marginalCount++;
        else unprofitableCount++;
        totalMonthlyRevenueCents += p.monthlyRevenueCents;
        totalMonthlyCostCents += p.monthlyCostCents;
      }
      const avgProfitMarginPct =
        totalMonthlyRevenueCents > 0
          ? Math.round(
              ((totalMonthlyRevenueCents - totalMonthlyCostCents) / totalMonthlyRevenueCents) * 1000
            ) / 10
          : 0;
      const profitabilityMix = [
        { name: "Profitable", value: profitableCount, color: "#22c55e" },
        { name: "Marginal", value: marginalCount, color: "#eab308" },
        { name: "Unprofitable", value: unprofitableCount, color: "#ef4444" },
      ];

      // MRR from active service plans
      const visitsPerMonthByFreq: Record<string, number> = {
        weekly: 4.33,
        biweekly: 2.17,
        monthly: 1,
        onetime: 0,
      };
      let mrrCents = 0;
      for (const p of allActivePlans) {
        const freq = visitsPerMonthByFreq[p.frequency] ?? 0;
        mrrCents += Math.round(parseFloat(p.pricePerVisit) * 100 * freq);
      }

      // Invoice collection rate
      const paidTotal = allInvoices
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + parseFloat(i.total), 0);
      const outstandingTotal = allInvoices
        .filter((i) => i.status === "sent" || i.status === "pending")
        .reduce((s, i) => s + parseFloat(i.total), 0);
      const collectionRate =
        paidTotal + outstandingTotal > 0
          ? Math.round((paidTotal / (paidTotal + outstandingTotal)) * 100)
          : 100;

      // Active customers
      const activeCustomers = allContactsRaw.filter((c) => c.status === "active").length;

      // New customers last 30 days
      const thirtyAgo = new Date(now);
      thirtyAgo.setDate(thirtyAgo.getDate() - 30);
      const newCustomers30d = allContactsRaw.filter(
        (c) => new Date(c.createdAt) >= thirtyAgo
      ).length;

      // Churned last 30 days (contacts that moved to cancelled recently, using updatedAt as proxy)
      const churned30d = allContactsRaw.filter(
        (c) => c.status === "cancelled" && new Date(c.updatedAt) >= thirtyAgo
      ).length;

      // Active vs paused plans
      const activePlanCount = allActivePlans.length;
      const pausedPlanCount = allPlansRaw.filter((p) => p.pausedAt != null || p.isStopOnly).length;

      res.json({
        kpis: {
          mrrCents,
          activeCustomers,
          avgProfitMarginPct,
          collectionRate,
          newCustomers30d,
          churned30d,
          activePlanCount,
          pausedPlanCount,
          profitableCount,
          marginalCount,
          unprofitableCount,
        },
        monthlyRevenue,
        customerAcquisition,
        profitabilityMix,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/business-overview/assessment",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const company = await storage.getCompany(companyId);
        const tz = company?.timezone || "America/New_York";
        const now = new Date();

        const allContacts = await storage.getContacts(companyId);
        const allInvoices = await storage.getInvoices(companyId);
        const allPlansRaw = await storage.getServicePlans(companyId, {});
        const allActivePlans = allPlansRaw.filter((p) => p.isActive && !p.isStopOnly);

        const activeCustomers = allContacts.filter((c) => c.status === "active").length;
        const cancelledCustomers = allContacts.filter((c) => c.status === "cancelled").length;

        const visitsPerMonthByFreq: Record<string, number> = {
          weekly: 4.33,
          biweekly: 2.17,
          monthly: 1,
          onetime: 0,
        };
        let mrrCents = 0;
        for (const p of allActivePlans) {
          mrrCents += Math.round(
            parseFloat(p.pricePerVisit) * 100 * (visitsPerMonthByFreq[p.frequency] ?? 0)
          );
        }

        const paidInvoices = allInvoices.filter((i) => i.status === "paid");
        const paidTotal = paidInvoices.reduce((s, i) => s + parseFloat(i.total), 0);
        const outstandingTotal = allInvoices
          .filter((i) => i.status === "sent" || i.status === "pending")
          .reduce((s, i) => s + parseFloat(i.total), 0);
        const collectionRate =
          paidTotal + outstandingTotal > 0
            ? Math.round((paidTotal / (paidTotal + outstandingTotal)) * 100)
            : 100;

        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .split("T")[0];
        const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
          .toISOString()
          .split("T")[0];
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
          .toISOString()
          .split("T")[0];
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
          .toISOString()
          .split("T")[0];
        const thisMonthRev = await storage.getRevenueForPeriod(
          companyId,
          thisMonthStart,
          thisMonthEnd,
          tz
        );
        const lastMonthRev = await storage.getRevenueForPeriod(
          companyId,
          lastMonthStart,
          lastMonthEnd,
          tz
        );
        const revenueGrowthPct =
          lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100) : 0;

        const thirtyAgo = new Date(now);
        thirtyAgo.setDate(thirtyAgo.getDate() - 30);
        const assessYesterday = new Date(now);
        assessYesterday.setDate(assessYesterday.getDate() - 1);
        const recentVisits = await storage.getVisitsForDateRange(
          companyId,
          thirtyAgo.toISOString().split("T")[0],
          assessYesterday.toISOString().split("T")[0]
        );
        const recentTerminalAssess = recentVisits.filter((v) =>
          ["completed", "skipped", "cancelled"].includes(v.status)
        );
        const visitCompletionRate =
          recentTerminalAssess.length > 0
            ? Math.round(
                (recentTerminalAssess.filter((v) => v.status === "completed").length /
                  recentTerminalAssess.length) *
                  100
              )
            : 0;

        const { calculateAllCustomerProfitability } =
          await import("../services/profitability-calculator");
        const profitResults = await calculateAllCustomerProfitability(companyId);
        let profitableCount = 0,
          marginalCount = 0,
          unprofitableCount = 0;
        let totalMonthlyRevCents = 0,
          totalMonthlyCostCents = 0;
        for (const p of profitResults) {
          if (p.status === "profitable") profitableCount++;
          else if (p.status === "marginal") marginalCount++;
          else unprofitableCount++;
          totalMonthlyRevCents += p.monthlyRevenueCents;
          totalMonthlyCostCents += p.monthlyCostCents;
        }
        const avgProfitMarginPct =
          totalMonthlyRevCents > 0
            ? Math.round(
                ((totalMonthlyRevCents - totalMonthlyCostCents) / totalMonthlyRevCents) * 1000
              ) / 10
            : 0;

        const factSheet = {
          businessName: company?.name || "Your Business",
          activeCustomers,
          cancelledCustomers,
          totalCustomers: allContacts.length,
          mrrDollars: Math.round(mrrCents / 100),
          collectionRatePct: collectionRate,
          visitCompletionRatePct: visitCompletionRate,
          avgProfitMarginPct,
          profitableCustomers: profitableCount,
          marginalCustomers: marginalCount,
          unprofitableCustomers: unprofitableCount,
          thisMonthRevenueDollars: Math.round(thisMonthRev),
          lastMonthRevenueDollars: Math.round(lastMonthRev),
          revenueGrowthPct,
          paidInvoiceCount: paidInvoices.length,
        };

        const crypto = await import("crypto");
        const factSheetJson = JSON.stringify(factSheet, Object.keys(factSheet).sort());
        const currentHash = crypto.createHash("sha256").update(factSheetJson).digest("hex");

        const forceRefresh = req.query.force === "true";

        if (!forceRefresh) {
          const recentHistory = await storage.getBusinessAssessments(companyId, 1);
          const cached = recentHistory[0];
          if (cached && cached.factSheetHash === currentHash && cached.fullResult) {
            const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const allHistory = await storage.getBusinessAssessments(companyId, 50);
            const priorMonthAssessment = allHistory.find(
              (h) => h.id !== cached.id && new Date(h.createdAt) < currentMonthStart
            );
            const scoreDelta = priorMonthAssessment
              ? cached.score - priorMonthAssessment.score
              : null;
            return res.json({
              ...cached.fullResult,
              scoreDelta,
              cachedAt: cached.createdAt,
              fromCache: true,
            });
          }
        }

        const fsModule = await import("fs");
        const pathModule = await import("path");
        const promptFilePath = pathModule.join(
          process.cwd(),
          "attached_assets",
          "Pasted-ROLE-You-are-an-AI-Business-Assessor-for-pet-waste-remo_1777668951167.txt"
        );
        let basePromptContent = "";
        try {
          basePromptContent = fsModule.readFileSync(promptFilePath, "utf-8");
        } catch {
          basePromptContent =
            "You are an AI Business Assessor for pet waste removal / poop scooping businesses. You act as a combined COO, CFO, route-operations consultant, and growth strategist for small service businesses. Evaluate the business using hard-hitting, neutral, business-owner-level judgment.";
        }

        const systemPrompt =
          basePromptContent +
          `

---

JSON OUTPUT OVERRIDE:
Ignore the "REQUIRED OUTPUT FORMAT" markdown structure described above. Instead, return your complete assessment as a single valid JSON object with EXACTLY these fields:
{
  "healthScore": <integer 0-100 equal to sum of all scoreBreakdown scores>,
  "verdict": "<2-3 sentence bottom-line verdict on real condition of business>",
  "businessStage": "<one of: Idea stage | Pre-revenue setup | Early revenue | Owner-operator route business | Small team route business | Growth-stage route business | Mature local operator | Distressed business>",
  "primaryServiceModel": "<one of: Weekly recurring | Biweekly recurring | Monthly recurring | One-time cleanups | Mixed recurring and one-time | Pet waste removal plus add-ons | Other>",
  "rating": "<one of: Excellent | Strong | Good but uneven | Viable but fragile | Weak | High-risk | Structurally poor | Not currently viable>",
  "confidenceLevel": "<High | Medium | Low>",
  "executiveSummary": {
    "topThingsWorking": ["<item 1>", "<item 2>", "<item 3>"],
    "topProblems": ["<item 1>", "<item 2>", "<item 3>"],
    "topActionsFirst": ["<action 1>", "<action 2>", "<action 3>"],
    "biggestRisk": "<single biggest business risk>",
    "fastestWayToImprove": "<one action most likely to improve score within 30-60 days>"
  },
  "scoreBreakdown": [
    { "category": "Recurring Revenue Quality", "score": <0-15>, "max": 15, "assessment": "<specific assessment with numbers>" },
    { "category": "Route Density and Territory Efficiency", "score": <0-15>, "max": 15, "assessment": "<specific assessment>" },
    { "category": "Gross Margin / Unit Economics", "score": <0-15>, "max": 15, "assessment": "<specific assessment>" },
    { "category": "Pricing Power and Plan Structure", "score": <0-10>, "max": 10, "assessment": "<specific assessment>" },
    { "category": "Operating Efficiency", "score": <0-10>, "max": 10, "assessment": "<specific assessment>" },
    { "category": "Billing and Cash Flow", "score": <0-10>, "max": 10, "assessment": "<specific assessment>" },
    { "category": "Sales and Marketing Engine", "score": <0-10>, "max": 10, "assessment": "<specific assessment>" },
    { "category": "Customer Retention and Service Quality", "score": <0-5>, "max": 5, "assessment": "<specific assessment>" },
    { "category": "Scalability and Owner Dependency", "score": <0-5>, "max": 5, "assessment": "<specific assessment>" },
    { "category": "Risk Profile", "score": <0-5>, "max": 5, "assessment": "<specific assessment>" }
  ],
  "whatIsWorking": [
    { "name": "<name>", "observation": "<specific observation>", "evidenceLabel": "<Evidence-based|Inference|Insufficient data>", "whyItMatters": "<why it matters>", "recommendation": "<Keep|Strengthen|Monitor>" }
  ],
  "whatIsNotWorking": [
    { "name": "<name>", "problem": "<specific problem>", "evidenceLabel": "<Evidence-based|Inference|Insufficient data>", "businessImpact": "<impact>", "likelyRootCause": "<root cause>", "recommendedCorrection": "<correction>" }
  ],
  "routeOpsAssessment": "<paragraph on route ops: service-area discipline, route density, travel time, stops per hour, missed-service risk, top bottleneck, top risk, highest-leverage fix>",
  "financialAssessment": "<paragraph CFO-level: revenue predictability, avg revenue per customer, gross margin, cash flow, billing and collections, profit leakage, top financial bottleneck, top financial risk, highest-leverage fix>",
  "pricingAssessment": "<paragraph on pricing: weekly/biweekly/monthly adequacy, which customer type is least profitable, which change should happen first>",
  "marketingAssessment": "<paragraph on growth engine: lead sources, local SEO, referrals, neighborhood marketing, strongest channel, weakest issue, best next move>",
  "ownerDecisions": [
    { "decision": "<decision name>", "whyItMatters": "<why>", "recommendedAnswer": "<answer>", "riskIfIgnored": "<risk>" }
  ],
  "actionPlan": {
    "next30": ["<specific action 1>", "<specific action 2>", "<specific action 3>"],
    "days31to60": ["<specific action 1>", "<specific action 2>", "<specific action 3>"],
    "days61to90": ["<specific action 1>", "<specific action 2>", "<specific action 3>"]
  },
  "stopStartContinue": {
    "stop": ["<specific thing to stop>", "<specific thing to stop>", "<specific thing to stop>"],
    "start": ["<specific thing to start>", "<specific thing to start>", "<specific thing to start>"],
    "continue": ["<specific thing to continue>", "<specific thing to continue>", "<specific thing to continue>"]
  },
  "missingData": ["<data item and what decision it affects>"],
  "finalSummary": "<5-8 sentence blunt final summary: Is this business healthy? What is the main thing holding it back? What should the owner fix first? What should the owner stop doing? What would improve the score fastest?>",
  "cfo": {
    "rating": "<Healthy|Caution|Critical>",
    "findings": ["<specific finding with numbers from the fact sheet>"]
  },
  "coo": {
    "rating": "<Healthy|Caution|Critical>",
    "findings": ["<specific finding with numbers from the fact sheet>"]
  },
  "recommendations": [
    { "priority": "<High|Medium|Low>", "title": "<short title>", "explanation": "<1-2 sentences with specific numbers>" }
  ]
}

Rules:
- healthScore must equal the sum of all scoreBreakdown scores
- Apply all scoring cap rules from the prompt above before finalizing the score
- cfo findings: focus on revenue, collection, MRR, margin — cite exact numbers from fact sheet
- coo findings: focus on visit completion, customer mix, cancellations — cite exact numbers
- recommendations: max 5, ranked by priority, cite exact numbers from the fact sheet
- NEVER invent numbers not present in the fact sheet
- whatIsWorking: 3-7 items; whatIsNotWorking: 3-7 items; ownerDecisions: exactly 5 items`;

        const OpenAI = (await import("openai")).default;
        const ai = new OpenAI({
          apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
        });

        const completion = await ai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: 4000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(factSheet, null, 2) },
          ],
        });

        const raw = completion.choices[0]?.message?.content ?? "{}";
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return res.status(503).json({ message: "Failed to parse AI response" });
        }

        const typedParsed = parsed as Record<string, unknown>;
        const healthScore =
          typeof typedParsed.healthScore === "number" ? typedParsed.healthScore : null;
        const verdict = typeof typedParsed.verdict === "string" ? typedParsed.verdict : "";

        let scoreDelta: number | null = null;
        if (healthScore !== null) {
          const history = await storage.getBusinessAssessments(companyId, 50);
          const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const priorMonthAssessment = history.find(
            (h) => new Date(h.createdAt) < currentMonthStart
          );
          if (priorMonthAssessment) {
            scoreDelta = healthScore - priorMonthAssessment.score;
          }
          const savedAssessment = await storage.saveBusinessAssessment({
            companyId,
            score: healthScore,
            verdict,
            factSheetHash: currentHash,
            fullResult: typedParsed,
          });
          return res.json({ ...typedParsed, scoreDelta, cachedAt: savedAssessment.createdAt });
        }

        res.json({ ...(parsed as Record<string, unknown>), scoreDelta });
      } catch (err) {
        if (
          (err as { status?: number; code?: string })?.status === 429 ||
          (err as { code?: string })?.code === "insufficient_quota"
        ) {
          return res.status(503).json({ message: "AI service temporarily unavailable" });
        }
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/business-overview/assessment-history",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const history = await storage.getBusinessAssessments(companyId, 13);
        res.json(history);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/business-overview/assessment/email",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        requireRole(role);

        const emailSchema = z.object({ recipientEmail: z.string().email().optional() });
        const parsed = emailSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid email address." });
        }

        const recentHistory = await storage.getBusinessAssessments(companyId, 1);
        const cached = recentHistory[0];
        if (!cached || !cached.fullResult) {
          return res
            .status(404)
            .json({ error: "No assessment found. Please generate an assessment first." });
        }

        const company = await storage.getCompany(companyId);
        const companyName = company?.name || "Your Business";

        let toEmail = parsed.data.recipientEmail?.trim();
        if (!toEmail) {
          const { getUserById } = await import("../services/app-auth");
          const user = await getUserById(userId);
          toEmail = user?.email || "";
        }

        if (!toEmail) {
          return res.status(400).json({ error: "No recipient email address available." });
        }

        const { generateAssessmentPdf } = await import("../services/assessment-pdf");
        const pdfBuffer = await generateAssessmentPdf(cached.fullResult, companyName);

        const generatedDate = new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        const subject = `AI Business Assessment Report — ${companyName}`;
        const text = `Hi,\n\nPlease find attached the AI Business Assessment report for ${companyName}, generated on ${generatedDate}.\n\nHealth Score: ${cached.score}/100\nVerdict: ${cached.verdict}\n\nThis report was generated by ScooPilot.`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb;">
            <div style="background-color: #1a7a4c; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 22px;">ScooPilot</h1>
              <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 14px;">AI Business Assessment Report</p>
            </div>
            <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="color: #374151;">Your AI Business Assessment report for <strong>${companyName}</strong> is attached to this email as a PDF.</p>
              <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px; margin: 20px 0; border-left: 4px solid #1a7a4c;">
                <p style="margin: 0 0 6px; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Summary</p>
                <p style="margin: 4px 0; font-size: 15px;"><strong>Health Score:</strong> <span style="color: #1a7a4c; font-weight: 700;">${cached.score}/100</span></p>
                <p style="margin: 4px 0; font-size: 14px; color: #374151;">${cached.verdict}</p>
              </div>
              <p style="color: #6b7280; font-size: 13px;">Generated on ${generatedDate}</p>
            </div>
          </div>
        `;

        const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
        if (!SENDGRID_API_KEY) {
          return res.status(503).json({ error: "Email service not configured." });
        }

        if (process.env.DISABLE_EMAIL_SENDING === "true") {
          return res.json({ success: true, to: toEmail, suppressed: true });
        }

        const sgMail = (await import("@sendgrid/mail")).default;
        sgMail.setApiKey(SENDGRID_API_KEY);

        const OUTBOUND_DOMAIN = process.env.OUTBOUND_EMAIL_DOMAIN || "scoopilot.com";
        const senderEmail = `notifications@${OUTBOUND_DOMAIN}`;

        const mailData: sgMailT.MailDataRequired = {
          to: toEmail,
          from: { name: "ScooPilot", email: senderEmail },
          subject,
          text,
          html,
          attachments: [
            {
              content: pdfBuffer.toString("base64"),
              filename: `ai-assessment-${companyName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`,
              type: "application/pdf",
              disposition: "attachment",
            },
          ],
          trackingSettings: {
            clickTracking: { enable: false, enableText: false },
            openTracking: { enable: false },
          },
        };

        await sgMail.send(mailData);
        return res.json({ success: true, to: toEmail });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/business-overview/assessment-history/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const assessment = await storage.getBusinessAssessmentById(p(req.params.id), companyId);
        if (!assessment) {
          return res.status(404).json({ message: "Assessment not found" });
        }
        res.json(assessment);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/profitability/customer/:contactId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { calculateCustomerProfitability } =
          await import("../services/profitability-calculator");
        const result = await calculateCustomerProfitability(companyId, p(req.params.contactId));
        if (!result)
          return res.status(404).json({ message: "No profitability data for this customer" });
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/profitability/customer/:contactId/suggestions",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { generateProfitabilitySuggestions } =
          await import("../services/profitability-advisor");
        const suggestions = await generateProfitabilitySuggestions(
          companyId,
          p(req.params.contactId)
        );
        res.json({ suggestions });
      } catch (err: unknown) {
        const errObj = err as { status?: number; code?: string; message?: string };
        if (
          errObj.status === 429 ||
          errObj.code === "insufficient_quota" ||
          (errObj.message && errObj.message.includes("OpenAI"))
        ) {
          return res
            .status(503)
            .json({ message: "AI service temporarily unavailable. Please try again later." });
        }
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/contacts/:id/cost-overrides",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ message: "Contact not found" });
        res.json({ costOverrides: contact.costOverrides || null });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/contacts/:id/cost-overrides",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ message: "Contact not found" });
        const costOverridesSchema = z.object({
          techHourlyWageCents: z.number().min(0).optional().nullable(),
          burdenMultiplier: z.number().min(1).max(5).optional().nullable(),
          distanceFromNearestStopMiles: z.number().min(0).max(100).optional().nullable(),
          overheadAllocationCents: z.number().min(0).optional().nullable(),
        });
        const parsed = costOverridesSchema.parse(req.body);
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== null && v !== undefined) cleaned[k] = v;
        }
        const overrides = Object.keys(cleaned).length > 0 ? cleaned : null;
        await storage.updateContact(p(req.params.id), companyId, { costOverrides: overrides });
        res.json({ costOverrides: overrides });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/overhead-costs/total", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const total = await storage.getTotalMonthlyOverheadCents(companyId);
      res.json({ totalMonthlyOverheadCents: total });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/profitability/route-summary",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { calculateAllCustomerProfitability } =
          await import("../services/profitability-calculator");
        const allProfitability = await calculateAllCustomerProfitability(companyId);
        const routes = await storage.getRoutes(companyId);
        const plans = await storage.getServicePlans(companyId, { isActive: true });

        const planRouteMap = new Map<string, string>();
        const planContactMap = new Map<string, string>();
        for (const plan of plans) {
          if (plan.routeId) planRouteMap.set(plan.id, plan.routeId);
          planContactMap.set(plan.id, plan.contactId);
        }

        const routeMap = new Map<
          string,
          {
            routeId: string;
            routeName: string;
            dayOfWeek: string;
            totalStops: number;
            totalRevenueCents: number;
            totalCostCents: number;
            totalProfitCents: number;
            customers: Array<{
              contactId: string;
              firstName: string;
              lastName: string;
              revenueCents: number;
              costCents: number;
            }>;
          }
        >();

        for (const route of routes) {
          routeMap.set(route.id, {
            routeId: route.id,
            routeName: route.name,
            dayOfWeek: route.dayOfWeek ?? "tbd",
            totalStops: 0,
            totalRevenueCents: 0,
            totalCostCents: 0,
            totalProfitCents: 0,
            customers: [],
          });
        }

        for (const customer of allProfitability) {
          for (const prop of customer.properties) {
            const routeId = planRouteMap.get(prop.servicePlanId);
            if (!routeId || !routeMap.has(routeId)) continue;
            const routeEntry = routeMap.get(routeId)!;
            routeEntry.totalStops++;
            routeEntry.totalRevenueCents += prop.revenuePerVisitCents;
            routeEntry.totalCostCents += prop.costPerVisitCents;
            routeEntry.totalProfitCents += prop.profitPerVisitCents;

            let existing = routeEntry.customers.find((c) => c.contactId === customer.contactId);
            if (!existing) {
              existing = {
                contactId: customer.contactId,
                firstName: customer.contactName.split(" ")[0],
                lastName: customer.contactName.split(" ").slice(1).join(" "),
                revenueCents: 0,
                costCents: 0,
              };
              routeEntry.customers.push(existing);
            }
            existing.revenueCents += prop.revenuePerVisitCents;
            existing.costCents += prop.costPerVisitCents;
          }
        }

        const result = Array.from(routeMap.values())
          .filter((r) => r.totalStops > 0)
          .map((r) => ({
            ...r,
            avgMarginPct:
              r.totalRevenueCents > 0
                ? Math.round((r.totalProfitCents / r.totalRevenueCents) * 10000) / 100
                : 0,
          }));

        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/profitability/route-map", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { calculateAllCustomerProfitability } =
        await import("../services/profitability-calculator");
      const allProfitability = await calculateAllCustomerProfitability(companyId);
      const routes = await storage.getRoutes(companyId);
      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const properties = await storage.getProperties(companyId);
      const contacts = await storage.getContacts(companyId);

      const propertyMap = new Map(properties.map((p) => [p.id, p]));
      const contactMap = new Map(contacts.map((c) => [c.id, c]));

      const plansByRoute = new Map<string, typeof plans>();
      for (const plan of plans) {
        if (!plan.routeId || plan.isStopOnly) continue;
        if (!plansByRoute.has(plan.routeId)) plansByRoute.set(plan.routeId, []);
        plansByRoute.get(plan.routeId)!.push(plan);
      }

      const profByContact = new Map<string, (typeof allProfitability)[0]>();
      for (const cp of allProfitability) {
        profByContact.set(cp.contactId, cp);
      }

      type MapStop = {
        propertyId: string;
        contactId: string;
        contactName: string;
        propertyAddress: string;
        latitude: number;
        longitude: number;
        frequency: string;
        dogCount: number;
        yardSize: string;
        revenuePerVisitCents: number;
        costPerVisitCents: number;
        profitPerVisitCents: number;
        profitMarginPct: number;
        status: "profitable" | "marginal" | "unprofitable";
        stopOrder: number;
      };

      type MapRoute = {
        routeId: string;
        routeName: string;
        dayOfWeek: string;
        color: string;
        totalStops: number;
        totalRevenueCents: number;
        totalCostCents: number;
        totalProfitCents: number;
        avgMarginPct: number;
        status: "profitable" | "marginal" | "unprofitable";
        stops: MapStop[];
      };

      const result: MapRoute[] = [];

      for (const route of routes) {
        const routePlans = plansByRoute.get(route.id) || [];
        const stops: MapStop[] = [];
        let totalRev = 0,
          totalCost = 0,
          totalProfit = 0;

        for (const plan of routePlans) {
          const prop = propertyMap.get(plan.propertyId);
          if (!prop || !prop.latitude || !prop.longitude) continue;
          const contact = contactMap.get(plan.contactId);
          const custProf = profByContact.get(plan.contactId);
          const propProf = custProf?.properties.find((p) => p.servicePlanId === plan.id);

          const rev = propProf?.revenuePerVisitCents ?? 0;
          const cost = propProf?.costPerVisitCents ?? 0;
          const profit = propProf?.profitPerVisitCents ?? 0;
          const margin = rev > 0 ? (profit / rev) * 100 : 0;
          const status: "profitable" | "marginal" | "unprofitable" =
            margin > 15 ? "profitable" : margin >= 0 ? "marginal" : "unprofitable";

          totalRev += rev;
          totalCost += cost;
          totalProfit += profit;

          stops.push({
            propertyId: prop.id,
            contactId: plan.contactId,
            contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
            propertyAddress: prop.streetAddress || "Unknown",
            latitude: Number(prop.latitude),
            longitude: Number(prop.longitude),
            frequency: plan.frequency,
            dogCount: prop.numberOfDogs ?? 1,
            yardSize: prop.yardSize || "standard",
            revenuePerVisitCents: rev,
            costPerVisitCents: cost,
            profitPerVisitCents: profit,
            profitMarginPct: Math.round(margin * 10) / 10,
            status,
            stopOrder: plan.stopOrder ?? 0,
          });
        }

        if (stops.length === 0) continue;

        stops.sort((a, b) => a.stopOrder - b.stopOrder);
        const avgMargin = totalRev > 0 ? Math.round((totalProfit / totalRev) * 10000) / 100 : 0;
        const routeStatus: "profitable" | "marginal" | "unprofitable" =
          avgMargin > 15 ? "profitable" : avgMargin >= 0 ? "marginal" : "unprofitable";

        result.push({
          routeId: route.id,
          routeName: route.name,
          dayOfWeek: route.dayOfWeek ?? "tbd",
          color: route.color || "#3b82f6",
          totalStops: stops.length,
          totalRevenueCents: totalRev,
          totalCostCents: totalCost,
          totalProfitCents: totalProfit,
          avgMarginPct: avgMargin,
          status: routeStatus,
          stops,
        });
      }

      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/profitability/recalculate",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { generateProfitabilitySnapshots } =
          await import("../services/profitability-calculator");
        const count = await generateProfitabilitySnapshots(companyId);
        res.json({ success: true, snapshotsCreated: count });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/profitability/history/:contactId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const snapshots = await storage.getProfitabilitySnapshots(companyId, {
          contactId: p(req.params.contactId),
        });
        res.json(snapshots);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/profitability/bulk-recommendations",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { calculateAllCustomerProfitability, generateBulkRecommendations } =
          await import("../services/profitability-calculator");
        const allProfitability = await calculateAllCustomerProfitability(companyId);
        const recommendations = generateBulkRecommendations(allProfitability);
        res.json(recommendations);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Pricing Simulator ================

  app.post(
    "/api/pricing-simulator/simulate",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const schema = z.object({
          targetMarginPct: z.number().min(1).max(80),
          overheadAdjustmentPct: z.number().min(-50).max(100),
          laborRateAdjustmentPct: z.number().min(-50).max(100),
          travelCostFactor: z.number().min(0.1).max(5),
        });
        const params = schema.parse(req.body);
        const { runPricingSimulation } = await import("../services/pricing-simulator");
        const result = await runPricingSimulation(companyId, params);
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/pricing-simulator/elasticity",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const schema = z.object({
          propertyId: z.string().optional(),
        });
        const { propertyId } = schema.parse(req.body);
        const { runPriceElasticitySimulation } = await import("../services/pricing-simulator");
        const result = await runPriceElasticitySimulation(companyId, propertyId || undefined);
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/pricing-simulator/competitor-analysis",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const schema = z.object({
          zipCode: z.string().optional(),
        });
        const { zipCode } = schema.parse(req.body);
        const { runCompetitorAnalysis } = await import("../services/pricing-simulator");
        const result = await runCompetitorAnalysis(companyId, zipCode || undefined);
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/pricing-simulator/zip-codes",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const props = await storage.getProperties(companyId);
        const zipSet = new Set(props.map((p) => p.zipCode).filter(Boolean));
        res.json([...zipSet].sort());
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Competitor Pricing ================

  app.get("/api/competitor-pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const zipCode = req.query.zipCode as string | undefined;
      const items = await storage.getCompetitorPricing(companyId, zipCode);
      res.json(items);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/competitor-pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const schema = z.object({
        zipCode: z.string().min(1),
        competitorName: z.string().min(1),
        frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]).default("weekly"),
        priceCents: z.number().int().min(0),
        dogCountRange: z.string().optional().default("1-2"),
        yardSizeCategory: z.string().optional().default("medium"),
        source: z.enum(["manual", "research"]).optional().default("manual"),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const item = await storage.createCompetitorPricing({ ...data, companyId });
      res.json(item);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/competitor-pricing/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const id = p(req.params.id);
      const schema = z.object({
        zipCode: z.string().min(1).optional(),
        competitorName: z.string().min(1).optional(),
        frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]).optional(),
        priceCents: z.number().int().min(0).optional(),
        dogCountRange: z.string().optional(),
        yardSizeCategory: z.string().optional(),
        source: z.enum(["manual", "research"]).optional(),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const item = await storage.updateCompetitorPricing(id, companyId, data);
      res.json(item);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete(
    "/api/competitor-pricing/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const id = p(req.params.id);
        await storage.deleteCompetitorPricing(id, companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Overhead Costs ================

  app.get("/api/overhead-costs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const items = await storage.getOverheadCosts(companyId);
      const totalMonthlyOverheadCents = items.reduce((sum, i) => sum + i.monthlyCostCents, 0);
      res.json({ items, totalMonthlyOverheadCents });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/overhead-costs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { category, name, monthlyCostCents, type, sortOrder } = req.body;
      if (!category || typeof category !== "string" || !name || typeof name !== "string") {
        return res.status(400).json({ error: "category and name are required strings" });
      }
      const costCents =
        typeof monthlyCostCents === "number" && monthlyCostCents >= 0
          ? Math.round(monthlyCostCents)
          : 0;
      const validType = type === "variable" ? "variable" : "fixed";
      const item = await storage.createOverheadCost({
        companyId,
        category: category.trim(),
        name: name.trim(),
        monthlyCostCents: costCents,
        type: validType,
        isDefault: false,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
      });
      res.json(item);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/overhead-costs/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const id = p(req.params.id);
      const updates: Record<string, unknown> = {};
      if (typeof req.body.name === "string") updates.name = req.body.name.trim();
      if (typeof req.body.monthlyCostCents === "number" && req.body.monthlyCostCents >= 0) {
        updates.monthlyCostCents = Math.round(req.body.monthlyCostCents);
      }
      if (req.body.type === "fixed" || req.body.type === "variable") updates.type = req.body.type;
      if (typeof req.body.category === "string") updates.category = req.body.category.trim();
      if (typeof req.body.sortOrder === "number") updates.sortOrder = req.body.sortOrder;
      if (Object.keys(updates).length === 0)
        return res.status(400).json({ error: "No valid fields to update" });
      const item = await storage.updateOverheadCost(id, companyId, updates);
      if (!item) return res.status(404).json({ error: "Item not found" });
      res.json(item);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/overhead-costs/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteOverheadCost(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/overhead-costs/seed-defaults",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const existing = await storage.getOverheadCosts(companyId);
        if (existing.length > 0) {
          return res.json({
            seeded: false,
            message: "Items already exist",
            count: existing.length,
          });
        }

        const company = await storage.getCompany(companyId);
        const { TIER_CONFIG } = await import("@shared/schema");
        const tier = (company?.subscriptionTier || "free_trial") as keyof typeof TIER_CONFIG;
        const subscriptionPriceCents = Math.round((TIER_CONFIG[tier]?.price ?? 0) * 100);

        const defaults: Array<{
          category: string;
          name: string;
          type: "fixed" | "variable";
          sortOrder: number;
          monthlyCostCents?: number;
        }> = [
          {
            category: "Office + Admin",
            name: "Scheduling/CRM software",
            type: "fixed",
            sortOrder: 0,
          },
          {
            category: "Office + Admin",
            name: "Website hosting and domain",
            type: "fixed",
            sortOrder: 1,
          },
          {
            category: "Office + Admin",
            name: "Phone line/business number",
            type: "fixed",
            sortOrder: 2,
          },
          {
            category: "Office + Admin",
            name: "Email and workspace tools",
            type: "fixed",
            sortOrder: 3,
          },
          {
            category: "Office + Admin",
            name: "Bookkeeping/accounting software",
            type: "fixed",
            sortOrder: 4,
          },
          {
            category: "Office + Admin",
            name: "Payment processing fees",
            type: "variable",
            sortOrder: 5,
          },
          { category: "Office + Admin", name: "Business insurance", type: "fixed", sortOrder: 6 },
          { category: "Office + Admin", name: "Licenses and permits", type: "fixed", sortOrder: 7 },
          { category: "Office + Admin", name: "Legal and tax prep", type: "fixed", sortOrder: 8 },
          {
            category: "Office + Admin",
            name: "ScooPilot subscription",
            type: "fixed",
            sortOrder: 9,
            monthlyCostCents: subscriptionPriceCents,
          },
          { category: "Marketing", name: "Google Ads", type: "variable", sortOrder: 0 },
          { category: "Marketing", name: "Facebook/Instagram ads", type: "variable", sortOrder: 1 },
          { category: "Marketing", name: "Yard signs", type: "variable", sortOrder: 2 },
          { category: "Marketing", name: "Flyers/door hangers", type: "variable", sortOrder: 3 },
          { category: "Marketing", name: "Vehicle magnets or wraps", type: "fixed", sortOrder: 4 },
          { category: "Marketing", name: "Referral rewards", type: "variable", sortOrder: 5 },
          {
            category: "Marketing",
            name: "Print materials and business cards",
            type: "variable",
            sortOrder: 6,
          },
          { category: "Vehicles + Transportation", name: "Fuel", type: "variable", sortOrder: 0 },
          {
            category: "Vehicles + Transportation",
            name: "Vehicle payment or lease",
            type: "fixed",
            sortOrder: 1,
          },
          {
            category: "Vehicles + Transportation",
            name: "Vehicle insurance",
            type: "fixed",
            sortOrder: 2,
          },
          {
            category: "Vehicles + Transportation",
            name: "Repairs and maintenance",
            type: "variable",
            sortOrder: 3,
          },
          { category: "Vehicles + Transportation", name: "Tires", type: "variable", sortOrder: 4 },
          {
            category: "Vehicles + Transportation",
            name: "Registration",
            type: "fixed",
            sortOrder: 5,
          },
          {
            category: "Vehicles + Transportation",
            name: "Route optimization software",
            type: "fixed",
            sortOrder: 6,
          },
          {
            category: "Tools + Field Supplies",
            name: "Rakes, bins, scoopers, bags",
            type: "variable",
            sortOrder: 0,
          },
          { category: "Tools + Field Supplies", name: "Gloves", type: "variable", sortOrder: 1 },
          {
            category: "Tools + Field Supplies",
            name: "Disinfectant and sanitizer",
            type: "variable",
            sortOrder: 2,
          },
          {
            category: "Tools + Field Supplies",
            name: "Boot spray/cleaning supplies",
            type: "variable",
            sortOrder: 3,
          },
          {
            category: "Tools + Field Supplies",
            name: "Uniforms/branded shirts",
            type: "fixed",
            sortOrder: 4,
          },
          {
            category: "Tools + Field Supplies",
            name: "Replacement tools from wear and tear",
            type: "variable",
            sortOrder: 5,
          },
          { category: "Labor", name: "Employee wages", type: "variable", sortOrder: 0 },
          { category: "Labor", name: "Payroll taxes", type: "variable", sortOrder: 1 },
          { category: "Labor", name: "Workers' comp", type: "fixed", sortOrder: 2 },
          { category: "Labor", name: "Training time", type: "variable", sortOrder: 3 },
          { category: "Labor", name: "Bonuses/incentives", type: "variable", sortOrder: 4 },
          { category: "Labor", name: "Hiring costs", type: "variable", sortOrder: 5 },
          { category: "Labor", name: "Background checks", type: "variable", sortOrder: 6 },
          { category: "Operations", name: "Mobile data plans", type: "fixed", sortOrder: 0 },
          { category: "Operations", name: "GPS/time tracking apps", type: "fixed", sortOrder: 1 },
          {
            category: "Operations",
            name: "Customer notification tools",
            type: "fixed",
            sortOrder: 2,
          },
          {
            category: "Operations",
            name: "Storage bins or small storage unit",
            type: "fixed",
            sortOrder: 3,
          },
          {
            category: "Operations",
            name: "Equipment cleaning area/supplies",
            type: "variable",
            sortOrder: 4,
          },
          { category: "Financial Overhead", name: "Bank fees", type: "fixed", sortOrder: 0 },
          {
            category: "Financial Overhead",
            name: "Merchant service fees",
            type: "variable",
            sortOrder: 1,
          },
          {
            category: "Financial Overhead",
            name: "Bad debt/unpaid invoices",
            type: "variable",
            sortOrder: 2,
          },
          {
            category: "Financial Overhead",
            name: "Refunds or service credits",
            type: "variable",
            sortOrder: 3,
          },
        ];

        for (const item of defaults) {
          await storage.createOverheadCost({
            companyId,
            category: item.category,
            name: item.name,
            monthlyCostCents: item.monthlyCostCents ?? 0,
            type: item.type,
            isDefault: true,
            sortOrder: item.sortOrder,
          });
        }

        const items = await storage.getOverheadCosts(companyId);
        res.json({ seeded: true, count: items.length, items });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/overhead-costs/monthly-fuel",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);

        const allRoutes = await storage.getRoutes(companyId);

        if (allRoutes.length === 0) {
          return res.json({ totalMiles: 0, weeklyMiles: 0, fuelCostCents: 0, routeCount: 0 });
        }

        const company = await storage.getCompany(companyId);
        const config = (company?.pricingConfig as unknown as Record<string, unknown>) || {};
        const gasPriceCents = (config.averageGasPriceCentsPerGallon as number | undefined) ?? 350;
        const mpg = (config.vehicleMPG as number | undefined) ?? null;
        const costPerMileCents = (config.vehicleCostPerMileCents as number | undefined) ?? 65;

        const effectiveCostPerMileCents =
          mpg && mpg > 0 ? Math.round(gasPriceCents / mpg) : costPerMileCents;

        const allPlans = await storage.getServicePlans(companyId, { isActive: true });
        const allProperties = await storage.getProperties(companyId);
        const propMap = new Map(allProperties.map((p) => [p.id, p]));
        const startPoint =
          company?.startLatitude && company?.startLongitude
            ? { latitude: Number(company.startLatitude), longitude: Number(company.startLongitude) }
            : undefined;

        let weeklyMiles = 0;
        let routeCount = 0;

        for (const route of allRoutes) {
          const routePlans = allPlans
            .filter((sp) => sp.routeId === route.id)
            .sort((a, b) => a.stopOrder - b.stopOrder);

          if (routePlans.length < 2) continue;

          const stops: { id: string; latitude: number; longitude: number }[] = [];
          for (const sp of routePlans) {
            const prop = propMap.get(sp.propertyId);
            if (prop?.latitude && prop?.longitude) {
              stops.push({
                id: sp.id,
                latitude: Number(prop.latitude),
                longitude: Number(prop.longitude),
              });
            }
          }

          if (stops.length < 2) continue;

          routeCount++;
          const metrics = await getRouteMetricsWithLegs(stops, startPoint);
          if (metrics) {
            weeklyMiles += metrics.totalDistance;
          } else {
            weeklyMiles += calculateTotalDistance(stops, startPoint);
          }
        }

        weeklyMiles = Math.round(weeklyMiles * 10) / 10;
        const WEEKS_PER_MONTH = 4.33;
        const totalMiles = Math.round(weeklyMiles * WEEKS_PER_MONTH * 10) / 10;
        const fuelCostCents = Math.round(totalMiles * effectiveCostPerMileCents);

        res.json({ totalMiles, weeklyMiles, fuelCostCents, routeCount });
      } catch (err) {
        handleError(res, err);
      }
    }
  );
}

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
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";

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
            monthly: z.number().min(0).optional(),
            oneTime: z.number().min(0).optional(),
          }),
          enabledFrequencies: z
            .object({
              twiceWeekly: z.boolean().optional(),
              monthly: z.boolean().optional(),
            })
            .optional(),
          monthlyLinkedToCleanup: z.boolean().optional(),
          perDogRule: z.object({
            incrementDogs: z.number().int().min(1),
            surchargeAmount: z.number().min(0),
            maxDogs: z.number().int().min(1).max(20),
          }),
          yardSizeTiers: z.array(
            z.object({
              name: z.string().optional(),
              upToAcres: z.number().min(0).nullable(),
              surcharge: z.number().min(0),
            })
          ),
          firstTimeCleanupConfig: z
            .object({
              baseAmount: z.number().min(0),
              modifiers: z.array(
                z.object({
                  id: z.string(),
                  type: z.enum(["per_unit", "hourly", "flat_fee"]),
                  label: z.string(),
                  pricePerUnit: z.number().optional(),
                  rate: z.number().optional(),
                  estimatedHours: z.number().optional(),
                  amount: z.number().optional(),
                })
              ),
              conversionDiscount: z.object({
                type: z.enum(["waive", "discount_amount", "discount_percent", "none"]),
                discountAmount: z.number().optional(),
                discountPercent: z.number().optional(),
              }),
              firstTimeCleanupMode: z.enum(["fixed", "hourly", "bucket"]).optional(),
              hourlyRate: z.number().min(0).optional(),
              estimatedHours: z.number().min(0).optional(),
              bucketFirstPrice: z.number().min(0).optional(),
              bucketAdditionalPrice: z.number().min(0).optional(),
              defaultBucketCount: z.number().int().min(1).optional(),
            })
            .optional(),
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

        const twiceWeeklyEnabled = rules.enabledFrequencies?.twiceWeekly !== false;
        const monthlyEnabled = rules.enabledFrequencies?.monthly === true;

        const frequencies = [
          {
            key: "weekly",
            label: "Weekly Scooping",
            base: rules.basePrices.weekly,
            unit: "per_week",
          },
          ...(twiceWeeklyEnabled
            ? [
                {
                  key: "twiceWeekly",
                  label: "Twice Weekly Scooping",
                  base: rules.basePrices.twiceWeekly,
                  unit: "per_visit",
                },
              ]
            : []),
          {
            key: "biWeekly",
            label: "Bi-Weekly Scooping",
            base: rules.basePrices.biWeekly,
            unit: "per_visit",
          },
          ...(monthlyEnabled
            ? [
                {
                  key: "monthly",
                  label: "Monthly Scooping",
                  base: rules.basePrices.monthly ?? 0,
                  unit: "per_visit",
                },
              ]
            : []),
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
          const tierLabel =
            tier.name ||
            (tier.upToAcres != null ? `Lot Size up to ${tier.upToAcres} Acre` : "Lot Size (Large)");
          const tierName =
            tier.upToAcres != null ? `Lot Size up to ${tier.upToAcres} Acre` : tierLabel;
          if (tier.upToAcres != null) {
            generatedYardAcres.add(tier.upToAcres);
          }
          const existingAddon =
            (tier.upToAcres != null ? existingLotByAcres.get(tier.upToAcres) : undefined) ||
            existingAddOnsByName.get(tierName) ||
            existingAddOnsByName.get(tierLabel);
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
            const acresLabel =
              tier.upToAcres != null ? `up to ${tier.upToAcres} acre` : "unlimited";
            await storage.createServicePricingItem({
              companyId,
              category: "add_on",
              name: tierLabel,
              description:
                tier.surcharge === 0
                  ? `No additional charge for lots ${acresLabel}`
                  : `Additional charge for lots ${acresLabel}`,
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

        // Generation is additive: never delete existing packages. We only insert
        // packages that don't already exist, and skip any that conflict with an
        // existing (custom) package, leaving it untouched.
        //
        // The generated package name (`${freqLabel} - ${dogLabel}`) uniquely encodes
        // both the frequency and the dog tier, so matching by name is sufficient to
        // detect a package that already exists or conflicts with a custom one.
        const existingPackages = await storage.getServicePackages(companyId);
        const existingNames = new Set(existingPackages.map((p) => p.name.trim().toLowerCase()));

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

        let sortOrder = existingPackages.length + 1;
        let createdCount = 0;
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

            const packageName = `${freqLabel} - ${dogMatch ? dogMatch[0] : "1 Dog"}`;

            // Additive: skip if a package with this name already exists (either a
            // previously generated one or a custom package), leaving it untouched.
            if (existingNames.has(packageName.trim().toLowerCase())) {
              continue;
            }
            existingNames.add(packageName.trim().toLowerCase());

            await storage.createServicePackage({
              companyId,
              name: packageName,
              description: `${freqLabel} service for ${dogMatch ? dogMatch[0].toLowerCase() : "1 dog"}`,
              frequency: displayFreq,
              basePrice: totalPrice.toFixed(2),
              includedItems,
              sortOrder: sortOrder++,
            });
            createdCount++;
          }
        }

        const newPackages = await storage.getServicePackages(companyId);
        res.json({ success: true, packagesCreated: createdCount, packages: newPackages });
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

  const firstTimeCleanupConfigSchema = z
    .object({
      baseAmount: z.number().min(0),
      modifiers: z
        .array(
          z.object({
            id: z.string(),
            type: z.enum(["per_unit", "hourly", "flat_fee"]),
            label: z.string(),
            pricePerUnit: z.number().optional(),
            rate: z.number().optional(),
            estimatedHours: z.number().optional(),
            amount: z.number().optional(),
          })
        )
        .optional(),
      conversionDiscount: z
        .object({
          type: z.enum(["waive", "discount_amount", "discount_percent", "none"]),
          discountAmount: z.number().optional(),
          discountPercent: z.number().optional(),
        })
        .optional(),
      firstTimeCleanupMode: z.enum(["fixed", "hourly", "bucket"]).optional(),
      hourlyRate: z.number().min(0).optional(),
      estimatedHours: z.number().min(0).optional(),
      bucketFirstPrice: z.number().min(0).optional(),
      bucketAdditionalPrice: z.number().min(0).optional(),
      defaultBucketCount: z.number().int().min(1).optional(),
    })
    .optional();

  const pricingRulesSchema = z
    .object({
      basePrices: z.object({
        weekly: z.number().min(0),
        biWeekly: z.number().min(0),
        twiceWeekly: z.number().min(0),
        monthly: z.number().min(0).optional(),
        oneTime: z.number().min(0).optional(),
      }),
      enabledFrequencies: z
        .object({
          twiceWeekly: z.boolean().optional(),
          monthly: z.boolean().optional(),
        })
        .optional(),
      perDogRule: z.object({
        incrementDogs: z.number().int().min(1),
        surchargeAmount: z.number().min(0),
        maxDogs: z.number().int().min(1).max(20),
      }),
      yardSizeTiers: z.array(
        z.object({
          name: z.string().optional(),
          upToAcres: z.number().min(0).nullable(),
          surcharge: z.number().min(0),
        })
      ),
      firstTimeCleanupConfig: firstTimeCleanupConfigSchema,
    })
    .optional();

  const pricingConfigSchema = z.object({
    pricingRules: pricingRulesSchema,
    tierNames: z
      .object({
        tier1: z.string(),
        tier2: z.string(),
        tier3: z.string(),
      })
      .optional(),
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

  app.put("/api/pricing-rules", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const rules = pricingRulesSchema.unwrap().parse(req.body);
      const existing: PricingConfig = {
        ...DEFAULT_PRICING_CONFIG,
        ...(company.pricingConfig || {}),
      };
      const merged: PricingConfig = { ...existing, pricingRules: rules };
      await storage.updateCompany(companyId, { pricingConfig: merged });
      res.json(rules);
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
      const customerAcquisition: {
        month: string;
        newClients: number;
        total: number;
        sources: Record<string, number>;
      }[] = [];
      const contactsByCreatedMonth: Record<string, number> = {};
      const sourcesByCreatedMonth: Record<string, Record<string, number>> = {};
      for (const c of allContactsRaw) {
        const created = new Date(c.createdAt);
        const key = `${created.getFullYear()}-${String(created.getMonth()).padStart(2, "0")}`;
        contactsByCreatedMonth[key] = (contactsByCreatedMonth[key] || 0) + 1;
        const src = (c.leadSource as string | null)?.trim() || "Direct / Unknown";
        if (!sourcesByCreatedMonth[key]) sourcesByCreatedMonth[key] = {};
        sourcesByCreatedMonth[key][src] = (sourcesByCreatedMonth[key][src] || 0) + 1;
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
          sources: sourcesByCreatedMonth[key] || {},
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

      // Invoice Collection (12 months) — invoiced by createdAt month, collected by paidAt month
      const icMonths: {
        monthKey: string;
        month: string;
        invoicedCents: number;
        collectedCents: number;
      }[] = [];
      const icWindowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
        icMonths.push({
          monthKey,
          month: d.toLocaleString("default", { month: "short", year: "2-digit" }),
          invoicedCents: 0,
          collectedCents: 0,
        });
      }
      const icMap = new Map(icMonths.map((m) => [m.monthKey, m]));
      for (const inv of allInvoices) {
        const created = new Date(inv.createdAt);
        if (created >= icWindowStart) {
          const key = `${created.getFullYear()}-${String(created.getMonth()).padStart(2, "0")}`;
          const bucket = icMap.get(key);
          if (bucket) bucket.invoicedCents += Math.round(parseFloat(inv.total) * 100);
        }
        if (inv.paidAt) {
          const paid = new Date(inv.paidAt);
          if (paid >= icWindowStart) {
            const key = `${paid.getFullYear()}-${String(paid.getMonth()).padStart(2, "0")}`;
            const bucket = icMap.get(key);
            if (bucket) bucket.collectedCents += Math.round(parseFloat(inv.total) * 100);
          }
        }
      }
      const invoiceCollection = icMonths.map(({ month, invoicedCents, collectedCents }) => ({
        month,
        invoicedCents,
        collectedCents,
      }));

      // Revenue by plan frequency
      const freqMrrMap: Record<string, number> = { weekly: 0, biweekly: 0, monthly: 0 };
      for (const p of allActivePlans) {
        const freq = p.frequency as string;
        if (freq in freqMrrMap) {
          const visits = visitsPerMonthByFreq[freq] ?? 0;
          freqMrrMap[freq] += Math.round(parseFloat(p.pricePerVisit) * 100 * visits);
        }
      }
      const revenueByFrequency = [
        { name: "Weekly", mrrCents: freqMrrMap.weekly },
        { name: "Bi-Weekly", mrrCents: freqMrrMap.biweekly },
        { name: "Monthly", mrrCents: freqMrrMap.monthly },
      ];

      // Route Efficiency — avg stops per active route-day per month over 12 months
      const reStart = new Date(now.getFullYear(), now.getMonth() - 11, 1)
        .toISOString()
        .split("T")[0];
      const reEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
      const allVisits12m = await storage.getVisitsForDateRange(companyId, reStart, reEnd);
      const reMonths: { monthKey: string; month: string }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        reMonths.push({
          monthKey: `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`,
          month: d.toLocaleString("default", { month: "short", year: "2-digit" }),
        });
      }
      const routeDayStops = new Map<string, number>(); // "monthKey|routeId" -> stop count
      for (const v of allVisits12m) {
        if (v.status !== "completed" || !v.routeId) continue;
        const parts = v.scheduledDate.split("-");
        const yr = parseInt(parts[0], 10);
        const mo = parseInt(parts[1], 10) - 1;
        const monthKey = `${yr}-${String(mo).padStart(2, "0")}`;
        const key = `${monthKey}|${v.routeId}`;
        routeDayStops.set(key, (routeDayStops.get(key) || 0) + 1);
      }
      const reByMonth = new Map<string, { totalStops: number; routeDays: number }>();
      for (const [key, stops] of routeDayStops.entries()) {
        const monthKey = key.split("|")[0];
        const existing = reByMonth.get(monthKey) || { totalStops: 0, routeDays: 0 };
        existing.totalStops += stops;
        existing.routeDays += 1;
        reByMonth.set(monthKey, existing);
      }
      const routeEfficiency = reMonths.map(({ month, monthKey }) => {
        const bucket = reByMonth.get(monthKey);
        const avgStopsPerDay =
          bucket && bucket.routeDays > 0
            ? Math.round((bucket.totalStops / bucket.routeDays) * 10) / 10
            : 0;
        return { month, avgStopsPerDay };
      });

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
        invoiceCollection,
        revenueByFrequency,
        routeEfficiency,
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

        const [allContacts, allInvoices, allPlansRaw] = await Promise.all([
          storage.getContacts(companyId),
          storage.getInvoices(companyId),
          storage.getServicePlans(companyId, {}),
        ]);
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

        const newCustomers30d = allContacts.filter(
          (c) => new Date(c.createdAt) >= thirtyAgo
        ).length;
        const churned30d = allContacts.filter(
          (c) => c.status === "cancelled" && new Date(c.updatedAt) >= thirtyAgo
        ).length;
        const activePlanCount = allActivePlans.length;
        const pausedPlanCount = allPlansRaw.filter(
          (p) => p.pausedAt != null || p.isStopOnly
        ).length;
        const churnRatePct =
          activeCustomers > 0 ? Math.round((churned30d / activeCustomers) * 1000) / 10 : 0;

        // Route density metrics — activeRouteCount counts only routes with at least one active plan
        const plansWithRoute = allActivePlans.filter((p) => p.routeId != null).length;
        const distinctRouteIds = new Set(allActivePlans.map((p) => p.routeId).filter(Boolean)).size;
        const activeRouteCount = distinctRouteIds;
        const avgStopsPerRoute =
          activeRouteCount > 0 ? Math.round((activePlanCount / activeRouteCount) * 10) / 10 : 0;
        const plansOnRoutePct =
          activePlanCount > 0 ? Math.round((plansWithRoute / activePlanCount) * 100) : 0;

        // Data quality warnings
        const dataQualityWarnings: Array<{
          dataPoint: string;
          status: "Warning" | "Good" | "Missing";
          note: string;
        }> = [];
        if (activePlanCount === 0) {
          dataQualityWarnings.push({
            dataPoint: "Active Plans",
            status: "Missing",
            note: "No active service plans found — most metrics cannot be assessed.",
          });
        }
        if (activeCustomers === 0) {
          dataQualityWarnings.push({
            dataPoint: "Active Customers",
            status: "Missing",
            note: "No active customers found — customer-based metrics cannot be assessed.",
          });
        }
        if (activeRouteCount > 0 && activePlanCount > 0) {
          const routeToCustomerRatio = activeRouteCount / activePlanCount;
          if (routeToCustomerRatio >= 0.8) {
            dataQualityWarnings.push({
              dataPoint: "Route vs Customer Count",
              status: "Warning",
              note: `Route count (${activeRouteCount}) is unusually high relative to active plans (${activePlanCount}) — verify whether service visits are being counted as routes rather than customers.`,
            });
          } else {
            dataQualityWarnings.push({
              dataPoint: "Route vs Customer Count",
              status: "Good",
              note: `${activeRouteCount} routes serving ${activePlanCount} active plans (${avgStopsPerRoute} stops/route avg).`,
            });
          }
        }
        if (plansOnRoutePct < 50 && activePlanCount > 0) {
          dataQualityWarnings.push({
            dataPoint: "Plans Assigned to Routes",
            status: "Warning",
            note: `Only ${plansOnRoutePct}% of active plans are assigned to a route — route density metrics may be understated.`,
          });
        } else if (activePlanCount > 0) {
          dataQualityWarnings.push({
            dataPoint: "Plans Assigned to Routes",
            status: "Good",
            note: `${plansOnRoutePct}% of active plans are assigned to routes.`,
          });
        }
        if (mrrCents === 0 && activePlanCount > 0) {
          dataQualityWarnings.push({
            dataPoint: "MRR Calculation",
            status: "Warning",
            note: "Active plans exist but MRR calculates to $0 — check that plan prices are set correctly.",
          });
        }
        if (collectionRate < 50 && paidInvoices.length > 0) {
          dataQualityWarnings.push({
            dataPoint: "Collection Rate",
            status: "Warning",
            note: `Collection rate of ${collectionRate}% is unusually low — verify invoice statuses are being updated correctly.`,
          });
        }

        const factSheet = {
          businessName: company?.name || "Your Business",
          activeCustomers,
          cancelledCustomers,
          totalCustomers: allContacts.length,
          newCustomers30d,
          churned30d,
          churnRatePct,
          activePlanCount,
          pausedPlanCount,
          mrrDollars: Math.round(mrrCents / 100),
          scheduledMonthlyRevenueDollars: Math.round(mrrCents / 100),
          collectionRatePct: collectionRate,
          avgProfitMarginPct,
          profitableCustomers: profitableCount,
          marginalCustomers: marginalCount,
          unprofitableCustomers: unprofitableCount,
          billedCalendarMonthToDateDollars: Math.round(thisMonthRev),
          billedPriorCalendarMonthDollars: Math.round(lastMonthRev),
          billingNote:
            "billedCalendarMonthToDateDollars reflects invoices ISSUED this calendar month only — it is commonly $0 mid-month because most operators batch invoices at month-end. This is NOT a revenue or cash-flow signal. Use mrrDollars / scheduledMonthlyRevenueDollars for all revenue analysis.",
          billedAmountChangeVsPriorMonthPct: revenueGrowthPct,
          paidInvoiceCount: paidInvoices.length,
          activeRouteCount,
          avgStopsPerRoute,
          plansOnRoutePct,
          dataQualityWarnings,
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

        const hasDataQualityWarnings = dataQualityWarnings.some(
          (w) => w.status === "Warning" || w.status === "Missing"
        );

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
  "confidenceLevel": "<High | Medium | Low — MUST be Medium or Low if dataQualityWarnings contains any Warning or Missing entries>",
  "confidenceReason": "<plain-English explanation of why this confidence level was chosen, citing specific data gaps or quality issues>",
  "executiveSummary": {
    "topThingsWorking": ["<item 1>", "<item 2>", "<item 3>"],
    "topProblems": ["<item 1>", "<item 2>", "<item 3>"],
    "topActionsFirst": ["<action 1>", "<action 2>", "<action 3>"],
    "biggestRisk": "<single biggest business risk with specific numbers>",
    "fastestWayToImprove": "<one specific operational action most likely to improve score within 30-60 days — must include a concrete step, not a vague strategy>"
  },
  "scoreBreakdown": [
    { "category": "Recurring Revenue Quality", "score": <0-15>, "max": 15, "assessment": "<specific assessment with numbers>", "driver": "<the single key metric driving this score, e.g. '$X MRR from Y active plans'>", "suggestedFix": "<one-line specific action to improve this score>" },
    { "category": "Route Density and Territory Efficiency", "score": <0-15>, "max": 15, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" },
    { "category": "Gross Margin / Unit Economics", "score": <0-15>, "max": 15, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" },
    { "category": "Pricing Power and Plan Structure", "score": <0-10>, "max": 10, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" },
    { "category": "Operating Efficiency", "score": <0-10>, "max": 10, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" },
    { "category": "Billing and Cash Flow", "score": <0-10>, "max": 10, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" },
    { "category": "Sales and Marketing Engine", "score": <0-10>, "max": 10, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" },
    { "category": "Customer Retention and Service Quality", "score": <0-5>, "max": 5, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" },
    { "category": "Scalability and Owner Dependency", "score": <0-5>, "max": 5, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" },
    { "category": "Risk Profile", "score": <0-5>, "max": 5, "assessment": "<specific assessment>", "driver": "<key metric>", "suggestedFix": "<one-line action>" }
  ],
  "whatIsWorking": [
    { "name": "<name>", "observation": "<specific observation with numbers from fact sheet>", "metricValue": "<the concrete metric value e.g. '91%' or '4.2 stops/route' or '$3,200 MRR' — NOT a badge label like Evidence-based>", "evidenceLabel": "<Evidence-based|Inference|Insufficient data>", "whyItMatters": "<why it matters>", "recommendation": "<Keep|Strengthen|Monitor>" }
  ],
  "whatIsNotWorking": [
    { "name": "<name>", "problem": "<specific problem with numbers>", "metricValue": "<the concrete metric value e.g. '4.2 stops/route' or '$0 MRR' — NOT a badge label>", "evidenceLabel": "<Evidence-based|Inference|Insufficient data>", "businessImpact": "<quantified impact where possible>", "likelyRootCause": "<root cause>", "recommendedCorrection": "<specific correction with concrete steps>" }
  ],
  "functionalAnalysis": {
    "routeOps": {
      "diagnosis": "<1-2 sentence direct diagnosis of route operation health>",
      "evidence": "<specific numbers from fact sheet supporting the diagnosis>",
      "businessImpact": "<what this means for revenue, margin, or owner workload>",
      "recommendedFix": "<specific operational action with timeline>"
    },
    "financial": {
      "diagnosis": "<1-2 sentence CFO-level diagnosis>",
      "evidence": "<specific revenue, margin, collection numbers>",
      "businessImpact": "<cash flow or profit impact>",
      "recommendedFix": "<specific financial action with timeline>"
    },
    "pricing": {
      "diagnosis": "<1-2 sentence pricing diagnosis>",
      "evidence": "<which service tiers are weak and why>",
      "businessImpact": "<monthly revenue impact of pricing gaps>",
      "recommendedFix": "<specific price change or structure change>"
    },
    "marketing": {
      "diagnosis": "<1-2 sentence growth engine diagnosis>",
      "evidence": "<new customers added, growth rate, channel data available>",
      "businessImpact": "<what current growth rate means for 12-month trajectory>",
      "recommendedFix": "<specific marketing action with timeline>"
    }
  },
  "ownerDecisions": [
    { "decision": "<decision name>", "whyItMatters": "<why>", "recommendedAnswer": "<specific answer>", "riskIfIgnored": "<risk>" },
    { "decision": "<decision name>", "whyItMatters": "<why>", "recommendedAnswer": "<specific answer>", "riskIfIgnored": "<risk>" },
    { "decision": "<decision name>", "whyItMatters": "<why>", "recommendedAnswer": "<specific answer>", "riskIfIgnored": "<risk>" },
    { "decision": "<decision name>", "whyItMatters": "<why>", "recommendedAnswer": "<specific answer>", "riskIfIgnored": "<risk>" },
    { "decision": "<decision name>", "whyItMatters": "<why>", "recommendedAnswer": "<specific answer>", "riskIfIgnored": "<risk>" }
  ],
  "nextThreeDecisions": [
    "<Question framing the first most critical owner decision — phrased as a question the owner must answer this week>",
    "<Question framing the second most critical owner decision>",
    "<Question framing the third most critical owner decision>"
  ],
  "actionPlan": {
    "week1": ["<specific day-level task>", "<specific day-level task>", "<specific day-level task>"],
    "week2": ["<specific operational task>", "<specific operational task>"],
    "week3week4": ["<specific operational task>", "<specific operational task>"],
    "days31to60": ["<specific action 1>", "<specific action 2>", "<specific action 3>"],
    "days61to90": ["<specific action 1>", "<specific action 2>", "<specific action 3>"]
  },
  "stopStartContinue": {
    "stop": ["<specific thing to stop — not vague>", "<specific thing to stop>", "<specific thing to stop>"],
    "start": ["<specific thing to start — not vague>", "<specific thing to start>", "<specific thing to start>"],
    "continue": ["<specific thing to continue>", "<specific thing to continue>", "<specific thing to continue>"]
  },
  "missingData": ["<data item and what decision it blocks>"],
  "finalSummary": "<5-8 sentence blunt final summary: Is this business healthy? What is the main thing holding it back? What should the owner fix first? What should the owner stop doing? What would improve the score fastest?>",
  "cfo": {
    "rating": "<Healthy|Caution|Critical>",
    "findings": ["<specific finding with exact numbers from fact sheet>"]
  },
  "coo": {
    "rating": "<Healthy|Caution|Critical>",
    "findings": ["<specific finding with exact numbers from fact sheet>"]
  },
  "recommendations": [
    {
      "priorityRank": <1-5 integer, 1 = highest>,
      "priority": "<High|Medium|Low>",
      "title": "<short specific title>",
      "explanation": "<1-2 sentences with specific numbers from fact sheet>",
      "estimatedImpact": "<computed dollar or percentage impact if calculable, otherwise 'Estimated impact unavailable — [specific missing data needed]'>",
      "difficulty": "<Low|Medium|High>",
      "timeframeDays": <integer number of days to implement>
    }
  ]
}

LANGUAGE RULES — STRICTLY ENFORCED:
- Every recommendation, fix, and action must be operational and specific. Name the exact thing to do.
- FORBIDDEN phrases (if you use these, the output is invalid): "develop a marketing strategy", "reassess pricing", "monitor customer satisfaction", "evaluate workflows", "consider implementing", "you might want to", "it may be helpful", "explore options", "look into".
- Instead use: "Raise biweekly rates from $X to $Y for all customers added after [date]", "Send a re-engagement email to the 3 customers who cancelled in the last 30 days", "Block off Tuesdays for route-dense zip code [X]".

Rules:
- healthScore must equal the sum of all scoreBreakdown scores
- Apply all scoring cap rules from the prompt above before finalizing the score
- ${hasDataQualityWarnings ? "DATA QUALITY WARNING IS ACTIVE: confidenceLevel MUST be Medium or Low. Reflect the dataQualityWarnings array in your confidenceReason." : "No data quality warnings — set confidenceLevel based on data completeness alone."}
- IMPORTANT: billedCalendarMonthToDateDollars reflects only invoices *issued* this calendar month — it is commonly $0 mid-month because operators batch invoices at month-end. The billingNote field in the fact sheet explains this. Do NOT treat billedCalendarMonthToDateDollars=0 or billedAmountChangeVsPriorMonthPct=-100 as a revenue or cash-flow problem. Use mrrDollars / scheduledMonthlyRevenueDollars (MRR from active plans) as the authoritative revenue figure for all CFO findings, revenue trend analysis, and health scoring.
- Route density assessment: use activeRouteCount, avgStopsPerRoute, and plansOnRoutePct. avgStopsPerRoute >= 8 is good density; 5-7 is moderate; <5 is low density. If plansOnRoutePct < 70%, flag that many customers are not yet assigned to routes.
- cfo findings: focus on scheduledMonthlyRevenueDollars (MRR), collection, margin — cite exact numbers from fact sheet
- coo findings: focus on churn rate (churnRatePct), new customers added (newCustomers30d), active vs paused plans, route density (avgStopsPerRoute, activeRouteCount), customer mix — cite exact numbers from fact sheet
- recommendations: max 5, ranked by priorityRank (1 = most important), cite exact numbers from the fact sheet
- NEVER invent numbers not present in the fact sheet
- whatIsWorking: 3-7 items; whatIsNotWorking: 3-7 items; ownerDecisions: exactly 5 items; nextThreeDecisions: exactly 3 items`;

        const { anthropic, CLAUDE_FAST_MODEL } = await import("../services/claude");
        const completion = await anthropic.messages.create({
          model: CLAUDE_FAST_MODEL,
          max_tokens: 6000,
          system: systemPrompt,
          messages: [{ role: "user", content: JSON.stringify(factSheet, null, 2) }],
        });

        const raw = completion.content[0]?.type === "text" ? completion.content[0].text : "{}";
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return res.status(503).json({ message: "Failed to parse AI response" });
        }

        const typedParsed = parsed as Record<string, unknown>;

        // Enforce confidence level server-side: if data quality has Warning/Missing, confidence must be Medium or Low
        if (hasDataQualityWarnings) {
          if (typedParsed.confidenceLevel === "High") {
            typedParsed.confidenceLevel = "Medium";
            typedParsed.confidenceReason =
              (typeof typedParsed.confidenceReason === "string"
                ? typedParsed.confidenceReason + " "
                : "") +
              `[Note: Confidence automatically adjusted from High to Medium due to ${dataQualityWarnings.filter((w) => w.status === "Warning" || w.status === "Missing").length} active data quality warning(s).]`;
          }
        }

        // Embed input data so the PDF generator can use it for KPI tables and data quality checks
        typedParsed._inputData = factSheet;

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
        const errObj = err as { status?: number; code?: string; message?: string };
        if (
          errObj?.status === 429 ||
          errObj?.status === 404 ||
          errObj?.status === 503 ||
          errObj?.code === "insufficient_quota" ||
          (errObj?.message &&
            (errObj.message.includes("AI service unavailable") ||
              errObj.message.includes("temporarily unavailable")))
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
    "/api/business-overview/assessment/pdf",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const recentHistory = await storage.getBusinessAssessments(companyId, 1);
        const cached = recentHistory[0];
        if (!cached || !cached.fullResult) {
          return res
            .status(404)
            .json({ error: "No assessment found. Please generate an assessment first." });
        }
        const company = await storage.getCompany(companyId);
        const companyName = company?.name || "Your Business";
        const { generateAssessmentPdf } = await import("../services/assessment-pdf");
        const pdfBuffer = await generateAssessmentPdf(cached.fullResult, companyName);
        const filename = `business-health-report-${companyName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.send(pdfBuffer);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/business-overview/assessment/pdf",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const company = await storage.getCompany(companyId);
        const companyName = company?.name || "Your Business";
        const assessmentData = req.body;
        if (!assessmentData || typeof assessmentData !== "object") {
          return res.status(400).json({ error: "Invalid assessment data." });
        }
        const { generateAssessmentPdf } = await import("../services/assessment-pdf");
        const pdfBuffer = await generateAssessmentPdf(assessmentData, companyName);
        const filename = `business-health-report-${companyName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.send(pdfBuffer);
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
          errObj.status === 503 ||
          errObj.code === "insufficient_quota" ||
          (errObj.message &&
            (errObj.message.includes("AI service unavailable") ||
              errObj.message.includes("temporarily unavailable")))
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
        depotId: string | null;
      };

      const technicianIdsForMap = [
        ...new Set(routes.map((r) => r.technicianId).filter(Boolean)),
      ] as string[];
      const techDepotMapForMap = new Map<string, string>();
      if (technicianIdsForMap.length > 0) {
        const techRows = await db
          .select({ id: users.id, defaultDepotId: users.defaultDepotId })
          .from(users)
          .where(eq(users.id, technicianIdsForMap[0]));
        for (const tech of techRows) {
          if (tech.defaultDepotId) techDepotMapForMap.set(tech.id, tech.defaultDepotId);
        }
        for (const techId of technicianIdsForMap.slice(1)) {
          const [tech] = await db
            .select({ id: users.id, defaultDepotId: users.defaultDepotId })
            .from(users)
            .where(eq(users.id, techId));
          if (tech?.defaultDepotId) techDepotMapForMap.set(tech.id, tech.defaultDepotId);
        }
      }

      const allDepotsForMap = await storage.getDepots(companyId);
      const depotMapForMap = new Map(allDepotsForMap.map((d) => [d.id, d]));

      // Analytics depot resolution: only explicit assignments (route or technician) count as a
      // named depot. Routes that would otherwise fall back to the primary depot are grouped under
      // "Company Default" (null) so the analytics table clearly separates intentionally-assigned
      // routes from those that have no explicit depot affiliation.
      const resolveRouteDepotForMap = (route: {
        depotId?: string | null;
        technicianId?: string | null;
      }): string | null => {
        if (route.depotId && depotMapForMap.has(route.depotId)) return route.depotId;
        if (route.technicianId) {
          const techDepotId = techDepotMapForMap.get(route.technicianId);
          if (techDepotId && depotMapForMap.has(techDepotId)) return techDepotId;
        }
        return null;
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
        stops.forEach((s, idx) => {
          s.stopOrder = idx + 1;
        });
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
          depotId: resolveRouteDepotForMap(route),
        });
      }

      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/profitability/depot-summary",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { calculateAllCustomerProfitability } =
          await import("../services/profitability-calculator");

        const [allProfitability, routes, allDepots, plans] = await Promise.all([
          calculateAllCustomerProfitability(companyId),
          storage.getRoutes(companyId),
          storage.getDepots(companyId),
          storage.getServicePlans(companyId, { isActive: true }),
        ]);

        const depotMap = new Map(allDepots.map((d) => [d.id, d]));

        const technicianIds = [
          ...new Set(routes.map((r) => r.technicianId).filter(Boolean)),
        ] as string[];
        const techDepotMap = new Map<string, string>();
        if (technicianIds.length > 0) {
          const techRows = await db
            .select({ id: users.id, defaultDepotId: users.defaultDepotId })
            .from(users)
            .where(eq(users.id, technicianIds[0]));
          for (const tech of techRows) {
            if (tech.defaultDepotId) techDepotMap.set(tech.id, tech.defaultDepotId);
          }
          if (technicianIds.length > 1) {
            for (const techId of technicianIds.slice(1)) {
              const [tech] = await db
                .select({ id: users.id, defaultDepotId: users.defaultDepotId })
                .from(users)
                .where(eq(users.id, techId));
              if (tech?.defaultDepotId) techDepotMap.set(tech.id, tech.defaultDepotId);
            }
          }
        }

        // Analytics depot resolution: explicit assignments only. Routes falling back to
        // primary depot are grouped under "Company Default" (null) so the By Depot table
        // clearly separates intentionally-assigned routes from unaffiliated ones.
        const resolveRouteDepotId = (route: {
          depotId?: string | null;
          technicianId?: string | null;
        }): string | null => {
          if (route.depotId && depotMap.has(route.depotId)) return route.depotId;
          if (route.technicianId) {
            const techDepotId = techDepotMap.get(route.technicianId);
            if (techDepotId && depotMap.has(techDepotId)) return techDepotId;
          }
          return null;
        };

        const routeDepotMap = new Map<string, string | null>();
        for (const route of routes) {
          routeDepotMap.set(route.id, resolveRouteDepotId(route));
        }

        const planRouteMap = new Map<string, string>();
        for (const plan of plans) {
          if (plan.routeId) planRouteMap.set(plan.id, plan.routeId);
        }

        const COMPANY_DEFAULT_KEY = "__company_default__";

        const depotAgg = new Map<
          string,
          {
            depotId: string | null;
            depotName: string;
            totalStops: number;
            totalRevenueCents: number;
            totalCostCents: number;
            totalProfitCents: number;
            totalTravelMinutes: number;
          }
        >();

        const ensureDepot = (key: string, name: string, depotId: string | null) => {
          if (!depotAgg.has(key)) {
            depotAgg.set(key, {
              depotId,
              depotName: name,
              totalStops: 0,
              totalRevenueCents: 0,
              totalCostCents: 0,
              totalProfitCents: 0,
              totalTravelMinutes: 0,
            });
          }
          return depotAgg.get(key)!;
        };

        for (const customer of allProfitability) {
          for (const prop of customer.properties) {
            const routeId = planRouteMap.get(prop.servicePlanId);
            if (!routeId) continue;
            const depotId = routeDepotMap.get(routeId);
            let key: string;
            let name: string;
            if (depotId && depotMap.has(depotId)) {
              key = depotId;
              name = depotMap.get(depotId)!.name;
            } else {
              key = COMPANY_DEFAULT_KEY;
              name = "Company Default";
            }
            const entry = ensureDepot(key, name, depotId && depotMap.has(depotId) ? depotId : null);
            entry.totalStops++;
            entry.totalRevenueCents += prop.revenuePerVisitCents;
            entry.totalCostCents += prop.costPerVisitCents;
            entry.totalProfitCents += prop.profitPerVisitCents;
            entry.totalTravelMinutes += prop.standardTravelMinutesUsed ?? 0;
          }
        }

        const result = Array.from(depotAgg.values()).map((d) => ({
          depotId: d.depotId,
          depotName: d.depotName,
          totalStops: d.totalStops,
          totalRevenueCents: d.totalRevenueCents,
          totalCostCents: d.totalCostCents,
          totalProfitCents: d.totalProfitCents,
          avgMarginPct:
            d.totalRevenueCents > 0
              ? Math.round((d.totalProfitCents / d.totalRevenueCents) * 10000) / 100
              : 0,
          avgTravelTimePerStopMinutes:
            d.totalStops > 0 ? Math.round((d.totalTravelMinutes / d.totalStops) * 10) / 10 : 0,
        }));

        result.sort((a, b) => {
          if (a.depotId === null && b.depotId !== null) return 1;
          if (a.depotId !== null && b.depotId === null) return -1;
          return a.depotName.localeCompare(b.depotName);
        });

        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

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

      // Get trailing 90-day actuals; falls back to "estimated" when no real data exists
      const actuals = await storage.getOverheadTrailingActuals(companyId);
      let {
        trailingMonthlyStops,
        trailingMonthlyRevenueCents,
        trailingMonthlyTransactions,
        trailingMonthlyMiles,
      } = actuals;
      const { dataSource } = actuals;

      // For new accounts with no activity yet, fall back to pricing config estimates
      if (dataSource === "estimated") {
        const company = await storage.getCompany(companyId);
        const pricingCfg = (company?.pricingConfig ?? {}) as Record<string, unknown>;
        trailingMonthlyStops = Number(pricingCfg.estimatedMonthlyStops ?? 100);
        const pricingRules = (pricingCfg.pricingRules ?? {}) as Record<string, unknown>;
        const basePrices = (pricingRules.basePrices ?? {}) as Record<string, number>;
        const weeklyBasePriceCents = Math.round((basePrices.weekly ?? 25) * 100);
        trailingMonthlyRevenueCents = trailingMonthlyStops * weeklyBasePriceCents;
        trailingMonthlyTransactions = Math.round(trailingMonthlyStops / 4);
      }

      // Augment trailingMonthlyMiles with geometry-based computation when routes exist.
      // The storage layer returns 0 because route distances are not persisted in the DB;
      // this block computes them on the fly from route stop coordinates.
      // trailingMonthlyMiles is already initialised from actuals above.
      const hasMileDrivers = items.some(
        (i) =>
          i.type === "variable" && (i.costDriverType === "per_mile" || i.costDriverType === "fuel")
      );
      if (hasMileDrivers) {
        try {
          const allRoutes = await storage.getRoutes(companyId);
          if (allRoutes.length > 0) {
            const [allPlans, allProperties, company] = await Promise.all([
              storage.getServicePlans(companyId, { isActive: true }),
              storage.getProperties(companyId),
              storage.getCompany(companyId),
            ]);
            const propMap = new Map(allProperties.map((pr) => [pr.id, pr]));
            const startPoint =
              company?.startLatitude && company?.startLongitude
                ? {
                    latitude: Number(company.startLatitude),
                    longitude: Number(company.startLongitude),
                  }
                : undefined;
            let weeklyMiles = 0;
            for (const route of allRoutes) {
              const routePlans = (
                allPlans as { routeId: string; stopOrder: number; propertyId: string; id: string }[]
              )
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
              const metrics = await getRouteMetricsWithLegs(stops, startPoint);
              weeklyMiles += metrics
                ? metrics.totalDistance
                : calculateTotalDistance(stops, startPoint);
            }
            trailingMonthlyMiles = Math.round(weeklyMiles * 4.33 * 10) / 10;
          }
        } catch {
          // Miles computation is best-effort; fall through to estimate below
        }
      }

      // Fallback: when no route distance data is available, estimate from stop count.
      // 5 mi/stop is a reasonable default for local pet-waste routes.
      if (trailingMonthlyMiles === 0 && hasMileDrivers) {
        trailingMonthlyMiles = Math.round(trailingMonthlyStops * 5);
      }

      // First pass: compute all non-pct_expense variable items
      const firstPassMap = new Map<string, number>();
      for (const item of items) {
        if (
          item.type === "variable" &&
          item.costDriverType &&
          item.costDriverType !== "pct_expense"
        ) {
          const rate = Number(item.driverRate ?? 0);
          const params = item.driverParams as Record<string, unknown> | null;
          let computedCents = item.monthlyCostCents;
          switch (item.costDriverType) {
            case "pct_revenue":
              computedCents = Math.round((rate / 100) * trailingMonthlyRevenueCents);
              break;
            case "per_stop":
              computedCents = Math.round(rate * trailingMonthlyStops * 100);
              break;
            case "per_mile":
              computedCents = Math.round(rate * trailingMonthlyMiles * 100);
              break;
            case "fuel": {
              const mpg = Number(params?.mpg ?? 18);
              const gasPrice = Number(params?.gasPricePerGallon ?? 4.0);
              computedCents =
                mpg > 0 ? Math.round((trailingMonthlyMiles / mpg) * gasPrice * 100) : 0;
              break;
            }
            case "payment_processing": {
              const ratePct = Number(params?.ratePct ?? 2.9);
              const flatFeeCents = Number(params?.flatFeeCents ?? 30);
              computedCents =
                Math.round((trailingMonthlyRevenueCents * ratePct) / 100) +
                Math.round(flatFeeCents * trailingMonthlyTransactions);
              break;
            }
            case "per_unit": {
              const qty = Number(params?.quantityPerMonth ?? 1);
              computedCents = Math.round(rate * qty * 100);
              break;
            }
            case "manual":
              computedCents = item.monthlyCostCents;
              break;
          }
          firstPassMap.set(item.id, computedCents);
        } else {
          firstPassMap.set(item.id, item.monthlyCostCents);
        }
      }

      // Second pass: resolve pct_expense items (reference must be in firstPassMap)
      const enrichedItems = items.map((item) => {
        if (item.type !== "variable" || !item.costDriverType) return item;
        if (item.costDriverType === "pct_expense") {
          const rate = Number(item.driverRate ?? 0);
          const params = item.driverParams as Record<string, unknown> | null;
          const refId = params?.referenceItemId as string | undefined;
          const refCents = refId ? (firstPassMap.get(refId) ?? 0) : 0;
          return { ...item, monthlyCostCents: Math.round((rate / 100) * refCents) };
        }
        const computed = firstPassMap.get(item.id);
        return computed !== undefined ? { ...item, monthlyCostCents: computed } : item;
      });

      const totalMonthlyOverheadCents = enrichedItems.reduce(
        (sum, i) => sum + i.monthlyCostCents,
        0
      );
      res.json({
        items: enrichedItems,
        totalMonthlyOverheadCents,
        trailingMonthlyStops,
        trailingMonthlyRevenueCents,
        trailingMonthlyMiles,
        trailingMonthlyTransactions,
        dataSource,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/overhead-costs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const {
        category,
        name,
        monthlyCostCents,
        type,
        sortOrder,
        costDriverType,
        driverRate,
        driverParams,
      } = req.body;
      if (!category || typeof category !== "string" || !name || typeof name !== "string") {
        return res.status(400).json({ error: "category and name are required strings" });
      }
      const costCents =
        typeof monthlyCostCents === "number" && monthlyCostCents >= 0
          ? Math.round(monthlyCostCents)
          : 0;
      const validType = type === "variable" ? "variable" : "fixed";
      const VALID_DRIVER_TYPES = [
        "pct_revenue",
        "per_stop",
        "per_mile",
        "fuel",
        "payment_processing",
        "pct_expense",
        "per_unit",
        "manual",
      ];
      const parsedDriverType = VALID_DRIVER_TYPES.includes(costDriverType) ? costDriverType : null;
      const parsedDriverRate =
        typeof driverRate === "number" && driverRate > 0 ? String(driverRate) : null;
      const parsedDriverParams =
        driverParams && typeof driverParams === "object" && !Array.isArray(driverParams)
          ? (driverParams as Record<string, unknown>)
          : null;
      const item = await storage.createOverheadCost({
        companyId,
        category: category.trim(),
        name: name.trim(),
        monthlyCostCents: costCents,
        type: validType,
        isDefault: false,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        costDriverType: parsedDriverType,
        driverRate: parsedDriverRate,
        driverParams: parsedDriverParams,
        variableRatePct: null,
        variableFlatCents: null,
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
      // Driver fields — allow explicit null to clear the cost driver
      if ("costDriverType" in req.body) {
        const VALID_DRIVER_TYPES = [
          "pct_revenue",
          "per_stop",
          "per_mile",
          "fuel",
          "payment_processing",
          "pct_expense",
          "per_unit",
          "manual",
        ];
        updates.costDriverType = VALID_DRIVER_TYPES.includes(req.body.costDriverType)
          ? req.body.costDriverType
          : null;
        // Always null legacy columns when touching driver fields
        updates.variableRatePct = null;
        updates.variableFlatCents = null;
      }
      if ("driverRate" in req.body) {
        updates.driverRate =
          typeof req.body.driverRate === "number" && req.body.driverRate > 0
            ? String(req.body.driverRate)
            : null;
      }
      if ("driverParams" in req.body) {
        updates.driverParams =
          req.body.driverParams &&
          typeof req.body.driverParams === "object" &&
          !Array.isArray(req.body.driverParams)
            ? (req.body.driverParams as Record<string, unknown>)
            : null;
      }
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
          costDriverType?: string;
          driverRate?: number;
          driverParams?: Record<string, unknown>;
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
            costDriverType: "payment_processing",
            driverParams: { ratePct: 2.9, flatFeeCents: 30 },
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
          // Marketing items — flipped to fixed (budget items that don't vary per-stop/revenue)
          { category: "Marketing", name: "Google Ads", type: "fixed", sortOrder: 0 },
          { category: "Marketing", name: "Facebook/Instagram ads", type: "fixed", sortOrder: 1 },
          { category: "Marketing", name: "Yard signs", type: "fixed", sortOrder: 2 },
          { category: "Marketing", name: "Flyers/door hangers", type: "fixed", sortOrder: 3 },
          { category: "Marketing", name: "Vehicle magnets or wraps", type: "fixed", sortOrder: 4 },
          { category: "Marketing", name: "Referral rewards", type: "variable", sortOrder: 5 },
          {
            category: "Marketing",
            name: "Print materials and business cards",
            type: "variable",
            sortOrder: 6,
          },
          {
            category: "Vehicles + Transportation",
            name: "Fuel",
            type: "variable",
            sortOrder: 0,
            costDriverType: "fuel",
            driverParams: { mpg: 18, gasPricePerGallon: 4.0 },
          },
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
            costDriverType: "per_mile",
            driverRate: 0.2,
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
          // Payroll taxes — pct_expense driver assigned in second pass after insert
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
          // "Merchant service fees" removed — replaced by "Payment processing fees" above
          {
            category: "Financial Overhead",
            name: "Bad debt/unpaid invoices",
            type: "variable",
            sortOrder: 1,
            costDriverType: "pct_revenue",
            driverRate: 2,
          },
          {
            category: "Financial Overhead",
            name: "Refunds or service credits",
            type: "variable",
            sortOrder: 2,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            costDriverType: (item.costDriverType as any) ?? null,
            driverRate: item.driverRate != null ? String(item.driverRate) : null,
            driverParams: item.driverParams ?? null,
            variableRatePct: null,
            variableFlatCents: null,
          });
        }

        // Second pass: wire Payroll taxes → Employee wages as pct_expense (7.65% FICA)
        const seededItems = await storage.getOverheadCosts(companyId);
        const wagesItem = seededItems.find(
          (i) => i.name === "Employee wages" && i.category === "Labor"
        );
        const payrollItem = seededItems.find(
          (i) => i.name === "Payroll taxes" && i.category === "Labor"
        );
        if (wagesItem && payrollItem) {
          await storage.updateOverheadCost(payrollItem.id, companyId, {
            costDriverType: "pct_expense",
            driverRate: "7.65",
            driverParams: { referenceItemId: wagesItem.id },
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

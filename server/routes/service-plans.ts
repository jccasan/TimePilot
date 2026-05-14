import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, gte } from "drizzle-orm";
import { visits, servicePlans } from "@shared/schema";
import { cheapestInsertionIndex } from "../services/route-optimizer";
import { z } from "zod";
import { createStripeCustomer } from "../services/stripe";
import {
  insertServicePlanSchema,
  insertVacationHoldSchema,
  type InsertJob,
  type InsertAgreement,
} from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  requireApiKeyScope,
  getBaseUrl,
  handleError,
  sanitizeDecimal,
  auditLog,
  p,
  clearRouteOptimizationState,
  provisionPortalAccess,
  validateAndResolveAddOns,
} from "./shared";

export async function registerServicePlansRoutes(app: Express): Promise<void> {
  // ================ Service Plan Routes ================

  app.get("/api/service-plans", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const hasFilters =
        req.query.contactId || req.query.propertyId || req.query.isActive !== undefined;
      const enriched = req.query.enriched === "true" || !hasFilters;

      const filters: { contactId?: string; propertyId?: string; isActive?: boolean } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.propertyId) filters.propertyId = req.query.propertyId as string;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";

      const plans = await storage.getServicePlans(companyId, hasFilters ? filters : undefined);

      if (enriched && !hasFilters) {
        const allContacts = await storage.getContacts(companyId);
        const allProperties = await storage.getProperties(companyId);
        const allRoutes = await storage.getRoutes(companyId);

        const contactMap = new Map(allContacts.map((c) => [c.id, c]));
        const propertyMap = new Map(allProperties.map((p) => [p.id, p]));
        const routeMap = new Map(allRoutes.map((r) => [r.id, r]));

        const enrichedPlans = await Promise.all(
          plans.map(async (plan) => {
            const addOns = await storage.getServicePlanAddOns(plan.id);
            const contact = contactMap.get(plan.contactId);
            const property = propertyMap.get(plan.propertyId);
            const route = plan.routeId ? routeMap.get(plan.routeId) : null;
            return {
              ...plan,
              addOns,
              contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown",
              propertyAddress: property
                ? `${property.streetAddress || ""}${property.city ? `, ${property.city}` : ""}`.trim()
                : "Unknown",
              routeName: route?.name || null,
            };
          })
        );
        res.json(enrichedPlans);
      } else {
        const plansWithAddOns = await Promise.all(
          plans.map(async (plan) => {
            const addOns = await storage.getServicePlanAddOns(plan.id);
            return { ...plan, addOns };
          })
        );
        res.json(plansWithAddOns);
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/service-plans/bulk", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const bulkSchema = z.object({
        ids: z.array(z.string().uuid()).min(1, "ids must be a non-empty array of UUIDs"),
        updates: z
          .object({
            priceAdjustment: z
              .object({
                type: z.enum(["flat", "percentage"]),
                amount: z.number().finite(),
              })
              .optional(),
            dayOfWeek: z
              .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
              .optional(),
            isActive: z.boolean().optional(),
            routeId: z.string().nullable().optional(),
          })
          .strict(),
      });

      const parsed = bulkSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors.map((e) => e.message).join("; ") });
      }
      const { ids, updates } = parsed.data;

      if (updates.routeId && updates.routeId !== "") {
        const companyRoutes = await storage.getRoutes(companyId);
        const routeExists = companyRoutes.some((r) => r.id === updates.routeId);
        if (!routeExists) {
          return res
            .status(400)
            .json({ error: "Route not found or does not belong to your company" });
        }
      }

      const allPlans = await storage.getServicePlans(companyId);
      const planMap = new Map(allPlans.map((p) => [p.id, p]));
      const activePlans = allPlans.filter((p) => p.isActive);

      let dayRoutes: Awaited<ReturnType<typeof storage.getRoutes>> | null = null;
      if (updates.dayOfWeek && !updates.routeId) {
        dayRoutes = await storage.getRoutes(companyId, updates.dayOfWeek);
      }

      const results: typeof allPlans = [];
      for (const planId of ids) {
        const existing = planMap.get(planId);
        if (!existing) continue;

        const safeUpdates: Partial<{
          pricePerVisit: string;
          isActive: boolean;
          pausedAt: Date | null;
          routeId: string | null;
          dayOfWeek:
            | "monday"
            | "tuesday"
            | "wednesday"
            | "thursday"
            | "friday"
            | "saturday"
            | "sunday"
            | "tbd"
            | null;
        }> = {};

        if (updates.priceAdjustment) {
          const currentPrice = parseFloat(existing.pricePerVisit);
          if (updates.priceAdjustment.type === "flat") {
            safeUpdates.pricePerVisit = Math.max(
              0,
              currentPrice + updates.priceAdjustment.amount
            ).toFixed(2);
          } else {
            safeUpdates.pricePerVisit = Math.max(
              0,
              currentPrice * (1 + updates.priceAdjustment.amount / 100)
            ).toFixed(2);
          }
        }

        if (updates.isActive !== undefined) {
          safeUpdates.isActive = updates.isActive;
          safeUpdates.pausedAt = updates.isActive ? null : new Date();
        }

        if (updates.routeId !== undefined) {
          safeUpdates.routeId = updates.routeId === "" ? null : updates.routeId;
        }

        if (updates.dayOfWeek) {
          safeUpdates.dayOfWeek = updates.dayOfWeek as
            | "monday"
            | "tuesday"
            | "wednesday"
            | "thursday"
            | "friday"
            | "saturday"
            | "sunday"
            | "tbd";
          if (updates.dayOfWeek !== existing.dayOfWeek && !updates.routeId) {
            if (dayRoutes && dayRoutes.length > 0) {
              let bestRoute = dayRoutes[0];
              let bestCount = Infinity;
              for (const route of dayRoutes) {
                const stopCount = activePlans.filter(
                  (sp) => sp.routeId === route.id && sp.id !== planId
                ).length;
                if (stopCount < bestCount) {
                  bestCount = stopCount;
                  bestRoute = route;
                }
              }
              safeUpdates.routeId = bestRoute.id;
            } else {
              safeUpdates.routeId = null;
            }
          }
        }

        if (Object.keys(safeUpdates).length === 0) continue;
        const plan = await storage.updateServicePlan(planId, companyId, safeUpdates);
        if (plan) results.push(plan);

        const bulkRouteIdChanged =
          safeUpdates.routeId !== undefined && safeUpdates.routeId !== existing.routeId;
        const bulkDayChanged =
          safeUpdates.dayOfWeek !== undefined && safeUpdates.dayOfWeek !== existing.dayOfWeek;
        const bulkDeactivated = safeUpdates.isActive === false && existing.isActive === true;
        if (bulkRouteIdChanged || bulkDayChanged || bulkDeactivated) {
          const bulkRoutesToClear = new Set<string>();
          if (existing.routeId) bulkRoutesToClear.add(existing.routeId);
          if (safeUpdates.routeId) bulkRoutesToClear.add(safeUpdates.routeId);
          for (const rId of Array.from(bulkRoutesToClear)) {
            clearRouteOptimizationState(rId, companyId).catch(console.error);
          }
        }
      }

      const affectedRouteIds = new Set<string>();
      for (const planId of ids) {
        const existing = planMap.get(planId);
        if (!existing) continue;
        const result = results.find((r) => r.id === planId);
        if (!result) continue;
        if (result.routeId !== existing.routeId) {
          if (result.routeId) affectedRouteIds.add(result.routeId);
          if (existing.routeId) affectedRouteIds.add(existing.routeId);
        }
      }
      for (const rId of Array.from(affectedRouteIds)) {
        storage.renumberRouteStops(rId, companyId).catch(console.error);
      }

      res.json({ updated: results.length, results });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const plan = await storage.getServicePlan(p(req.params.id), companyId);
      if (!plan) return res.status(404).json({ error: "Scheduled service not found" });
      const addOns = await storage.getServicePlanAddOns(plan.id);
      res.json({ ...plan, addOns });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/service-plans", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      if (req._apiKeyAuth) requireApiKeyScope(req, "crm:write");
      const body = { ...req.body, companyId };
      if (!body.routeId || body.routeId === "") body.routeId = null;
      const parsed = insertServicePlanSchema.parse(body);

      const plan = await storage.createServicePlan(parsed);

      if (plan.routeId) {
        clearRouteOptimizationState(plan.routeId, companyId).catch(console.error);
        storage.renumberRouteStops(plan.routeId, companyId).catch(console.error);
      }

      const { userId } = await getCompanyContext(req);
      auditLog(
        companyId,
        userId,
        "service_plan",
        plan.id,
        "create",
        {
          new: {
            contactId: parsed.contactId,
            frequency: parsed.frequency,
            dayOfWeek: parsed.dayOfWeek,
          },
        },
        req.ip || undefined
      );

      const contact = await storage.getContact(parsed.contactId, companyId);
      if (contact && (contact.status === "lead" || contact.status === "estimate")) {
        await storage.updateContact(parsed.contactId, companyId, { status: "active" });
        if (contact.email && !contact.hasPortalAccess) {
          provisionPortalAccess(parsed.contactId, companyId, getBaseUrl(req)).catch((err) =>
            console.error(
              "[auto-portal] Failed to provision portal access on service plan creation:",
              err
            )
          );
        }
      }

      if (contact && !contact.stripeCustomerId && contact.email) {
        (async () => {
          try {
            const co = await storage.getCompany(companyId);
            const acct = co?.stripeConnectOnboarded ? co.stripeConnectAccountId : null;
            const stripeCustomerId = await createStripeCustomer({
              email: contact.email!,
              name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.email!,
              metadata: { scoopilotContactId: contact.id, companyId },
              stripeAccount: acct,
            });
            await storage.updateContact(parsed.contactId, companyId, { stripeCustomerId });
          } catch (err) {
            console.error("[auto-stripe] Failed to auto-create Stripe customer:", err);
          }
        })();
      }

      let planAddOns: unknown[] = [];
      if (req.body.addOns && Array.isArray(req.body.addOns)) {
        const validatedAddOns = await validateAndResolveAddOns(req.body.addOns, companyId);
        planAddOns = await storage.setServicePlanAddOns(plan.id, validatedAddOns);
      }

      try {
        const { generateVisitsForPlans } = await import("../jobs/auto-visits");
        const today = new Date();
        const planStart = plan.startDate ? new Date(plan.startDate + "T00:00:00") : today;
        const anchor = planStart > today ? planStart : today;
        const sixMonthsOut = new Date(anchor);
        sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
        // Use planStart (not anchor) so one-time or past-dated plans still get their visits.
        await generateVisitsForPlans(
          companyId,
          [plan.id],
          planStart.toISOString().split("T")[0],
          sixMonthsOut.toISOString().split("T")[0]
        );
      } catch (genErr) {
        console.error("[service-plan] Failed to auto-generate visits:", genErr);
      }

      res.status(201).json({ ...plan, addOns: planAddOns });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/service-plans/bulk", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);

      const DAY_OF_WEEK_VALUES = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "tbd",
      ] as const;
      type DayOfWeekValue = (typeof DAY_OF_WEEK_VALUES)[number];

      const bulkSchema = z.object({
        items: z.array(
          z.object({
            contactId: z.string(),
            propertyId: z.string(),
            frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]),
            dayOfWeek: z.enum(DAY_OF_WEEK_VALUES).optional().nullable(),
            startDate: z.string(),
            pricePerVisit: z.string(),
          })
        ),
        autoAssign: z.boolean().optional().default(false),
      });

      const { items, autoAssign } = bulkSchema.parse(req.body);

      const allProperties = await storage.getProperties(companyId);
      const propertyById = new Map(allProperties.map((p) => [p.id, p]));

      const createdPlans: {
        planId: string;
        contactId: string;
        propertyId: string;
        dayOfWeek: DayOfWeekValue | null;
      }[] = [];
      const failures: { contactId: string; reason: string }[] = [];

      for (const item of items) {
        try {
          const contact = await storage.getContact(item.contactId, companyId);
          if (!contact) {
            failures.push({
              contactId: item.contactId,
              reason: "Contact not found or access denied",
            });
            continue;
          }
          const property = propertyById.get(item.propertyId);
          if (
            !property ||
            property.companyId !== companyId ||
            property.contactId !== item.contactId
          ) {
            failures.push({
              contactId: item.contactId,
              reason: "Property not found or does not belong to this contact",
            });
            continue;
          }

          const plan = await storage.createServicePlan({
            companyId,
            contactId: item.contactId,
            propertyId: item.propertyId,
            frequency: item.frequency,
            dayOfWeek: item.dayOfWeek ?? null,
            pricePerVisit: item.pricePerVisit,
            startDate: item.startDate,
            isActive: true,
          });
          createdPlans.push({
            planId: plan.id,
            contactId: item.contactId,
            propertyId: item.propertyId,
            dayOfWeek: item.dayOfWeek ?? null,
          });

          if (contact.status === "lead" || contact.status === "estimate") {
            await storage.updateContact(item.contactId, companyId, { status: "active" });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push({ contactId: item.contactId, reason: msg });
        }
      }

      const createdPlanIds = createdPlans.map((p) => p.planId);

      let visitsCreated = 0;
      if (createdPlanIds.length > 0) {
        try {
          const { generateVisitsForPlans } = await import("../jobs/auto-visits");
          const today = new Date();
          const sixMonthsOut = new Date(today);
          sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
          visitsCreated = await generateVisitsForPlans(
            companyId,
            createdPlanIds,
            today.toISOString().split("T")[0],
            sixMonthsOut.toISOString().split("T")[0]
          );
        } catch (genErr) {
          console.error("[bulk-service-plans] Failed to generate visits:", genErr);
        }
      }

      let stopsAssigned = 0;
      let routesCreated = 0;
      const routeSummary: {
        day: string;
        routeName: string;
        stopsPlaced: number;
        overDuration?: boolean;
      }[] = [];

      if (autoAssign && createdPlans.length > 0) {
        const { assignNewStopsToRoutes } = await import("../services/weekly-optimizer");
        const company = await storage.getCompany(companyId);

        const allExistingPlans = await storage.getServicePlans(companyId);
        const existingPlansByRoute = new Map<string, number>();
        const existingPlanCoordsByRoute = new Map<string, { lat: number; lng: number }[]>();
        for (const ep of allExistingPlans) {
          if (!ep.routeId) continue;
          existingPlansByRoute.set(ep.routeId, (existingPlansByRoute.get(ep.routeId) || 0) + 1);
          if (ep.propertyId) {
            const prop = propertyById.get(ep.propertyId);
            if (prop?.latitude && prop?.longitude) {
              if (!existingPlanCoordsByRoute.has(ep.routeId))
                existingPlanCoordsByRoute.set(ep.routeId, []);
              existingPlanCoordsByRoute
                .get(ep.routeId)!
                .push({ lat: Number(prop.latitude), lng: Number(prop.longitude) });
            }
          }
        }

        const daysNeeded = [
          ...new Set(createdPlans.filter((p) => p.dayOfWeek).map((p) => p.dayOfWeek!)),
        ];
        const existingRouteInfos = [];
        for (const day of daysNeeded) {
          const dayRoutes = (await storage.getRoutes(companyId, day)).filter((r) => !r.date);
          for (const r of dayRoutes) {
            existingRouteInfos.push({
              id: r.id,
              name: r.name,
              dayOfWeek: day,
              stopCount: existingPlansByRoute.get(r.id) || 0,
              stopCoords: existingPlanCoordsByRoute.get(r.id) || [],
            });
          }
        }

        const newStops = createdPlans
          .filter((cp) => cp.dayOfWeek)
          .map((cp) => {
            const prop = propertyById.get(cp.propertyId);
            return {
              planId: cp.planId,
              propertyId: cp.propertyId,
              dayOfWeek: cp.dayOfWeek!,
              lat: prop?.latitude ? Number(prop.latitude) : null,
              lng: prop?.longitude ? Number(prop.longitude) : null,
            };
          });

        const co = company as Record<string, unknown>;
        const { assignments, newRoutes } = await assignNewStopsToRoutes(
          newStops,
          existingRouteInfos,
          async (name, day) => {
            const created = await storage.createRoute({
              companyId,
              name,
              dayOfWeek: day as DayOfWeekValue,
            });
            return { id: created.id, name: created.name };
          },
          company?.maxStopsPerRoute ?? undefined,
          {
            maxRouteDurationHours:
              typeof co.maxRouteDurationHours === "number" && co.maxRouteDurationHours > 0
                ? co.maxRouteDurationHours
                : undefined,
            avgMinutesPerStop:
              typeof co.avgMinutesPerStop === "number" && co.avgMinutesPerStop > 0
                ? co.avgMinutesPerStop
                : 12,
          }
        );

        routesCreated = newRoutes.length;

        // Collect route IDs that exceed the configured duration budget.
        const overDurationRouteIds = new Set<string>();

        for (const assignment of assignments) {
          await storage.updateServicePlan(assignment.planId, companyId, {
            routeId: assignment.routeId,
          });
          stopsAssigned++;
          if (assignment.overDuration) {
            overDurationRouteIds.add(assignment.routeId);
          }
          const existing = routeSummary.find(
            (r) => r.day === assignment.day && r.routeName === assignment.routeName
          );
          if (existing) {
            existing.stopsPlaced++;
            if (assignment.overDuration) existing.overDuration = true;
          } else {
            routeSummary.push({
              day: assignment.day,
              routeName: assignment.routeName,
              stopsPlaced: 1,
              overDuration: assignment.overDuration ?? false,
            });
          }
        }
      }

      const overDurationRoutes = routeSummary.filter((r) => r.overDuration);

      res.json({
        created: createdPlans.length,
        failures,
        visitsCreated,
        stopsAssigned,
        routesCreated,
        routeSummary,
        overDurationRoutes,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getServicePlan(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Scheduled service not found" });
      const validFrequencies = ["weekly", "biweekly", "monthly", "onetime"];
      if (req.body.frequency && !validFrequencies.includes(req.body.frequency)) {
        return res
          .status(400)
          .json({ error: `Invalid frequency. Must be one of: ${validFrequencies.join(", ")}` });
      }
      const validDays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];
      if (req.body.dayOfWeek && !validDays.includes(req.body.dayOfWeek)) {
        return res
          .status(400)
          .json({ error: `Invalid dayOfWeek. Must be one of: ${validDays.join(", ")}` });
      }

      const allowedFields = [
        "frequency",
        "dayOfWeek",
        "pricePerVisit",
        "isActive",
        "startDate",
        "endDate",
        "routeId",
        "stopOrder",
        "serviceName",
        "jobType",
        "jobStatus",
        "startTime",
        "endTime",
        "anytime",
        "endsAfterCount",
        "endsAfterUnit",
        "visitInstructions",
        "assignedUserId",
        "isStopOnly",
        "pausedAt",
        "discount",
      ];
      const body: Record<string, unknown> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) body[key] = req.body[key];
      }
      if (body.routeId === "") body.routeId = null;
      if (body.pricePerVisit !== undefined)
        body.pricePerVisit = sanitizeDecimal(body.pricePerVisit);
      // pausedAt is a timestamp column — Drizzle requires a Date object, not a string.
      if (body.pausedAt !== undefined && body.pausedAt !== null) {
        const d = new Date(body.pausedAt as string);
        body.pausedAt = isNaN(d.getTime()) ? null : d;
      }

      const dayChanged = body.dayOfWeek && body.dayOfWeek !== existing.dayOfWeek;
      if (dayChanged && !body.routeId) {
        const dayRoutes = await storage.getRoutes(companyId, body.dayOfWeek as string | undefined);
        if (dayRoutes.length > 0) {
          const allPlans = await storage.getServicePlans(companyId, { isActive: true });
          let bestRoute = dayRoutes[0];
          let bestCount = Infinity;
          for (const route of dayRoutes) {
            const stopCount = allPlans.filter(
              (sp) => sp.routeId === route.id && sp.id !== p(req.params.id)
            ).length;
            if (stopCount < bestCount) {
              bestCount = stopCount;
              bestRoute = route;
            }
          }
          body.routeId = bestRoute.id;
        }
      }

      if (body.routeId === null && existing.routeId && body.stopOrder === undefined) {
        body.stopOrder = 0;
      }
      if (body.routeId && body.routeId !== existing.routeId && body.stopOrder === undefined) {
        const routeStops = await storage.getServicePlans(companyId, {
          routeId: (body.routeId as string | null | undefined) ?? undefined,
          isActive: true,
        });

        let insertionOrder: number | null = null;

        if (routeStops.length >= 2 && existing.propertyId) {
          const allProperties = await storage.getProperties(companyId);
          const propertyMap = new Map(allProperties.map((pr) => [pr.id, pr]));
          const newProp = propertyMap.get(existing.propertyId);

          if (newProp?.latitude && newProp?.longitude) {
            const newLat = parseFloat(String(newProp.latitude));
            const newLon = parseFloat(String(newProp.longitude));

            if (!isNaN(newLat) && !isNaN(newLon)) {
              const sorted = [...routeStops].sort(
                (a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0)
              );

              // Build a list of stops that have valid coordinates, tracking their
              // position in `sorted` so the insertion index maps back correctly even
              // when some stops are missing geocoding data.
              const stopsWithCoords: {
                latitude: number;
                longitude: number;
                sortedIndex: number;
              }[] = [];
              for (let i = 0; i < sorted.length; i++) {
                const s = sorted[i];
                if (!s.propertyId) continue;
                const pr = propertyMap.get(s.propertyId);
                if (!pr?.latitude || !pr?.longitude) continue;
                const lat = parseFloat(String(pr.latitude));
                const lon = parseFloat(String(pr.longitude));
                if (isNaN(lat) || isNaN(lon)) continue;
                stopsWithCoords.push({ latitude: lat, longitude: lon, sortedIndex: i });
              }

              if (stopsWithCoords.length >= 2) {
                const insertIdx = cheapestInsertionIndex(
                  stopsWithCoords.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
                  { latitude: newLat, longitude: newLon }
                );

                if (insertIdx < stopsWithCoords.length) {
                  // Insert before the stop at stopsWithCoords[insertIdx].
                  // Use that stop's actual stopOrder as the threshold so gaps in
                  // numbering from prior operations are respected.
                  const targetSortedIndex = stopsWithCoords[insertIdx].sortedIndex;
                  const thresholdOrder =
                    sorted[targetSortedIndex].stopOrder ?? targetSortedIndex + 1;
                  await db
                    .update(servicePlans)
                    .set({ stopOrder: sql`${servicePlans.stopOrder} + 1` })
                    .where(
                      and(
                        eq(servicePlans.routeId, body.routeId as string),
                        eq(servicePlans.companyId, companyId),
                        gte(servicePlans.stopOrder, thresholdOrder),
                        eq(servicePlans.isActive, true)
                      )
                    );
                  insertionOrder = thresholdOrder;
                } else {
                  // cheapestInsertionIndex chose the tail — append after the last stop
                  const maxOrder = sorted.reduce((m, s) => Math.max(m, s.stopOrder ?? 0), 0);
                  insertionOrder = maxOrder + 1;
                }
              }
            }
          }
        }

        if (insertionOrder !== null) {
          body.stopOrder = insertionOrder;
        } else {
          // Fallback: route has <2 stops, no coordinates, or property unknown — append
          const maxOrder = routeStops.reduce((m, s) => Math.max(m, s.stopOrder ?? 0), 0);
          body.stopOrder = maxOrder + 1;
        }
      }

      if (body.routeId && !body.dayOfWeek) {
        const targetRoute = await storage.getRoute(body.routeId as string, companyId);
        if (targetRoute) {
          body.dayOfWeek = targetRoute.dayOfWeek;
        }
      }

      const { addOns: addOnsData } = req.body;
      const updateBody = body as Partial<import("@shared/schema").InsertServicePlan>;
      const plan = await storage.updateServicePlan(p(req.params.id), companyId, updateBody);
      const { userId } = await getCompanyContext(req);
      auditLog(
        companyId,
        userId,
        "service_plan",
        p(req.params.id),
        "update",
        {
          old: {
            frequency: existing.frequency,
            dayOfWeek: existing.dayOfWeek,
            routeId: existing.routeId,
          },
          new: updateBody,
        },
        req.ip || undefined
      );

      // Propagate changes to the linked jobs and agreements rows so GET /api/jobs
      // (which reads from those tables via INNER JOIN) reflects the edit immediately.
      const linkedJobForSync = await storage.getJobByServicePlanId(p(req.params.id));
      if (linkedJobForSync) {
        const jobSync: Partial<InsertJob> = {};
        if (updateBody.serviceName !== undefined) jobSync.serviceName = updateBody.serviceName;
        if (updateBody.jobType !== undefined) jobSync.jobType = updateBody.jobType;
        if (updateBody.jobStatus !== undefined) jobSync.jobStatus = updateBody.jobStatus;
        if (updateBody.dayOfWeek !== undefined) jobSync.dayOfWeek = updateBody.dayOfWeek;
        if (updateBody.routeId !== undefined) jobSync.routeId = updateBody.routeId;
        if (updateBody.anytime !== undefined) jobSync.anytime = updateBody.anytime;
        if (updateBody.startTime !== undefined) jobSync.startTime = updateBody.startTime;
        if (updateBody.endTime !== undefined) jobSync.endTime = updateBody.endTime;
        if (updateBody.visitInstructions !== undefined)
          jobSync.visitInstructions = updateBody.visitInstructions;
        if (updateBody.assignedUserId !== undefined)
          jobSync.assignedUserId = updateBody.assignedUserId;
        if (updateBody.stopOrder !== undefined) jobSync.stopOrder = updateBody.stopOrder;
        if (updateBody.isStopOnly !== undefined) jobSync.isStopOnly = updateBody.isStopOnly;
        if (Object.keys(jobSync).length > 0) {
          await storage.updateJob(linkedJobForSync.id, companyId, jobSync);
        }
        if (linkedJobForSync.agreementId) {
          const agreementSync: Partial<InsertAgreement> = {};
          if (updateBody.frequency !== undefined) agreementSync.frequency = updateBody.frequency;
          if (updateBody.pricePerVisit !== undefined)
            agreementSync.pricePerVisit = updateBody.pricePerVisit;
          if (updateBody.startDate !== undefined) agreementSync.startDate = updateBody.startDate;
          if (updateBody.endDate !== undefined) agreementSync.endDate = updateBody.endDate;
          if (updateBody.endsAfterCount !== undefined)
            agreementSync.endsAfterCount = updateBody.endsAfterCount;
          if (updateBody.endsAfterUnit !== undefined)
            agreementSync.endsAfterUnit = updateBody.endsAfterUnit;
          if (updateBody.isActive !== undefined) agreementSync.isActive = updateBody.isActive;
          if (updateBody.pausedAt !== undefined) agreementSync.pausedAt = updateBody.pausedAt;
          if (Object.keys(agreementSync).length > 0) {
            await storage.updateAgreement(linkedJobForSync.agreementId, companyId, agreementSync);
          }
        }
      }

      const routeIdChanged = body.routeId !== undefined && body.routeId !== existing.routeId;
      const dayChanged2 = body.dayOfWeek !== undefined && body.dayOfWeek !== existing.dayOfWeek;
      const deactivated = body.isActive === false && existing.isActive === true;
      if (routeIdChanged || dayChanged2 || deactivated) {
        const routesToClear = new Set<string>();
        if (existing.routeId) routesToClear.add(existing.routeId);
        if (body.routeId && body.routeId !== existing.routeId)
          routesToClear.add(body.routeId as string);
        for (const rId of Array.from(routesToClear)) {
          clearRouteOptimizationState(rId, companyId).catch(console.error);
        }
      }

      if (routeIdChanged || deactivated) {
        const routesToRenumber = new Set<string>();
        if (existing.routeId) routesToRenumber.add(existing.routeId);
        if (body.routeId && body.routeId !== existing.routeId)
          routesToRenumber.add(body.routeId as string);
        for (const rId of Array.from(routesToRenumber)) {
          await storage.renumberRouteStops(rId, companyId);
        }
      }

      if (body.isActive === false && existing.isActive === true) {
        const today = new Date().toISOString().split("T")[0];
        const cancelledCount = await storage.cancelFutureVisitsForPlans([p(req.params.id)], today);
        if (cancelledCount > 0) {
          console.log(
            `[admin-pause] Cancelled ${cancelledCount} future visits for plan ${p(req.params.id)}`
          );
        }
      }

      const reactivated = body.isActive === true && existing.isActive === false;
      const scheduleChanged =
        (body.frequency && body.frequency !== existing.frequency) ||
        (body.dayOfWeek && body.dayOfWeek !== existing.dayOfWeek);

      if (reactivated || scheduleChanged) {
        try {
          if (scheduleChanged && !reactivated) {
            const todayStr = new Date().toISOString().split("T")[0];
            await storage.cancelFutureVisitsForPlans([p(req.params.id)], todayStr);
          }
          const { generateVisitsForPlans } = await import("../jobs/auto-visits");
          const today = new Date();
          const startDate = plan?.startDate ? new Date(plan.startDate + "T00:00:00") : today;
          const anchor = startDate > today ? startDate : today;
          const sixMonthsOut = new Date(anchor);
          sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
          const generated = await generateVisitsForPlans(
            companyId,
            [p(req.params.id)],
            anchor.toISOString().split("T")[0],
            sixMonthsOut.toISOString().split("T")[0]
          );
          console.log(
            `[plan-update] ${reactivated ? "Reactivated" : "Schedule changed"}: generated ${generated} visits for plan ${p(req.params.id)}`
          );
        } catch (genErr) {
          console.error("[plan-update] Failed to regenerate visits:", genErr);
        }
      }

      if (addOnsData && Array.isArray(addOnsData)) {
        const validatedAddOns = await validateAndResolveAddOns(addOnsData, companyId);
        const addOns = await storage.setServicePlanAddOns(p(req.params.id), validatedAddOns);
        const existingJob = await storage.getJobByServicePlanId(p(req.params.id));
        if (existingJob) await storage.setJobAddOns(existingJob.id, validatedAddOns);
        return res.json({ ...plan, addOns });
      }

      const addOns = await storage.getServicePlanAddOns(p(req.params.id));
      res.json({ ...plan, addOns });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getServicePlan(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Scheduled service not found" });

      if (existing.routeId) {
        clearRouteOptimizationState(existing.routeId, companyId).catch(console.error);
      }
      await storage.deleteServicePlan(p(req.params.id), companyId);
      if (existing.routeId) {
        await storage.renumberRouteStops(existing.routeId, companyId);
      }
      const { userId } = await getCompanyContext(req);
      auditLog(
        companyId,
        userId,
        "service_plan",
        p(req.params.id),
        "delete",
        {
          deleted: {
            contactId: existing.contactId,
            frequency: existing.frequency,
            dayOfWeek: existing.dayOfWeek,
          },
        },
        req.ip || undefined
      );
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Jobs API ================

  app.get("/api/jobs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: {
        isActive?: boolean;
        routeId?: string;
        propertyId?: string;
        contactId?: string;
      } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.propertyId) filters.propertyId = req.query.propertyId as string;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
      if (req.query.routeId) filters.routeId = req.query.routeId as string;
      const jobsList = await storage.getJobsWithAgreements(
        companyId,
        Object.keys(filters).length > 0 ? filters : undefined
      );
      const jobStatus = req.query.jobStatus as string | undefined;
      const jobType = req.query.jobType as string | undefined;
      let filtered = jobsList;
      if (jobStatus) filtered = filtered.filter((j) => j.jobStatus === jobStatus);
      if (jobType) filtered = filtered.filter((j) => j.jobType === jobType);
      res.json(filtered);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/jobs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const suppressNotifications = req.body.suppressNotifications === true;
      const body = { ...req.body, companyId };
      delete body.suppressNotifications;
      if (!body.routeId || body.routeId === "") body.routeId = null;
      if (!body.jobType) body.jobType = body.frequency === "onetime" ? "one_off" : "recurring";
      if (!body.jobStatus) body.jobStatus = "active";
      if (body.anytime === undefined) body.anytime = true;
      const isActive = body.jobStatus === "active";

      let effectiveDay = body.dayOfWeek;
      if (!effectiveDay && body.startDate) {
        const dayNames = [
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
        ];
        const d = new Date(body.startDate + "T12:00:00");
        effectiveDay = dayNames[d.getDay()];
        body.dayOfWeek = effectiveDay;
      }

      if (!body.routeId && effectiveDay && isActive) {
        const allRoutes = await storage.getRoutes(companyId);
        const dayRoute = allRoutes.find((r) => r.dayOfWeek === effectiveDay && !r.date);
        if (dayRoute) {
          body.routeId = dayRoute.id;
        } else {
          const dayLabel = effectiveDay.charAt(0).toUpperCase() + effectiveDay.slice(1);
          const newRoute = await storage.createRoute({
            companyId,
            name: dayLabel,
            dayOfWeek: effectiveDay,
            date: null,
            technicianId: body.assignedUserId || null,
            color: "#3b82f6",
          });
          body.routeId = newRoute.id;
        }
      }

      const rawPrice = parseFloat(body.pricePerVisit);
      const safePrice = isNaN(rawPrice) ? "0.00" : rawPrice.toFixed(2);

      const sp = await storage.createServicePlan({
        companyId,
        contactId: body.contactId,
        propertyId: body.propertyId,
        frequency: body.frequency || "weekly",
        pricePerVisit: safePrice,
        isActive,
        startDate: body.startDate || new Date().toISOString().split("T")[0],
        endDate: body.endDate || null,
        endsAfterCount: body.endsAfterCount || null,
        endsAfterUnit: body.endsAfterUnit || null,
        estimateId: body.estimateId || null,
        routeId: body.routeId || null,
        stopOrder: body.stopOrder || 0,
        dayOfWeek: body.dayOfWeek || null,
        serviceName: body.serviceName || null,
        jobType: body.jobType,
        jobStatus: body.jobStatus,
        startTime: body.startTime || null,
        endTime: body.endTime || null,
        anytime: body.anytime,
        visitInstructions: body.visitInstructions || null,
        assignedUserId: body.assignedUserId || null,
        isStopOnly: body.isStopOnly || false,
      });

      try {
        const { generateVisitsForPlans } = await import("../jobs/auto-visits");
        const today = new Date();
        const jobStart = body.startDate ? new Date(body.startDate + "T00:00:00") : today;
        const anchor = jobStart > today ? jobStart : today;
        const sixMonthsOut = new Date(anchor);
        sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
        // Use jobStart (not anchor) as the lower bound so that one-time jobs with a
        // start date on or before today still have their visit created correctly.
        await generateVisitsForPlans(
          companyId,
          [sp.id],
          jobStart.toISOString().split("T")[0],
          sixMonthsOut.toISOString().split("T")[0]
        );
      } catch (genErr) {
        console.error("[jobs] Failed to auto-generate visits:", genErr);
      }

      const contact = await storage.getContact(body.contactId, companyId);
      if (contact && (contact.status === "lead" || contact.status === "estimate")) {
        await storage.updateContact(body.contactId, companyId, { status: "active" });
        if (!suppressNotifications && contact.email && !contact.hasPortalAccess) {
          provisionPortalAccess(body.contactId, companyId, getBaseUrl(req)).catch((err) =>
            console.error("[auto-portal] Failed to provision portal access on job creation:", err)
          );
        }
      }

      if (contact && !contact.stripeCustomerId && contact.email) {
        (async () => {
          try {
            const co = await storage.getCompany(companyId);
            const acct = co?.stripeConnectOnboarded ? co.stripeConnectAccountId : null;
            const stripeCustomerId = await createStripeCustomer({
              email: contact.email!,
              name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.email!,
              metadata: { scoopilotContactId: contact.id, companyId },
              stripeAccount: acct,
            });
            await storage.updateContact(body.contactId, companyId, { stripeCustomerId });
          } catch (err) {
            console.error("[auto-stripe] Failed to auto-create Stripe customer:", err);
          }
        })();
      }

      const linkedJob = await storage.getJobByServicePlanId(sp.id);
      const linkedAgreement = await storage.getAgreementByServicePlanId(sp.id);
      res.status(201).json({
        ...(linkedJob || {}),
        agreementId: linkedAgreement?.id,
        contactId: body.contactId,
        frequency: body.frequency,
        servicePlanId: sp.id,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/jobs/:id/approve", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const job = await storage.getJob(p(req.params.id), companyId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.jobStatus !== "draft") {
        return res
          .status(400)
          .json({ error: `Cannot approve a job with status '${job.jobStatus}'` });
      }

      const updated = await storage.updateJob(job.id, companyId, { jobStatus: "active" });
      const agreement = await storage.getAgreement(job.agreementId, companyId);
      if (agreement) {
        await storage.updateAgreement(agreement.id, companyId, { isActive: true });
      }

      if (job.servicePlanId) {
        await storage.updateServicePlan(job.servicePlanId, companyId, {
          jobStatus: "active",
          isActive: true,
        });
        try {
          const { generateVisitsForPlans } = await import("../jobs/auto-visits");
          const today = new Date();
          const plan = await storage.getServicePlan(job.servicePlanId, companyId);
          const planStart = plan?.startDate ? new Date(plan.startDate + "T00:00:00") : today;
          const anchor = planStart > today ? planStart : today;
          const sixMonthsOut = new Date(anchor);
          sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
          // Use planStart (not anchor) so one-time or past-dated jobs still get their visits.
          const generated = await generateVisitsForPlans(
            companyId,
            [job.servicePlanId],
            planStart.toISOString().split("T")[0],
            sixMonthsOut.toISOString().split("T")[0]
          );
          console.log(`[job-approve] Generated ${generated} visits for approved job ${job.id}`);
        } catch (genErr) {
          console.error("[job-approve] Failed to generate visits:", genErr);
        }
      }

      res.json(updated);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/jobs/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const job = await storage.getJob(p(req.params.id), companyId);
      if (!job) return res.status(404).json({ error: "Job not found" });

      const oldRouteId = job.routeId;

      const allowedFields = [
        "routeId",
        "stopOrder",
        "jobStatus",
        "dayOfWeek",
        "startTime",
        "endTime",
        "anytime",
        "assignedUserId",
        "visitInstructions",
      ];
      const body: Record<string, unknown> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) body[key] = req.body[key];
      }
      if (body.routeId === "") body.routeId = null;

      const updated = await storage.updateJob(
        p(req.params.id),
        companyId,
        body as Parameters<typeof storage.updateJob>[2]
      );

      const newRouteId = updated.routeId;

      if (job.servicePlanId) {
        const spUpdate: Record<string, unknown> = {};
        if (body.routeId !== undefined) spUpdate.routeId = body.routeId ?? null;
        if (body.stopOrder !== undefined) spUpdate.stopOrder = body.stopOrder;
        if (body.assignedUserId !== undefined) spUpdate.assignedUserId = body.assignedUserId;
        if (Object.keys(spUpdate).length > 0) {
          await storage.updateServicePlan(
            job.servicePlanId,
            companyId,
            spUpdate as Parameters<typeof storage.updateServicePlan>[2]
          );
        }
      }

      if (oldRouteId && oldRouteId !== newRouteId) {
        storage.renumberRouteStops(oldRouteId, companyId).catch(console.error);
      }
      if (newRouteId && newRouteId !== oldRouteId) {
        storage.renumberRouteStops(newRouteId, companyId).catch(console.error);
      }

      res.json(updated);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/jobs/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const job = await storage.getJob(p(req.params.id), companyId);
      if (!job) return res.status(404).json({ error: "Job not found" });

      const routeId = job.routeId;

      if (job.servicePlanId) {
        await storage.updateServicePlan(job.servicePlanId, companyId, {
          isActive: false,
          routeId: null,
          stopOrder: 0,
        } as Parameters<typeof storage.updateServicePlan>[2]);
      }

      await storage.deleteJob(p(req.params.id), companyId);

      if (routeId) {
        storage.renumberRouteStops(routeId, companyId).catch(console.error);
      }

      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Service Zone Routes ================

  app.get("/api/service-zones", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const zones = await storage.getServiceZones(companyId);
      res.json(zones);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/service-zones", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { zipCode, dayOfWeek, label, latitude, longitude, priceSurchargePercent } = req.body;
      if (!zipCode) return res.status(400).json({ error: "zipCode is required" });
      const zone = await storage.createServiceZone({
        companyId,
        zipCode,
        dayOfWeek: dayOfWeek || "tbd",
        label: label || null,
        priceSurchargePercent: Math.max(
          0,
          Math.min(200, Math.round(Number(priceSurchargePercent) || 0))
        ),
        latitude: latitude || null,
        longitude: longitude || null,
      });
      res.status(201).json(zone);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/service-zones/bulk", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { zones } = req.body;
      if (!Array.isArray(zones) || zones.length === 0)
        return res.status(400).json({ error: "zones array is required" });
      const created = [];
      for (const z of zones) {
        if (!z.zipCode) continue;
        const zone = await storage.createServiceZone({
          companyId,
          zipCode: z.zipCode,
          dayOfWeek: z.dayOfWeek || "tbd",
          label: z.label || null,
          priceSurchargePercent: Math.max(
            0,
            Math.min(200, Math.round(Number(z.priceSurchargePercent) || 0))
          ),
          latitude: z.latitude || null,
          longitude: z.longitude || null,
        });
        created.push(zone);
      }
      res.status(201).json(created);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/service-zones/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const zones = await storage.getServiceZones(companyId);
      const existing = zones.find((z) => z.id === p(req.params.id));
      if (!existing) return res.status(404).json({ error: "Service zone not found" });
      const { dayOfWeek, label, isActive, priceSurchargePercent } = req.body;
      const updates: Partial<import("@shared/schema").InsertServiceZone> = {};
      if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek;
      if (label !== undefined) updates.label = label;
      if (isActive !== undefined) updates.isActive = isActive;
      if (priceSurchargePercent !== undefined) {
        const pct = Math.max(0, Math.min(200, Math.round(Number(priceSurchargePercent) || 0)));
        updates.priceSurchargePercent = pct;
      }
      const zone = await storage.updateServiceZone(p(req.params.id), companyId, updates);
      res.json(zone);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/service-zones/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const zones = await storage.getServiceZones(companyId);
      const existing = zones.find((z) => z.id === p(req.params.id));
      if (!existing) return res.status(404).json({ error: "Service zone not found" });
      await storage.deleteServiceZone(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Upcoming Visit Count for a Service Plan ================

  app.get(
    "/api/service-plans/:id/upcoming-visits-count",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const planId = p(req.params.id);
        const existing = await storage.getServicePlan(planId, companyId);
        if (!existing) return res.status(404).json({ error: "Job not found" });
        const today = new Date().toISOString().split("T")[0];
        const count = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(visits)
          .where(
            and(
              eq(visits.companyId, companyId),
              eq(visits.servicePlanId, planId),
              gte(visits.scheduledDate, today),
              eq(visits.status, "scheduled")
            )
          );
        return res.json({ count: count[0]?.count ?? 0 });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Cancel All Visits for a Recurring Job ================

  app.post(
    "/api/service-plans/:id/cancel-all",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId } = await getCompanyContext(req);
        const planId = p(req.params.id);
        const existing = await storage.getServicePlan(planId, companyId);
        if (!existing) return res.status(404).json({ error: "Job not found" });
        if (existing.jobType !== "recurring")
          return res.status(400).json({ error: "Cancel All is only available for recurring jobs" });
        if (existing.jobStatus === "cancelled")
          return res.status(400).json({ error: "This job is already cancelled" });

        const today = new Date().toISOString().split("T")[0];

        // Cancel all future scheduled visits
        const cancelledCount = await storage.cancelFutureVisitsForPlans([planId], today);

        // Mark the service plan as cancelled and inactive
        await storage.updateServicePlan(planId, companyId, {
          jobStatus: "cancelled",
          isActive: false,
        });

        // Propagate to linked job and agreement
        const linkedJob = await storage.getJobByServicePlanId(planId);
        if (linkedJob) {
          await storage.updateJob(linkedJob.id, companyId, { jobStatus: "cancelled" });
          if (linkedJob.agreementId) {
            await storage.updateAgreement(linkedJob.agreementId, companyId, { isActive: false });
          }
        }

        // Clear route optimization state if the plan was on a route
        if (existing.routeId) {
          clearRouteOptimizationState(existing.routeId, companyId).catch(console.error);
        }

        auditLog(
          companyId,
          userId,
          "service_plan",
          planId,
          "update",
          { action: "cancel_all", cancelledVisits: cancelledCount },
          req.ip || undefined
        );

        return res.json({ success: true, cancelledCount });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Vacation Hold Routes ================

  app.get(
    "/api/service-plans/:id/vacation-holds",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        await getCompanyContext(req);
        const holds = await storage.getVacationHolds(p(req.params.id));
        res.json(holds);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/service-plans/:id/vacation-holds",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        await getCompanyContext(req);
        const parsed = insertVacationHoldSchema.parse({
          ...req.body,
          servicePlanId: p(req.params.id),
        });
        const hold = await storage.createVacationHold(parsed);
        res.status(201).json(hold);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete("/api/vacation-holds/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteVacationHold(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });
}

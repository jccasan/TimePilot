import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getCompanyToday, getCompanyWeekStart } from "../utils/company-date";
import { getRouteMetricsWithLegs } from "../services/route-optimizer";
import { geocodeAddress } from "../services/geocode";
import { insertRouteSchema, type InsertRoute, companyUsers } from "@shared/schema";
import { users } from "@shared/models/auth";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  handleError,
  p,
  clearRouteOptimizationState,
} from "./shared";

/**
 * Resolve the route start point using the full priority chain:
 *  1. Route's explicitly assigned depot
 *  2. Assigned technician's default depot
 *  3. Company's primary depot
 *  4. Legacy company start coordinates
 */
async function resolveStartPoint(
  companyId: string,
  routeDepotId: string | null | undefined,
  technicianId: string | null | undefined,
  company: { startLatitude?: string | null; startLongitude?: string | null }
): Promise<{ latitude: number; longitude: number } | undefined> {
  if (routeDepotId) {
    const depot = await storage.getDepotById(routeDepotId, companyId);
    if (depot) {
      return {
        latitude: parseFloat(String(depot.latitude)),
        longitude: parseFloat(String(depot.longitude)),
      };
    }
  }
  if (technicianId) {
    const [techUser] = await db
      .select({ defaultDepotId: users.defaultDepotId })
      .from(users)
      .where(eq(users.id, technicianId))
      .limit(1);
    if (techUser?.defaultDepotId) {
      const depot = await storage.getDepotById(techUser.defaultDepotId, companyId);
      if (depot) {
        return {
          latitude: parseFloat(String(depot.latitude)),
          longitude: parseFloat(String(depot.longitude)),
        };
      }
    }
  }
  const primaryDepot = await storage.getPrimaryDepot(companyId);
  if (primaryDepot) {
    return {
      latitude: parseFloat(String(primaryDepot.latitude)),
      longitude: parseFloat(String(primaryDepot.longitude)),
    };
  }
  if (company.startLatitude && company.startLongitude) {
    return {
      latitude: parseFloat(String(company.startLatitude)),
      longitude: parseFloat(String(company.startLongitude)),
    };
  }
  return undefined;
}

/**
 * Collect ALL valid candidate start locations for multi-start optimization.
 * Returns each distinct depot / company start in priority order; callers
 * pass the full list to the optimizer, which deduplicates and picks the best.
 *  1. Route's explicitly assigned depot
 *  2. Assigned technician's default depot
 *  3. Company's primary depot
 *  4. Legacy company start coordinates
 */
async function resolveAllCandidateStarts(
  companyId: string,
  routeDepotId: string | null | undefined,
  technicianId: string | null | undefined,
  company: { startLatitude?: string | null; startLongitude?: string | null }
): Promise<{ latitude: number; longitude: number }[]> {
  const candidates: { latitude: number; longitude: number }[] = [];

  if (routeDepotId) {
    const depot = await storage.getDepotById(routeDepotId, companyId);
    if (depot) {
      candidates.push({
        latitude: parseFloat(String(depot.latitude)),
        longitude: parseFloat(String(depot.longitude)),
      });
    }
  }
  if (technicianId) {
    const [techUser] = await db
      .select({
        defaultDepotId: users.defaultDepotId,
        homeLatitude: users.homeLatitude,
        homeLongitude: users.homeLongitude,
      })
      .from(users)
      .where(eq(users.id, technicianId))
      .limit(1);
    if (techUser?.defaultDepotId) {
      const depot = await storage.getDepotById(techUser.defaultDepotId, companyId);
      if (depot) {
        candidates.push({
          latitude: parseFloat(String(depot.latitude)),
          longitude: parseFloat(String(depot.longitude)),
        });
      }
    }
    // 5. Technician's saved home address
    if (techUser?.homeLatitude != null && techUser?.homeLongitude != null) {
      candidates.push({
        latitude: techUser.homeLatitude,
        longitude: techUser.homeLongitude,
      });
    }
  }
  const primaryDepot = await storage.getPrimaryDepot(companyId);
  if (primaryDepot) {
    candidates.push({
      latitude: parseFloat(String(primaryDepot.latitude)),
      longitude: parseFloat(String(primaryDepot.longitude)),
    });
  }
  if (company.startLatitude && company.startLongitude) {
    candidates.push({
      latitude: parseFloat(String(company.startLatitude)),
      longitude: parseFloat(String(company.startLongitude)),
    });
  }

  return candidates;
}

export async function registerRoutePlanningRoutes(app: Express): Promise<void> {
  // ================ Route Routes ================

  app.get("/api/routes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const dayOfWeek = req.query.dayOfWeek as string | undefined;
      const routesList = await storage.getRoutes(companyId, dayOfWeek);

      const optimizedRoutes = routesList.filter((r) => r.optimizedStopHash !== null);
      if (optimizedRoutes.length > 0) {
        const allPlans = await storage.getServicePlans(companyId, { isActive: true });
        const plansByRoute = new Map<string, string[]>();
        for (const plan of allPlans) {
          if (!plan.routeId) continue;
          if (!plansByRoute.has(plan.routeId)) plansByRoute.set(plan.routeId, []);
          plansByRoute.get(plan.routeId)!.push(plan.id);
        }

        const staleRouteIds: string[] = [];
        const result = routesList.map((route) => {
          if (!route.optimizedStopHash) return { ...route, isOptimizedCurrent: false };
          const currentIds = (plansByRoute.get(route.id) ?? []).sort();
          const currentHash = crypto
            .createHash("sha256")
            .update(currentIds.join(","))
            .digest("hex");
          const isCurrent = currentHash === route.optimizedStopHash;
          if (!isCurrent) staleRouteIds.push(route.id);
          return { ...route, isOptimizedCurrent: isCurrent };
        });

        for (const rId of staleRouteIds) {
          clearRouteOptimizationState(rId, companyId).catch(console.error);
        }

        return res.json(result);
      }

      res.json(routesList.map((r) => ({ ...r, isOptimizedCurrent: false })));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/routes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const body = { ...req.body, companyId };
      if (body.technicianId === "") body.technicianId = null;
      const parsed = insertRouteSchema.parse(body);
      if (parsed.depotId) {
        const depot = await storage.getDepotById(parsed.depotId, companyId);
        if (!depot)
          return res
            .status(400)
            .json({ error: "Invalid depotId: depot not found for this company" });
      }
      const route = await storage.createRoute(parsed);
      res.status(201).json(route);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/routes/suggest-day", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: "lat and lng are required" });
      }

      const [allPlans, allProperties] = await Promise.all([
        storage.getServicePlans(companyId, { isActive: true }),
        storage.getProperties(companyId),
      ]);

      const propertyMap = new Map(allProperties.map((p) => [p.id, p]));

      // Haversine distance in km
      function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      // Pass 1: precompute final stop counts per day for tie-breaking
      const dayStopCounts = new Map<string, number>();
      for (const plan of allPlans) {
        const day = plan.dayOfWeek;
        if (!day || day === "tbd") continue;
        dayStopCounts.set(day, (dayStopCounts.get(day) ?? 0) + 1);
      }

      // Pass 2: find nearest geocoded property and its day
      let nearestDay: string | null = null;
      let nearestDist = Infinity;

      for (const plan of allPlans) {
        const day = plan.dayOfWeek;
        if (!day || day === "tbd") continue;

        const prop = propertyMap.get(plan.propertyId);
        if (prop?.latitude == null || prop?.longitude == null) continue;

        const dist = haversineKm(
          lat,
          lng,
          parseFloat(String(prop.latitude)),
          parseFloat(String(prop.longitude))
        );

        if (
          dist < nearestDist ||
          (dist === nearestDist &&
            nearestDay !== null &&
            (dayStopCounts.get(day) ?? 0) > (dayStopCounts.get(nearestDay) ?? 0))
        ) {
          nearestDist = dist;
          nearestDay = day;
        }
      }

      res.json({ day: nearestDay });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/routes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getRoute(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Route not found" });
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
      const allowed = ["name", "dayOfWeek", "technicianId", "color", "depotId"];
      const updates: Partial<Record<string, unknown>> = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (updates.depotId && typeof updates.depotId === "string") {
        const depot = await storage.getDepotById(updates.depotId, companyId);
        if (!depot)
          return res
            .status(400)
            .json({ error: "Invalid depotId: depot not found for this company" });
      }
      const route = await storage.updateRoute(
        p(req.params.id),
        companyId,
        updates as Partial<InsertRoute>
      );
      res.json(route);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/routes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getRoute(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Route not found" });
      await storage.deleteRoute(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/routes/:id/unassign-all", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(p(req.params.id), companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });
      const count = await storage.unassignAllStops(route.id);
      res.json({ success: true, unassignedCount: count });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/routes/:id/move-day", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { targetDate } = z
        .object({
          targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD"),
        })
        .parse(req.body);
      const route = await storage.getRoute(p(req.params.id), companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });
      if (route.date === targetDate)
        return res
          .status(400)
          .json({ error: "Target date must be different from the route's current date" });
      const result = await storage.moveRouteToDate(p(req.params.id), companyId, targetDate);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/routes/:id/lock", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(p(req.params.id), companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      const newLocked = !route.isLocked;
      const updated = await storage.updateRoute(p(req.params.id), companyId, {
        isLocked: newLocked,
      });
      res.json(updated);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/routes/:id/optimize", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const route = await storage.getRoute(p(req.params.id), companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      const { runSkill } = await import("../services/skills/index");
      const result = await runSkill(
        "optimize_route",
        { routeId: route.id },
        { companyId, userId, role }
      );

      if (!result.success) {
        if (result.error === "LOCKED") return res.status(409).json({ error: result.message });
        if (result.error === "TOO_MANY_STOPS")
          return res.status(400).json({ error: result.message });
        if (result.error === "INSUFFICIENT_STOPS") {
          return res.json({
            optimized: false,
            message: result.message,
            totalDistance: 0,
            stopCount: result.data?.stopCount ?? 0,
          });
        }
        if (result.error === "GEOCODE_FAILURE") {
          return res.json({
            optimized: false,
            message: result.message,
            totalDistance: 0,
            stopCount: result.data?.stopCount ?? 0,
            geocodeFailure: true,
            failedStops: result.data?.failedStops ?? [],
          });
        }
        return res.status(500).json({ error: result.message });
      }

      const d = result.data!;
      res.json({ optimized: true, ...d });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * POST /api/skills/run
   * Run a registered skill by name with typed params.
   * Company context is always derived from the authenticated session — any
   * companyId in the request body is intentionally ignored.
   *
   * Body: { skill: string; params?: Record<string, unknown> }
   * - optimize_route: params.routeId (UUID, required)
   *
   * Automation actionConfig contract (run_skill):
   * { type: "run_skill", params: { skillName: string, ...skillParams } }
   * e.g. { type: "run_skill", params: { skillName: "optimize_route", routeId: "<uuid>" } }
   * Executed by automation-runner.ts which spreads params (minus skillName) into runSkill().
   */
  app.post("/api/skills/run", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const { skill: skillName, params } = req.body as {
        skill: string;
        params?: Record<string, unknown>;
      };
      if (!skillName || typeof skillName !== "string") {
        return res.status(400).json({ error: "skill name is required" });
      }
      const { runSkill } = await import("../services/skills/index");
      const result = await runSkill(skillName, params ?? {}, { companyId, userId, role });
      if (!result.success) {
        if (result.error === "LOCKED") return res.status(409).json(result);
        if (result.error === "ROUTE_NOT_FOUND") return res.status(404).json(result);
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/routes/:id/split", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(p(req.params.id), companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const maxStops: number = req.body?.maxStops ?? company.maxStopsPerRoute ?? null;
      if (!maxStops || maxStops < 2) {
        return res.status(400).json({ error: "maxStops must be at least 2" });
      }

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans.filter((sp) => sp.routeId === route.id);

      // Use active service-plan count (same metric as assignNewStopsToRoutes) to
      // determine whether the route is oversized and how many sub-routes to create.
      const routeStopCounts = await storage.getRouteStopCounts(companyId);
      const planCountForRoute = routeStopCounts.get(route.id) ?? routePlans.length;

      if (planCountForRoute <= maxStops) {
        return res.json({
          noOp: true,
          message: `Route has ${planCountForRoute} active service plans, at or under the limit of ${maxStops}`,
        });
      }

      const allProperties = await storage.getProperties(companyId);
      const propertyMap = new Map(allProperties.map((p) => [p.id, p]));

      const { kMeansClustering } = await import("../services/weekly-optimizer");
      const { optimizeRouteAsyncMultiStart: optimizeClusterMulti } =
        await import("../services/route-optimizer");
      const { routificOptimize } = await import("../services/routific");

      const weeklyStops = routePlans
        .map((sp) => {
          const prop = propertyMap.get(sp.propertyId);
          if (!prop || !prop.latitude || !prop.longitude) return null;
          return {
            id: sp.id,
            servicePlanId: sp.id,
            contactId: sp.contactId,
            contactName: "",
            propertyId: sp.propertyId,
            address: prop.streetAddress || "",
            latitude: parseFloat(String(prop.latitude)),
            longitude: parseFloat(String(prop.longitude)),
            currentDay: route.dayOfWeek || "tbd",
            currentRouteId: route.id,
            currentStopOrder: sp.stopOrder,
            zipCode: prop.zipCode || null,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (weeklyStops.length < 2) {
        return res.status(400).json({ error: "Not enough geocoded stops to split" });
      }

      const k = Math.ceil(planCountForRoute / maxStops);
      let clusters = kMeansClustering(weeklyStops, k);

      // Guard against under-minimum sub-clusters created by the split.
      // Mirror the protection already present in the weekly optimizer so a
      // 52+8 partition from 60 stops doesn't produce a standalone 8-stop route.
      const { mergeSmallClusters } = await import("../services/weekly-optimizer");
      const minSplitSize =
        company.minStopsPerDay != null && company.minStopsPerDay > 0
          ? company.minStopsPerDay
          : Math.ceil(planCountForRoute / k / 3);
      clusters = mergeSmallClusters(clusters, minSplitSize);

      const suffixLetters = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
      const splitColors = [
        "#ef4444",
        "#22c55e",
        "#f59e0b",
        "#8b5cf6",
        "#06b6d4",
        "#ec4899",
        "#84cc16",
        "#f97316",
      ];

      const [startPoint, candidateStartsForSplit] = await Promise.all([
        resolveStartPoint(
          companyId,
          (route as Record<string, unknown>).depotId as string | null | undefined,
          route.technicianId ?? null,
          company
        ),
        resolveAllCandidateStarts(
          companyId,
          (route as Record<string, unknown>).depotId as string | null | undefined,
          route.technicianId ?? null,
          company
        ),
      ]);

      const newRoutes: { id: string; name: string; stopCount: number }[] = [];
      const allAffectedPlanIds: string[] = [];

      // Stops on the original route that could not be geocoded are excluded from
      // weeklyStops and therefore from every cluster. They remain on route.id with
      // their original stopOrder values, which would collide with the 1..N orders
      // written for cluster[0]. Bump them to a high stopOrder now so that
      // renumberRouteStops places them after the optimized stops.
      const weeklyStopIds = new Set(weeklyStops.map((s) => s.id));
      const ungeocoded = routePlans.filter((sp) => !weeklyStopIds.has(sp.id));
      for (const sp of ungeocoded) {
        await storage.updateServicePlan(sp.id, companyId, {
          stopOrder: 99000 + (sp.stopOrder ?? 0),
        });
      }

      for (let ci = 0; ci < clusters.length; ci++) {
        const cluster = clusters[ci];
        let targetRouteId: string;

        if (ci === 0) {
          targetRouteId = route.id;
        } else {
          const suffix = suffixLetters[ci - 1] || String(ci + 1);
          const newName = `${route.name}-${suffix}`;
          const sourceDepotId = (route as Record<string, unknown>).depotId as
            | string
            | null
            | undefined;
          const newRoute = await storage.createRoute({
            companyId,
            name: newName,
            dayOfWeek: route.dayOfWeek || undefined,
            technicianId: route.technicianId || undefined,
            color: splitColors[(ci - 1) % splitColors.length],
            ...(sourceDepotId ? { depotId: sourceDepotId } : {}),
          });
          targetRouteId = newRoute.id;
          newRoutes.push({ id: newRoute.id, name: newRoute.name, stopCount: cluster.length });
        }

        const clusterStops = cluster.map((s) => ({
          id: s.id,
          latitude: s.latitude,
          longitude: s.longitude,
        }));
        const internalClusterResult = await optimizeClusterMulti(
          clusterStops,
          candidateStartsForSplit
        );
        const clusterBestStart = internalClusterResult.bestStart ?? startPoint;
        let orderedIds: string[];
        if (!internalClusterResult.degraded) {
          orderedIds = internalClusterResult.orderedIds;
        } else {
          const routificResult = await routificOptimize(
            clusterStops,
            clusterBestStart,
            company.maxRouteDurationHours && company.maxRouteDurationHours > 0
              ? { maxDurationHours: company.maxRouteDurationHours }
              : undefined
          );
          orderedIds = routificResult
            ? routificResult.orderedIds
            : internalClusterResult.orderedIds;
        }

        for (let si = 0; si < orderedIds.length; si++) {
          await storage.updateServicePlan(orderedIds[si], companyId, {
            routeId: targetRouteId,
            stopOrder: si + 1,
          });
          allAffectedPlanIds.push(orderedIds[si]);
        }

        const unordered = cluster.filter((s) => !orderedIds.includes(s.id));
        for (let si = 0; si < unordered.length; si++) {
          await storage.updateServicePlan(unordered[si].id, companyId, {
            routeId: targetRouteId,
            stopOrder: orderedIds.length + si + 1,
          });
          allAffectedPlanIds.push(unordered[si].id);
        }
      }

      try {
        const tz = company.timezone || "America/New_York";
        const today = getCompanyToday(tz);
        const uniquePlanIds = Array.from(new Set(allAffectedPlanIds));
        if (uniquePlanIds.length > 0) {
          await storage.deleteFutureScheduledVisitsForPlans(uniquePlanIds, today);
          const { generateVisitsForPlans } = await import("../jobs/auto-visits");
          const startDate = new Date(today + "T00:00:00Z");
          startDate.setUTCDate(startDate.getUTCDate() + 1);
          const endDate = new Date(today + "T00:00:00Z");
          endDate.setUTCDate(endDate.getUTCDate() + 182);
          await generateVisitsForPlans(
            companyId,
            uniquePlanIds,
            startDate.toISOString().split("T")[0],
            endDate.toISOString().split("T")[0]
          );
        }
      } catch (genErr) {
        console.error("[route-split] Failed to regenerate visits after split:", genErr);
      }

      res.json({
        routesCreated: newRoutes.length,
        newRoutes,
        originalRoute: {
          id: route.id,
          name: route.name,
          stopCount: clusters[0]?.length ?? routePlans.length,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/routes/apply-max-stops", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);

      const rawMaxStops = req.body?.maxStops;
      const isClearing = rawMaxStops === null || rawMaxStops === undefined;

      if (!isClearing) {
        const n = Number(rawMaxStops);
        if (!Number.isInteger(n) || n < 2) {
          return res.status(400).json({ error: "maxStops must be an integer of 2 or greater" });
        }
      }

      const maxStops: number | null = isClearing ? null : Number(rawMaxStops);
      await storage.updateCompany(companyId, { maxStopsPerRoute: maxStops });

      if (isClearing) {
        return res.json({ cleared: true });
      }
      const maxStopsNum = maxStops as number;

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const routes = await storage.getRoutes(companyId);
      const plans = await storage.getServicePlans(companyId, { isActive: true });

      const plansByRoute = new Map<string, typeof plans>();
      for (const route of routes) plansByRoute.set(route.id, []);
      for (const plan of plans) {
        if (plan.routeId && plansByRoute.has(plan.routeId)) {
          plansByRoute.get(plan.routeId)!.push(plan);
        }
      }

      // Determine effective stop count per route using this week's visit counts
      const bulkTz = company.timezone || "America/New_York";
      const bulkWeekStart = getCompanyWeekStart(bulkTz);
      const bulkWeekStartObj = new Date(bulkWeekStart + "T12:00:00Z");
      const bulkWeekEndObj = new Date(bulkWeekStartObj);
      bulkWeekEndObj.setUTCDate(bulkWeekEndObj.getUTCDate() + 6);
      const bulkWeekEnd = bulkWeekEndObj.toISOString().split("T")[0];
      const bulkWeekVisits = await storage.getVisitsForDateRange(
        companyId,
        bulkWeekStart,
        bulkWeekEnd
      );
      const visitCountByRoute = new Map<string, number>();
      for (const v of bulkWeekVisits) {
        if (v.routeId && v.status !== "cancelled") {
          visitCountByRoute.set(v.routeId, (visitCountByRoute.get(v.routeId) || 0) + 1);
        }
      }

      const oversized = routes.filter((r) => (visitCountByRoute.get(r.id) || 0) > maxStopsNum);

      if (oversized.length === 0) {
        return res.json({
          routesSplit: 0,
          subRoutesCreated: 0,
          skipped: routes.length,
          errors: [],
        });
      }

      const { kMeansClustering } = await import("../services/weekly-optimizer");
      const { optimizeRouteAsyncMultiStart: optimizeBulkClusterMulti } =
        await import("../services/route-optimizer");
      const { routificOptimize: routificOptimizeBulk } = await import("../services/routific");
      const allProperties = await storage.getProperties(companyId);
      const propertyMap = new Map(allProperties.map((p) => [p.id, p]));

      const suffixLetters = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
      const splitColors = [
        "#ef4444",
        "#22c55e",
        "#f59e0b",
        "#8b5cf6",
        "#06b6d4",
        "#ec4899",
        "#84cc16",
        "#f97316",
      ];
      const tz = company.timezone || "America/New_York";
      const today = getCompanyToday(tz);

      let routesSplit = 0;
      let subRoutesCreated = 0;
      const errors: string[] = [];
      const allAffectedPlanIds: string[] = [];

      for (const route of oversized) {
        try {
          const [startPoint, candidateStartsBulk] = await Promise.all([
            resolveStartPoint(
              companyId,
              (route as Record<string, unknown>).depotId as string | null | undefined,
              route.technicianId ?? null,
              company
            ),
            resolveAllCandidateStarts(
              companyId,
              (route as Record<string, unknown>).depotId as string | null | undefined,
              route.technicianId ?? null,
              company
            ),
          ]);
          const routePlans = plansByRoute.get(route.id) || [];

          const weeklyStops = routePlans
            .map((sp) => {
              const prop = propertyMap.get(sp.propertyId);
              if (!prop || !prop.latitude || !prop.longitude) return null;
              return {
                id: sp.id,
                servicePlanId: sp.id,
                contactId: sp.contactId,
                contactName: "",
                propertyId: sp.propertyId,
                address: prop.streetAddress || "",
                latitude: parseFloat(String(prop.latitude)),
                longitude: parseFloat(String(prop.longitude)),
                currentDay: route.dayOfWeek || "tbd",
                currentRouteId: route.id,
                currentStopOrder: sp.stopOrder,
                zipCode: prop.zipCode || null,
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);

          if (weeklyStops.length < 2) {
            errors.push(`${route.name}: not enough geocoded stops`);
            continue;
          }

          const routeVisitCount = visitCountByRoute.get(route.id) || 0;
          const k = Math.ceil(routeVisitCount / maxStopsNum);
          const clusters = kMeansClustering(weeklyStops, k);

          for (let ci = 0; ci < clusters.length; ci++) {
            const cluster = clusters[ci];
            let targetRouteId: string;

            if (ci === 0) {
              targetRouteId = route.id;
            } else {
              const suffix = suffixLetters[ci - 1] || String(ci + 1);
              const bulkSourceDepotId = (route as Record<string, unknown>).depotId as
                | string
                | null
                | undefined;
              const newRoute = await storage.createRoute({
                companyId,
                name: `${route.name}-${suffix}`,
                dayOfWeek: route.dayOfWeek || undefined,
                technicianId: route.technicianId || undefined,
                color: splitColors[(ci - 1) % splitColors.length],
                ...(bulkSourceDepotId ? { depotId: bulkSourceDepotId } : {}),
              });
              targetRouteId = newRoute.id;
              subRoutesCreated++;
            }

            const clusterStops = cluster.map((s) => ({
              id: s.id,
              latitude: s.latitude,
              longitude: s.longitude,
            }));
            const internalBulkResult = await optimizeBulkClusterMulti(
              clusterStops,
              candidateStartsBulk
            );
            const bulkBestStart = internalBulkResult.bestStart ?? startPoint;
            let orderedIds: string[];
            if (!internalBulkResult.degraded) {
              orderedIds = internalBulkResult.orderedIds;
            } else {
              const routificRes = await routificOptimizeBulk(
                clusterStops,
                bulkBestStart,
                company.maxRouteDurationHours && company.maxRouteDurationHours > 0
                  ? { maxDurationHours: company.maxRouteDurationHours }
                  : undefined
              );
              orderedIds = routificRes ? routificRes.orderedIds : internalBulkResult.orderedIds;
            }

            for (let si = 0; si < orderedIds.length; si++) {
              await storage.updateServicePlan(orderedIds[si], companyId, {
                routeId: targetRouteId,
                stopOrder: si + 1,
              });
              allAffectedPlanIds.push(orderedIds[si]);
            }
            const unordered = cluster.filter((s) => !orderedIds.includes(s.id));
            for (let si = 0; si < unordered.length; si++) {
              await storage.updateServicePlan(unordered[si].id, companyId, {
                routeId: targetRouteId,
                stopOrder: orderedIds.length + si + 1,
              });
              allAffectedPlanIds.push(unordered[si].id);
            }
          }
          routesSplit++;
        } catch (splitErr: unknown) {
          console.error(`[apply-max-stops] Failed to split route ${route.name}:`, splitErr);
          errors.push(route.name);
        }
      }

      try {
        const uniquePlanIds = Array.from(new Set(allAffectedPlanIds));
        if (uniquePlanIds.length > 0) {
          await storage.deleteFutureScheduledVisitsForPlans(uniquePlanIds, today);
          const { generateVisitsForPlans } = await import("../jobs/auto-visits");
          const startDate = new Date(today + "T00:00:00Z");
          startDate.setUTCDate(startDate.getUTCDate() + 1);
          const endDate = new Date(today + "T00:00:00Z");
          endDate.setUTCDate(endDate.getUTCDate() + 182);
          await generateVisitsForPlans(
            companyId,
            uniquePlanIds,
            startDate.toISOString().split("T")[0],
            endDate.toISOString().split("T")[0]
          );
        }
      } catch (genErr) {
        console.error("[apply-max-stops] Failed to regenerate visits:", genErr);
      }

      res.json({
        routesSplit,
        subRoutesCreated,
        skipped: routes.length - oversized.length,
        errors,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/routes/optimize-weekly", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { respectZones = false, includeSaturday = false } = req.body || {};

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const tz = company.timezone || "America/New_York";

      // Scan the next 30 days of visits to capture all recurring plans — weekly,
      // bi-weekly, and monthly customers all appear at least once in this window.
      const todayStr = getCompanyToday(tz);
      const windowEndObj = new Date(todayStr + "T12:00:00Z");
      windowEndObj.setUTCDate(windowEndObj.getUTCDate() + 30);
      const windowEndDate = windowEndObj.toISOString().split("T")[0];

      const windowVisitsAll = await storage.getVisitsForDateRange(
        companyId,
        todayStr,
        windowEndDate
      );
      const activeWindowVisits = windowVisitsAll.filter(
        (v) => v.status !== "cancelled" && v.servicePlanId
      );

      if (activeWindowVisits.length < 3) {
        return res.status(400).json({
          error:
            "Need at least 3 upcoming appointments to optimize. Generate visits for the next several weeks first.",
        });
      }

      // Build plan + property maps for geographic data
      const allPlans = await storage.getServicePlans(companyId, { isActive: true });
      const planMap = new Map(allPlans.map((p) => [p.id, p]));

      // Deduplicate: one entry per service plan — captures every active customer
      // regardless of visit frequency (weekly/bi-weekly/monthly).
      const seenPlanIds = new Set<string>();
      const dedupedVisits = activeWindowVisits.filter((v) => {
        if (!v.servicePlanId || seenPlanIds.has(v.servicePlanId)) return false;
        seenPlanIds.add(v.servicePlanId);
        return true;
      });

      const uniquePlanIds = dedupedVisits.map((v) => v.servicePlanId!);

      const allProperties = await storage.getProperties(companyId);
      let propertyMap = new Map(allProperties.map((p) => [p.id, p]));

      // Geocode any missing properties referenced by upcoming visits
      const plansNeedingGeocode = uniquePlanIds
        .map((id) => planMap.get(id))
        .filter((sp): sp is NonNullable<typeof sp> => {
          if (!sp) return false;
          const prop = propertyMap.get(sp.propertyId);
          return !!(prop && prop.streetAddress && (!prop.latitude || !prop.longitude));
        });
      for (const sp of plansNeedingGeocode) {
        const prop = propertyMap.get(sp.propertyId)!;
        const coords = await geocodeAddress(
          prop.streetAddress!,
          prop.city,
          prop.state,
          prop.zipCode,
          null,
          companyId
        );
        if (coords) {
          const updated = await storage.updateProperty(prop.id, companyId, {
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          propertyMap.set(prop.id, updated);
        }
      }

      const allContacts = await storage.getContacts(companyId);
      const contactMap = new Map(allContacts.map((c) => [c.id, c]));

      const { analyzeWeeklySchedule } = await import("../services/weekly-optimizer");

      const ACTIVE_DAYS_SET = includeSaturday
        ? new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"])
        : new Set(["monday", "tuesday", "wednesday", "thursday", "friday"]);

      // Build one WeeklyStop per unique service plan.
      // currentDay comes from the plan's own dayOfWeek — the recurring schedule —
      // not from a specific visit date. This is the true "current" state.
      let excludedWeekendCount = 0;
      const ungeocodedStops: {
        servicePlanId: string;
        contactId: string;
        propertyId: string;
        name: string;
        address: string;
      }[] = [];
      const weeklyStops = dedupedVisits
        .map((visit) => {
          const sp = visit.servicePlanId ? planMap.get(visit.servicePlanId) : undefined;
          if (!sp) return null;
          const prop = propertyMap.get(sp.propertyId);
          const contact = contactMap.get(sp.contactId);
          if (!prop || !prop.latitude || !prop.longitude) {
            ungeocodedStops.push({
              servicePlanId: sp.id,
              contactId: sp.contactId,
              propertyId: sp.propertyId,
              name: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown",
              address: prop
                ? [prop.streetAddress, prop.city, prop.state, prop.zipCode]
                    .filter(Boolean)
                    .join(", ")
                : "No address",
            });
            return null;
          }
          const planDay = (sp.dayOfWeek || "monday").toLowerCase();
          if (!ACTIVE_DAYS_SET.has(planDay)) {
            excludedWeekendCount++;
            return null;
          }
          return {
            id: sp.id,
            servicePlanId: sp.id,
            contactId: sp.contactId,
            contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown",
            propertyId: sp.propertyId,
            address: `${prop.streetAddress || ""}${prop.city ? `, ${prop.city}` : ""}`,
            latitude: parseFloat(String(prop.latitude)),
            longitude: parseFloat(String(prop.longitude)),
            currentDay: planDay,
            currentRouteId: sp.routeId,
            currentStopOrder: sp.stopOrder,
            zipCode: prop.zipCode || null,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (weeklyStops.length < 3) {
        const note =
          excludedWeekendCount > 0
            ? ` (${excludedWeekendCount} weekend stops excluded — enable "Include Saturday" to optimize them)`
            : "";
        return res.status(400).json({
          error: `Not enough geocoded appointments to optimize${note}. Ensure property addresses are complete.`,
          geocodeFailure: true,
          failedStops: ungeocodedStops,
        });
      }

      const [startPoint, candidateStarts] = await Promise.all([
        resolveStartPoint(companyId, null, null, company),
        resolveAllCandidateStarts(companyId, null, null, company),
      ]);

      let zones: { zipCode: string; dayOfWeek: string }[] = [];
      if (respectZones) {
        const serviceZoneRows = await storage.getServiceZones(companyId);
        zones = serviceZoneRows
          .filter((z) => z.isActive)
          .map((z) => ({ zipCode: z.zipCode, dayOfWeek: z.dayOfWeek }));
      }

      const maxStopsPerDay =
        company.maxStopsPerRoute && company.maxStopsPerRoute > 0
          ? company.maxStopsPerRoute
          : undefined;
      const minStopsPerDay =
        company.minStopsPerDay && company.minStopsPerDay > 0 ? company.minStopsPerDay : undefined;

      const maxRouteDurationHours =
        company.maxRouteDurationHours && company.maxRouteDurationHours > 0
          ? company.maxRouteDurationHours
          : undefined;

      const co = company as Record<string, unknown>;
      const routePlanningMode =
        co.routePlanningMode === "time" ? ("time" as const) : ("stops" as const);
      const avgMinutesPerStop =
        typeof co.avgMinutesPerStop === "number" && co.avgMinutesPerStop > 0
          ? co.avgMinutesPerStop
          : 12;
      const minRouteDurationHours =
        typeof co.minRouteDurationHours === "number" && co.minRouteDurationHours > 0
          ? co.minRouteDurationHours
          : undefined;

      const result = await analyzeWeeklySchedule(weeklyStops, startPoint, {
        respectZones,
        zones,
        includeSaturday,
        maxStopsPerDay,
        minStopsPerDay,
        maxRouteDurationHours,
        routePlanningMode,
        avgMinutesPerStop,
        minRouteDurationHours,
        candidateStarts,
      });

      const { calculateAllCustomerProfitability } =
        await import("../services/profitability-calculator");
      const allProfitability = await calculateAllCustomerProfitability(companyId);
      const profByPlan = new Map<
        string,
        { revenuePerVisitCents: number; costPerVisitCents: number; profitPerVisitCents: number }
      >();
      for (const cp of allProfitability) {
        for (const prop of cp.properties) {
          if (prop.servicePlanId) {
            profByPlan.set(prop.servicePlanId, {
              revenuePerVisitCents: prop.revenuePerVisitCents,
              costPerVisitCents: prop.costPerVisitCents,
              profitPerVisitCents: prop.profitPerVisitCents,
            });
          }
        }
      }

      const enrichRoutes = (days: typeof result.current.days) => {
        return days.map((d) => ({
          ...d,
          routes: d.routes.map((r) => {
            let totalRev = 0,
              totalCost = 0,
              totalProfit = 0;
            for (const stop of r.stops) {
              const sp = profByPlan.get(stop.servicePlanId);
              if (sp) {
                totalRev += sp.revenuePerVisitCents;
                totalCost += sp.costPerVisitCents;
                totalProfit += sp.profitPerVisitCents;
              }
            }
            return {
              ...r,
              totalRevenueCents: totalRev,
              totalCostCents: totalCost,
              totalProfitCents: totalProfit,
            };
          }),
        }));
      };

      const enrichedCurrent = enrichRoutes(result.current.days);
      const enrichedProposed = enrichRoutes(result.proposed.days);

      const { getEffectivePricingConfig } = await import("../services/pricing-calculator");
      const pricingConfig = getEffectivePricingConfig(company.pricingConfig);

      let fuelCostCentsPerMile: number;
      let fuelCostSource: string;
      if (pricingConfig.vehicleMPG && pricingConfig.vehicleMPG > 0) {
        fuelCostCentsPerMile =
          pricingConfig.averageGasPriceCentsPerGallon / pricingConfig.vehicleMPG;
        fuelCostSource = "gas_mpg";
      } else if (pricingConfig.vehicleCostPerMileCents > 0) {
        fuelCostCentsPerMile = pricingConfig.vehicleCostPerMileCents;
        fuelCostSource = "cost_per_mile";
      } else {
        fuelCostCentsPerMile = 65;
        fuelCostSource = "default";
      }

      const computeRouteFuel = (
        routes: {
          estimatedMiles: number;
          routeLabel: string;
          totalRevenueCents?: number;
          totalCostCents?: number;
          totalProfitCents?: number;
        }[]
      ) => {
        return routes.map((r) => ({
          routeLabel: r.routeLabel,
          fuelCostCents: Math.round(r.estimatedMiles * fuelCostCentsPerMile),
          miles: r.estimatedMiles,
          totalRevenueCents: r.totalRevenueCents ?? 0,
          totalCostCents: r.totalCostCents ?? 0,
          totalProfitCents: r.totalProfitCents ?? 0,
        }));
      };

      const currentFuelCostCents = Math.round(result.current.totalMiles * fuelCostCentsPerMile);
      const proposedFuelCostCents = Math.round(result.proposed.totalMiles * fuelCostCentsPerMile);
      const fuelCostSavedCents = currentFuelCostCents - proposedFuelCostCents;

      const laborCentsPerMinute =
        (pricingConfig.techHourlyWageCents * pricingConfig.burdenMultiplier) / 60;
      const currentLaborCents = Math.round(result.current.totalMinutes * laborCentsPerMinute);
      const proposedLaborCents = Math.round(result.proposed.totalMinutes * laborCentsPerMinute);
      const laborSavedCents = currentLaborCents - proposedLaborCents;

      res.json({
        ...result,
        excludedWeekendCount,
        ungeocodedStops,
        laborCost: {
          centsPerMinute: Math.round(laborCentsPerMinute * 10) / 10,
          hourlyRateCents: pricingConfig.techHourlyWageCents,
          burdenMultiplier: pricingConfig.burdenMultiplier,
          burdenedHourlyRateCents: Math.round(
            pricingConfig.techHourlyWageCents * pricingConfig.burdenMultiplier
          ),
          currentTotalCents: currentLaborCents,
          proposedTotalCents: proposedLaborCents,
          savedCents: laborSavedCents,
        },
        fuelCost: {
          centsPerMile: Math.round(fuelCostCentsPerMile * 10) / 10,
          source: fuelCostSource,
          gasPriceCentsPerGallon: pricingConfig.averageGasPriceCentsPerGallon,
          vehicleMPG: pricingConfig.vehicleMPG,
          currentTotalCents: currentFuelCostCents,
          proposedTotalCents: proposedFuelCostCents,
          savedCents: fuelCostSavedCents,
          currentPerDay: enrichedCurrent.map((d) => ({
            day: d.day,
            fuelCostCents: Math.round(d.totalMiles * fuelCostCentsPerMile),
            routes: computeRouteFuel(d.routes),
          })),
          proposedPerDay: enrichedProposed.map((d) => ({
            day: d.day,
            fuelCostCents: Math.round(d.totalMiles * fuelCostCentsPerMile),
            routes: computeRouteFuel(d.routes),
          })),
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/routes/multi-week-optimize",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { respectZones = false, includeSaturday = false } = req.body || {};

        const company = await storage.getCompany(companyId);
        if (!company) return res.status(404).json({ error: "Company not found" });

        const tz = company.timezone || "America/New_York";

        // Count active technicians — used to split each day into one route per tech.
        const companyUsersList = await storage.getCompanyUsers(companyId);
        const activeTechCount = companyUsersList.filter(
          (cu) => cu.role === "tech" && cu.isActive !== false
        ).length;
        const numTechs = Math.max(1, activeTechCount);

        // Build shared lookup maps (plans, properties, contacts) — fetched once for all weeks.
        const allPlans = await storage.getServicePlans(companyId, { isActive: true });
        const planMap = new Map(allPlans.map((p) => [p.id, p]));
        const allProperties = await storage.getProperties(companyId);
        let propertyMap = new Map(allProperties.map((p) => [p.id, p]));
        const allContacts = await storage.getContacts(companyId);
        const contactMap = new Map(allContacts.map((c) => [c.id, c]));

        const [startPoint, candidateStarts] = await Promise.all([
          resolveStartPoint(companyId, null, null, company),
          resolveAllCandidateStarts(companyId, null, null, company),
        ]);

        let zones: { zipCode: string; dayOfWeek: string }[] = [];
        if (respectZones) {
          const serviceZoneRows = await storage.getServiceZones(companyId);
          zones = serviceZoneRows
            .filter((z) => z.isActive)
            .map((z) => ({ zipCode: z.zipCode, dayOfWeek: z.dayOfWeek }));
        }

        const maxStopsPerDay =
          company.maxStopsPerRoute && company.maxStopsPerRoute > 0
            ? company.maxStopsPerRoute
            : undefined;
        const minStopsPerDay =
          company.minStopsPerDay && company.minStopsPerDay > 0 ? company.minStopsPerDay : undefined;

        const co2 = company as Record<string, unknown>;
        const routePlanningMode =
          co2.routePlanningMode === "time" ? ("time" as const) : ("stops" as const);
        const avgMinutesPerStop =
          typeof co2.avgMinutesPerStop === "number" && co2.avgMinutesPerStop > 0
            ? co2.avgMinutesPerStop
            : 12;
        const minRouteDurationHours =
          typeof co2.minRouteDurationHours === "number" && co2.minRouteDurationHours > 0
            ? co2.minRouteDurationHours
            : undefined;

        const ACTIVE_DAYS_SET = includeSaturday
          ? new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"])
          : new Set(["monday", "tuesday", "wednesday", "thursday", "friday"]);
        const MONTH_NAMES = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];

        // Determine next Monday — start of the upcoming week (not the current week).
        const todayStr = getCompanyToday(tz);
        const todayObj = new Date(todayStr + "T12:00:00Z");
        const todayDow = todayObj.getUTCDay(); // 0=Sun, 1=Mon...
        const daysUntilNextMonday = todayDow === 0 ? 1 : 8 - todayDow;
        const nextMondayObj = new Date(todayObj);
        nextMondayObj.setUTCDate(todayObj.getUTCDate() + daysUntilNextMonday);

        const { analyzeWeeklySchedule } = await import("../services/weekly-optimizer");

        const formatWeekLabel = (start: Date, end: Date): string => {
          const s = `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCDate()}`;
          const e = `${MONTH_NAMES[end.getUTCMonth()]} ${end.getUTCDate()}`;
          return `${s} – ${e}`;
        };

        // Build analysis for each of the next 4 weeks.
        // Processed sequentially so the shared mutable propertyMap is never
        // raced by concurrent geocode writes across weeks.
        const weekResults = [];
        for (const weekOffset of [0, 1, 2, 3]) {
          const weekStartObj = new Date(nextMondayObj);
          weekStartObj.setUTCDate(nextMondayObj.getUTCDate() + weekOffset * 7);
          const weekEndObj = new Date(weekStartObj);
          weekEndObj.setUTCDate(weekStartObj.getUTCDate() + 6);

          const weekStart = weekStartObj.toISOString().split("T")[0];
          const weekEnd = weekEndObj.toISOString().split("T")[0];
          const weekLabel = formatWeekLabel(weekStartObj, weekEndObj);
          const weekNum = weekOffset + 1;

          // Fetch this week's visits and deduplicate by service plan.
          const weekVisitsAll = await storage.getVisitsForDateRange(companyId, weekStart, weekEnd);
          const activeVisits = weekVisitsAll.filter(
            (v) => v.status !== "cancelled" && v.servicePlanId
          );

          const seenPlanIds = new Set<string>();
          const dedupedVisits = activeVisits.filter((v) => {
            if (!v.servicePlanId || seenPlanIds.has(v.servicePlanId)) return false;
            seenPlanIds.add(v.servicePlanId);
            return true;
          });

          // Geocode any properties missing coordinates (runs at most once per property across all weeks).
          for (const visit of dedupedVisits) {
            const sp = visit.servicePlanId ? planMap.get(visit.servicePlanId) : undefined;
            if (!sp) continue;
            const prop = propertyMap.get(sp.propertyId);
            if (prop && prop.streetAddress && (!prop.latitude || !prop.longitude)) {
              const coords = await geocodeAddress(
                prop.streetAddress,
                prop.city,
                prop.state,
                prop.zipCode,
                null,
                companyId
              );
              if (coords) {
                const updated = await storage.updateProperty(prop.id, companyId, {
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                });
                propertyMap.set(prop.id, updated);
              }
            }
          }

          // Build WeeklyStop objects — currentDay from service plan's recurring dayOfWeek.
          let excludedCount = 0;
          const weeklyStops = dedupedVisits
            .map((visit) => {
              const sp = visit.servicePlanId ? planMap.get(visit.servicePlanId) : undefined;
              if (!sp) return null;
              const prop = propertyMap.get(sp.propertyId);
              const contact = contactMap.get(sp.contactId);
              if (!prop || !prop.latitude || !prop.longitude) return null;
              const planDay = (sp.dayOfWeek || "monday").toLowerCase();
              if (!ACTIVE_DAYS_SET.has(planDay)) {
                excludedCount++;
                return null;
              }
              return {
                id: sp.id,
                servicePlanId: sp.id,
                contactId: sp.contactId,
                contactName: contact
                  ? `${contact.firstName} ${contact.lastName}`.trim()
                  : "Unknown",
                propertyId: sp.propertyId,
                address: `${prop.streetAddress || ""}${prop.city ? `, ${prop.city}` : ""}`,
                latitude: parseFloat(String(prop.latitude)),
                longitude: parseFloat(String(prop.longitude)),
                currentDay: planDay,
                currentRouteId: sp.routeId,
                currentStopOrder: sp.stopOrder,
                zipCode: prop.zipCode || null,
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);

          if (weeklyStops.length < 3) {
            weekResults.push({
              weekStart,
              weekEnd,
              weekLabel,
              weekNum,
              techCount: numTechs,
              empty: true as const,
              reason:
                weeklyStops.length === 0
                  ? "No visits scheduled this week"
                  : `Only ${weeklyStops.length} geocoded stop${weeklyStops.length === 1 ? "" : "s"} — need at least 3 to optimize`,
              excludedWeekendCount: excludedCount,
            });
            continue;
          }

          const result = await analyzeWeeklySchedule(weeklyStops, startPoint, {
            respectZones,
            zones,
            includeSaturday,
            maxStopsPerDay,
            minStopsPerDay,
            numTechs,
            maxRouteDurationHours:
              company.maxRouteDurationHours && company.maxRouteDurationHours > 0
                ? company.maxRouteDurationHours
                : undefined,
            routePlanningMode,
            avgMinutesPerStop,
            minRouteDurationHours,
            candidateStarts,
          });

          weekResults.push({
            weekStart,
            weekEnd,
            weekLabel,
            weekNum,
            techCount: numTechs,
            empty: false as const,
            excludedWeekendCount: excludedCount,
            ...result,
          });
        }

        // Build a map of existing recurring-route tech assignments (dayOfWeek → technicianId | null)
        // so the frontend can pre-fill the first route's dropdown for each proposed day.
        // Uses the same route-selection criteria as apply-weekly-plan (dayOfWeek, no date, not locked),
        // and picks the first match per day using the same unsorted getRoutes() output so the
        // "first" route is consistent between prefill and the apply handler.
        const allExistingRoutes = await storage.getRoutes(companyId);
        const existingTechAssignments: Record<string, string | null> = {};
        for (const r of allExistingRoutes) {
          if (!r.dayOfWeek || r.date || r.isLocked) continue;
          // Only record the first match per day (same as apply-weekly-plan's .find() call)
          if (!(r.dayOfWeek in existingTechAssignments)) {
            existingTechAssignments[r.dayOfWeek] = r.technicianId ?? null;
          }
        }

        res.json({ weeks: weekResults, existingTechAssignments });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/routes/apply-weekly-plan",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);

        type DayOfWeekValue =
          | "monday"
          | "tuesday"
          | "wednesday"
          | "thursday"
          | "friday"
          | "saturday"
          | "sunday";
        type PlanStop = { servicePlanId?: string; id?: string };
        type PlanRoute = { routeLabel?: string; stops?: PlanStop[] };
        type DayPlan = { day: DayOfWeekValue; routes: PlanRoute[] };

        const { acceptedDays, proposedDays, techAssignments } = req.body;
        const techAssignmentsMap: Record<string, string> =
          techAssignments && typeof techAssignments === "object" ? techAssignments : {};
        if (!proposedDays || !Array.isArray(proposedDays)) {
          return res.status(400).json({ error: "proposedDays is required" });
        }

        const validDays: DayOfWeekValue[] = [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ];
        for (const dp of proposedDays) {
          if (!dp.day || !validDays.includes(dp.day)) {
            return res.status(400).json({ error: `Invalid day: ${dp.day}` });
          }
          if (!Array.isArray(dp.routes)) {
            return res.status(400).json({ error: "Each day must have a routes array" });
          }
        }
        const typedDays = proposedDays as DayPlan[];

        const company = await storage.getCompany(companyId);
        if (!company) return res.status(404).json({ error: "Company not found" });

        const daysToApply: DayPlan[] =
          acceptedDays && Array.isArray(acceptedDays)
            ? typedDays.filter((d) => acceptedDays.includes(d.day))
            : typedDays;

        const companyPlans = await storage.getServicePlans(companyId, { isActive: true });
        const validPlanIds = new Set(companyPlans.map((p) => p.id));

        const getStopId = (s: PlanStop): string | undefined => s.servicePlanId || s.id;

        let totalRoutes = 0;
        let _totalStopsValidated = 0;
        for (const dayPlan of daysToApply) {
          for (const route of dayPlan.routes) {
            const routeStops = (route.stops || []).filter((s) => {
              const spId = getStopId(s);
              return spId && validPlanIds.has(spId);
            });
            if (routeStops.length > 0) {
              totalRoutes++;
              _totalStopsValidated += routeStops.length;
            }
          }
        }

        if (totalRoutes === 0) {
          return res.status(400).json({ error: "No valid stops to apply" });
        }

        const existingRoutes = await storage.getRoutes(companyId);

        let routesCreated = 0;
        let stopsUpdated = 0;
        const updatedPlanIds: string[] = [];
        const affectedRouteIds = new Set<string>();

        for (const dayPlan of daysToApply) {
          const day = dayPlan.day;
          let dayRouteIdx = 0;
          for (let rIdx = 0; rIdx < dayPlan.routes.length; rIdx++) {
            const proposedRoute = dayPlan.routes[rIdx];
            const validStops = (proposedRoute.stops || []).filter((s) => {
              const spId = getStopId(s);
              return spId && validPlanIds.has(spId);
            });
            if (validStops.length === 0) continue;

            const routeLabel =
              proposedRoute.routeLabel || `${day.charAt(0).toUpperCase() + day.slice(1)} Route`;
            const techKey = `${day}|${routeLabel}`;
            const hasTechAssignment = techKey in techAssignmentsMap;
            const assignedTechId = hasTechAssignment
              ? techAssignmentsMap[techKey] || null
              : undefined;

            let existingRoute: (typeof existingRoutes)[number] | undefined =
              dayRouteIdx === 0
                ? existingRoutes.find((r) => r.dayOfWeek === day && !r.date && !r.isLocked)
                : undefined;
            const resolvedTechId: string | null = assignedTechId ?? null;
            if (!existingRoute) {
              const newRoute = await storage.createRoute({
                companyId,
                name: routeLabel,
                dayOfWeek: day,
                color: ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6"][routesCreated % 5],
                ...(hasTechAssignment ? { technicianId: resolvedTechId } : {}),
              });
              existingRoute = newRoute;
              existingRoutes.push(newRoute);
              routesCreated++;
            } else if (hasTechAssignment) {
              await storage.updateRoute(existingRoute.id, companyId, {
                technicianId: resolvedTechId,
              });
              existingRoute = { ...existingRoute, technicianId: resolvedTechId };
            }
            dayRouteIdx++;
            affectedRouteIds.add(existingRoute!.id);

            // Collect the service plan IDs proposed for this destination route
            const proposedStopIds = new Set(validStops.map((s) => getStopId(s)!));

            // Find stops already on this route that are NOT in the proposal.
            // Bump them to a high stopOrder (99000 + current) so that after
            // renumberRouteStops sorts by stopOrder ASC they land after the
            // optimized sequence (1..N) rather than being interleaved with it.
            const preExistingNonProposed = companyPlans.filter(
              (p) => p.routeId === existingRoute!.id && !proposedStopIds.has(p.id)
            );
            for (const plan of preExistingNonProposed) {
              await storage.updateServicePlan(plan.id, companyId, {
                stopOrder: 99000 + (plan.stopOrder ?? 0),
              });
            }

            for (let sIdx = 0; sIdx < validStops.length; sIdx++) {
              const stop = validStops[sIdx];
              const spId = getStopId(stop)!;
              const planBefore = companyPlans.find((p) => p.id === spId);
              if (planBefore?.routeId) affectedRouteIds.add(planBefore.routeId);
              await storage.updateServicePlan(spId, companyId, {
                routeId: existingRoute!.id,
                dayOfWeek: day,
                stopOrder: sIdx + 1,
              });
              updatedPlanIds.push(spId);
              stopsUpdated++;
            }
          }
        }

        for (const rId of Array.from(affectedRouteIds)) {
          clearRouteOptimizationState(rId, companyId).catch(console.error);
          await storage.renumberRouteStops(rId, companyId);
        }

        const appliedDaySet = new Set(daysToApply.map((d) => d.day));
        let routesRemoved = 0;
        const refreshedRoutes = await storage.getRoutes(companyId);
        const allPlans = await storage.getServicePlans(companyId, { isActive: true });
        for (const route of refreshedRoutes) {
          if (!route.dayOfWeek || route.date || route.isLocked) continue;
          if (!(appliedDaySet as Set<string>).has(route.dayOfWeek)) continue;
          const assignedStops = allPlans.filter((p) => p.routeId === route.id);
          if (assignedStops.length === 0) {
            try {
              await storage.deleteRoute(route.id, companyId);
              routesRemoved++;
            } catch (_e) {}
          }
        }

        // Respond immediately — visit regeneration runs in the background so the
        // HTTP request doesn't time out on large route sets.
        res.json({
          applied: true,
          routesCreated,
          routesRemoved,
          stopsUpdated,
        });

        // Background: delete stale visits and regenerate for the next 6 months.
        // Errors here are non-fatal — visits will catch up on the next nightly run.
        (async () => {
          try {
            const tz = company?.timezone || "America/New_York";
            const today = getCompanyToday(tz);
            const affectedPlanIds = Array.from(new Set(updatedPlanIds));
            if (affectedPlanIds.length > 0) {
              await storage.deleteFutureScheduledVisitsForPlans(affectedPlanIds, today);
              const { generateVisitsForPlans } = await import("../jobs/auto-visits");
              const startDate = new Date(today + "T00:00:00Z");
              startDate.setUTCDate(startDate.getUTCDate() + 1);
              const endDate = new Date(today + "T00:00:00Z");
              endDate.setUTCDate(endDate.getUTCDate() + 182);
              await generateVisitsForPlans(
                companyId,
                affectedPlanIds,
                startDate.toISOString().split("T")[0],
                endDate.toISOString().split("T")[0]
              );
              console.log(
                `[apply-weekly-plan] Background visit regen complete for ${affectedPlanIds.length} plans`
              );
            }
          } catch (genErr) {
            console.error(
              "[apply-weekly-plan] Failed to regenerate visits after optimization:",
              genErr
            );
          }
        })();
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/routes/:id/reverse", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(p(req.params.id), companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      if (route.isLocked) {
        return res.status(409).json({ error: "Route is locked. Unlock it before reversing." });
      }

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans
        .filter((sp) => sp.routeId === route.id)
        .sort((a, b) => a.stopOrder - b.stopOrder);

      if (routePlans.length < 2) {
        return res.json({ reversed: false, message: "Not enough stops to reverse" });
      }

      const reversed = [...routePlans].reverse();
      for (let i = 0; i < reversed.length; i++) {
        await storage.updateServicePlan(reversed[i].id, companyId, { stopOrder: i + 1 });
      }

      res.json({ reversed: true, stopCount: routePlans.length });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/routes/:id/reorder-stops",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const routeId = p(req.params.id);
        const route = await storage.getRoute(routeId, companyId);
        if (!route) return res.status(404).json({ error: "Route not found" });
        if (route.isLocked)
          return res.status(409).json({ error: "Route is locked. Unlock it before reordering." });
        const { orderedIds } = req.body;
        if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
          return res.status(400).json({ error: "orderedIds must be a non-empty array" });
        }
        const uniqueIds = [...new Set(orderedIds as string[])];
        if (uniqueIds.length !== orderedIds.length) {
          return res.status(400).json({ error: "orderedIds must not contain duplicates" });
        }
        const currentStops = await storage.getServicePlans(companyId, { routeId, isActive: true });
        const currentIds = new Set(currentStops.map((s) => s.id));
        const requestedIds = new Set(uniqueIds);
        const missingIds = [...currentIds].filter((id) => !requestedIds.has(id));
        const extraIds = [...requestedIds].filter((id) => !currentIds.has(id));
        if (missingIds.length > 0 || extraIds.length > 0) {
          return res
            .status(400)
            .json({ error: "orderedIds must contain exactly the route's current active stop IDs" });
        }
        await storage.reorderRouteStops(routeId, companyId, uniqueIds);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/routes/:id/metrics", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(p(req.params.id), companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans
        .filter((sp) => sp.routeId === route.id)
        .sort((a, b) => a.stopOrder - b.stopOrder);

      if (routePlans.length < 2) {
        return res.json({
          totalDistance: 0,
          totalDuration: 0,
          legs: [],
          stopCount: routePlans.length,
        });
      }

      const allProperties = await storage.getProperties(companyId);
      const propMap = new Map(allProperties.map((p) => [p.id, p]));

      const stops: { id: string; latitude: number; longitude: number }[] = [];
      const missingCoords: string[] = [];

      for (const sp of routePlans) {
        const prop = propMap.get(sp.propertyId);
        if (prop?.latitude && prop?.longitude) {
          stops.push({
            id: sp.id,
            latitude: Number(prop.latitude),
            longitude: Number(prop.longitude),
          });
        } else {
          missingCoords.push(sp.id);
        }
      }

      if (stops.length < 2) {
        return res.json({
          totalDistance: 0,
          totalDuration: 0,
          legs: [],
          stopCount: routePlans.length,
          missingCoords,
        });
      }

      const company = await storage.getCompany(companyId);
      const startPoint = company
        ? await resolveStartPoint(
            companyId,
            (route as Record<string, unknown>).depotId as string | null | undefined,
            route.technicianId ?? null,
            company
          )
        : undefined;

      const metrics = await getRouteMetricsWithLegs(stops, startPoint);

      if (!metrics) {
        return res.json({
          totalDistance: 0,
          totalDuration: 0,
          legs: [],
          stopCount: routePlans.length,
          missingCoords,
          error: "Unable to calculate driving metrics",
        });
      }

      // Compute over-duration flag server-side so the UI has a reliable flag,
      // not a client-side estimate.  Only applies in time-based planning mode.
      const co2 = company as Record<string, unknown>;
      const routePlanningMode2 = co2.routePlanningMode === "time" ? "time" : "stops";
      const avgMinutesPerStop2 =
        typeof co2.avgMinutesPerStop === "number" && co2.avgMinutesPerStop > 0
          ? (co2.avgMinutesPerStop as number)
          : 12;
      const maxRouteDurationHours2 =
        typeof company?.maxRouteDurationHours === "number" && company.maxRouteDurationHours > 0
          ? company.maxRouteDurationHours
          : null;
      const estimatedTotalMinutes2 =
        Math.round(metrics.totalDuration) + routePlans.length * avgMinutesPerStop2;
      const overDuration =
        routePlanningMode2 === "time" &&
        maxRouteDurationHours2 != null &&
        estimatedTotalMinutes2 > maxRouteDurationHours2 * 60;

      res.json({
        totalDistance: Math.round(metrics.totalDistance * 10) / 10,
        totalDuration: Math.round(metrics.totalDuration),
        legs: metrics.legs.map((l) => ({
          fromId: l.fromId,
          toId: l.toId,
          distance: Math.round(l.distance * 10) / 10,
          duration: Math.round(l.duration),
        })),
        stopCount: routePlans.length,
        missingCoords: missingCoords.length > 0 ? missingCoords : undefined,
        overDuration,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/routes/:id/dispatch", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(p(req.params.id), companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });
      if (!route.technicianId)
        return res.status(400).json({ error: "No technician assigned to this route" });

      const targetDate = req.body.date || new Date().toISOString().split("T")[0];

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans
        .filter((sp) => sp.routeId === route.id)
        .sort((a, b) => a.stopOrder - b.stopOrder);

      if (routePlans.length === 0) {
        return res.status(400).json({ error: "No stops in this route to dispatch" });
      }

      const existingVisits = await storage.getVisits(companyId, { date: targetDate });
      const existingSet = new Set(
        existingVisits.map((v) => `${v.servicePlanId}_${v.scheduledDate}`)
      );

      const dayMap: Record<string, number> = {
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
        sunday: 0,
      };

      let created = 0;
      let skipped = 0;
      for (const plan of routePlans) {
        const key = `${plan.id}_${targetDate}`;
        if (existingSet.has(key)) {
          skipped++;
          continue;
        }

        const targetDateObj = new Date(targetDate + "T00:00:00Z");
        const targetDayOfWeek = targetDateObj.getUTCDay();
        const planDayNum = plan.dayOfWeek ? dayMap[plan.dayOfWeek] : undefined;
        if (planDayNum !== undefined && targetDayOfWeek !== planDayNum) {
          skipped++;
          continue;
        }

        if (plan.startDate) {
          const planStartDate = new Date(plan.startDate + "T00:00:00Z");
          if (targetDateObj < planStartDate) {
            skipped++;
            continue;
          }
        }
        if (plan.endDate) {
          const planEndDate = new Date(plan.endDate + "T00:00:00Z");
          if (targetDateObj > planEndDate) {
            skipped++;
            continue;
          }
        }

        let shouldGenerate = true;
        if (plan.frequency !== "weekly" && !plan.startDate) {
          shouldGenerate = false;
        } else if (plan.frequency === "biweekly") {
          const planStartDate = new Date(plan.startDate + "T00:00:00Z");
          const diffMs = targetDateObj.getTime() - planStartDate.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          const diffWeeks = Math.floor(diffDays / 7);
          if (diffWeeks % 2 !== 0) shouldGenerate = false;
        } else if (plan.frequency === "monthly") {
          const planStartDate = new Date(plan.startDate + "T00:00:00Z");
          if (
            !(
              targetDateObj.getUTCMonth() === planStartDate.getUTCMonth() &&
              targetDateObj.getUTCFullYear() === planStartDate.getUTCFullYear()
            )
          ) {
            const effectiveDayNum = planDayNum !== undefined ? planDayNum : targetDayOfWeek;
            const firstOfMonth = new Date(
              Date.UTC(targetDateObj.getUTCFullYear(), targetDateObj.getUTCMonth(), 1)
            );
            let firstTargetDay = new Date(firstOfMonth);
            while (firstTargetDay.getUTCDay() !== effectiveDayNum) {
              firstTargetDay.setUTCDate(firstTargetDay.getUTCDate() + 1);
            }
            if (targetDateObj.getTime() !== firstTargetDay.getTime()) shouldGenerate = false;
          }
        } else if (plan.frequency === "onetime") {
          if (targetDate !== plan.startDate) shouldGenerate = false;
        }

        if (!shouldGenerate) {
          skipped++;
          continue;
        }

        const newVisit = await storage.createVisit({
          companyId,
          servicePlanId: plan.id,
          propertyId: plan.propertyId,
          routeId: route.id,
          scheduledDate: targetDate,
          status: "scheduled",
        });
        if (newVisit) created++;
      }

      res.json({
        dispatched: true,
        technicianId: route.technicianId,
        date: targetDate,
        visitsCreated: created,
        visitsSkipped: skipped,
        totalStops: routePlans.length,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Depot Routes ================

  app.get("/api/depots", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const list = await storage.getDepots(companyId);
      res.json(list);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/depots", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const schema = z.object({
        name: z.string().min(1),
        address: z.string().min(1),
        latitude: z.coerce.number(),
        longitude: z.coerce.number(),
        isPrimary: z.boolean().optional().default(false),
      });
      const body = schema.parse(req.body);

      // If this is the first depot or isPrimary requested, manage primary flag
      const existing = await storage.getDepots(companyId);
      const shouldBePrimary = body.isPrimary || existing.length === 0;

      const depot = await storage.createDepot({
        companyId,
        name: body.name,
        address: body.address,
        latitude: String(body.latitude),
        longitude: String(body.longitude),
        isPrimary: shouldBePrimary,
      });

      // If this depot is primary, clear primary flag from others
      if (shouldBePrimary && existing.length > 0) {
        await storage.setPrimaryDepot(depot.id, companyId);
      }

      res.status(201).json(depot);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/depots/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const existing = await storage.getDepotById(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Depot not found" });

      const schema = z.object({
        name: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
        latitude: z.coerce.number().optional(),
        longitude: z.coerce.number().optional(),
      });
      const body = schema.parse(req.body);
      const updates: { name?: string; address?: string; latitude?: string; longitude?: string } =
        {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.address !== undefined) updates.address = body.address;
      if (body.latitude !== undefined) updates.latitude = String(body.latitude);
      if (body.longitude !== undefined) updates.longitude = String(body.longitude);

      const depot = await storage.updateDepot(p(req.params.id), companyId, updates);
      res.json(depot);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/depots/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const existing = await storage.getDepotById(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Depot not found" });
      if (existing.isPrimary) {
        return res
          .status(400)
          .json({ error: "Cannot delete the primary depot. Set another depot as primary first." });
      }
      await storage.deleteDepot(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/depots/:id/set-primary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const existing = await storage.getDepotById(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Depot not found" });
      const depot = await storage.setPrimaryDepot(p(req.params.id), companyId);
      res.json(depot);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Update technician home address (used as a candidate start in route optimization)
  app.patch(
    "/api/team/:userId/home-address",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role, userId: currentUserId } = await getCompanyContext(req);
        const targetUserId = p(req.params.userId);

        // Techs can only update their own home address; owner/admin can update anyone on the team
        if (targetUserId !== currentUserId) {
          requireRole(role, ["owner", "admin"]);
        }

        // Verify target user belongs to caller's company
        const [membership] = await db
          .select({ userId: companyUsers.userId })
          .from(companyUsers)
          .where(
            and(
              eq(companyUsers.userId, targetUserId),
              eq(companyUsers.companyId, companyId),
              eq(companyUsers.isActive, true)
            )
          );
        if (!membership) return res.status(404).json({ error: "Team member not found" });

        const schema = z.object({
          homeAddress: z.string().nullable(),
          homeLatitude: z.number().optional(),
          homeLongitude: z.number().optional(),
        });
        const {
          homeAddress,
          homeLatitude: clientLat,
          homeLongitude: clientLng,
        } = schema.parse(req.body);

        if (!homeAddress) {
          await db
            .update(users)
            .set({
              homeAddress: null,
              homeLatitude: null,
              homeLongitude: null,
              updatedAt: new Date(),
            })
            .where(eq(users.id, targetUserId));
          return res.json({
            success: true,
            homeAddress: null,
            homeLatitude: null,
            homeLongitude: null,
          });
        }

        let finalLat: number | null = null;
        let finalLng: number | null = null;

        if (clientLat != null && clientLng != null) {
          // Use coords provided by client (from Mapbox autocomplete) — skip geocoding round-trip
          finalLat = clientLat;
          finalLng = clientLng;
        } else {
          // Fall back to server-side geocoding
          const coords = await geocodeAddress(homeAddress);
          if (!coords) {
            return res.status(422).json({
              error: "Address could not be geocoded. Please enter a more specific address.",
            });
          }
          finalLat = parseFloat(coords.latitude);
          finalLng = parseFloat(coords.longitude);
        }

        await db
          .update(users)
          .set({
            homeAddress,
            homeLatitude: finalLat,
            homeLongitude: finalLng,
            updatedAt: new Date(),
          })
          .where(eq(users.id, targetUserId));

        return res.json({
          success: true,
          homeAddress,
          homeLatitude: finalLat,
          homeLongitude: finalLng,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // Update technician default depot
  app.patch(
    "/api/team/:userId/default-depot",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role, userId: currentUserId } = await getCompanyContext(req);
        const targetUserId = p(req.params.userId);

        // Techs can only update their own depot; owner/admin can update anyone on the team
        if (targetUserId !== currentUserId) {
          requireRole(role, ["owner", "admin"]);
        }

        // Verify target user belongs to caller's company
        const [membership] = await db
          .select({ userId: companyUsers.userId })
          .from(companyUsers)
          .where(
            and(
              eq(companyUsers.userId, targetUserId),
              eq(companyUsers.companyId, companyId),
              eq(companyUsers.isActive, true)
            )
          );
        if (!membership) return res.status(404).json({ error: "Team member not found" });

        const schema = z.object({ depotId: z.string().nullable() });
        const { depotId } = schema.parse(req.body);

        // Verify depot belongs to this company (if not null)
        if (depotId) {
          const depot = await storage.getDepotById(depotId, companyId);
          if (!depot) return res.status(404).json({ error: "Depot not found" });
        }

        await db
          .update(users)
          .set({ defaultDepotId: depotId, updatedAt: new Date() })
          .where(eq(users.id, targetUserId));
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );
}

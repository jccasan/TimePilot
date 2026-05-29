/**
 * route-cap-fixer.ts
 *
 * Shared service used by both the tenant-facing apply-max-stops route and the
 * admin route-health fix endpoint.  Splits every route in a company that
 * exceeds `maxStopsPerRoute` using the same k-means + two-start TSP approach
 * as the original implementation.
 */
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { users } from "@shared/models/auth";
import { getCompanyToday } from "../utils/company-date";

export interface SplitSummary {
  routesSplit: number;
  subRoutesCreated: number;
  skipped: number;
  errors: string[];
  splitDetails: { originalName: string; newRoutes: { name: string; stopCount: number }[] }[];
}

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

/**
 * Split all oversized routes for a company so none exceed `maxStopsNum`.
 * Updates the company's `maxStopsPerRoute` setting before splitting.
 */
export async function splitOversizedRoutes(
  companyId: string,
  maxStopsNum: number
): Promise<SplitSummary> {
  await storage.updateCompany(companyId, { maxStopsPerRoute: maxStopsNum });

  const company = await storage.getCompany(companyId);
  if (!company) throw new Error("Company not found");

  const { kMeansClustering } = await import("./weekly-optimizer");
  const { optimizeRouteAsyncMultiStart } = await import("./route-optimizer");
  const { routificOptimize } = await import("./routific");

  const allRoutes = await storage.getRoutes(companyId);
  const allPlans = await storage.getServicePlans(companyId, { isActive: true });
  const allProperties = await storage.getProperties(companyId);
  const propertyMap = new Map(allProperties.map((p) => [p.id, p]));

  const plansByRoute = new Map<string, typeof allPlans>();
  for (const route of allRoutes) plansByRoute.set(route.id, []);
  for (const plan of allPlans) {
    if (plan.routeId && plansByRoute.has(plan.routeId)) {
      plansByRoute.get(plan.routeId)!.push(plan);
    }
  }

  const oversized = allRoutes.filter((r) => (plansByRoute.get(r.id)?.length ?? 0) > maxStopsNum);

  if (oversized.length === 0) {
    return {
      routesSplit: 0,
      subRoutesCreated: 0,
      skipped: allRoutes.length,
      errors: [],
      splitDetails: [],
    };
  }

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
  const splitDetails: SplitSummary["splitDetails"] = [];

  for (const route of oversized) {
    try {
      const candidateStarts = await resolveAllCandidateStarts(
        companyId,
        (route as Record<string, unknown>).depotId as string | null | undefined,
        route.technicianId ?? null,
        company
      );

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

      const routePlanCount = plansByRoute.get(route.id)?.length ?? 0;
      const k = Math.ceil(routePlanCount / maxStopsNum);
      const clusters = kMeansClustering(weeklyStops, k);

      const routeSplitDetail: (typeof splitDetails)[number] = {
        originalName: route.name,
        newRoutes: [],
      };

      for (let ci = 0; ci < clusters.length; ci++) {
        const cluster = clusters[ci];
        let targetRouteId: string;
        let targetRouteName: string;

        if (ci === 0) {
          targetRouteId = route.id;
          targetRouteName = route.name;
        } else {
          const suffix = suffixLetters[ci - 1] || String(ci + 1);
          const sourceDepotId = (route as Record<string, unknown>).depotId as
            | string
            | null
            | undefined;
          targetRouteName = `${route.name}-${suffix}`;
          const newRoute = await storage.createRoute({
            companyId,
            name: targetRouteName,
            dayOfWeek: route.dayOfWeek || undefined,
            technicianId: route.technicianId || undefined,
            color: splitColors[(ci - 1) % splitColors.length],
            ...(sourceDepotId ? { depotId: sourceDepotId } : {}),
          });
          targetRouteId = newRoute.id;
          subRoutesCreated++;
        }

        const clusterStops = cluster.map((s) => ({
          id: s.id,
          latitude: s.latitude,
          longitude: s.longitude,
        }));

        const internalResult = await optimizeRouteAsyncMultiStart(clusterStops, candidateStarts);
        let orderedIds: string[];
        if (!internalResult.degraded) {
          orderedIds = internalResult.orderedIds;
        } else {
          const routificRes = await routificOptimize(
            clusterStops,
            internalResult.bestStart,
            company.maxRouteDurationHours && company.maxRouteDurationHours > 0
              ? { maxDurationHours: company.maxRouteDurationHours }
              : undefined
          );
          orderedIds = routificRes ? routificRes.orderedIds : internalResult.orderedIds;
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

        routeSplitDetail.newRoutes.push({
          name: targetRouteName,
          stopCount: orderedIds.length + unordered.length,
        });
      }
      splitDetails.push(routeSplitDetail);
      routesSplit++;
    } catch (splitErr: unknown) {
      console.error(`[route-cap-fixer] Failed to split route ${route.name}:`, splitErr);
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
    console.error("[route-cap-fixer] Failed to regenerate visits:", genErr);
  }

  return {
    routesSplit,
    subRoutesCreated,
    skipped: allRoutes.length - oversized.length,
    errors,
    splitDetails,
  };
}

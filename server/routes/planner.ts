import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { planFourWeekRoutes } from "../services/planner/planner";
import { buildPlannerInputs } from "../services/planner/scoopilotAdapter";
import { getPlanStoreForCompany } from "../services/planner/planStore";
import {
  createDraftRoutePlan,
  approveRoutePlan,
  rejectRoutePlan,
} from "../services/planner/approval";
import { createRoutingProvider } from "../services/planner/routingProviderFactory";
import { InMemoryTravelLegCache } from "../services/planner/travelLegCache";
import { isAuthenticated, getCompanyContext, requireRole, handleError, p } from "./shared";

// Ordered weekday names matching the dayOfWeek enum in the schema.
const WEEK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
type WeekDay = (typeof WEEK_DAYS)[number];

/**
 * Derive a concrete day-of-week for the nth route in a planning week.
 * Route index 0 → monday, 1 → tuesday, …, 4+ → friday (capped).
 */
function routeIndexToDayOfWeek(routeIndex: number): WeekDay {
  return WEEK_DAYS[Math.min(routeIndex, WEEK_DAYS.length - 1)];
}

// Per-server travel leg cache (shared across all requests, keyed by leg).
const travelCache = new InMemoryTravelLegCache();

export function registerPlannerRoutes(app: Express): void {
  /**
   * POST /api/planner/run
   * Generate a 4-week draft plan for the authenticated company and persist it
   * in the company's in-memory plan store.
   */
  app.post("/api/planner/run", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);

      const { customers, settings } = await buildPlannerInputs(companyId);

      const routingProvider = createRoutingProvider();
      const result = await planFourWeekRoutes(
        customers,
        settings,
        new Date(),
        routingProvider,
        travelCache
      );

      const store = getPlanStoreForCompany(companyId);
      const plan = await createDraftRoutePlan(result, store, {
        generatedBy: userId,
        source: "automatic",
      });

      res.json({ plan });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/planner/plans
   * List all draft/approved/rejected plans for the company.
   */
  app.get("/api/planner/plans", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const store = getPlanStoreForCompany(companyId);
      const plans = await store.list();
      res.json({ plans });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * POST /api/planner/plans/:planId/approve
   * Approve a draft plan (marks all routes in it as approved).
   */
  app.post(
    "/api/planner/plans/:planId/approve",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);

        const planId = p(req.params.planId);
        const store = getPlanStoreForCompany(companyId);

        const existing = await store.get(planId);
        if (!existing) {
          return res.status(404).json({ error: "Plan not found" });
        }

        const plan = await approveRoutePlan(planId, userId, store);
        res.json({ plan });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  /**
   * POST /api/planner/plans/:planId/reject
   * Reject a plan with a reason.
   */
  app.post(
    "/api/planner/plans/:planId/reject",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);

        const planId = p(req.params.planId);
        const reason = (req.body as { reason?: string }).reason ?? "No reason provided";
        const store = getPlanStoreForCompany(companyId);

        const existing = await store.get(planId);
        if (!existing) {
          return res.status(404).json({ error: "Plan not found" });
        }

        const plan = await rejectRoutePlan(planId, userId, reason, store);
        res.json({ plan });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  /**
   * POST /api/planner/plans/:planId/apply
   * Owner/admin only — commit an approved plan to real routes.
   *
   * For each planned route within each week:
   *   - Finds or creates a matching route row by name, assigning a concrete
   *     dayOfWeek derived from the route's position in the week (0→monday,
   *     1→tuesday, …).
   *   - Writes routeId, stopOrder, and dayOfWeek back to the servicePlan for
   *     each stop.
   */
  app.post(
    "/api/planner/plans/:planId/apply",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);

        const planId = p(req.params.planId);
        const store = getPlanStoreForCompany(companyId);
        const plan = await store.get(planId);

        if (!plan) {
          return res.status(404).json({ error: "Plan not found" });
        }
        if (plan.status !== "approved") {
          return res.status(400).json({
            error: "Plan must be approved before it can be applied",
            status: plan.status,
          });
        }

        // Gather existing routes so we can match by name.
        const existingRoutes = await storage.getRoutes(companyId);
        const routeByName = new Map(existingRoutes.map((r) => [r.name, r]));

        // Build contact→servicePlan map using the same first-wins order as the
        // adapter (buildCustomers), so the same plan that drove clustering is
        // the one that gets updated.
        const activePlans = await storage.getServicePlans(companyId, { isActive: true });
        const planByContactId = new Map<string, (typeof activePlans)[0]>();
        for (const sp of activePlans) {
          if (!sp.contactId) continue;
          if (!planByContactId.has(sp.contactId)) {
            planByContactId.set(sp.contactId, sp);
          }
        }

        const appliedRouteCount = { created: 0, reused: 0, stopsUpdated: 0 };

        // Optional week filter: if weekNumbers is provided, only apply those weeks.
        const body = req.body as { weekNumbers?: number[] };
        const weekFilter =
          Array.isArray(body.weekNumbers) && body.weekNumbers.length > 0
            ? new Set(body.weekNumbers)
            : null;

        const weeksToApply = weekFilter
          ? plan.planningWindow.weeks.filter((w) => weekFilter.has(w.weekNumber))
          : plan.planningWindow.weeks;

        for (const week of weeksToApply) {
          for (let routeIndex = 0; routeIndex < week.plannedRoutes.length; routeIndex++) {
            const plannedRoute = week.plannedRoutes[routeIndex];

            // Derive a concrete day-of-week from this route's position in the week.
            const assignedDay = routeIndexToDayOfWeek(routeIndex);

            // Find or create the real route row.
            let dbRoute = routeByName.get(plannedRoute.routeName);
            if (!dbRoute) {
              dbRoute = await storage.createRoute({
                companyId,
                name: plannedRoute.routeName,
                dayOfWeek: assignedDay,
              });
              routeByName.set(dbRoute.name, dbRoute);
              appliedRouteCount.created += 1;
            } else {
              appliedRouteCount.reused += 1;
            }

            // Write routeId, stopOrder, and dayOfWeek (from the plan's day
            // assignment) back to each matching service plan.
            for (const stop of plannedRoute.assignedStops) {
              const sp = planByContactId.get(stop.customerId);
              if (!sp) continue;
              await storage.updateServicePlan(sp.id, companyId, {
                routeId: dbRoute.id,
                stopOrder: stop.stopOrder,
                dayOfWeek: assignedDay,
              });
              appliedRouteCount.stopsUpdated += 1;
            }
          }
        }

        res.json({
          message: "Plan applied successfully",
          planId,
          appliedRouteCount,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );
}

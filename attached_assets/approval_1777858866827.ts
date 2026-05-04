// Draft / approve / reject / rollback workflow for route plans.
// In-memory store by default; swap with a DB by replacing RoutePlanStore.

import type {
  FourWeekPlanResult,
  PlannedRoute,
  RoutePlan,
  RoutePlanSource,
} from "./types.js";

export interface RoutePlanStore {
  save(plan: RoutePlan): Promise<void>;
  get(planId: string): Promise<RoutePlan | undefined>;
  list(): Promise<RoutePlan[]>;
}

export class InMemoryRoutePlanStore implements RoutePlanStore {
  private store = new Map<string, RoutePlan>();

  async save(plan: RoutePlan): Promise<void> {
    this.store.set(plan.planId, plan);
  }
  async get(planId: string): Promise<RoutePlan | undefined> {
    return this.store.get(planId);
  }
  async list(): Promise<RoutePlan[]> {
    return Array.from(this.store.values()).sort((a, b) =>
      a.generatedAt.localeCompare(b.generatedAt),
    );
  }
}

export interface CreateDraftOptions {
  generatedBy: string;
  source?: RoutePlanSource;
  previousPlanId?: string;
}

let planSeq = 0;

export async function createDraftRoutePlan(
  result: FourWeekPlanResult,
  store: RoutePlanStore,
  opts: CreateDraftOptions,
): Promise<RoutePlan> {
  planSeq += 1;
  const plan: RoutePlan = {
    planId: `plan_${Date.now().toString(36)}_${planSeq}`,
    version: 1,
    status: "draft",
    generatedAt: new Date().toISOString(),
    generatedBy: opts.generatedBy,
    source: opts.source ?? "automatic",
    previousPlanId: opts.previousPlanId,
    planningWindow: result.planningWindow,
    summary: result.fourWeekSummary,
    warnings: result.warnings,
  };
  await store.save(plan);
  return plan;
}

export async function approveRoutePlan(
  planId: string,
  approvedBy: string,
  store: RoutePlanStore,
): Promise<RoutePlan> {
  const plan = await store.get(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  if (plan.status === "approved") return plan;
  const next: RoutePlan = {
    ...plan,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy,
  };
  // Mark all routes in the plan as approved.
  for (const week of next.planningWindow.weeks) {
    week.plannedRoutes = week.plannedRoutes.map((r): PlannedRoute => ({ ...r, status: "approved" }));
  }
  await store.save(next);
  return next;
}

export async function rejectRoutePlan(
  planId: string,
  rejectedBy: string,
  reason: string,
  store: RoutePlanStore,
): Promise<RoutePlan> {
  const plan = await store.get(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  const next: RoutePlan = {
    ...plan,
    status: "rejected",
    approvedAt: new Date().toISOString(),
    approvedBy: rejectedBy,
    warnings: [...plan.warnings, `rejected: ${reason}`],
  };
  for (const week of next.planningWindow.weeks) {
    week.plannedRoutes = week.plannedRoutes.map((r): PlannedRoute => ({ ...r, status: "rejected" }));
  }
  await store.save(next);
  return next;
}

export async function rollbackRoutePlan(
  planId: string,
  store: RoutePlanStore,
): Promise<RoutePlan | undefined> {
  const plan = await store.get(planId);
  if (!plan?.previousPlanId) return undefined;
  const prev = await store.get(plan.previousPlanId);
  return prev;
}

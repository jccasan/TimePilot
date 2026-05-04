// Route stability helpers. Stability is normally a score penalty rather than a
// hard rule. routeLock=true is the one exception: locked customers stay where
// they are unless the result is infeasible.

import type { Customer, PlannedRoute } from "./types";

export interface StabilityContext {
  movedCustomerIds: Set<string>;
  lockedRespected: number;
  lockedViolated: number;
}

export function computeStabilityContext(
  customers: Customer[],
  plannedRoutes: PlannedRoute[]
): StabilityContext {
  const moved = new Set<string>();
  let respected = 0;
  let violated = 0;

  const newAssignment = new Map<string, string>();
  for (const route of plannedRoutes) {
    for (const stop of route.assignedStops) {
      newAssignment.set(stop.customerId, route.id);
    }
  }

  for (const c of customers) {
    const prev = c.currentAssignedRouteId;
    const next = newAssignment.get(c.id);
    if (prev && next && prev !== next) {
      moved.add(c.id);
      if (c.routeLock) violated += 1;
    } else if (prev && next && prev === next) {
      if (c.routeLock) respected += 1;
    }
  }

  return { movedCustomerIds: moved, lockedRespected: respected, lockedViolated: violated };
}

// Predicate used during candidate generation to penalize splitting locked
// customers from their existing route. Returns true if a customer can be moved.
export function canMoveCustomer(customer: Customer, allowRebalancing: boolean): boolean {
  if (customer.routeLock) return false;
  return allowRebalancing;
}

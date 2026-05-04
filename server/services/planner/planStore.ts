// Per-company InMemoryRoutePlanStore singleton.
// Plans survive across requests within a server session.
// TODO: swap the in-memory store for a Postgres-backed implementation.

import { InMemoryRoutePlanStore } from "./approval";
import type { RoutePlanStore } from "./approval";

const stores = new Map<string, InMemoryRoutePlanStore>();

/**
 * Returns the RoutePlanStore for the given companyId, creating it on first use.
 * Each company gets its own isolated store so plans don't bleed across tenants.
 */
export function getPlanStoreForCompany(companyId: string): RoutePlanStore {
  let store = stores.get(companyId);
  if (!store) {
    store = new InMemoryRoutePlanStore();
    stores.set(companyId, store);
  }
  return store;
}

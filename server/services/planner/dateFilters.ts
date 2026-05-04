// Determine which customers are due in a given planning week and split into
// routable vs excluded sets.

import type { Customer, ExcludedCustomer } from "./types";
import { diffDays, isWithinRange, parseIsoDate } from "./dateUtils";

export function isCustomerDueInWeek(
  customer: Customer,
  weekStartDate: Date,
  weekEndDate: Date
): boolean {
  if (!customer.active) return false;

  switch (customer.serviceFrequency) {
    case "weekly":
      return true;

    case "biweekly": {
      if (!customer.biweeklyAnchorDate) {
        // Without an anchor we cannot place the biweekly cycle deterministically.
        // Default to "due every other week" starting from epoch Mondays so behavior
        // is at least stable across runs.
        const anchor = parseIsoDate("2024-01-01");
        const weeks = Math.floor(diffDays(weekStartDate, anchor) / 7);
        return weeks % 2 === 0;
      }
      const anchor = parseIsoDate(customer.biweeklyAnchorDate);
      const weeks = Math.floor(diffDays(weekStartDate, anchor) / 7);
      return weeks >= 0 && weeks % 2 === 0;
    }

    case "monthly": {
      if (!customer.nextServiceDate) return false;
      const next = parseIsoDate(customer.nextServiceDate);
      return isWithinRange(next, weekStartDate, weekEndDate);
    }

    case "one_time": {
      if (!customer.scheduledServiceDate) return false;
      const sd = parseIsoDate(customer.scheduledServiceDate);
      return isWithinRange(sd, weekStartDate, weekEndDate);
    }
  }
}

export function getDueCustomers(
  customers: Customer[],
  weekStartDate: Date,
  weekEndDate: Date
): Customer[] {
  return customers.filter((c) => isCustomerDueInWeek(c, weekStartDate, weekEndDate));
}

export interface SplitResult {
  routableCustomers: Customer[];
  excludedCustomers: ExcludedCustomer[];
  needsLocationReview: ExcludedCustomer[];
}

export function splitRoutableCustomers(customers: Customer[]): SplitResult {
  const routable: Customer[] = [];
  const excluded: ExcludedCustomer[] = [];
  const needsReview: ExcludedCustomer[] = [];

  for (const c of customers) {
    if (!c.active) {
      excluded.push({ customerId: c.id, customerName: c.name, reason: "inactive" });
      continue;
    }
    if (c.location?.needsLocationReview) {
      needsReview.push({
        customerId: c.id,
        customerName: c.name,
        reason: c.location.reviewReason ?? "needs_location_review",
      });
      continue;
    }
    const lat = c.latitude ?? c.location?.latitude;
    const lng = c.longitude ?? c.location?.longitude;
    if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
      excluded.push({
        customerId: c.id,
        customerName: c.name,
        reason: "missing_coordinates",
      });
      continue;
    }
    const source = c.location?.coordinateSource;
    if (source === "missing" || source === "failed") {
      excluded.push({
        customerId: c.id,
        customerName: c.name,
        reason: `coordinates_${source}`,
      });
      continue;
    }
    if (!Number.isFinite(c.revenuePerVisit) || c.revenuePerVisit <= 0) {
      excluded.push({
        customerId: c.id,
        customerName: c.name,
        reason: "missing_or_invalid_revenue",
      });
      continue;
    }
    routable.push(c);
  }

  return {
    routableCustomers: routable,
    excludedCustomers: excluded,
    needsLocationReview: needsReview,
  };
}

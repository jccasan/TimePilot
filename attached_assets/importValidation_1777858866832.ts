// Pre-routing validation for imported customer rows.
// Returns warnings (allow with caution) vs blocking errors (must fix).

import type { Customer, ImportValidationResult } from "./types.js";

export function validateImportedCustomers(
  customers: Customer[],
  options: { requireServiceTimeOverride?: boolean } = {},
): ImportValidationResult {
  const warnings: ImportValidationResult["importWarnings"] = [];
  const errors: ImportValidationResult["importBlockingErrors"] = [];

  const seenIds = new Set<string>();
  const seenAddresses = new Map<string, string>(); // normalized -> customerId
  const seenNames = new Map<string, string>();

  const validFreqs = new Set(["weekly", "biweekly", "monthly", "one_time"]);

  for (const c of customers) {
    if (!c.id) {
      errors.push({ field: "id", message: "Missing customer id." });
      continue;
    }
    if (seenIds.has(c.id)) {
      errors.push({ customerId: c.id, field: "id", message: "Duplicate customer id." });
    }
    seenIds.add(c.id);

    if (!c.name || !c.name.trim()) {
      errors.push({ customerId: c.id, field: "name", message: "Missing customer name." });
    } else {
      const k = c.name.trim().toLowerCase();
      if (seenNames.has(k) && seenNames.get(k) !== c.id) {
        warnings.push({
          customerId: c.id,
          field: "name",
          message: `Duplicate customer name "${c.name}" (also ${seenNames.get(k)}).`,
        });
      }
      seenNames.set(k, c.id);
    }

    if (!c.address || !c.address.trim()) {
      errors.push({ customerId: c.id, field: "address", message: "Missing service address." });
    } else {
      const k = normalizeAddress(c.address);
      if (seenAddresses.has(k) && seenAddresses.get(k) !== c.id) {
        warnings.push({
          customerId: c.id,
          field: "address",
          message: `Duplicate service address (also ${seenAddresses.get(k)}).`,
        });
      }
      seenAddresses.set(k, c.id);
    }

    if (!validFreqs.has(c.serviceFrequency)) {
      errors.push({
        customerId: c.id,
        field: "serviceFrequency",
        message: `Invalid serviceFrequency "${String(c.serviceFrequency)}".`,
      });
    }

    if (!Number.isFinite(c.revenuePerVisit) || c.revenuePerVisit <= 0) {
      errors.push({
        customerId: c.id,
        field: "revenuePerVisit",
        message: "Missing or non-positive revenuePerVisit.",
      });
    }

    if (
      options.requireServiceTimeOverride &&
      (c.estimatedServiceMinutes === undefined ||
        !Number.isFinite(c.estimatedServiceMinutes) ||
        (c.estimatedServiceMinutes ?? 0) <= 0)
    ) {
      warnings.push({
        customerId: c.id,
        field: "estimatedServiceMinutes",
        message: "Missing per-customer service-time override.",
      });
    }

    const lat = c.latitude ?? c.location?.latitude;
    const lng = c.longitude ?? c.location?.longitude;
    if (
      (lat !== undefined && (Number.isNaN(lat) || lat < -90 || lat > 90)) ||
      (lng !== undefined && (Number.isNaN(lng) || lng < -180 || lng > 180))
    ) {
      errors.push({
        customerId: c.id,
        field: "latitude/longitude",
        message: "Invalid coordinate values.",
      });
    }
    if (c.location?.coordinateSource === "failed") {
      warnings.push({
        customerId: c.id,
        field: "coordinateSource",
        message: "Failed geocoding — needs location review before routing.",
      });
    }

    if (!c.active) {
      warnings.push({
        customerId: c.id,
        field: "active",
        message: "Customer is inactive — will be excluded from routing.",
      });
    }
  }

  return { importWarnings: warnings, importBlockingErrors: errors };
}

function normalizeAddress(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

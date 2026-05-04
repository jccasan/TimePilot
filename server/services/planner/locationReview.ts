// Bulk address review workflow. Owner/admin must confirm coordinates before
// they're saved. Temporary Geocoding suggestions are review-only.

import type { GeocodingProvider } from "./geocodingProvider";
import type {
  AddressMatchStatus,
  AddressReviewCandidate,
  BulkApprovalAuditEntry,
  Customer,
  RoutePlannerSettings,
} from "./types";

export const MANUAL_GOOGLE_MAPS_INSTRUCTIONS = `We couldn't confidently find this address on the map.

To fix it:
1. Open Google Maps.
2. Search for the customer's address.
3. Right-click the correct spot on the map.
4. Click the first line that shows the latitude and longitude.
5. The coordinates will copy automatically.
6. Paste them into the Latitude / Longitude fields for this customer.
7. Save the customer record.

Example format:
39.115661, -77.563601

Make sure the first number goes in Latitude and the second number goes in Longitude.`;

export const BULK_NEEDS_REVIEW_WARNING =
  "You selected one or more locations that were flagged for review. Approving them will save these coordinates as confirmed customer locations for routing. Only continue if you have verified they are correct.";

export interface ClassifyOptions {
  highConfidenceThreshold?: number; // default 0.85
  reviewThreshold?: number; // default 0.5
}

export function classifyAddressCandidate(
  candidate: AddressReviewCandidate,
  _settings: RoutePlannerSettings,
  options: ClassifyOptions = {}
): AddressReviewCandidate {
  const high = options.highConfidenceThreshold ?? 0.85;
  const review = options.reviewThreshold ?? 0.5;

  const reasons: string[] = [];
  let status: AddressMatchStatus;

  if (candidate.suggestedLatitude === undefined || candidate.suggestedLongitude === undefined) {
    status = "failed";
    reasons.push("no_geocode_result");
  } else if ((candidate.confidenceScore ?? 0) >= high) {
    status = "ready_for_bulk_approval";
  } else if ((candidate.confidenceScore ?? 0) >= review) {
    status = "needs_review";
    reasons.push("low_confidence");
  } else {
    status = "failed";
    reasons.push("very_low_confidence");
  }

  return {
    ...candidate,
    matchStatus: status,
    reviewReasons: reasons,
    selectedForApproval: status === "ready_for_bulk_approval",
  };
}

export async function createAddressReviewCandidates(
  customers: Customer[],
  geocoder: GeocodingProvider,
  settings: RoutePlannerSettings,
  options: ClassifyOptions = {}
): Promise<AddressReviewCandidate[]> {
  const out: AddressReviewCandidate[] = [];
  for (const c of customers) {
    const suggestion = await geocoder.geocode(c.address);
    const base: AddressReviewCandidate = {
      customerId: c.id,
      customerName: c.name,
      originalAddress: c.address,
      suggestedFormattedAddress: suggestion?.formattedAddress,
      suggestedLatitude: suggestion?.latitude,
      suggestedLongitude: suggestion?.longitude,
      confidenceScore: suggestion?.confidence,
      matchStatus: "failed",
      reviewReasons: [],
      selectedForApproval: false,
      coordinateSourceAfterApproval: "owner_confirmed_location",
    };
    out.push(classifyAddressCandidate(base, settings, options));
  }
  return out;
}

export interface BulkApprovalResult {
  approvedCount: number;
  updatedCustomers: Customer[];
  audit: BulkApprovalAuditEntry[];
  warnings: string[];
}

export function bulkApproveAddressCandidates(
  candidateIds: string[],
  candidates: AddressReviewCandidate[],
  customers: Customer[],
  approvingUserId: string
): BulkApprovalResult {
  const idSet = new Set(candidateIds);
  const updated: Customer[] = customers.map((c) => ({ ...c }));
  const audit: BulkApprovalAuditEntry[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();
  let approved = 0;

  let approvedAnyNeedsReview = false;

  for (const cand of candidates) {
    if (!idSet.has(cand.customerId)) continue;
    if (cand.matchStatus === "failed") {
      warnings.push(
        `${cand.customerName}: cannot approve — geocoding failed; provide manual coordinates first.`
      );
      continue;
    }
    if (cand.suggestedLatitude === undefined || cand.suggestedLongitude === undefined) {
      warnings.push(`${cand.customerName}: missing suggested coordinates.`);
      continue;
    }
    const target = updated.find((u) => u.id === cand.customerId);
    if (!target) continue;

    target.latitude = cand.suggestedLatitude;
    target.longitude = cand.suggestedLongitude;
    target.location = {
      ...(target.location ?? { originalAddress: cand.originalAddress }),
      latitude: cand.suggestedLatitude,
      longitude: cand.suggestedLongitude,
      originalAddress: cand.originalAddress,
      formattedAddress: cand.suggestedFormattedAddress,
      coordinateSource: "owner_confirmed_location",
      locationConfidence: "confirmed",
      needsLocationReview: false,
      reviewedAt: now,
      reviewedBy: approvingUserId,
    };
    audit.push({
      customerId: cand.customerId,
      approvedAt: now,
      approvedBy: approvingUserId,
      originalAddress: cand.originalAddress,
      suggestedFormattedAddress: cand.suggestedFormattedAddress,
      approvedFromStatus: cand.matchStatus,
      approvedDespiteWarning: cand.matchStatus === "needs_review",
      approvalMethod: "bulk",
    });
    if (cand.matchStatus === "needs_review") approvedAnyNeedsReview = true;
    approved += 1;
  }

  if (approvedAnyNeedsReview) {
    warnings.push(BULK_NEEDS_REVIEW_WARNING);
  }
  return { approvedCount: approved, updatedCustomers: updated, audit, warnings };
}

export function approveSingleAddressCandidate(
  candidateId: string,
  candidates: AddressReviewCandidate[],
  customers: Customer[],
  approvingUserId: string,
  correctedLatLng?: { latitude: number; longitude: number }
): BulkApprovalResult {
  const cand = candidates.find((c) => c.customerId === candidateId);
  if (!cand) {
    return {
      approvedCount: 0,
      updatedCustomers: customers,
      audit: [],
      warnings: ["candidate_not_found"],
    };
  }
  if (correctedLatLng) {
    const tweaked: AddressReviewCandidate = {
      ...cand,
      suggestedLatitude: correctedLatLng.latitude,
      suggestedLongitude: correctedLatLng.longitude,
      matchStatus: "ready_for_bulk_approval",
    };
    return bulkApproveAddressCandidates(
      [candidateId],
      candidates.map((c) => (c.customerId === candidateId ? tweaked : c)),
      customers,
      approvingUserId
    );
  }
  return bulkApproveAddressCandidates([candidateId], candidates, customers, approvingUserId);
}

export function markCustomerNeedsLocationReview(
  customerId: string,
  reason: string,
  customers: Customer[]
): Customer[] {
  return customers.map((c) =>
    c.id === customerId
      ? {
          ...c,
          location: {
            ...(c.location ?? { originalAddress: c.address }),
            originalAddress: c.location?.originalAddress ?? c.address,
            coordinateSource: c.location?.coordinateSource ?? "missing",
            locationConfidence: "uncertain",
            needsLocationReview: true,
            reviewReason: reason,
          },
        }
      : c
  );
}

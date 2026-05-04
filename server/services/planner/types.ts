// Core types for the Servicd route grouping engine.
// All types are pure data containers so the module can be persisted later
// to Postgres, Supabase, Firebase, Redis, Replit DB, or any backend.

export type ServiceFrequency = "weekly" | "biweekly" | "monthly" | "one_time";
export type BillingFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annually";

export type CoordinateSource =
  | "owner_confirmed_location"
  | "manual_override"
  | "mapbox_permanent"
  | "imported_coordinates"
  | "missing"
  | "failed";

export type LocationConfidence = "confirmed" | "likely" | "uncertain" | "failed";

export type RouteCostMode =
  | "office_to_first_stop_only"
  | "office_to_first_and_return"
  | "stop_to_stop_only"
  | "custom_start_location";

export type FeasibilityStatus = "feasible" | "infeasible" | "feasible_with_warnings";

export type RouteStatus =
  | "draft"
  | "approved"
  | "rejected"
  | "partially_approved"
  | "assigned"
  | "completed";

export type PlanningStartMode =
  | "current_monday_if_today_is_monday"
  | "next_monday"
  | "custom_start_date";

export type RoutingProfile = "driving" | "driving-traffic";

export interface CustomerLocation {
  latitude?: number;
  longitude?: number;
  originalAddress: string;
  formattedAddress?: string;
  coordinateSource: CoordinateSource;
  locationConfidence: LocationConfidence;
  needsLocationReview: boolean;
  reviewedAt?: string;
  reviewedBy?: string;
  geocodedAt?: string;
  addressHash?: string;
  reviewReason?: string;
}

export interface Customer {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  serviceFrequency: ServiceFrequency;
  billingFrequency?: BillingFrequency;
  revenuePerVisit: number;
  estimatedServiceMinutes?: number;
  active: boolean;
  lastServiceDate?: string;
  nextServiceDate?: string;
  scheduledServiceDate?: string;
  biweeklyAnchorDate?: string;
  routeLock?: boolean;
  currentAssignedRouteId?: string;
  location?: CustomerLocation;
  importedExternalId?: string;
}

export interface CompanyLocation {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  coordinateSource: CoordinateSource;
  isDefaultStartLocation: boolean;
}

export interface RouteStop {
  customerId: string;
  customerName: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  revenuePerVisit: number;
  stopOrder: number;
  allocatedDriveMinutes?: number;
  allocatedDriveCost?: number;
  allocatedFuelCost?: number;
  estimatedStopProfit?: number;
  estimatedStopProfitMargin?: number;
  warnings?: string[];
}

export interface PlannedRoute {
  id: string;
  routeName: string;
  planningWeekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
  startLocation?: CompanyLocation;
  routeCostMode: RouteCostMode;
  assignedStops: RouteStop[];
  stopCount: number;
  totalServiceMinutes: number;
  totalDriveMinutes: number;
  totalBufferMinutes: number;
  totalRouteMinutes: number;
  estimatedMiles: number;
  revenue: number;
  serviceLaborCost: number;
  driveLaborCost: number;
  fuelCost: number;
  vehicleCost?: number;
  grossProfit: number;
  profitMargin: number;
  revenuePerRouteHour: number;
  driveMinutesPerStop: number;
  stopsPerMile?: number;
  revenuePerMile?: number;
  routeScore: number;
  profitabilityScore: number;
  feasibilityStatus: FeasibilityStatus;
  estimatedFallback?: boolean;
  warnings: string[];
  recommendations: string[];
  optimizationNotes?: string[];
  status: RouteStatus;
  assignedDate?: string;
  assignedTechnicianId?: string;
}

export interface MapboxConfig {
  accessToken: string;
  profile: RoutingProfile;
  country?: string;
  cacheEnabled: boolean;
  coordinatePrecision: number;
  maxMatrixSize?: number;
  requestTimeoutMs?: number;
}

export interface RoutePlannerSettings {
  planningWeeks: number; // default 4
  planningStartMode: PlanningStartMode;
  customStartDate?: string;

  companyStartLocation?: CompanyLocation;
  routeCostMode: RouteCostMode;
  includeOfficeToFirstStop: boolean;
  includeReturnToOffice: boolean;

  // Service time
  defaultServiceMinutesPerStop: number; // default 10
  allowCustomerServiceTimeOverride: boolean;
  routeBufferMinutes: number; // default 30
  perStopBufferMinutes: number; // default 1

  // Time constraints
  minimumViableRouteMinutes: number; // default 60
  targetMinRouteMinutes: number; // default 300
  targetMaxRouteMinutes: number; // default 420
  hardMaxRouteMinutes: number; // default 450
  allowTimeOverride: boolean;
  maxAllowedTimeOverrideMinutes?: number;

  // Stop count warnings
  useStopCountAsHardConstraint: boolean;
  warnAtStopCount: number;
  unusualStopCountThreshold: number;

  // Cost settings
  laborCostPerHour: number;
  averageGasPricePerGallon: number;
  vehicleMilesPerGallon: number;
  useFuelOnlyCost: boolean;
  vehicleCostPerMile?: number;
  includeDriveLaborInProfitability: boolean;
  includeFuelCostInProfitability: boolean;

  // Profitability
  minimumRouteGrossProfit: number;
  targetRouteProfitMargin: number;
  minimumRouteProfitMargin: number;
  targetRevenuePerRouteHour?: number;
  minimumRevenuePerRouteHour?: number;

  // Scoring weights (should sum to ~1.0)
  profitabilityWeight: number;
  driveEfficiencyWeight: number;
  densityWeight: number;
  routeStabilityWeight: number;
  fewestRoutesWeight: number;

  // Routing behavior
  allowRouteRebalancing: boolean;
  preserveExistingRouteAssignments: boolean;
  maxAllowedCustomerMoves?: number;

  // Mapbox
  mapboxConfig?: MapboxConfig;

  // Stop count floor — routes with fewer stops than this are candidates for merging.
  minStopsPerRoute?: number;

  // Calendar (out of scope for v1 routing — kept here for future scheduler)
  blockedDates?: string[];
  holidayDates?: string[];
}

export interface MapboxRouteResult {
  distanceMiles: number;
  durationMinutes: number;
  geometry?: unknown;
  rawResponse?: unknown;
}

export interface TravelMatrix {
  durationsMinutes: number[][];
  distancesMiles: number[][];
  stopIds: string[];
}

export interface TravelLegCacheRecord {
  cacheKey: string;
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  durationMinutes: number;
  distanceMiles: number;
  provider: "mapbox" | "fallback";
  profile: RoutingProfile;
  fetchedAt: string;
  expiresAt?: string;
  estimatedFallback: boolean;
}

export interface PlanningWeekSummary {
  routeCount: number;
  stopCount: number;
  totalRouteMinutes: number;
  totalRevenue: number;
  totalGrossProfit: number;
  averageProfitMargin: number;
  excludedCount: number;
  needsReviewCount: number;
}

export interface PlanningWeek {
  weekNumber: 1 | 2 | 3 | 4 | number;
  weekStartDate: string;
  weekEndDate: string;
  dueCustomers: Customer[];
  routableCustomers: Customer[];
  excludedCustomers: ExcludedCustomer[];
  plannedRoutes: PlannedRoute[];
  summary: PlanningWeekSummary;
}

export interface PlanningWindow {
  startDate: string;
  endDate: string;
  weeks: PlanningWeek[];
}

export interface ExcludedCustomer {
  customerId: string;
  customerName: string;
  reason: string;
}

export interface WeeklyPlanResult {
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
  plannedRoutes: PlannedRoute[];
  summary: PlanningWeekSummary;
  excludedCustomers: ExcludedCustomer[];
  needsLocationReview: ExcludedCustomer[];
  warnings: string[];
}

export interface FourWeekSummary {
  totalRoutes: number;
  totalStops: number;
  totalRouteMinutes: number;
  totalRevenue: number;
  totalGrossProfit: number;
  averageProfitMargin: number;
  weeksPlanned: number;
}

export interface FourWeekPlanResult {
  planningWindow: PlanningWindow;
  fourWeekSummary: FourWeekSummary;
  needsLocationReview: ExcludedCustomer[];
  excludedCustomers: ExcludedCustomer[];
  warnings: string[];
}

export interface NewCustomerAssignmentResult {
  assignedRouteId?: string;
  insertionIndex?: number;
  nearestNeighborCustomerId?: string;
  addedDriveMinutes: number;
  addedMiles: number;
  addedLaborCost: number;
  addedFuelCost: number;
  addedRevenue: number;
  profitImpact: number;
  warnings: string[];
  needsManualRouteAssignment: boolean;
  candidateRoutesReviewed: number;
}

// Address review
export type AddressMatchStatus = "ready_for_bulk_approval" | "needs_review" | "failed";

export interface AddressReviewCandidate {
  customerId: string;
  customerName: string;
  originalAddress: string;
  suggestedFormattedAddress?: string;
  suggestedLatitude?: number;
  suggestedLongitude?: number;
  confidenceScore?: number;
  matchStatus: AddressMatchStatus;
  reviewReasons: string[];
  selectedForApproval: boolean;
  coordinateSourceAfterApproval: "owner_confirmed_location";
}

export interface BulkApprovalAuditEntry {
  customerId: string;
  approvedAt: string;
  approvedBy: string;
  originalAddress: string;
  suggestedFormattedAddress?: string;
  approvedFromStatus: AddressMatchStatus;
  approvedDespiteWarning: boolean;
  approvalMethod: "bulk" | "single" | "manual";
}

// Route plan (commit/approval workflow)
export type RoutePlanStatus = "draft" | "approved" | "rejected" | "partially_approved";
export type RoutePlanSource = "automatic" | "manual" | "import" | "rebalance";

export interface RoutePlan {
  planId: string;
  version: number;
  status: RoutePlanStatus;
  generatedAt: string;
  generatedBy: string;
  approvedAt?: string;
  approvedBy?: string;
  source: RoutePlanSource;
  previousPlanId?: string;
  planningWindow: PlanningWindow;
  summary: FourWeekSummary;
  warnings: string[];
}

// Import validation
export interface ImportValidationResult {
  importWarnings: { customerId?: string; field?: string; message: string }[];
  importBlockingErrors: { customerId?: string; field?: string; message: string }[];
}

// Customer notification preview (for future use)
export interface CustomerNotificationPreview {
  customerId: string;
  oldAssignment?: string;
  newAssignment?: string;
  requiresCustomerNotification: boolean;
  suggestedNotificationMessage?: string;
}

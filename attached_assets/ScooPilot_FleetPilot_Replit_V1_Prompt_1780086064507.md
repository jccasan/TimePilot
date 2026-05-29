# ScooPilot — FleetPilot (Vehicle Tracker) V1: Replit Build Prompt

You are building FleetPilot, a $19/month fleet management add-on for ScooPilot. V1 covers core fleet management only. V2 (ops integration) is a separate session.

## Decisions Already Made — Do Not Ask

- Fuel log: separate entry form, not bundled with odometer entry
- Vehicle-to-route assignment: V2 only, not in V1
- $19/month flat rate, all vehicles included
- 14-day free trial
- Available on all base tiers (no CRM requirement)
- Storage path for documents: `vehicles/{companyId}/{vehicleId}/documents/{docId}`
- Document deletion: delete from object storage first, then database record. If storage deletion fails, log and still delete DB record.

## Critical Rules

1. Do not add anything to `server/index.ts` except one line registering `server/routes/vehicles.ts`
2. Do not add any methods to `server/storage.ts` — all data access goes in `server/repositories/VehicleRepository.ts`
3. Do not write or regenerate any migrations — they already exist in the migrations/ folder
4. Do not add startup SQL to `server/index.ts`
5. Follow the reference patterns below exactly

---

## Reference Patterns

### Auth Pattern (from server/routes/contacts.ts)
```typescript
import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  handleError,
} from "./shared";

// Every route:
app.get("/api/vehicles", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { companyId } = await getCompanyContext(req);
    // all queries must include companyId WHERE clause
  } catch (err) {
    handleError(err, res);
  }
});
```

### File Upload Pattern (from server/routes/voice.ts)
```typescript
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";

// Inside route handler:
const multer = (await import("multer")).default;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, JPG, and PNG files are supported"));
  },
}).single("file");

await new Promise<void>((resolve, reject) => {
  upload(req, res, (err) => { if (err) reject(err); else resolve(); });
});

const file = (req as Request & { file?: Express.Multer.File }).file;
if (!file) return res.status(400).json({ error: "No file uploaded" });

const oss = new ObjectStorageService();
const uploadURL = await oss.getObjectEntityUploadURL();
const objectPath = oss.normalizeObjectEntityPath(uploadURL);
const putRes = await fetch(uploadURL, {
  method: "PUT",
  body: file.buffer,
  headers: { "Content-Type": file.mimetype || "application/octet-stream" },
});
// objectPath is what you store in the database as fileUrl
```

### File Delete Pattern (from server/jobs/message-cleanup.ts)
```typescript
const oss = new ObjectStorageService();
try {
  const file = await oss.getObjectEntityFile(storedFileUrl);
  await file.delete();
} catch (err) {
  console.warn(`[Vehicles] Failed to delete object storage file ${storedFileUrl}:`, (err as Error).message);
  // Still delete the database record
}
```

### Stripe Add-on Pattern (from server/routes/stripe.ts)
```typescript
// In checkout.session.completed handler — add alongside existing voice plan logic:
const meta = session.metadata || {};
if (meta.add_on === "vehicle_tracker") {
  const tenantId = meta.tenant_id;
  await storage.updateCompany(tenantId, {
    vehicleTrackerEnabled: true,
    stripeVehicleSubscriptionId: subscription.id,
  });
}

// In customer.subscription.deleted handler:
if (company.stripeVehicleSubscriptionId === stripeSubId) {
  await storage.updateCompany(company.id, {
    vehicleTrackerEnabled: false,
    stripeVehicleSubscriptionId: null,
  });
}
```

### Repository Pattern (create new, follow this structure)
```typescript
// server/repositories/VehicleRepository.ts
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { vehicles, vehicleOdometerLogs /* etc */ } from "@shared/vehicle-schema";

export class VehicleRepository {
  async createVehicle(companyId: string, data: InsertVehicle) {
    const [row] = await db.insert(vehicles).values({ ...data, companyId }).returning();
    return row;
  }
  // All methods take companyId as first param
  // All queries include .where(and(eq(table.companyId, companyId), ...))
}

export const vehicleRepo = new VehicleRepository();

// server/repositories/index.ts
export { vehicleRepo } from "./VehicleRepository";
```

---

## Step 1 — Schema & Migration (Already Done)

The schema file and migrations are already written. Do not regenerate them.

**Files already in place:**
- `shared/vehicle-schema.ts` — all 6 tables with enums, indexes, and TypeScript types
- `migrations/0001_vehicle_tracker.sql` — creates all tables, FKs, indexes, adds columns to companies and routes tables
- `migrations/0002_vehicle_alert_count.sql` — adds `pending_alert_count` to vehicles table
- `drizzle.config.ts` — already includes `shared/vehicle-schema.ts` in schema array

**Key types exported from `shared/vehicle-schema.ts` — use these throughout:**
```typescript
Vehicle, InsertVehicle
VehicleOdometerLog, InsertOdometerLog
VehicleMaintenanceLog, InsertMaintenanceLog
VehicleFuelLog, InsertFuelLog
VehicleRepairLog, InsertRepairLog
VehicleDocument, InsertVehicleDocument
VehicleSummary, FleetSummary, FleetAlert
```

**Notable schema detail — `vehicles` table has `pendingAlertCount: integer`**
This is pre-computed by the nightly rollup and cached on the vehicle record. The list page reads this field directly — do not call `getFleetAlerts()` on every list request.

**FK note:** The `companyId` FK on vehicles uses a raw SQL reference pattern to avoid circular imports. In `VehicleRepository.ts`, always use `eq(vehicles.companyId, companyId)` in WHERE clauses — do not use Drizzle relational queries for cross-schema joins.

**Action required:** Run the two migrations:
```bash
npx drizzle-kit migrate
```
If already applied, confirm tables exist and proceed immediately to Step 2. Do not regenerate or modify any migration files.

---


## Step 2 — VehicleRepository

Create `server/repositories/VehicleRepository.ts` and `server/repositories/index.ts`.

All methods take `companyId` as first parameter. Every query includes `companyId` WHERE clause.

```typescript
// Vehicles
createVehicle(companyId, data): Promise<Vehicle>
getVehicles(companyId, filters?: { status?: string }): Promise<Vehicle[]>
getVehicle(companyId, vehicleId): Promise<Vehicle | null>
updateVehicle(companyId, vehicleId, data): Promise<Vehicle>
softDeleteVehicle(companyId, vehicleId, status: 'inactive' | 'sold'): Promise<Vehicle>

// Odometer
createOdometerEntry(companyId, vehicleId, data): Promise<VehicleOdometerLog>
getOdometerEntries(companyId, vehicleId, filters?: { from?, to?, limit? }): Promise<VehicleOdometerLog[]>
getLatestOdometerReading(companyId, vehicleId): Promise<number | null>

// Maintenance
createMaintenanceEntry(companyId, vehicleId, data): Promise<VehicleMaintenanceLog>
getMaintenanceEntries(companyId, vehicleId, filters?: { from?, to? }): Promise<VehicleMaintenanceLog[]>
updateMaintenanceEntry(companyId, vehicleId, entryId, data): Promise<VehicleMaintenanceLog>
deleteMaintenanceEntry(companyId, vehicleId, entryId): Promise<void>

// Fuel
createFuelEntry(companyId, vehicleId, data): Promise<VehicleFuelLog>
getFuelEntries(companyId, vehicleId, filters?: { from?, to? }): Promise<VehicleFuelLog[]>
updateFuelEntry(companyId, vehicleId, entryId, data): Promise<VehicleFuelLog>
deleteFuelEntry(companyId, vehicleId, entryId): Promise<void>
calculateMPG(companyId, vehicleId): Promise<{ perFillup: number | null; rollingAverage: number | null }>
// MPG: never stored, calculated at read time from consecutive entries with mileageAtFill set
// rollingAverage: last 10 fill-ups

// Repairs
createRepairEntry(companyId, vehicleId, data): Promise<VehicleRepairLog>
getRepairEntries(companyId, vehicleId, filters?: { from?, to? }): Promise<VehicleRepairLog[]>
updateRepairEntry(companyId, vehicleId, entryId, data): Promise<VehicleRepairLog>
deleteRepairEntry(companyId, vehicleId, entryId): Promise<void>

// Documents
createDocument(companyId, vehicleId, data): Promise<VehicleDocument>
getDocuments(companyId, vehicleId): Promise<VehicleDocument[]>
updateDocument(companyId, vehicleId, docId, data: { label?, documentType?, expiresAt? }): Promise<VehicleDocument>
deleteDocument(companyId, vehicleId, docId): Promise<void>
// deleteDocument: delete object storage file FIRST using file delete pattern above, then delete DB record
// If storage deletion fails: log warning, still delete DB record

// Aggregations
getVehicleSummary(companyId, vehicleId, from: Date, to: Date): Promise<VehicleSummary>
// Returns: totalMiles, totalFuelCostCents, totalMaintenanceCostCents, totalRepairCostCents,
//          realCostPerMileCents, estimatedCostPerMileCents (from pricingConfig.vehicleCostPerMileCents),
//          deltaPerMileCents, averageMPG

getFleetSummary(companyId, from: Date, to: Date): Promise<FleetSummary>
// Aggregates VehicleSummary across all active vehicles plus:
// fleetAverageMPG, fleetRealCostPerMileCents (blended), totalDowntimeDays,
// costBreakdownPct: { fuel: number, maintenance: number, repair: number }

getFleetAlerts(companyId): Promise<FleetAlert[]>
// All alerts sorted by urgency (daysUntilDue ascending):
// - Maintenance nextDueDate within 30 days OR mileage gap < 500 miles vs latest odometer
// - vehicles.insuranceExpiresAt within 30 days
// - vehicles.registrationExpiresAt within 30 days
// - vehicleDocuments.expiresAt within 30 days (any doc with non-null expiresAt)
// Each alert: { vehicleId, vehicleName, alertType, daysUntilDue, urgency: 'warning'|'urgent' }
// urgent = within 7 days
```

Stop and wait for confirmation.

---

## Step 3 — Route File

Create `server/routes/vehicles.ts`. Register in `server/index.ts` with one line.

### Feature gate middleware
```typescript
async function requireVehicleTracker(req: Request, res: Response, next: NextFunction) {
  const { companyId } = await getCompanyContext(req);
  const company = await storage.getCompany(companyId);
  const withinTrial = company?.vehicleTrackerTrialEndsAt
    ? new Date() < new Date(company.vehicleTrackerTrialEndsAt)
    : false;
  if (!company?.vehicleTrackerEnabled && !withinTrial) {
    // Activate trial on first access if no trial set yet
    if (!company?.vehicleTrackerTrialEndsAt) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      await storage.updateCompany(companyId, { vehicleTrackerTrialEndsAt: trialEnd });
      return next();
    }
    return res.status(403).json({ error: "FleetPilot add-on required", upgrade: true });
  }
  next();
}
```

Apply `isAuthenticated` then `requireVehicleTracker` to all vehicle endpoints.

### All endpoints to implement:

```
GET    /api/vehicles                           list, query: status
POST   /api/vehicles                           create
GET    /api/vehicles/fleet/summary             fleet summary, query: from, to, preset(30d/90d/180d/365d)
GET    /api/vehicles/fleet/alerts              all alerts sorted by urgency
GET    /api/vehicles/:id                       single vehicle + current mileage + alert count + doc count
PATCH  /api/vehicles/:id                       update
DELETE /api/vehicles/:id                       soft delete, body: { status: 'inactive'|'sold' }

GET    /api/vehicles/:id/odometer              list, query: from, to, limit
POST   /api/vehicles/:id/odometer              create manual entry

GET    /api/vehicles/:id/maintenance           list, query: from, to
POST   /api/vehicles/:id/maintenance           create
PATCH  /api/vehicles/:id/maintenance/:eid      update
DELETE /api/vehicles/:id/maintenance/:eid      delete

GET    /api/vehicles/:id/fuel                  list with MPG per entry
POST   /api/vehicles/:id/fuel                  create
PATCH  /api/vehicles/:id/fuel/:eid             update
DELETE /api/vehicles/:id/fuel/:eid             delete

GET    /api/vehicles/:id/repairs               list
POST   /api/vehicles/:id/repairs               create
PATCH  /api/vehicles/:id/repairs/:eid          update
DELETE /api/vehicles/:id/repairs/:eid          delete

GET    /api/vehicles/:id/documents             list
POST   /api/vehicles/:id/documents             upload — use file upload pattern above
                                               accepted: application/pdf, image/jpeg, image/png, 10MB max
                                               storage path: vehicles/{companyId}/{vehicleId}/documents/{docId}
PATCH  /api/vehicles/:id/documents/:did        update label, documentType, expiresAt only
DELETE /api/vehicles/:id/documents/:did        delete file from storage then DB record

GET    /api/vehicles/:id/summary               per-vehicle summary, query: from, to, preset

POST   /api/vehicles/subscribe                 create Stripe Checkout session
                                               metadata: { tenant_id: companyId, add_on: 'vehicle_tracker' }
                                               follow voice plan checkout pattern in stripe.ts
```

Stop and wait for confirmation.

---

## Step 4 — Stripe Integration

Extend `server/routes/stripe.ts` only. Follow the reference pattern above exactly.

- `checkout.session.completed`: handle `add_on === 'vehicle_tracker'`
- `customer.subscription.deleted`: clear `vehicleTrackerEnabled` and `stripeVehicleSubscriptionId`
- Do not restructure the stripe.ts file

Stop and wait for confirmation.

---

## Step 5 — Nightly Rollup Extension

Extend `server/jobs/nightly-rollup.ts`. Add at the end of the existing job. Do not restructure.

```typescript
// Vehicle alert pre-computation
// For each company with vehicleTrackerEnabled = true:
//   Query vehicleMaintenanceLogs.nextDueDate within 30 days
//   Query vehicleMaintenanceLogs.nextDueMiles — compare against latest odometer, flag if gap < 500 miles
//   Query vehicles.insuranceExpiresAt within 30 days
//   Query vehicles.registrationExpiresAt within 30 days
//   Query vehicleDocuments.expiresAt within 30 days (non-null only)
//   All five in one pass per company
// Log: [VehicleAlerts] Processed N companies, M alerts generated
```

Stop and wait for confirmation.

---

## Step 6 — Frontend

**Use `client/src/pages/contact-detail.tsx` as the structural template for the vehicle detail page** (tabbed layout, sidebar summary card, action buttons). Match its patterns exactly — same component library, same card/tab structure, same spacing.

**Use `client/src/pages/contacts.tsx` as the template for the vehicle list page** (table layout, filter bar, status badges, action column).

### Pages to create:

**`/fleet` — Vehicle List**
- Filter bar: All / Active / Inactive / Sold (match contacts.tsx filter pattern)
- Table: make + model + year, status badge, current mileage, primary tech name, alert count (red badge if > 0), document count
- "Add Vehicle" button top right
- Empty state: "No vehicles added. Add your first vehicle to start tracking costs."
- Non-subscriber: upgrade card showing $19/mo, mention AUTOsist comparison: "AUTOsist charges $6/vehicle/month. At 3 vehicles that's $18/mo — with no connection to your routes or profitability. FleetPilot is $19 flat."
- Add "Fleet" to sidebar navigation

**`/fleet/:id` — Vehicle Detail**
Tabs (match contact-detail.tsx tab pattern): **Odometer | Maintenance | Fuel | Repairs | Documents | Summary**

*Odometer tab*
- Add Entry button → form: date, reading (miles), notes
- Entry list: date, reading, miles since previous entry, source badge (Manual / Auto)
- Warning if new reading < previous reading

*Maintenance tab*
- Add Entry button → form: service type dropdown, date, mileage at service, cost, vendor, notes, next due date (optional), next due miles (optional)
- Upcoming maintenance card at top if any entries have nextDueDate within 30 days (red if within 7)
- Entry list: type badge, date, cost, vendor, next due indicator

*Fuel tab*
- Add Entry button → separate form (not bundled with odometer): date, gallons, price per gallon (auto-calculates total), total cost, mileage at fill (optional), notes
- Rolling average MPG shown at top of tab
- Entry list: date, gallons, total cost, MPG for that fill-up (if mileageAtFill set)

*Repairs tab*
- Add Entry button → form: date, type dropdown, description, labor cost, parts cost (total auto-calculated), vendor, downtime days, insurance claim ref (optional), notes
- Entry list: date, type badge, description, total cost, downtime days

*Documents tab*
- Upload button → form: file picker (PDF/JPG/PNG, 10MB max), document type dropdown, label, expiry date (optional)
- List: type badge, label, expiry date (red if within 30 days), file size, upload date, download link, delete button
- Images: inline thumbnail. PDFs: icon + open in new tab.
- Empty state: "No documents uploaded. Add your insurance certificate, registration, or maintenance records."

*Summary tab*
- Date range selector: Last 30 / 90 / 180 / 365 days / Custom
- Cards: Total Miles, Fuel Cost, Maintenance Cost, Repair Cost
- Real Cost Per Mile (prominent) vs estimated rate with delta
- Cost breakdown bar: fuel / maintenance / repair as percentage

**`/fleet/summary` — Fleet Summary**
- Date range selector
- Metric cards: Total Miles, Fleet Average MPG, Fleet Real Cost Per Mile, Total Downtime Days
- Per-vehicle breakdown table: vehicle, miles, fuel, maintenance, repair, cost/mile
- Cost breakdown: fuel / maintenance / repair percentages

**Dashboard Widget** (add to existing dashboard)
- Only visible when vehicleTrackerEnabled or within trial
- Alert list: upcoming maintenance and expiring docs/registrations/insurance, sorted by urgency
- Fleet cost per mile: actual vs estimated
- Quick links: Add maintenance entry, Add fuel entry, Upload document

Stop and wait for confirmation.

---

## Final Checklist

- [ ] shared/vehicle-schema.ts created with 6 tables
- [ ] drizzle.config.ts updated
- [ ] companies table extended with 3 new columns
- [ ] PricingConfig interface extended
- [ ] Migration generated via drizzle-kit generate, reviewed, committed
- [ ] server/repositories/VehicleRepository.ts created
- [ ] server/repositories/index.ts created
- [ ] server/routes/vehicles.ts created
- [ ] Single line added to server/index.ts
- [ ] stripe.ts extended for vehicle_tracker add-on events
- [ ] nightly-rollup.ts extended with vehicle alert step
- [ ] /fleet list page with upgrade prompt for non-subscribers
- [ ] /fleet/:id detail page with 6 tabs
- [ ] /fleet/summary fleet summary page
- [ ] Dashboard widget
- [ ] Fleet added to sidebar navigation
- [ ] No additions to server/storage.ts
- [ ] No inline SQL in server/index.ts
- [ ] Document delete removes object storage file before database record
- [ ] MPG never stored, always calculated at read time
- [ ] All endpoints return 403 with { error, upgrade: true } for non-subscribers outside trial

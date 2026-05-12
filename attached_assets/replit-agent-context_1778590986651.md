# ScooPilot — Replit Agent Context File
# Upload this alongside the prompt. Do not modify.

## Tech Stack
- Frontend: React + TypeScript, TanStack Query v5, wouter routing, Shadcn/ui + Tailwind CSS
- Backend: Express.js + TypeScript, Drizzle ORM, PostgreSQL (Neon)
- Mutations: apiRequest from @/lib/queryClient
- Build: Vite (frontend) + tsx (backend), same port

## Key File Locations

### Protected — read only, do not modify
- client/src/components/business-onboarding.tsx (2010 lines)
- client/src/components/import-wizard.tsx (2515 lines)

### Modifiable existing files
- client/src/App.tsx
  - BusinessOnboarding renders around line 440
  - businessOnboardingDone state uses sessionStorage key: "scoopilot_onboarding_dismissed"
  - Gate condition: !businessOnboardingDone && (!businessOnboarding || !businessOnboarding.isComplete)
- server/routes/onboarding.ts
  - GET /api/onboarding/business-status handler lives here
  - Currently returns: { isComplete: boolean, isDemo?: boolean }
  - Queries the companies table for business_onboarding_complete column

### New file to create
- client/src/components/post-onboarding-import-prompt.tsx

## Component Signatures (do not alter)

### BusinessOnboarding (protected)
export default function BusinessOnboarding({
  onComplete: () => void;
  onDismiss?: () => void;
})

### ImportWizard (protected)
export interface ImportWizardProps {
  targetSchema: "contacts" | "invoices" | "routes";
  onComplete: (result: ImportResult) => void;
  onCancel: () => void;
  initialPlatform?: "sweepandgo" | "jobber" | "generic" | "googlesheet" | null;
}
export function ImportWizard(props: ImportWizardProps)

## Onboarding Flow Steps

Voice plan tenants (voicePlanStatus === "active") — 6 steps:
  0: CompanyProfileStep
  1: BusinessIntelligenceStep
  2: PricingSetupStep
  3: PaymentProcessingStep
  4: VoiceAgentSetupStep
  5: ReviewLaunchStep

All other tenants — 5 steps:
  0: CompanyProfileStep
  1: BusinessIntelligenceStep
  2: PricingSetupStep
  3: PaymentProcessingStep
  4: ReviewLaunchStep

## businessOnboardingDone State Logic
const [businessOnboardingDone, setBusinessOnboardingDone] = useState(
  () => sessionStorage.getItem("scoopilot_onboarding_dismissed") === "true"
);
- isComplete persists to DB via business_onboarding_complete column in companies table
- Set permanently via POST /api/onboarding/business-complete
- sessionStorage flag is the "do this later" escape hatch within a single session only

## Import Runs Table (existing, no migration needed)
Table: import_runs
Relevant columns:
  - company_id
  - status: "completed" | "pending" | "failed"
  - type: e.g. "sweepandgo_contacts" | "csv_contacts"
  - imported_rows: integer
  - completed_at: timestamp

Query to check if company has ever completed a contacts import:
SELECT EXISTS(
  SELECT 1 FROM import_runs
  WHERE company_id = $companyId
    AND status = 'completed'
    AND (type = 'sweepandgo_contacts' OR type = 'csv_contacts')
) AS has_completed_import

## CSV Import Schema (exact field names — must match exactly)
Import wizard SCHEMA_FIELDS (from import-wizard.tsx):
  firstName (required)
  lastName (required)
  email
  phone
  streetAddress
  address2
  city
  state
  zipCode
  numberOfDogs
  yardSize
  serviceFrequency
  leadSource
  status
  notes
  gateCode
  serviceDay

Valid enum values:
  serviceFrequency: weekly | biweekly | monthly | one_time
  serviceDay: monday | tuesday | wednesday | thursday | friday | saturday | sunday
  status: lead | active | inactive | paused

Export headers (from server/routes/contacts.ts csvContactHeaders):
  firstName, lastName, email, phone, streetAddress, address2,
  city, state, zipCode, numberOfDogs, yardSize,
  serviceFrequency, serviceDay, leadSource, referralSource, status, notes

Notes:
  - referralSource is exported but NOT in import SCHEMA_FIELDS (will be unmapped)
  - gateCode IS in import schema but NOT in export headers

## Routing
- /migration — exists, hosts TransferTab which renders ImportWizard inline
- No new routes needed for this feature

## Import Wizard API Endpoints (internal to wizard — do not replicate)
  GET  /api/imports/fetch-url?url=...     proxy for Google Sheet CSV URLs
  POST /api/imports/ai-map                AI field mapping
  POST /api/imports/geocode-preview       optional geocode preview
  POST /api/imports/preview               staged dry-run
  POST /api/imports/apply                 commits staged rows { routePreference, platform }
  After apply: navigate to /import/:batchId/resolve

## What NOT to build
- Do not add a new API route
- Do not add a new DB column or migration
- Do not add localStorage or sessionStorage for import tracking (use import_runs)
- Do not modify business-onboarding.tsx or import-wizard.tsx
- Do not add the migration step inside the onboarding wizard step array

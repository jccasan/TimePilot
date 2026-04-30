# Scoopilot - Pet Waste Removal SaaS

## Overview

Scoopilot is a production-ready vertical SaaS application for pet waste removal businesses. It offers a comprehensive operational solution encompassing CRM, recurring service scheduling with route optimization, a mobile interface for field technicians, invoicing, and a client portal. The platform integrates event-driven automation and a REST API with webhooks for AI agent integrations, aiming to significantly enhance efficiency and streamline customer management in the industry.

## User Preferences

- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface
- Before making any code changes, the agent must:
  1. Identify all existing functionality outside the direct scope of the request that could be affected (shared components, state variables used elsewhere, API endpoints other features depend on, styling that touches other pages, etc.).
  2. Present those potential side effects to the user clearly before writing any code.
  3. Wait for the user's approval before proceeding with changes that touch anything outside the explicitly requested scope.
  4. Never make unrequested changes — even if something looks like a bug or improvement opportunity, flag it and ask first.

## System Architecture

### Core Design Principles

Scoopilot is a full-stack, multi-tenant SaaS application built on role-based access control, event-driven automation, and a modular design, ensuring scalability and a clear separation of concerns.

### Backend

- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM
- **Authentication**: Custom email/password with session cookies and Bearer token.
- **API & Webhooks**: Comprehensive REST API with scoped API keys and HMAC-signed webhook delivery. Stripe webhook event deduplication.
- **Security**: Helmet middleware, CORS, rate limiting, and multi-tenant data isolation.
- **Automation**: Configurable reminder system and quiet hours.
- **Route Optimization**: Nearest-neighbor TSP with 2-opt improvement.
- **Routes Structure**: Backend routes are split into domain-specific modules under `server/routes/`. Each module exports a `registerXxxRoutes(app)` function. Shared middleware and helpers live in `server/routes/shared.ts`. `server/routes/index.ts` orchestrates all registrations. `server/routes.ts` is a thin re-export of `registerRoutes` from the index.

### Frontend

- **Framework**: React with TypeScript
- **State Management**: TanStack Query v5
- **UI Components**: Shadcn/ui with Tailwind CSS, utilizing a green/earth tone theme.
- **Mobile View**: Dedicated mobile-optimized views for field technicians, including PWA support and offline capabilities.
- **Client Portal**: Self-service portal for managing services, billing, and account information.
- **Admin Dashboard**: Platform-level administration for tenant management.
- **Rover Chatbot**: AI-powered in-app assistant with SSE streaming responses and function calling.
- **Dark Mode**: Full dark mode support.
- **Draggable Grid Layouts**: Dashboard and settings page use `react-grid-layout` for drag-and-drop reordering and resizing of blocks/widgets, with layouts persisted to the `companies` table.

### Key Features

- **Quick Create**: Sidebar dropdown for rapidly creating contacts, quotes, invoices, and jobs.
- **Data Management**: CRM for contacts and properties, CSV import with AI-assisted mapping, activity logs, and global search.
- **Jobs & Scheduling (Unified)**: Job management directly from the Scheduling page. Auto-visit generation on job creation. Supports individual visit editing, client filtering, and toggling hidden statuses.
- **Scheduling & Routing**: Auto-visit generation, auto-assignment to daily routes, drag-and-drop route builder with map visualization, and route locking. Calendar views with drag-and-drop rescheduling.
- **Financials**: Detailed invoicing with Stripe integration, payment ledger, profitability dashboard, client tipping, and QuickBooks Online bidirectional sync. Invoicing redesign adds: revenue dashboard (this week, outstanding, overdue, collected), multi-select batch actions (send/charge/mark paid), grouped invoice sections (Overdue/Unpaid/Draft/Paid) in the "All" view, and autopay indicators for contacts with Stripe on file. Invoice page action-first redesign: consolidated status tabs (All, Uninvoiced, Unpaid, Overdue, Paid, Failed), count+dollar badge on Unpaid/Overdue tabs, split-button "Generate All Invoices" with dropdown (by customer/date/selected), dominant bulk-generate CTA in uninvoiced view, bulk-generation confirmation modal, post-generation toast, per-contact checkboxes and autopay badges in uninvoiced view, per-contact invoice generation wired correctly, preview sheet for reviewing uninvoiced work before generating.
- **Communication**: Integrated two-way email and SMS with a unified threaded conversation inbox, client portal, and configurable notifications. Supports shared-number multi-tenant SMS routing and MMS.
- **Admin Messaging Monitor**: Platform admin page for messaging analytics, tenant-specific message breakdown, and exception queue management.
- **Client Signup Widget**: Public-facing signup and quote page with instant pricing, lead creation, and funnel analytics. Includes configurable auto-follow-up via SMS/email.
- **Lead Webhook Integration**: Accepts leads from external sources, auto-creating contacts and triggering notifications.
- **Quote Ingestion Webhook**: Accepts website form data, auto-deduplicates contacts, creates properties with geocoding, calculates tiered pricing, creates draft quotes, and triggers outbound webhooks and automation rules.
- **Field Operations**: Technician mobile interface with proof-of-service photo uploads, time tracking, yard measurement tools, automated customer notifications, and offline resilience.
- **Quoting & Proposals**: Universal quoting engine for residential and commercial quotes with multi-tier pricing, manual overrides, and a public portal. Commercial pricing tool includes detailed input fields.
- **Business Onboarding Wizard**: 5-step automated onboarding flow for new companies covering profile, business intelligence, pricing, Stripe Connect, and review.
- **Feature Tours**: Joyride-based guided tours for new and returning users.
- **Business Intelligence**: Overhead cost tracking, customer profitability, route profit maps, pricing simulation, and per-customer cost overrides.
- **Subscription Management**: DB-backed subscription tiers, Stripe Checkout, free trial, account freezing for failed payments, and usage metering. Includes a Voice Plan Add-on.
- **Voice Agent Scheduling API**: Platform-agnostic REST API for AI voice agents to manage services and retrieve call logs.
- **Cross-sell Opportunities Engine**: Rules-based engine that surfaces upgrade/add-on suggestions for contacts based on dog count, service frequency, tenure, and visit completion rate. A "Growth Opportunities" dashboard widget lists top upgrade candidates company-wide; contact detail pages show a collapsible "Suggestions" section with per-suggestion dismiss (persisted via `dismissed_opportunities` JSONB on contacts). Rules: biweekly→weekly (4+ dogs), monthly→biweekly (2+ dogs), deodorizer add-on (3+ dogs), loyalty upsell (12+ months), reliable client upgrade (90%+ completion, 10+ visits). API: `GET /api/contacts/:id/opportunities`, `PATCH /api/contacts/:id/dismiss-opportunity`, `GET /api/company/growth-opportunities`.
- **Client Notifications (Import Mode + Onboarding Complete)**: Settings block with two controls. (1) **Import Mode** — a persistent toggle (`clientNotificationsSuppressed` column on companies) that suppresses ALL outbound client emails (portal invites, invoices, payment reminders) while tenants are entering their existing client base. Gates are in `provisionPortalAccess`, `sendInvoiceEmail`, and the payment-reminder route. (2) **Onboarding Complete** — a one-time button that previews then batch-sends each active client a consolidated welcome email containing portal credentials, service day, frequency, price per visit, and next scheduled visit; then sets `clientNotificationsSuppressed=false` and stamps `onboardingCompleteSentAt`. Idempotency guard prevents re-sending. New columns: `client_notifications_suppressed BOOLEAN NOT NULL DEFAULT true` (new tenants start in Import Mode), `onboarding_complete_sent_at TIMESTAMP`.

### Data Model

The scheduling data model is refactored into three layers: `agreements` (billing), `jobs` (work/routing), and `visits` (instance). Dual-write strategy ensures backward compatibility during migration.

### UI Component Rules

**Never nest a Radix `<Popover>` inside a Radix `<Sheet>` or `<Drawer>`.** Radix UI's focus-trap on Sheet/Drawer conflicts with Popover's own focus management, causing focus to be stolen and the picker to close immediately on Android and some desktop browsers.

- Comboboxes/pickers that appear inside a Sheet or Drawer **must** use the Dialog-based picker pattern instead (see `client/src/pages/scheduling.tsx` `ScheduleJobForm`, lines 377–401 for the reference implementation).
- Hover-detail Popovers (e.g., `ClientInfoPopover`) should not be placed inside Sheet/Drawer content either; prefer a linked navigation target or an inline expansion.
- This rule was validated by a project-wide audit (Task #311, April 2026). All current Popovers are outside Sheet/Drawer contexts.

## CI / Quality Gates

### TypeScript (`typecheck`)

A `typecheck` validation step is registered and runs `npx tsc --noEmit` against the full project (`client/`, `server/`, `shared/`). It enforces all compiler flags in `tsconfig.json`, including `strict: true` and `noUnusedLocals: true`. TypeScript errors **block merges** — the check must pass before any PR is accepted.

- **Run command**: `npx tsc --noEmit`
- **Config**: `tsconfig.json`
- **Registered as**: validation command `typecheck`

Keep the codebase free of TS errors. If you add new imports, remove unused ones before committing.

### ESLint (`lint`)

A `lint` validation step is registered and runs `npx eslint .` against all `.ts` and `.tsx` files. It uses `@typescript-eslint/eslint-plugin` with the recommended ruleset. ESLint **errors block merges** — the gate must pass with 0 errors and 0 warnings.

- **Run command**: `npx eslint .`
- **Config**: `eslint.config.js` (flat config format, ESLint v10)
- **Registered as**: validation command `lint`

The following rules are enforced as **errors** (will block merges):
- `@typescript-eslint/no-unused-vars` — unused variables/args must be prefixed with `_`; catch-clause variables follow `caughtErrorsIgnorePattern: "^_"`.
- `@typescript-eslint/no-namespace` — use ES module syntax, not `namespace` blocks (suppress with inline comment only for `declare module` augmentations).
- `@typescript-eslint/no-unsafe-function-type` — use specific function signatures (`NextFunction`, `RequestHandler`, etc.) instead of `Function`.
- `@typescript-eslint/no-require-imports` — use `import` syntax; `require()` calls in config files should use inline `eslint-disable` comments.

`@typescript-eslint/no-explicit-any` remains a **warning** (not a merge blocker). Files that contained pre-existing `any` usage have a file-level `/* eslint-disable @typescript-eslint/no-explicit-any */` comment; new code should avoid `any` in favour of `unknown` or explicit types. `.local/**` (platform skill files) is excluded from linting.

### Prettier (`format`)

A `format` validation step is registered and runs `npx prettier --check .` against all project files. It uses the configuration in `.prettierrc` and respects exclusions in `.prettierignore` (node_modules, dist, build, wizard, .local, .config, etc.). Prettier formatting failures **block merges** — the check must pass before any PR is accepted.

- **Run command**: `npx prettier --check .`
- **Config**: `.prettierrc`
- **Ignore**: `.prettierignore`
- **Registered as**: validation command `format`

Keep all code Prettier-formatted. If you add or edit files, run `npx prettier --write <file>` before committing. Key style settings: `semi: true`, `singleQuote: false`, `tabWidth: 2`, `trailingComma: "es5"`, `printWidth: 100`.

## External Dependencies

- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads.
- **SendGrid**: Email sending.
- **Twilio**: SMS messaging (global provider).
- **Telnyx**: SMS/MMS messaging (per-tenant provider option).
- **Stripe**: Payment gateway with Stripe Connect using direct charges and application fees.
- **Mapbox**: Directions API, Geocoding API, and GL JS for mapping and routing.
- **Google Maps**: Street View Static API and Static Maps API for property images.
- **OpenAI**: Used for AI-assisted import wizard and Rover AI chatbot.
- **QuickBooks Online**: Accounting integration.
- **Retell AI**: Voice agent integration for lead creation and customer lookup.
- **Voice Agent Wizard** (Python Flask, port 5001): Standalone onboarding wizard for Retell AI agent tenants. Located in `wizard/`. Uses TinyDB, Leaflet.js map, pgeocode for ZIP centroids, geopy for distance calculation. Generates four output files per tenant (tenant_config.json, territory_data.json, agent_handbook.md, api_credentials.json). Dashboard at `/`, start at `/start`, wizard at `/onboard/<phone>`, summary at `/ready/<phone>`. Config API: `GET /api/config/<phone>` (X-Wizard-Key header). Location check: `POST /api/verify-location`. Sysadmin credentials: `GET /admin/credentials/<phone>` (WIZARD_ADMIN_KEY required).

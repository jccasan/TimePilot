# Scoopilot - Pet Waste Removal SaaS

## Overview
Scoopilot is a production-ready vertical SaaS application designed for pet waste removal businesses. It provides a comprehensive operational solution covering CRM, recurring service scheduling with route optimization, a mobile interface for field technicians, invoicing, and a client portal. The platform also features event-driven automation and a REST API with webhooks for AI agent integrations, aiming to significantly boost efficiency and streamline customer management within the industry.

## User Preferences
- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface

## Change Impact Review Process
Before making any code changes, the agent must:
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
- **API & Webhooks**: Comprehensive REST API with scoped API keys and HMAC-signed webhook delivery. Stripe webhook event deduplication via `stripe_events` table (30-day retention, nightly cleanup).
- **Security**: Helmet middleware, CORS, rate limiting, and multi-tenant data isolation.
- **Automation**: Configurable reminder system and quiet hours.
- **Route Optimization**: Nearest-neighbor TSP with 2-opt improvement.

### Frontend
- **Framework**: React with TypeScript
- **State Management**: TanStack Query v5
- **UI Components**: Shadcn/ui with Tailwind CSS, utilizing a green/earth tone theme.
- **Mobile View**: Dedicated mobile-optimized views for field technicians, including PWA support and offline capabilities. Service worker cache busting is handled by a Vite build plugin (`swBuildHashPlugin` in `vite.config.ts`) that replaces the `__BUILD_HASH__` placeholder in `client/public/sw.js` with a unique timestamp hash at build time. The `controllerchange` event in `client/index.html` auto-reloads the page when a new service worker activates.
- **Client Portal**: Self-service portal for managing services, billing, and account information.
- **Admin Dashboard**: Platform-level administration for tenant management.
- **Rover Chatbot**: AI-powered in-app assistant with SSE streaming responses and function calling. The floating button shows "Ask Rover" label text for clarity. Knowledge base in `server/services/rover-ai.ts` covers all modules, navigation, and key workflows.
- **Dark Mode**: Full dark mode support.
- **Draggable Grid Layouts**: Both the dashboard and the settings page use `react-grid-layout` (ResponsiveGridLayout) to support drag-and-drop reordering and resizing of blocks/widgets, with layouts persisted to the `companies` table (dashboardLayout and settingsLayout JSON columns).

### Key Features
- **Quick Create**: Sidebar dropdown button for rapidly creating contacts, quotes, invoices, and jobs from anywhere in the app. Contact and invoice creation open inline dialogs; quotes navigate with auto-open param. "New Job" navigates to `/scheduling`.
- **Data Management**: CRM for contacts and properties, CSV import with AI-assisted mapping, activity logs, and global search.
- **Jobs & Scheduling (Unified)**: Jobs are managed directly from the Scheduling page — there is no separate Jobs page (the `/jobs` route redirects to `/scheduling`). The Add Job dialog on the Scheduling page supports all fields: job type (one-off/recurring), customer, property, services, frequency, day of week, start/end time, anytime toggle, end conditions, assigned team member, and visit instructions. Creating a job via `POST /api/jobs` automatically generates visits for 6 months (no separate "Create Visits" step needed). Service plans support a `discount` field (percentage) and "Stop Only" flags for non-revenue visits.
- **Scheduling & Routing**: Auto-visit generation on job creation via `POST /api/jobs` and `POST /api/service-plans`. Visits auto-assigned to date-based daily routes. Routes have both `dayOfWeek` (legacy) and `date` (daily) columns. `POST /api/contacts/:id/services` convenience endpoint. Drag-and-drop route builder with map visualization and visit completion tracking. Includes a route lock feature to preserve optimized stop orders. Calendar views: day/week/month with drag-and-drop rescheduling.
- **Financials**: Detailed invoicing with Stripe integration, payment ledger, profitability dashboard, and client tipping. Supports QuickBooks Online bidirectional sync for contacts and invoices.
- **Communication**: Integrated two-way email and two-way SMS with a unified threaded conversation inbox, client portal, and configurable notification preferences. Email threads use `emailThreadId` for routing with reply-to address pattern (`reply+{threadId}@{INBOUND_EMAIL_DOMAIN}`). Inbound emails arrive via SendGrid Inbound Parse webhook (`POST /api/webhooks/sendgrid/inbound`). Supports shared-number multi-tenant SMS routing via a `message_routing` table and exception queue for ambiguous inbound messages. MMS with multi-image attach (up to 5 files, 5MB per file). 30-day configurable message retention with daily automated cleanup job (deletes expired messages, attachments from object storage, and SMS records).
- **Admin Messaging Monitor**: Platform admin page (`/admin/messaging`) with messaging analytics (volume by channel/direction, storage usage, compression savings), per-tenant message breakdown with inline retention period editing, exception queue management, and manual cleanup trigger.
- **Client Signup Widget**: Public-facing signup and quote page with instant pricing and lead creation. Includes funnel analytics tracking via `quote_form_events` table — tracks form_loaded, zip_entered, zip_passed/failed, step2_completed, step3_started, submitted, and quote_shown events per session. Admin analytics "Quote Funnel" tab shows conversion funnel, embed vs direct sessions, per-company breakdown, and time-range filtering. **Auto-follow-up**: When enabled (`quoteAutoFollowUpEnabled`), sends immediate SMS confirmation (customizable template with merge fields: {firstName}, {companyName}, {price}, {frequency}, {dogs}) and/or branded HTML email (`quoteFollowUpEmailEnabled`) to prospects upon quote form submission. Configurable in company settings. Messages logged in `sms_messages`/`emails_sent` tables.
- **Lead Webhook Integration**: Accepts leads from external sources with API key authentication, auto-creating contacts and triggering notifications.
- **Quote Ingestion Webhook**: `POST /api/webhooks/quotes` — accepts website form data (name, email, phone, address, dog count, yard size, frequency) via API key auth, auto-deduplicates contacts by email/phone, creates properties with geocoding, calculates three-tier pricing (essential/premium/deluxe) using the company's quote defaults, creates a draft quote, fires `quote.created` outbound webhooks and `quote_created` automation rules, and returns the quote ID with calculated pricing. Designed for Zapier/Make/direct website integration.
- **Field Operations**: Technician mobile interface with proof-of-service photo uploads, time tracking, yard measurement tools, and automated customer notifications (e.g., ETA SMS). Features offline resilience via IndexedDB caching and background sync.
- **Quoting & Proposals**: Universal quoting engine supporting residential and commercial quotes with multi-tier pricing, manual overrides, and public portal for viewing/accepting proposals. Commercial pricing tool includes station count, time per station, common area minutes, crew size, round-trip mileage, dump fees, site sq ft (auto-populated from measurement tool), initial deep clean, and multi-visit frequency discounts.
- **Business Onboarding Wizard**: 5-step automated onboarding flow for new companies — Company Profile, Business Intelligence (AI website scraping + CSV pricing import), Pricing Setup, Stripe Connect, and Review & Launch. Gates the dashboard until complete but users can click "Skip Setup" in the header to dismiss at any time. Existing companies auto-skip.
- **Feature Tours**: Joyride-based guided tours (welcome tour v2.0 and what's new v2.0) in `client/src/components/feature-tour.tsx`. Tours auto-launch for new/returning users after onboarding. Version-tracked per user via `/api/tours/status`.
- **Business Intelligence**: Overhead cost tracking, customer profitability, route profit maps, and pricing simulation. Per-customer cost overrides (`costOverrides` JSON column on contacts) for labor rate, burden multiplier, travel distance, and overhead per visit — applied consistently in both individual and bulk profitability calculations. Price calculator shows overhead disclaimer when monthly expenses aren't configured.
- **Subscription Management**: DB-backed subscription tiers, Stripe Checkout integration, 14-day free trial, automated account freezing for failed payments, and usage metering. Includes a Voice Plan Add-on for AI voice agents.
- **Voice Agent Scheduling API**: Platform-agnostic REST API for AI voice agents to perform caller lookup, check availability, book/pause/resume/reschedule/cancel services, and retrieve call logs.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads.
- **SendGrid**: Email sending.
- **Twilio**: SMS messaging (global provider).
- **Telnyx**: SMS/MMS messaging (per-tenant provider option). Supports inbound/outbound MMS with media attachments.
- **Stripe**: Payment gateway with Stripe Connect using **direct charges** (Express accounts). Tenant customer objects and PaymentIntents are created directly on the connected account via the `Stripe-Account` header, with the platform fee collected via `application_fee_amount`. Platform-level billing (ScooPilot subscriptions, voice plans) stays on the platform account. Platform fee configurable via `PLATFORM_FEE_PERCENT` env var (default 2.9%). Migration utility at `POST /api/admin/migrate-stripe-customers` moves existing platform-level customers to their connected accounts. Optional `STRIPE_CONNECT_WEBHOOK_SECRET` env var for Connect-specific webhook verification.
- **Mapbox**: Directions API, Geocoding API, and GL JS for mapping and routing.
- **Google Maps**: Street View Static API and Static Maps API for property images.
- **OpenAI**: Used for AI-assisted import wizard and Rover AI chatbot.
- **QuickBooks Online**: Accounting integration for syncing contacts, invoices, and payments.
- **Retell AI**: Voice agent integration for lead creation and customer lookup, with webhook handling for call events and usage tracking.

## Data Model (Task #95 Refactor — Dual-Write Active)
The core scheduling data model has been refactored from a single `service_plans` table into three clean layers:
- **`agreements`** — Billing/contract layer: contactId, frequency, pricePerVisit, isActive, pausedAt, startDate, endDate, estimateId. Links back to the original `service_plan_id` for migration traceability.
- **`jobs`** — Work/routing layer: agreementId, propertyId, routeId, stopOrder, dayOfWeek, serviceName, jobType, jobStatus, startTime, visitInstructions, assignedUserId, isStopOnly. Links back to original `service_plan_id`.
- **`visits`** — Instance layer: jobId (new), servicePlanId (legacy). Each visit is now linked to a job.
- **`job_add_ons`** — Add-ons per job (replaces `service_plan_add_ons`).
- **`vacation_holds`** — Now has both `service_plan_id` (legacy) and `agreement_id` (new).
- **Dual-write strategy**: All write operations (create, update, delete) to `service_plans` are automatically mirrored to `agreements`+`jobs`. `updateServicePlan()` auto-syncs relevant fields. `deleteServicePlan()` cascades deletes. Read operations still use the legacy table during transition.
- **`JobWithAgreement`** type merges Job + Agreement fields and includes `isActive`/`pausedAt` compat fields for frontend backward compatibility.
- The old `service_plans` table and its related types/storage methods remain for backward compatibility during the migration.
- Migration runs idempotently at startup via `migrateServicePlansToAgreementsAndJobs()` in `server/index.ts`.
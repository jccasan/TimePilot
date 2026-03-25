# Scoopilot - Pet Waste Removal SaaS

## Overview
Scoopilot is a production-ready vertical SaaS application for pet waste removal businesses. It offers a comprehensive operational solution, including multi-tenant architecture, CRM, recurring service scheduling with route assignments, a mobile interface for field technicians, invoicing, a client portal, event-driven automation, and a REST API with webhooks for AI agent integrations. The project aims to enhance efficiency and customer management for businesses in the pet waste removal industry.

## User Preferences
- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface

## System Architecture

### Core Design Principles
Scoopilot is a full-stack, multi-tenant SaaS application built on role-based access control, event-driven automation, and modular design for scalability, maintaining clear separation of concerns between frontend and backend.

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM
- **Authentication**: Custom email/password with session cookies and Bearer token.
- **Invoice Template Engine**: Custom HTML template engine supporting per-company themes.
- **Route Optimization**: Nearest-neighbor TSP with 2-opt improvement.
- **API & Webhooks**: Comprehensive REST API with scoped API keys and HMAC-signed webhook delivery.
- **Security**: Helmet middleware, CORS, rate limiting, multi-tenant data isolation.
- **Automation**: Configurable reminder system (service and invoice reminders), configurable quiet hours.

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query v5
- **UI Components**: Shadcn/ui with Tailwind CSS, using a green/earth tone theme.
- **Forms**: react-hook-form with zodResolver.
- **PWA Support**: Progressive Web App features.
- **Mobile View**: Dedicated mobile-optimized views for field technicians.
- **Client Portal**: Self-service portal for managing services, billing, account info, and communication preferences.
- **Admin Dashboard**: Platform-level administration for tenant management and analytics.
- **Rover Chatbot**: AI-powered in-app assistant with SSE streaming responses and function calling for live business data queries.
- **Dark Mode**: Full dark mode support.

### Key Features
- **Data Management**: CSV import with AI-assisted mapping, CRM for contacts and properties, activity logs, global search, and audit trail.
- **Jobs System**: Comprehensive job management for one-off and recurring services, supporting various statuses and end conditions. Service plans support a "Stop Only" flag (`isStopOnly`) for route stops that don't generate revenue — these are excluded from MRR, profitability, uninvoiced summaries, auto-invoicing, projected revenue, and avg price calculations while still appearing on routes.
- **Service Plans List & Bulk Edit**: Standalone `/service-plans` page showing all plans in a sortable, filterable table (client name, property, frequency, day, price, route, status, add-ons, type). Filters for frequency, day, route, status, price range (min/max). Checkbox selection with bulk actions: price adjustment (flat or percentage), day of week change (auto-route reassignment), status toggle, route reassignment. Confirmation dialog with preview. Backend: `GET /api/service-plans` returns enriched data (with contact/property/route names) when called without filter query params; returns filtered data when `contactId`/`propertyId`/`isActive` params present. `PATCH /api/service-plans/bulk` with Zod schema validation, route ownership checks, pausedAt management on status changes.
- **Scheduling & Routing**: Recurring service plans with add-ons, visit management, drag-and-drop route builder with map visualization, visit completion tracking. One-time service plans integrated into routes. Route lock feature: routes can be toggled locked/unlocked to protect manually optimized stop order — locked routes block optimize and reverse operations (server-side 409 enforcement + disabled UI buttons). Lock state persists via `isLocked` boolean on routes table.
- **Financials**: Detailed invoicing with Stripe integration, payment ledger, cost-based automatic price calculator, profitability dashboard, and client tipping. Revenue calculations use `paidAt` for accurate reporting. QuickBooks Online bidirectional sync for contacts (as Customers) and invoices with payment recording.
- **QuickBooks Online Integration**: OAuth 2.0 connection flow with automatic token refresh. Syncs contacts to QBO Customers (matches by email/name before creating). Pushes invoices with line items to QBO. Records payments when invoices are marked paid. Sync status dashboard with error logs and individual retry capability. Manual full re-sync from Settings. Schema: `qboRealmId`, `qboAccessToken`, `qboRefreshToken`, `qboTokenExpiresAt`, `qboConnectedAt`, `qboIncomeAccountRef` on companies; `qboCustomerId` on contacts; `qboInvoiceId` on invoices; `qbo_sync_logs` table for tracking. Service file: `server/services/quickbooks.ts`. Routes: `/api/qbo/*`. Requires `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` env vars.
- **Communication**: Integrated email and SMS with two-way SMS conversation inbox (threaded view, inline reply, unread tracking), client portal, and configurable notification preferences. Per-tenant SMS provider choice: Twilio (global) or Telnyx (per-tenant credentials). Schema: `smsProvider`, `telnyxApiKey`, `telnyxPhoneNumber`, `telnyxMessagingProfileId` on companies. Service: `server/services/telnyx-sms.ts` for Telnyx v2 API. Unified `sendSmsForCompany()` in `server/services/sms.ts` routes to correct provider. Inbound webhook: `POST /api/webhooks/telnyx/sms`. Settings UI: SMS Provider section with provider selector, Telnyx credentials, and webhook URL copy.
- **Client Signup Widget**: Public-facing signup and quote page at `/signup/:companySlug` (no auth required). Collects contact info, dog count, service frequency, and preferred day. Auto-creates lead with geocoded property and returns instant price quote. Companies configure their URL slug in Settings and can copy a direct link or iframe embed snippet.
- **Lead Webhook Integration**: `POST /api/webhooks/leads` accepts leads from Facebook Ads, Google Ads, or any external source. Authenticated via API key (`x-api-key` header). Flexible schema (only firstName required). Auto-creates contact as "lead", creates property if address provided, triggers new_lead notification, sends auto-quote SMS via Twilio if phone provided. SMS template is configurable per company (`leadWebhookSmsTemplate` on companies table) with merge fields: `{firstName}`, `{dogs}`, `{frequency}`, `{price}`. Webhook lead sources auto-created in lead_sources table. Settings page shows webhook URL, API key management, payload docs, and SMS template editor.
- **Field Operations**: Technician mobile interface with proof-of-service photo uploads, time tracking, satellite/aerial views, yard measurement tool, automated customer notifications (gate closed photo, ETA SMS), and manual "On my way" SMS with live GPS-based ETA via Mapbox Directions. Offline resilience: IndexedDB-based caching of route/visit data (`client/src/lib/offline-store.ts`), offline mutation queue for visit status changes and photo uploads, automatic background sync on reconnect (`client/src/lib/offline-sync.ts`), connectivity status bar (`client/src/components/offline-status-bar.tsx`), `useOffline` hook (`client/src/hooks/use-offline.ts`). Technicians can start, complete, skip, cancel visits, and capture photos while offline — all queued locally and synced FIFO when connectivity returns. Failed sync items surface to the user for retry.
- **Quoting & Proposals**: Universal quoting engine supporting residential and commercial quotes with 3-tier pricing (Essential, Property Care, Deluxe). Residential pricing: base rate + per-dog surcharge + acreage + heavy accumulation (>4 dogs = 1.2x) + initial clean (2.5x, cap $150). Commercial pricing: station rate x count + field rate x hours + frequency density discounts. Features: live tier preview in create dialog, manual price overrides, HTML proposal emails (residential card layout / commercial formal proposal), SMS summary, public portal for quote viewing/accepting at `/portal/:slug/quotes/:id`. Schema: `quotes` table with `quote_type`, `quote_status`, `quote_tier` enums. Service: `server/services/quote-pricing.ts`. Routes: `/api/quotes/*` (CRUD + send + preview), `/api/portal/quotes/:id` (public view/accept/decline). Page: `/quotes` with filters, stats, and create/edit dialog.
- **Business Intelligence**: Overhead cost tracking, customer profitability, route profit maps, and a pricing simulator. MRR calculation includes add-ons.
- **Dashboard Widgets**: Customizable drag-and-drop dashboard with various operational and financial widgets, including weather forecast and route map preview.
- **Onboarding**: Guided 5-step onboarding flow for initial setup including service zones, customer addition, pricing, service plan creation, and route generation.
- **Service Zones**: Management of service areas by zip code and day of week with interactive map.
- **Access Control**: Multi-tenant architecture with Owner, Admin, and Technician roles.
- **Admin Security Center**: Tools for managing admin accounts, active sessions, and audit logs. Includes password policy enforcement.
- **Subscription Pricing Management**: Admin interface for managing DB-backed subscription tiers.
- **Subscription Billing Lifecycle**: Stripe Checkout for subscription creation, 14-day free trial, automatic account freeze on failed payments (3 attempts = suspended), Stripe Customer Portal for self-service billing management, usage metering (SMS segments, voice minutes, user seats), subscription gate middleware (402 for suspended/cancelled accounts on write operations). All Stripe checkout sessions include `tenant_id` in metadata for reliable tenant resolution. Schema: `frozenAt` and `trialEndsAt` on companies, `usage_events` table, `suspended` status in subscription_status enum. Webhooks: `invoice.payment_failed`, `customer.subscription.trial_will_end`. Routes: `/api/subscriptions/create-checkout`, `/api/billing/portal`, `/api/billing/usage`, `/api/billing/subscription`.
- **Voice Plan Add-on**: Separate Stripe subscription add-on for AI voice agent. Two tiers: Starter ($59/mo, $49 for subscribers, 60 min included) and Pro ($119/mo, $99 for subscribers, 200 min included). $0.50/min overage. Purchasable from billing page (authenticated) or public page at `/voice-signup/:companySlug` (no auth). Schema: `voicePlanTier`, `voicePlanStatus`, `voicePlanIncludedMinutes`, `voicePlanOverageRate`, `stripeVoiceSubscriptionId` on companies. Config: `VOICE_PLAN_CONFIG` in `shared/schema.ts`. Env vars: `STRIPE_PRICE_VOICE_STARTER`, `STRIPE_PRICE_VOICE_STARTER_SUBSCRIBER`, `STRIPE_PRICE_VOICE_PRO`, `STRIPE_PRICE_VOICE_PRO_SUBSCRIBER`. Routes: `POST /api/billing/voice-checkout`, `POST /api/voice-signup/:slug/checkout`, `GET /api/voice-signup/:slug/info`. Webhook handling: `customer.subscription.created` with `checkout_type=voice_addon` metadata activates plan; `customer.subscription.deleted` clears voice plan fields.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads.
- **SendGrid**: Email sending.
- **Twilio**: SMS messaging (global provider).
- **Telnyx**: SMS messaging (per-tenant provider option, v2 API).
- **Stripe**: Payment gateway with Stripe Connect for multi-tenant payment routing.
- **Mapbox**: Directions API, Geocoding API, and GL JS for mapping and routing.
- **Google Maps**: Street View Static API and Static Maps API for property images.
- **OpenAI**: Used for AI-assisted import wizard and Rover AI chatbot (via Replit AI Integrations).
- **QuickBooks Online**: Accounting integration via OAuth 2.0 for syncing contacts, invoices, and payments (requires QBO_CLIENT_ID and QBO_CLIENT_SECRET).
- **Retell AI**: Voice agent integration for lead creation and customer lookup. Retell webhook at `POST /api/webhooks/retell` receives `call_ended`/`call_analyzed` events, matches tenant by `dedicatedPhoneNumber`, records call in `voice_calls` table with actual duration, logs usage event with real minutes, and reports metered usage to Stripe. Per-action voice_minute logging removed from voice action endpoints (book, pause, resume, reschedule, cancel).

### Voice Agent Scheduling API
Platform-agnostic REST API layer for AI voice agents (Vapi, Retell, Bland, custom Twilio+OpenAI). All endpoints under `/api/voice/*` authenticated via `x-api-key` header (or owner/admin session). Endpoints:
- `GET /api/voice/lookup?phone=...` — Caller lookup: returns contact, properties, active service plans, upcoming visits, active vacation holds. Returns `{found: false}` (not 404) for unknown callers.
- `GET /api/voice/availability?dayOfWeek=...` — Route capacity check: returns open slots per day (routes under 30 stops = capacity).
- `POST /api/voice/book` — Book new service: creates contact + property + service plan + auto-assigns route in one call. Accepts firstName, lastName, phone, email, address fields, frequency (weekly/biweekly/monthly/onetime), dayOfWeek.
- `POST /api/voice/pause` — Pause service: creates vacation hold(s). Accepts contactId or servicePlanId + startDate + endDate.
- `POST /api/voice/resume` — Resume service: removes active vacation holds. Accepts contactId or servicePlanId.
- `POST /api/voice/reschedule` — Reschedule: changes dayOfWeek and auto-assigns to best-fit route. Accepts contactId or servicePlanId + newDayOfWeek.
- `POST /api/voice/cancel` — Cancel: deactivates service plans and sets contact status to cancelled. Accepts contactId + optional reason.
- `GET /api/voice/calls` — Voice call log: returns recent calls from `voice_calls` table with duration, outcome, and summary.
All endpoints return flat JSON with `summary` field for voice agent readback. Documentation card with curl examples in Settings page (VoiceApiDocsSection).
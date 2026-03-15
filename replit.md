# Scoopilot - Pet Waste Removal SaaS

## Overview
Scoopilot is a production-ready vertical SaaS application designed for pet waste removal businesses. It offers a comprehensive operational solution, including a multi-tenant architecture with role-based access, CRM, recurring service scheduling with route assignments, a mobile interface for field technicians, invoicing, a client portal, event-driven automation, and a REST API with webhooks for AI agent integrations. The project aims to significantly enhance efficiency and customer management for companies in the pet waste removal industry.

## User Preferences
- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface

## System Architecture

### Core Design Principles
Scoopilot is a full-stack, multi-tenant SaaS application built on principles of role-based access control, event-driven automation, and modular design for scalability. It maintains a clear separation of concerns between frontend and backend.

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM
- **Authentication**: Custom email/password with session cookies and Bearer token fallback.
- **Invoice Template Engine**: Custom HTML template engine supporting per-company themes.
- **Route Optimization**: Nearest-neighbor TSP with 2-opt improvement, utilizing Mapbox Directions API.
- **Geocoding**: Mapbox Geocoding API v6.
- **API & Webhooks**: Comprehensive REST API with scoped API keys and HMAC-signed webhook delivery.
- **Security**: Helmet middleware, CORS, rate limiting, multi-tenant data isolation.

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query v5
- **UI Components**: Shadcn/ui with Tailwind CSS, using a green/earth tone theme.
- **Forms**: react-hook-form with zodResolver.
- **PWA Support**: Progressive Web App features for offline access.
- **Mobile View**: Dedicated mobile-optimized views for field technicians.
- **Client Portal**: Self-service portal with 4-tab layout (Overview, Services, Billing, Account). Clients can edit their contact info (name, email, phone), update property addresses/gate codes/instructions, manage pet count, view service history, approve estimates, manage payments, set notification preferences, request service changes (frequency, day, same-day service, pause, cancel), and use a referral program. Changes sync back to the CRM via `PATCH /api/portal/profile`.
- **Admin Dashboard**: Platform-level administration for tenant management and analytics.
- **Notifications System**: In-app notifications for business events.
- **Rover Chatbot**: In-app AI assistant.
- **Dark Mode**: Full dark mode support.

### Key Features
- **Data Management**: CSV import with AI-assisted mapping, competitor data transfer (Sweep & Go, Jobber) with auto-detection, CRM for contacts and properties, activity logs, global search, and an audit trail.
- **Jobs System**: The `service_plans` table now serves as the Jobs data model with new columns: `serviceName` (job title), `jobType` (one_off/recurring), `jobStatus` (draft/approved/active/completed/cancelled), `startTime`/`endTime`/`anytime` (time windows), `endsAfterCount`/`endsAfterUnit` (end conditions), `visitInstructions`, `assignedUserId`, `estimateId` (link to quote). Jobs API: `GET /api/jobs` (with jobStatus/jobType filters), `POST /api/jobs`, `POST /api/jobs/:id/approve`. When a client approves an estimate via portal, a draft job is auto-created and admin is notified. Auto-visit generation only processes jobs with `jobStatus='active'` and supports "ends after N units" end conditions. Existing service plan API endpoints continue to work for backward compatibility. **Frontend**: Dedicated `/jobs` page (`client/src/pages/jobs.tsx`) with job list, stat cards (total/draft/active/completed), search, status/type filters, create/edit dialogs with job type toggle (one-off/recurring), schedule section (start date, time window, anytime, repeats, end conditions), assigned team member, visit instructions, and approve button for drafts. Sidebar has "Jobs" link with Briefcase icon under Operations. All "Scheduled Services" labels renamed to "Jobs" across dashboard, contact-detail, portal, settings, scheduling, profitability, and popover components.
- **Scheduling & Routing**: Recurring service plans with add-on support (one-time, add-on, package pricing templates), visit management, route assignments, and a drag-and-drop route builder with map visualization. Service plans can have multiple add-ons via `service_plan_add_ons` table. Tech mobile view groups visits by property and shows service types and add-ons as badges. Auto-invoicing generates separate line items for base service and each add-on. One-time service plans can now be assigned to routes with a day of week; they appear in the route builder only during their scheduled week (Mon-Sun) and display a "One-Time" badge. Route builder has visit completion controls: per-stop status badges (Scheduled/In Progress/Completed/Skipped/Cancelled) with action dropdown to change status via `PATCH /api/visits/:id`. Completed/skipped/cancelled stops show visual treatment (green/orange/red borders, muted opacity). Route-scoped progress badge shows "X of Y processed". Route cards display total driving distance and estimated time from `GET /api/routes/:id/metrics` (Mapbox Directions API), with per-leg distance/duration separators between stops.
- **Financials**: Detailed invoicing with Stripe integration, payment ledger, cost-based automatic price calculator, and a profitability dashboard (per customer and route).
- **Communication**: Integrated email and SMS, client portal for self-service, notification preferences, and inbound SMS/portal message notifications.
- **Invoice Tipping**: Clients can add an optional tip ($5/$10/$15/custom) when paying invoices via the portal. Tips are stored in the `tipAmount` column on invoices and persisted only after successful Stripe payment via webhook. Tip metadata flows through Stripe checkout session.
- **Field Operations**: Technician mobile interface with proof-of-service photo uploads, time tracking, satellite/aerial views, and a yard measurement tool. Post-completion flow: gate closed photo capture (required), optional extra photos, auto-SMS to completed customer with gate photo (MMS), auto-ETA SMS to next customer on route with calculated travel time via Mapbox directions. Endpoint: `POST /api/visits/:id/complete-notify`. Techs only see visits for routes assigned to them (filtered by `routes.technicianId`); admins/owners see all. Visits sorted by route name then stop order. Grouped by route in both tech views with per-route progress. `completedBy` always set server-side on completion. Visit status transitions validated: scheduled->in_progress/completed/skipped/cancelled, in_progress->completed/skipped/cancelled, skipped/cancelled->scheduled, completed cannot transition. Auto-advance expands next incomplete visit after completing/skipping. Route-level authorization enforced on PATCH and complete-notify for tech role.
- **Business Intelligence**: Overhead cost tracking, customer profitability dashboard (includes add-on revenue), route profit maps, and a pricing simulator with competitor analysis. MRR is calculated from active service plans: sum of (base price + active add-ons) * visits-per-month (weekly=4.33, biweekly=2.17, monthly=1, onetime=0). Report projections and booked revenue also include add-on pricing.
- **Automation**: Event-driven automation rules and automated jobs (invoicing, reminders). Invoice reminders follow a controlled schedule: 7, 2, 1, and 0 days before due date; every 2 days after overdue. Each reminder sends exactly 1 notification (email preferred, SMS fallback). Tracked via `lastReminderSentAt` and `reminderCount` on invoices to prevent duplicate sends. Service reminders tracked via `serviceReminderSentAt` on visits with atomic claim-before-send. All jobs use company timezone (stored on `companies.timezone`, defaults to `America/New_York`). Auto-invoice tracks `lastAutoInvoiceRun` per company to catch up missed billing windows. Visit generation respects vacation holds (`vacation_holds` table) and filters out paused plans (`pausedAt` set). Creating a service plan auto-transitions contacts from "lead"/"estimate" to "active".
- **Onboarding**: Guided 5-step onboarding flow: (1) Set up service zones with interactive map and zip code day assignments, (2) Add first customer, (3) Price property, (4) Create service plan, (5) Generate route. Service zones step is skippable. Service zones also manageable from Settings.
- **Service Zones**: `service_zones` table stores zip code, day of week, and coordinates per company. Interactive Mapbox map with geocoded markers. CRUD + bulk API at `/api/service-zones`.
- **Access Control**: Multi-tenant architecture with Owner, Admin, and Technician roles.
- **Admin Security Center**: `/admin/security` — Admin accounts overview (password expiration status), active sessions with revoke, paginated audit log tracking logins (success/failure with IP), tier changes, session revocations, and pricing updates. Password policy: 16+ chars, mixed case/number/symbol, 90-day expiration, 10-password history, 8-hour session duration.
- **Subscription Pricing Management**: `/admin/pricing` — DB-backed subscription tiers (auto-seeded from `TIER_CONFIG`). Admin can edit tier name, max users, price, and toggle active/inactive. Changes are audit-logged. Tables: `subscription_tiers`, `admin_audit_logs`.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads (e.g., photos).
- **SendGrid**: Email sending.
- **Twilio**: SMS messaging.
- **Stripe**: Payment gateway with Stripe Connect (Express accounts) for multi-tenant payment routing. Each tenant can connect their own Stripe account via Settings. Platform fee: 2.9% (`PLATFORM_FEE_PERCENT` in `server/services/stripe.ts`). Payment functions (`createPaymentIntent`, `chargeInvoiceAutomatically`, `createCheckoutSession`) accept optional `stripeConnectAccountId` for routing. Connect endpoints: `/api/stripe-connect/onboard`, `/status`, `/dashboard-link`, `/disconnect`. Webhook handles `account.updated` for auto-syncing onboarding status.
- **Mapbox**: Directions API, Geocoding API, and GL JS for mapping and routing.
- **Google Maps**: Street View Static API and Static Maps API for property images.
- **OpenAI**: Used for AI-assisted import wizard.
- **Retell AI**: Voice agent integration with 4 API endpoints (`/api/retell/tenant-profile`, `/create-lead`, `/lookup-customer`, `/log-call`). All protected by `RETELL_API_KEY` header/query param. Companies have voice agent profile fields: `voiceAgentServiceArea`, `voiceAgentPricingSummary`, `voiceAgentPolicies`, `voiceAgentSpecialLines`, `voiceAgentGreeting`.
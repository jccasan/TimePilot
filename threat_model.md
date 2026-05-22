# Threat Model

## Project Overview

Scoopilot is a multi-tenant SaaS platform for pet waste removal businesses. The production application consists of a TypeScript/Express backend in `server/`, a React/TanStack Query frontend in `client/`, PostgreSQL via Drizzle, Replit object storage for uploaded files, and a separate Python Flask onboarding service in `wizard/` that is documented in `replit.md` as production-reachable on port 5001.

Users include tenant owners/admins/technicians, customer portal users, public prospects using quote/signup flows, and third-party integrations such as Stripe, Twilio/Telnyx, SendGrid, QuickBooks, Mapbox, OpenAI, and Retell. Production assumptions for scans: `NODE_ENV=production`; TLS is provided by the platform; mockup sandbox/dev-only experiments are not deployed; and the main app is publicly deployed with autoscaling, so process-local in-memory throttles are not durable security controls for internet-facing endpoints.

## Assets

- **Application identities and sessions** — user passwords, session cookies, bearer session tokens, portal session tokens, API keys, admin credentials, and webhook verification secrets. Compromise enables account takeover or service impersonation.
- **Tenant and customer data** — contact details, addresses, schedules, invoices, payment state, communications, notes, and uploaded photos/documents. This is the primary confidentiality target.
- **Billing and payment state** — Stripe customer IDs, invoice/payment metadata, autopay settings, subscription status, and usage records. Integrity failures can cause fraud or revenue loss.
- **Uploaded media and documents** — proof-of-service photos, message attachments, quote images, imported documents, logos, and other tenant content stored through object storage or the wizard service.
- **Wizard-generated onboarding artifacts** — `tenant_config.json`, `territory_data.json`, `agent_handbook.md`, and `api_credentials.json` in `wizard/output/`. These contain business configuration, service territory, operational policies, and tenant API credentials.
- **Platform secrets and third-party credentials** — database connection strings, session secrets, Stripe keys, Twilio/Telnyx credentials, QuickBooks tokens, Retell keys, and wizard admin/API keys.

## Trust Boundaries

- **Browser/mobile client to Express API** — all frontend state is untrusted. Server-side authentication, authorization, and tenant scoping must be enforced on every protected route.
- **Public internet to public routes** — signup/quote flows, portal login/reset, public quote-view actions, webhook receivers, and the Flask wizard expose unauthenticated entry points. This is the highest-risk boundary for spoofing, brute force, broken access control, and PII disclosure.
- **Express API to PostgreSQL** — the backend has broad read/write access to tenant data and session state. Query scoping and injection resistance are critical.
- **Express API to object storage** — uploads are stored in a nominally private object namespace, then served back through app routes. Read authorization must be enforced consistently.
- **Express API to external providers** — Stripe, Twilio/Telnyx, SendGrid, QuickBooks, Mapbox, OpenAI, and Retell calls cross service trust boundaries and require request authenticity plus secret handling.
- **Main app to separate wizard service** — `wizard/` is a separate production-reachable service with its own datastore, filesystem, and auth model. It must not rely on the main app’s protections.
- **Tenant user to tenant admin/platform admin** — owner/admin-only actions must be enforced server-side; tenant isolation must hold across all companies.
- **Machine credentials to staff identities** — API keys and other integration credentials must remain least-privileged machine principals rather than inheriting full owner/admin identity.

## Scan Anchors

- **Production entry points:** `server/index.ts`, `server/routes/index.ts`, `server/replit_integrations/object_storage/`, `wizard/app.py`.
- **Highest-risk code areas:** auth/session handling in `server/routes/auth.ts` and `server/routes/shared.ts`; public and portal routes in `server/routes/public-routes.ts` and `server/routes/portal.ts` (especially `POST /api/public/leads/:slug?dedup=true`, `/api/public/portal/setup-intent`, `/api/public/portal/setup-intent/confirm`, and public invoice/payment bootstrap flows); team membership lifecycle in `server/routes/company.ts` and `server/storage.ts`; API-key creation and use in `server/routes/automation.ts`; CRM contact write surfaces that accept API keys; object storage download path; all of `wizard/` (especially tenant-key handling on artifact/config endpoints).
- **Public surfaces:** public signup and quote routes, `/api/public/contact-lookup/:slug`, `/api/public/leads/:slug`, public invoice/payment routes, public portal billing bootstrap routes, portal login/reset flows, public portal quote routes, webhooks, and the Flask wizard routes under `/`, `/start`, `/onboard/<phone>`, `/ready/<phone>`, `/upload/<phone>`, `/uploads/<phone>/<filename>`, `/download/<phone>/<filename>`, `/handbook/<phone>`, and `/api/verify-location`.
- **Authenticated/admin surfaces:** most `/api/*` routes behind `isAuthenticated`; company membership and role checks are concentrated in `getCompanyContext()` and `requireRole()`; API-key behavior is centralized in `server/routes/shared.ts`.
- **Usually ignore unless reachability changes:** local task files, docs, and mockup/dev-only experiments. Do **not** ignore `wizard/`; `replit.md` documents it as production-reachable.

## Threat Categories

### Spoofing

The system accepts several identity mechanisms: session cookies, bearer tokens derived from session IDs, scoped API keys, portal tokens, and third-party webhook signatures. The application must validate each mechanism server-side, rate-limit public authentication endpoints, and fail closed when webhook verification secrets are absent. Public routes must not treat guessable or recoverable business identifiers such as phone numbers, quote IDs, contact IDs, slugs, email+ZIP pairs, or URL parameters as proof of identity. API keys must not be silently upgraded into staff identities.

### Tampering

Tenant users, portal users, and public callers can all submit mutable business data. The platform must ensure every state-changing route verifies the caller’s authorization for the specific tenant/resource being modified. Public quote acceptance, onboarding flows, upload endpoints, dedup/update paths, and any route that writes schedules, billing state, or business configuration must not rely on client-side restrictions or opaque-but-unauthenticated identifiers. Deactivated memberships must lose write access immediately, including existing sessions.

### Information Disclosure

Scoopilot stores sensitive customer, billing, routing, and media data, plus wizard-generated config files and API keys. API responses, file download routes, logs, and object storage download paths must not expose tenant data outside the intended audience. Files placed in private storage namespaces must remain inaccessible unless the caller is authorized for that exact object. Public convenience endpoints must not disclose customer identity, saved-card metadata, or service-address data without stronger proof of control.

### Denial of Service

The app exposes public authentication and integration endpoints and performs potentially expensive work such as geocoding, quote generation, file processing, and third-party API calls. Public and low-trust endpoints must be rate-limited and bounded by request size/timeouts so attackers cannot cheaply consume compute or provider quotas. This includes the customer portal login boundary, not just reset and signup flows. Because the production deployment is autoscaled and public, per-process in-memory rate limits should be treated as advisory at best; abuse controls for internet-facing endpoints need shared state or another mechanism that survives instance fan-out and churn.

### Elevation of Privilege

This is a multi-tenant system with owner/admin/tech and customer-portal roles, plus a separate wizard service. The platform must uphold strict tenant isolation and prevent IDOR/broken-function-level access control across company data, uploaded files, quotes, portal resources, billing setup flows, and wizard onboarding artifacts. Any route that bypasses role checks, object ACLs, tenant scoping, deactivation state, or machine-principal scope boundaries can convert a low-privilege or unauthenticated position into broad data access or tenant takeover.

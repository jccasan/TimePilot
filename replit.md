# Scoopilot - Pet Waste Removal SaaS

## Overview
Scoopilot is a production-ready vertical SaaS application for pet waste removal businesses. It provides multi-tenant architecture with role-based access control, CRM for contacts and properties, recurring service scheduling with route assignments, a technician mobile view for field work, invoicing, client portal access, event-driven automation rules, and REST API with webhooks for AI agent integrations.

## Current State
- Full-stack application running on Express + Vite + React
- PostgreSQL database with 15+ tables
- Authentication via Replit Auth
- Object storage integration for file uploads
- Seed data with demo company and comprehensive test data
- All major features implemented and functional

## Architecture

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon-backed via Replit)
- **ORM**: Drizzle ORM with drizzle-zod for validation
- **Auth**: Replit Auth (session-based)
- **Storage**: Object Storage for file uploads (proof-of-service photos)

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State/Data**: TanStack Query v5
- **UI**: Shadcn/ui components with Tailwind CSS
- **Theme**: Green/earth tone palette (primary: hsl(152 60% 36%))
- **Forms**: react-hook-form with zodResolver

### Key Files
- `shared/schema.ts` - Database schema and types (Drizzle + Zod)
- `server/storage.ts` - Storage interface and implementation (IStorage)
- `server/routes.ts` - All API routes (50+ endpoints)
- `server/seed.ts` - Demo data seeding script
- `client/src/App.tsx` - Root component with auth flow, routing, sidebar
- `client/src/components/app-sidebar.tsx` - Navigation sidebar
- `client/src/components/theme-provider.tsx` - Light/dark mode support

### Database Schema
- `companies` - Multi-tenant company accounts with subscription tiers
- `company_users` - User-company memberships with roles (owner/admin/tech)
- `contacts` - CRM contacts with status pipeline (lead/estimate/active/paused/cancelled)
- `tags` / `contact_tags` - Tagging system for contacts
- `properties` - Service addresses with yard details, gate codes, etc.
- `routes` - Daily route definitions with color coding
- `service_plans` - Recurring service configurations (weekly/biweekly/monthly/onetime)
- `vacation_holds` - Temporary service pauses
- `visits` - Individual scheduled/completed visits
- `invoices` / `invoice_line_items` - Billing records
- `messages` - Email/SMS communication log (inbound/outbound)
- `automation_rules` / `automation_event_logs` - Event-driven automation
- `api_keys` - Scoped API keys for external integrations
- `webhooks` - Webhook subscriptions for events
- `attachments` - File attachments (photos, documents)

### Subscription Tiers
| Tier | Users | Price |
|------|-------|-------|
| tier_1 | 1 | $49.99/mo |
| tier_1_3 | 1-3 | $99.99/mo |
| tier_3_5 | 3-5 | $199.99/mo |
| tier_6_10 | 6-10 | $349.99/mo |
| tier_10_plus | 10+ | $599.99/mo |

### Key Service Files
- `server/services/email.ts` - SendGrid email service (invoice emails, general comms)
- `server/services/sms.ts` - Twilio SMS service (outbound/inbound texting)

### Pages
1. **Dashboard** (`/`) - MRR stats, today's visits, quick actions
2. **Contacts** (`/contacts`) - CRM with search, filters, CSV import/export
3. **Contact Detail** (`/contacts/:id`) - Full contact with properties, plans, tags
4. **Scheduling** (`/scheduling`) - Week view with service plans and visits
5. **Routes** (`/routes`) - Route management with delete and service plan display
6. **Tech Mobile** (`/m/today`) - Mobile-optimized field view
7. **Communications** (`/communications`) - Email/SMS message center
8. **Invoices** (`/invoices`) - Invoice management with email sending
9. **Billing** (`/billing`) - Subscription tier management
10. **Automation** (`/automation`) - Event-driven rules
11. **API Keys** (`/api-keys`) - API key management with scopes
12. **Webhooks** (`/webhooks`) - Webhook subscriptions
13. **Portal** (`/portal`) - Client portal (placeholder)

### API Hooks for AI Integration
- REST API with scoped API key authentication
- Webhook system for event notifications
- Endpoints for contacts, visits, invoices CRUD
- Designed for AI phone assistants and AI employee agents

### Communication Services
- **Email**: SendGrid integration for outbound emails (invoice emails, general communications)
- **SMS**: Twilio integration for outbound/inbound texting (phone: +15715824054)
- **Webhook**: POST /api/webhooks/twilio/sms for incoming SMS messages
- Messages table logs all communication history (email/sms, inbound/outbound)

### Invoice Template Engine
- **Location**: `server/invoice-engine/` (compute + render), `server/templates/` (HTML template + theme + examples)
- **Template**: `server/templates/invoice.default.html` - mustache-style HTML with `{{path.to.value}}`, `{{#block}}...{{/block}}`
- **Theme**: `server/templates/invoice.theme.json` - controls colors, fonts, logoSize, borderRadius (edit JSON to rebrand)
- **Compute**: `server/invoice-engine/invoice.compute.ts` - calculates subtotal, discount, tax, total, balance; formats USD
- **Render**: `server/invoice-engine/invoice.render.ts` - loads template, merges theme + data, processes blocks/loops/conditionals
- **Example data**: `server/templates/examples/invoice.example.json`
- **Routes**:
  - `GET /invoice/example` - renders sample invoice (no auth)
  - `GET /invoice/:invoiceId/render` - renders real invoice from DB (auth required)
- **Frontend**: Print button on each invoice card opens rendered template in new tab

### Stripe Payment Integration
- **Service**: `server/services/stripe.ts` - Stripe customer creation, setup intents, payment intents, checkout sessions, webhook handling
- **Routes**: 
  - `POST /api/contacts/:id/stripe-customer` - Create Stripe customer for contact
  - `POST /api/contacts/:id/setup-intent` - Create setup intent for adding cards
  - `GET /api/contacts/:id/payment-methods` - List payment methods
  - `DELETE /api/payment-methods/:pmId` - Remove payment method
  - `POST /api/invoices/:id/charge` - Charge card on file
  - `POST /api/invoices/:id/checkout` - Create Stripe checkout session
  - `POST /api/webhooks/stripe` - Stripe webhook handler
- **Secrets**: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (optional, graceful degradation)

### Client Portal
- **Auth**: Token-based sessions (not Replit OIDC) for contacts/customers
- **Schema**: `portal_sessions` table with tokenHash, expiresAt (7-day sessions)
- **Routes**: 
  - `POST /api/portal/login` - Email + last name auth
  - `GET /api/portal/me` - Profile info
  - `GET /api/portal/schedule` - Service plans and upcoming visits
  - `GET /api/portal/invoices` - Invoice list
  - `POST /api/portal/invoices/:id/pay` - Pay via Stripe checkout
  - `POST /api/portal/pause` / `POST /api/portal/resume` - Service control
  - `POST /api/portal/logout`
  - `POST/DELETE /api/contacts/:id/portal-access` - Admin toggle
- **Frontend**: `/portal/login` and `/portal/client` (outside main auth flow)

### Tech Photo Upload
- Camera button on tech mobile view uploads via object storage presigned URLs
- Photos stored as `proofOfServicePhoto` on visits table
- Displayed inline in visit detail with proof of service section

## Recent Changes
- 2026-02-15: Tier 1 MVP features (Stripe, Portal, Tech Photos)
  - Stripe payment processing with charge/checkout on invoices
  - Payment methods management on contact detail page
  - Client portal with login, schedule, invoices, pause/resume
  - Portal access toggle on contact detail page
  - Tech photo upload via object storage presigned URLs
  - Upload route secured with authentication
- 2026-02-15: Customizable invoice template system
  - Mustache-style template engine (no dependencies)
  - Theme JSON controls all branding (colors, fonts, logo, border radius)
  - Printable + mobile-friendly HTML invoice template
  - Business header, invoice meta, customer/addresses, line items, visits, totals, notes, payment instructions
  - GET /invoice/example for preview, GET /invoice/:id/render for real invoices
  - Print button added to invoice list cards
- 2026-02-14: Advanced invoicing system with billing preferences, auto-generation, line items
  - Contacts have invoiceTiming (before/after service) and invoiceFrequency (per service/week/month)
  - Auto-invoice generation on visit completion for "after_service + per_service" contacts
  - Manual invoice creation with service pricing catalog selection, tax rate %, discount ($/%)
  - Server-side total calculations (subtotal, discount, tax, total)
  - Invoice detail view with line items breakdown
  - Auto-generate invoices from date range (completed or scheduled visits)
  - POST /api/invoices/generate endpoint for batch invoice creation
  - PATCH /api/contacts/:id/billing-preferences endpoint
- 2026-02-14: Added Communications module (SendGrid email + Twilio SMS)
- 2026-02-14: Routes page: delete functionality, service plans display
- 2026-02-14: Invoice email sending via SendGrid
- 2026-02-14: Messages database table for communication history
- 2026-02-14: Initial build of complete application
- All database tables created and seeded with demo data
- Full frontend with 13 pages built
- Auto-setup flow for first-time users (assigns to demo company)

## User Preferences
- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface

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

### Pages
1. **Dashboard** (`/`) - MRR stats, today's visits, quick actions
2. **Contacts** (`/contacts`) - CRM with search, filters, CSV import/export
3. **Contact Detail** (`/contacts/:id`) - Full contact with properties, plans, tags
4. **Scheduling** (`/scheduling`) - Week view with service plans and visits
5. **Routes** (`/routes`) - Route management by day of week
6. **Tech Mobile** (`/m/today`) - Mobile-optimized field view
7. **Invoices** (`/invoices`) - Invoice management with status tracking
8. **Billing** (`/billing`) - Subscription tier management
9. **Automation** (`/automation`) - Event-driven rules
10. **API Keys** (`/api-keys`) - API key management with scopes
11. **Webhooks** (`/webhooks`) - Webhook subscriptions
12. **Portal** (`/portal`) - Client portal (placeholder)

### API Hooks for AI Integration
- REST API with scoped API key authentication
- Webhook system for event notifications
- Endpoints for contacts, visits, invoices CRUD
- Designed for AI phone assistants and AI employee agents

## Recent Changes
- 2026-02-14: Initial build of complete application
- All database tables created and seeded with demo data
- Full frontend with 12 pages built
- Auto-setup flow for first-time users (assigns to demo company)

## User Preferences
- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface

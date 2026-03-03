# Scoopilot - Pet Waste Removal SaaS

## Overview
Scoopilot is a production-ready vertical SaaS application designed for pet waste removal businesses. It offers a comprehensive suite of tools including a multi-tenant architecture with role-based access, a CRM for managing contacts and properties, recurring service scheduling with route assignments, a mobile interface for field technicians, invoicing capabilities, a client portal, event-driven automation rules, and a REST API with webhooks for AI agent integrations. The project aims to provide a complete operational solution for pet waste removal companies, enhancing efficiency and customer management.

## User Preferences
- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface

## System Architecture

### Core Design Principles
Scoopilot is built as a full-stack, multi-tenant SaaS application. It emphasizes role-based access control, event-driven automation, and a modular design to support various business operations. The application is designed to be scalable and extensible, with clear separation of concerns between frontend and backend.

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon-backed)
- **ORM**: Drizzle ORM with drizzle-zod for validation
- **Authentication**: Custom email/password auth with session cookies + Bearer token fallback (tokens stored in localStorage for iframe compatibility). Password recovery via SendGrid email with secure reset tokens.
- **Storage**: Object Storage for file uploads (e.g., proof-of-service photos)
- **Email Service**: SendGrid for transactional and marketing emails
- **SMS Service**: Twilio for inbound and outbound text messaging
- **Payment Processing**: Stripe for secure payment gateway integration, including customer management, setup intents, payment intents, and webhook handling.
- **Invoice Template Engine**: Custom mustache-style HTML template engine for flexible and customizable invoice generation, supporting per-company theme overrides and company logo integration.
- **Route Optimization**: Implements a nearest-neighbor TSP with 2-opt improvement algorithm, with Mapbox Directions API for real road-based distance and duration metrics. Falls back to haversine if Mapbox is unavailable.
- **Geocoding**: Mapbox Geocoding API v6 for address autocomplete and forward geocoding. Auto-geocodes properties on creation and before route optimization. Uses public token (secret token lacks geocoding permissions). Public token exposed via /api/mapbox-token endpoint. Backfill endpoint: POST /api/properties/geocode-all.
- **Maps**: Mapbox SDK for routing, navigation, and geocoding (tokens stored as MAPBOX_PUBLIC_TOKEN and MAPBOX_SECRET_TOKEN secrets). Use MAPBOX_PUBLIC_TOKEN for geocoding API calls.

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query v5
- **UI Components**: Shadcn/ui with Tailwind CSS for a consistent and modern look.
- **Theme**: Green/earth tone palette (primary: hsl(152 60% 36%))
- **Forms**: react-hook-form with zodResolver for robust form handling and validation.
- **PWA Support**: Progressive Web App with manifest, service worker, offline fallback page, and install prompt for mobile/tablet users. Icons in client/public/icons/, manifest at client/public/manifest.json, service worker at client/public/sw.js.
- **Mobile View**: Dedicated mobile-optimized views for field technicians.
- **Technician Layout**: Role-based UI for technicians showing only Routes (with scheduled/completed/cancelled status tracking per day) and Clients (read-only searchable list). Technicians with role="tech" are automatically routed to this simplified interface. Visit statuses persist in localStorage keyed by day+date.
- **Client Portal**: Separate authentication (email + password) and UI for client self-service, allowing clients to view schedules, past visits, invoices, manage service pauses, and contact the business owner via email. Temporary passwords are emailed via SendGrid when portal access is granted.
- **Admin Dashboard**: A platform-level administration interface for managing tenant accounts, subscriptions, and platform-wide statistics.
- **Notifications System**: In-app notifications for various business events, with a bell icon and unread count in the UI.

### Key Features
- **CSV Import**: One-click import flow with automatic column mapping (fuzzy header matching), editable preview table for row-level review/editing/removal, and new lead source auto-detection. Two-step dialog: Map Columns → Review & Edit. Uses POST /api/contacts/validate-csv for parsing + POST /api/contacts/import/json for final import.
- **Dynamic Lead Sources**: Per-company lead sources managed via `lead_sources` table. Defaults seeded on company setup. Dropdowns in contacts, contact-detail use API data. Unknown lead sources from CSV imports auto-added.
- **CRM**: Manages contacts, properties, referral sources, and includes a tagging system and status pipeline.
- **Scheduling**: Recurring service plans, visit management, and route assignments. Service plans auto-assign to the least-loaded route for their day of week when created without an explicit route.
- **Route Builder**: Drag-and-drop route management with "Unassign All" bulk action, route optimization (TSP + 2-opt with credit system, auto-geocoding before optimization), and dispatch functionality.
- **Invoicing**: Detailed invoicing with line items, tax, discounts, payment processing via Stripe, customizable templates with company logo, and invoice voiding capability.
- **Communication**: Integrated email and SMS services with a centralized communication log.
- **Automation**: Event-driven automation rules with logs.
- **API & Webhooks**: Comprehensive REST API with scoped API keys and webhooks for external integrations, particularly with AI agents.
- **User Roles**: Supports owner, admin, and technician roles with appropriate access control.
- **Proof of Service**: Technicians can upload photos for completed visits via a mobile interface.

## Security
- **Security Headers**: Helmet middleware (HSTS, X-Content-Type-Options, X-Frame-Options, CSP in production)
- **CORS**: Strict origin allowlist via `ALLOWED_ORIGINS` env var (no wildcard with credentials)
- **Rate Limiting**: Global API (500/15min), auth endpoints (20/15min) via express-rate-limit
- **Multi-Tenant Isolation**: All data access scoped by companyId; DELETE/PATCH operations verify tenant ownership
- **Security Scripts**: `scripts/security_scan.sh` (deps, secrets, SAST), `scripts/security_fix.sh` (auto-patch)
- **Documentation**: `SECURITY.md` for scan instructions, severity levels, secret rotation
- **Reports**: `reports/` directory with scan output (dependency-audit.json, secrets-scan.txt, sast-results.json, security-summary.md)

## External Dependencies
- **PostgreSQL**: Primary database.
- **Custom Auth**: Email/password authentication with session cookies and Bearer token fallback.
- **Object Storage**: For storing file uploads such as proof-of-service photos.
- **SendGrid**: Email sending service for notifications and invoices.
- **Twilio**: SMS messaging service for customer communications.
- **Stripe**: Payment gateway for processing invoices and managing customer payment methods.
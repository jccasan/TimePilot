# Scoopilot - Pet Waste Removal SaaS

## Overview
Scoopilot is a production-ready vertical SaaS application for pet waste removal businesses. It provides a comprehensive operational solution, including a multi-tenant architecture with role-based access, CRM, recurring service scheduling with route assignments, a mobile interface for field technicians, invoicing, a client portal, event-driven automation, and a REST API with webhooks for AI agent integrations. The project aims to enhance efficiency and customer management for pet waste removal companies.

## User Preferences
- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface

## System Architecture

### Core Design Principles
Scoopilot is a full-stack, multi-tenant SaaS application emphasizing role-based access control, event-driven automation, and modular design for scalability and extensibility. It maintains a clear separation of concerns between frontend and backend.

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon-backed)
- **ORM**: Drizzle ORM with drizzle-zod
- **Authentication**: Custom email/password with session cookies + Bearer token fallback. Password recovery via SendGrid.
- **Invoice Template Engine**: Custom mustache-style HTML template engine supporting per-company themes and logos.
- **Route Optimization**: Nearest-neighbor TSP with 2-opt improvement, utilizing Mapbox Directions API for real road-based metrics and falling back to haversine.
- **Geocoding**: Mapbox Geocoding API v6 for address autocomplete and forward geocoding.
- **API & Webhooks**: Comprehensive REST API with scoped API keys and HMAC-signed webhook delivery with retry for external integrations.
- **Security**: Helmet middleware, strict CORS, rate limiting, multi-tenant data isolation, and security scripts.

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query v5
- **UI Components**: Shadcn/ui with Tailwind CSS
- **Theme**: Green/earth tone palette (primary: hsl(152 60% 36%))
- **Forms**: react-hook-form with zodResolver
- **PWA Support**: Progressive Web App with manifest, service worker, and offline fallback.
- **Mobile View**: Dedicated mobile-optimized views for field technicians with role-based UI.
- **Client Portal**: Separate authentication and UI for self-service, allowing clients to manage services and view information. Portal access is managed from the contact detail page (enable/disable) and credentials are emailed via SendGrid. "Send Portal Link" button on PortalAccessCard resends credentials (POST `/api/contacts/:id/portal-access/resend`). Bulk "Send Portal Link" action on contacts list page (POST `/api/contacts/bulk/send-portal-link`) enables portal access and sends credentials to multiple contacts at once. Portal login URL: `/portal/login`. All portal emails include a direct login link and temporary password.
- **Admin Dashboard**: Platform-level administration for tenant management, analytics, and company provisioning.
- **Notifications System**: In-app notifications for business events.
- **Rover Chatbot**: In-app AI assistant for app functionality questions and trouble ticket submission.
- **Dark Mode**: Full dark mode support.

### Key Features
- **CSV Import**: One-click import with automatic column mapping, editable preview, and lead source auto-detection.
- **AI-Assisted Import Wizard**: Multi-step wizard with AI-powered column mapping (OpenAI), confidence scores, and transformation support.
- **Sweep&Go Migration**: Invoice import from Sweep&Go CSV exports with payment ledger reconciliation.
- **Invoice Payment Ledger**: Internal payment tracking for imported, manual, and Stripe payments, supporting partial payments.
- **CRM**: Manages contacts, properties, referral sources, tagging, and status pipelines.
- **Scheduling**: Recurring service plans, visit management, and route assignments.
- **Route Builder**: Drag-and-drop route management, optimization, and dispatch.
- **Invoicing**: Detailed invoicing with line items, tax, discounts, Stripe payment processing, and customizable templates.
- **Communication**: Integrated email and SMS with a centralized log.
- **Automation**: Event-driven automation rules.
- **User Roles**: Owner, admin, and technician roles with access control.
- **Satellite/Aerial View**: Google Maps satellite imagery for properties, with street/aerial toggle on technician views.
- **Yard Measurement Tool**: Interactive Mapbox polygon drawing tool for measuring yard area from satellite view, with automatic size categorization (Small/Standard/Large/Extra Large).
- **Proof of Service**: Technicians can upload photos via mobile.
- **Technician Time Tracking**: Clock in/out functionality.
- **Bulk Contact Actions**: Multi-select actions for contacts.
- **Activity Log**: Chronological timeline of interactions per contact.
- **Global Search**: Search across contacts, properties, invoices, and routes.
- **Dashboard Customization**: Configurable widgets with persistent layout.
- **Route Map View**: Mapbox GL JS map for route visualization.
- **Audit Trail**: Tracks critical data changes with before/after snapshots.
- **Automated Jobs**: Auto-invoicing, reminders, auto-visit generation, and webhook retry.
- **Public Signup Flow**: Rate-limited public endpoint for new company signups with email verification.
- **Automatic Price Calculator**: Cost-based pricing engine (Feature Set A) that recommends three-tier pricing (Minimum/Recommended/Premium) based on yard size, dog count, service frequency, yard difficulty, travel distance, route density, and cluster proximity. Includes tenant-configurable settings for labor, fuel, overhead, equipment, frequency multipliers, difficulty multipliers, profit targets, and market anchors. Integrated into the Admin Pricing Tool page (`/pricing-calculator`), property detail views (inline `PriceCalculatorCard`), and the service plan estimate builder (inline price suggestions with profit warnings). Stores price recommendations in `price_recommendations` table. UI displays all costs in dollars/cents ($X.XX format); internally stores as cents (integers). Located in sidebar "Business" section. All settings and calculator fields have plain-English help tooltips (HelpCircle icons).
- **Customer Profitability Dashboard** (Feature Set B): Drilldown profitability dashboard at `/profitability` showing profit/loss per customer and per route. Includes KPI summary cards (Total Revenue, Total Costs, Total Profit, Average Margin, Unprofitable Count), a sortable/filterable customer profitability table with color-coded rows and status badges (Profitable/Marginal/Unprofitable), route-level profitability view with expandable customer details, customer drilldown page (`/profitability/:contactId`) with per-property cost breakdowns and historical trend charts, bulk price adjustment recommendations for unprofitable accounts, and inline profitability badges on contact detail pages. Uses `profitability_snapshots` table for historical tracking. Profitability calculator service (`server/services/profitability-calculator.ts`) reuses the pricing calculator engine for cost computation. Thresholds: profitable = >15% margin, marginal = 0-15%, unprofitable = negative. Located in sidebar "Business" section.
- **Route Profit Maps** (Feature Set C): Interactive Mapbox GL map at `/route-profit-maps` that visualizes route profitability geographically. Features: color-coded stop markers (green/yellow/red by profitability status), route path lines colored by overall route profitability, popup details per stop (revenue, cost, profit, margin), collapsible sidebar panel listing all routes with aggregate stats, day-of-week and status filters, "Stops" vs "Zones" view toggle (heatmap layer showing profit density), map legend, and click-to-zoom route focusing. API endpoint `GET /api/profitability/route-map` returns routes with geo-enriched stops. Component: `client/src/components/profitability-map.tsx`. Located in sidebar "Business" section.
- **Pricing Simulator** (Feature Set D): Interactive pricing simulation and competitor analysis tool at `/ai-pricing-optimizer`. Three-tab interface: (1) **Pricing Simulator** — slider controls for target margin %, overhead adjustment %, labor rate adjustment %, and travel cost factor; runs deterministic simulations showing per-property current vs simulated pricing with change amounts and margin projections; KPI summary cards for monthly revenue delta, margin changes, properties needing increases/decreases. (2) **Price Elasticity** — models churn impact at 9 price points (-10% to +30%) using an elasticity curve; shows estimated churn %, retained customers, adjusted monthly revenue, and net revenue change; highlights the "sweet spot" price point; can analyze all properties or a single property. (3) **Competitor Analysis** — CRUD for competitor pricing entries (name, price, zip code, frequency, yard size, dog count range); market comparison by zip code showing your avg vs market avg (normalized to weekly); position badges (below/at/above market). DB table: `competitor_pricing`. Service: `server/services/pricing-simulator.ts`. API: `POST /api/pricing-simulator/simulate`, `POST /api/pricing-simulator/elasticity`, `POST /api/pricing-simulator/competitor-analysis`, `GET /api/pricing-simulator/zip-codes`, full CRUD at `/api/competitor-pricing`. No OpenAI dependency — all simulations are deterministic math. Located in sidebar "Business" section.
- **Guided Onboarding Setup**: Action-oriented 4-step onboarding flow (`client/src/components/guided-setup.tsx`) embedded in the dashboard for new users. Steps: (1) Add first customer — inline form with name, address, yard size, dog count, frequency, service day; auto-creates contact + property. (2) Price first property — auto-runs pricing calculator, shows recommended price + estimated monthly profit as a "value hook", user can accept or override. (3) Create service plan — pre-filled summary card with one-click creation. (4) Generate route — auto-creates route for service day, assigns plan, generates 4 weeks of visits. Backend API `GET /api/onboarding/status` tracks 4 steps (add_customer, price_property, create_service_plan, generate_route) with helper IDs (firstContact, firstProperty, firstServicePlan). Component syncs activeStep with backend status on re-render. Skippable. Completion card offers "View Route Builder" or "Stay on Dashboard" CTAs. Handles edge cases: users who already completed some steps, missing property fallback creation, null guards on all mutations.
- **Overhead Costs**: Per-company overhead cost tracking at `/overhead-costs`. Users can add/delete line items organized by collapsible categories (Office + Admin, Marketing, Vehicles + Transportation, Tools + Field Supplies, Labor, Operations, Financial Overhead). Each item has a monthly cost (stored as cents), type (fixed/variable), and category. Auto-seeds default items on first visit including ScooPilot subscription (auto-detected from company tier). KPI cards show Total Monthly, Per Visit (overhead / estimatedMonthlyStops), Fixed total, Variable total. The total overhead feeds into the profitability calculator via `overrideMonthlyOverheadCents` parameter on `calculatePrice()`, replacing the legacy PricingConfig overhead fields when overhead_costs entries exist. Table: `overhead_costs`. API: `GET/POST/PATCH/DELETE /api/overhead-costs`, `POST /api/overhead-costs/seed-defaults`. Located in sidebar "Business" section.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads (e.g., proof-of-service photos).
- **SendGrid**: Email sending service.
- **Twilio**: SMS messaging service.
- **Stripe**: Payment gateway for processing payments and managing customer data.
- **Mapbox**: Directions API, Geocoding API, and GL JS for mapping and routing functionalities.
- **Google Maps**: Street View Static API and Static Maps API (satellite) for property images on contact detail and technician views. Proxied via `GET /api/streetview` and `GET /api/satellite` endpoints using `GOOGLE_MAPS_API_KEY`.
- **OpenAI**: Used for AI-assisted import wizard functionalities via Replit AI Integrations.
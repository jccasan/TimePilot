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
- **Scheduling & Routing**: Recurring service plans with add-ons, visit management, drag-and-drop route builder with map visualization, visit completion tracking. One-time service plans integrated into routes.
- **Financials**: Detailed invoicing with Stripe integration, payment ledger, cost-based automatic price calculator, profitability dashboard, and client tipping. Revenue calculations use `paidAt` for accurate reporting.
- **Communication**: Integrated email and SMS with two-way SMS conversation inbox (threaded view, inline reply, unread tracking), client portal, and configurable notification preferences.
- **Field Operations**: Technician mobile interface with proof-of-service photo uploads, time tracking, satellite/aerial views, yard measurement tool, automated customer notifications (gate closed photo, ETA SMS), and manual "On my way" SMS with live GPS-based ETA via Mapbox Directions.
- **Business Intelligence**: Overhead cost tracking, customer profitability, route profit maps, and a pricing simulator. MRR calculation includes add-ons.
- **Dashboard Widgets**: Customizable drag-and-drop dashboard with various operational and financial widgets, including weather forecast and route map preview.
- **Onboarding**: Guided 5-step onboarding flow for initial setup including service zones, customer addition, pricing, service plan creation, and route generation.
- **Service Zones**: Management of service areas by zip code and day of week with interactive map.
- **Access Control**: Multi-tenant architecture with Owner, Admin, and Technician roles.
- **Admin Security Center**: Tools for managing admin accounts, active sessions, and audit logs. Includes password policy enforcement.
- **Subscription Pricing Management**: Admin interface for managing DB-backed subscription tiers.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads.
- **SendGrid**: Email sending.
- **Twilio**: SMS messaging.
- **Stripe**: Payment gateway with Stripe Connect for multi-tenant payment routing.
- **Mapbox**: Directions API, Geocoding API, and GL JS for mapping and routing.
- **Google Maps**: Street View Static API and Static Maps API for property images.
- **OpenAI**: Used for AI-assisted import wizard and Rover AI chatbot (via Replit AI Integrations).
- **Retell AI**: Voice agent integration for lead creation and customer lookup.
# Scoopilot - Pet Waste Removal SaaS

## Overview
Scoopilot is a production-ready vertical SaaS application designed for pet waste removal businesses. It provides a comprehensive operational solution covering CRM, recurring service scheduling with route optimization, a mobile interface for field technicians, invoicing, and a client portal. The platform also features event-driven automation and a REST API with webhooks for AI agent integrations, aiming to significantly boost efficiency and streamline customer management within the industry.

## User Preferences
- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface

## System Architecture

### Core Design Principles
Scoopilot is a full-stack, multi-tenant SaaS application built on role-based access control, event-driven automation, and a modular design, ensuring scalability and a clear separation of concerns.

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM
- **Authentication**: Custom email/password with session cookies and Bearer token.
- **API & Webhooks**: Comprehensive REST API with scoped API keys and HMAC-signed webhook delivery.
- **Security**: Helmet middleware, CORS, rate limiting, and multi-tenant data isolation.
- **Automation**: Configurable reminder system and quiet hours.
- **Route Optimization**: Nearest-neighbor TSP with 2-opt improvement.

### Frontend
- **Framework**: React with TypeScript
- **State Management**: TanStack Query v5
- **UI Components**: Shadcn/ui with Tailwind CSS, utilizing a green/earth tone theme.
- **Mobile View**: Dedicated mobile-optimized views for field technicians, including PWA support and offline capabilities.
- **Client Portal**: Self-service portal for managing services, billing, and account information.
- **Admin Dashboard**: Platform-level administration for tenant management.
- **Rover Chatbot**: AI-powered in-app assistant with SSE streaming responses and function calling.
- **Dark Mode**: Full dark mode support.

### Key Features
- **Data Management**: CRM for contacts and properties, CSV import with AI-assisted mapping, activity logs, and global search.
- **Jobs System**: Management for one-off and recurring services, including "Stop Only" flags for non-revenue visits.
- **Scheduling & Routing**: Recurring service plans, visit management, drag-and-drop route builder with map visualization, and visit completion tracking. Includes a route lock feature to preserve optimized stop orders.
- **Financials**: Detailed invoicing with Stripe integration, payment ledger, profitability dashboard, and client tipping. Supports QuickBooks Online bidirectional sync for contacts and invoices.
- **Communication**: Integrated email and two-way SMS with a threaded conversation inbox, client portal, and configurable notification preferences.
- **Client Signup Widget**: Public-facing signup and quote page with instant pricing and lead creation.
- **Lead Webhook Integration**: Accepts leads from external sources with API key authentication, auto-creating contacts and triggering notifications.
- **Field Operations**: Technician mobile interface with proof-of-service photo uploads, time tracking, yard measurement tools, and automated customer notifications (e.g., ETA SMS). Features offline resilience via IndexedDB caching and background sync.
- **Quoting & Proposals**: Universal quoting engine supporting residential and commercial quotes with multi-tier pricing, manual overrides, and public portal for viewing/accepting proposals. Commercial pricing tool includes station count, time per station, common area minutes, crew size, round-trip mileage, dump fees, site sq ft (auto-populated from measurement tool), initial deep clean, and multi-visit frequency discounts.
- **Business Intelligence**: Overhead cost tracking, customer profitability, route profit maps, and pricing simulation.
- **Subscription Management**: DB-backed subscription tiers, Stripe Checkout integration, 14-day free trial, automated account freezing for failed payments, and usage metering. Includes a Voice Plan Add-on for AI voice agents.
- **Voice Agent Scheduling API**: Platform-agnostic REST API for AI voice agents to perform caller lookup, check availability, book/pause/resume/reschedule/cancel services, and retrieve call logs.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads.
- **SendGrid**: Email sending.
- **Twilio**: SMS messaging (global provider).
- **Telnyx**: SMS messaging (per-tenant provider option).
- **Stripe**: Payment gateway with Stripe Connect for multi-tenant payment routing.
- **Mapbox**: Directions API, Geocoding API, and GL JS for mapping and routing.
- **Google Maps**: Street View Static API and Static Maps API for property images.
- **OpenAI**: Used for AI-assisted import wizard and Rover AI chatbot.
- **QuickBooks Online**: Accounting integration for syncing contacts, invoices, and payments.
- **Retell AI**: Voice agent integration for lead creation and customer lookup, with webhook handling for call events and usage tracking.
# Scoopilot - Pet Waste Removal SaaS

## Overview

Scoopilot is a production-ready vertical SaaS application designed for pet waste removal businesses. It provides a comprehensive operational solution that includes CRM, recurring service scheduling with route optimization, a mobile interface for field technicians, invoicing, and a client portal. The platform integrates event-driven automation and a REST API with webhooks for AI agent integrations, aiming to significantly enhance efficiency and streamline customer management in the industry.

## User Preferences

- Green/earth tone color palette for pet waste business branding
- Mobile-first responsive design
- No emojis in UI
- Clean, professional interface
- Before making any code changes, the agent must:
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
- **API & Webhooks**: Comprehensive REST API with scoped API keys and HMAC-signed webhook delivery.
- **Security**: Helmet middleware, CORS, rate limiting, and multi-tenant data isolation.
- **Automation**: Configurable reminder system and quiet hours.
- **Route Optimization**: Nearest-neighbor TSP with 2-opt improvement.
- **Routes Structure**: Backend routes are organized into domain-specific modules.

### Frontend

- **Framework**: React with TypeScript
- **State Management**: TanStack Query v5
- **UI Components**: Shadcn/ui with Tailwind CSS, utilizing a green/earth tone theme.
- **Mobile View**: Dedicated mobile-optimized views for field technicians, including PWA support and offline capabilities.
- **Client Portal**: Self-service portal.
- **Admin Dashboard**: Platform-level administration for tenant management.
- **Rover Chatbot**: AI-powered in-app assistant with SSE streaming responses and function calling.
- **Dark Mode**: Full dark mode support.
- **Draggable Grid Layouts**: Dashboard and settings page use `react-grid-layout` with layout persistence.

### Key Features

- **Quick Create**: Sidebar dropdown for rapid creation of contacts, quotes, invoices, and jobs.
- **Data Management**: CRM for contacts and properties, CSV import with AI-assisted mapping, activity logs, and global search.
- **Jobs & Scheduling**: Unified job management, auto-visit generation, auto-assignment to routes, drag-and-drop route builder with map visualization, and calendar views.
- **Financials**: Detailed invoicing with Stripe integration, payment ledger, profitability dashboard, client tipping, and QuickBooks Online bidirectional sync. Includes a redesigned invoicing flow with revenue dashboard and batch actions.
- **Communication**: Integrated two-way email and SMS with a unified threaded conversation inbox, client portal, and configurable notifications. Supports shared-number multi-tenant SMS routing and MMS.
- **Admin Messaging Monitor**: Platform admin page for messaging analytics and exception queue management.
- **Client Signup Widget**: Public-facing signup and quote page with instant pricing, lead creation, and funnel analytics. Includes configurable auto-follow-up.
- **Lead & Quote Ingestion Webhooks**: Accepts leads and website form data from external sources, performing auto-deduplication, property creation with geocoding, tiered pricing calculation, draft quote creation, and triggering automation.
- **Field Operations**: Technician mobile interface with proof-of-service photo uploads, time tracking, yard measurement tools, automated customer notifications, and offline resilience.
- **Quoting & Proposals**: Universal quoting engine for residential and commercial quotes with multi-tier pricing, manual overrides, and a public portal.
- **Business Onboarding Wizard**: 5-step automated onboarding flow for new companies covering profile, business intelligence, pricing, Stripe Connect, and review.
- **Feature Tours**: Joyride-based guided tours for new and returning users.
- **Business Intelligence**: Overhead cost tracking, customer profitability, route profit maps, pricing simulation, and per-customer cost overrides.
- **Subscription Management**: DB-backed subscription tiers, Stripe Checkout, free trial, account freezing, and usage metering, including a Voice Plan Add-on.
- **Voice Agent Scheduling API**: Platform-agnostic REST API for AI voice agents to manage services and retrieve call logs.
- **Cross-sell Opportunities Engine**: Rules-based engine that surfaces upgrade/add-on suggestions for contacts based on various criteria, displayed in a dashboard widget and contact detail pages.
- **Client Notifications (Import Mode + Onboarding Complete)**: Settings block for suppressing outbound client emails during data import and a one-time batch-send welcome email upon onboarding completion.

### Data Model

The scheduling data model is refactored into three layers: `agreements` (billing), `jobs` (work/routing), and `visits` (instance).

### UI Component Rules

Radix `<Popover>` components should never be nested inside a Radix `<Sheet>` or `<Drawer>` due to focus management conflicts. Dialog-based picker patterns should be used instead for components within Sheets or Drawers.

## External Dependencies

- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads.
- **SendGrid**: Email sending.
- **Twilio**: SMS messaging.
- **Telnyx**: SMS/MMS messaging.
- **Stripe**: Payment gateway with Stripe Connect.
- **Mapbox**: Directions API, Geocoding API, and GL JS.
- **Google Maps**: Street View Static API and Static Maps API.
- **OpenAI**: AI-assisted import wizard and Rover AI chatbot.
- **QuickBooks Online**: Accounting integration.
- **Retell AI**: Voice agent integration.
- **Voice Agent Wizard** (Python Flask): Standalone onboarding wizard for Retell AI agent tenants.

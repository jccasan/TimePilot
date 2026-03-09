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
- **Client Portal**: Self-service portal with 4-tab layout (Overview, Services, Billing, Account). Clients can edit their contact info (name, email, phone), update property addresses/gate codes/instructions, manage pet count, view service history, approve estimates, manage payments, set notification preferences, and use a referral program. Changes sync back to the CRM via `PATCH /api/portal/profile`.
- **Admin Dashboard**: Platform-level administration for tenant management and analytics.
- **Notifications System**: In-app notifications for business events.
- **Rover Chatbot**: In-app AI assistant.
- **Dark Mode**: Full dark mode support.

### Key Features
- **Data Management**: CSV import with AI-assisted mapping, competitor data transfer (Sweep & Go, Jobber) with auto-detection, CRM for contacts and properties, activity logs, global search, and an audit trail.
- **Scheduling & Routing**: Recurring service plans, visit management, route assignments, and a drag-and-drop route builder with map visualization.
- **Financials**: Detailed invoicing with Stripe integration, payment ledger, cost-based automatic price calculator, and a profitability dashboard (per customer and route).
- **Communication**: Integrated email and SMS, client portal for self-service, and notification preferences.
- **Field Operations**: Technician mobile interface with proof-of-service photo uploads, time tracking, satellite/aerial views, and a yard measurement tool.
- **Business Intelligence**: Overhead cost tracking, customer profitability dashboard, route profit maps, and a pricing simulator with competitor analysis.
- **Automation**: Event-driven automation rules and automated jobs (invoicing, reminders).
- **Onboarding**: Guided 4-step onboarding flow for new users.
- **Access Control**: Multi-tenant architecture with Owner, Admin, and Technician roles.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Object Storage**: For file uploads (e.g., photos).
- **SendGrid**: Email sending.
- **Twilio**: SMS messaging.
- **Stripe**: Payment gateway.
- **Mapbox**: Directions API, Geocoding API, and GL JS for mapping and routing.
- **Google Maps**: Street View Static API and Static Maps API for property images.
- **OpenAI**: Used for AI-assisted import wizard.
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
- **Authentication**: Replit Auth (session-based)
- **Storage**: Object Storage for file uploads (e.g., proof-of-service photos)
- **Email Service**: SendGrid for transactional and marketing emails
- **SMS Service**: Twilio for inbound and outbound text messaging
- **Payment Processing**: Stripe for secure payment gateway integration, including customer management, setup intents, payment intents, and webhook handling.
- **Invoice Template Engine**: Custom mustache-style HTML template engine for flexible and customizable invoice generation, supporting per-company theme overrides.
- **Route Optimization**: Implements a nearest-neighbor TSP with 2-opt improvement algorithm using haversine distance to optimize service routes.

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
- **Client Portal**: Separate authentication and UI for client self-service, allowing clients to view schedules, invoices, and manage service pauses.
- **Admin Dashboard**: A platform-level administration interface for managing tenant accounts, subscriptions, and platform-wide statistics.
- **Notifications System**: In-app notifications for various business events, with a bell icon and unread count in the UI.

### Key Features
- **CRM**: Manages contacts, properties, and includes a tagging system and status pipeline.
- **Scheduling**: Recurring service plans, visit management, and route assignments.
- **Invoicing**: Detailed invoicing with line items, tax, discounts, payment processing via Stripe, and customizable templates.
- **Communication**: Integrated email and SMS services with a centralized communication log.
- **Automation**: Event-driven automation rules with logs.
- **API & Webhooks**: Comprehensive REST API with scoped API keys and webhooks for external integrations, particularly with AI agents.
- **User Roles**: Supports owner, admin, and technician roles with appropriate access control.
- **Proof of Service**: Technicians can upload photos for completed visits via a mobile interface.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Replit Auth**: User authentication and session management.
- **Object Storage**: For storing file uploads such as proof-of-service photos.
- **SendGrid**: Email sending service for notifications and invoices.
- **Twilio**: SMS messaging service for customer communications.
- **Stripe**: Payment gateway for processing invoices and managing customer payment methods.
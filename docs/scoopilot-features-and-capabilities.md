# ScooPilot — Complete Features & Capabilities Guide

---

## 1. Platform Overview

**The all-in-one field service management platform built specifically for pet waste removal businesses.**

ScooPilot is a cloud-based SaaS platform that gives pet waste removal companies everything they need to run, grow, and scale their business from a single dashboard. From the first lead to the last invoice, ScooPilot handles CRM, quoting, scheduling, route optimization, field operations, invoicing, payments, AI-powered tools, and client communications — all purpose-built for the scooping industry.

Whether you're a solo operator running 30 yards a day or a growing company with multiple crews and hundreds of clients, ScooPilot adapts to your business with flexible pricing tiers, team management, and powerful automation.

ScooPilot is a multi-tenant SaaS platform, meaning each company gets its own fully isolated workspace with its own data, branding, users, and settings — all managed from a single, secure cloud application at [app.scoopilot.com](https://app.scoopilot.com).

---

## 2. CRM & Contact Management

ScooPilot includes a full customer relationship management system designed for service businesses that manage recurring residential and commercial accounts.

- **Lead Pipeline** — Track every prospect from first contact to paying customer. Leads flow through a structured pipeline (lead → estimate → active → paused → cancelled) so nothing falls through the cracks.
- **Contact Records** — Store detailed client profiles including name, email, phone, billing preferences, service history, and dog information. Every interaction is logged automatically.
- **Property Management** — Link multiple properties to a single contact. Each property stores its own address, yard polygon, measured square footage, GPS coordinates, gate codes, and special instructions. Properties can have satellite imagery and yard measurements attached.
- **Dog Profiles** — Track the number of dogs, breeds, and any behavioral notes for each property — critical data that directly affects pricing and service time.
- **Bulk Import & Export** — Import your entire client list from CSV or JSON files. The import wizard includes column mapping, data validation, duplicate detection, and error previews. Export your data anytime.
- **Activity Logs** — Every action on a contact — calls, emails, texts, visits, invoices, payments, notes — is recorded in a chronological activity feed so your team always has full context.
- **Global Search** — Instantly search across contacts, properties, invoices, and quotes from a single search bar. Find any record in seconds.
- **Tags & Filtering** — Organize contacts with custom tags and filter your database by status, service frequency, yard size, location, or any custom criteria.
- **Bulk Actions** — Update statuses, apply tags, send portal invites, or trigger communications for multiple contacts at once.

---

## 3. Quoting & Proposals

ScooPilot's universal quoting engine lets you create professional, branded proposals for both residential homeowners and commercial properties — complete with interactive yard measurements and a client-facing acceptance portal.

### Residential Quoting
- **Smart Pricing Calculator** — Enter the number of dogs, yard size, service frequency, and whether it's a first-time cleanup. ScooPilot calculates pricing across three tiers automatically.
- **Multi-Tier Proposals** — Every quote generates three pricing options: Essential, Premium, and Deluxe. Each tier includes a customizable feature list so clients can see exactly what they're getting at each price point.
- **First-Time Deep Clean** — Automatically adds an initial cleanup fee for new properties that haven't been maintained, with the fee clearly broken out on the proposal.

### Commercial Quoting
- **Station-Based Pricing** — Built for HOAs, apartment complexes, dog parks, and commercial properties. Enter the number of waste stations, time per station, common area minutes, crew size, and service frequency.
- **Full Cost Calculator** — Accounts for round-trip mileage (calculated at the IRS standard rate), dump fees, site square footage, crew labor, and initial deep clean costs.
- **Frequency Discounts** — Automatically applies volume discounts for multi-visit schedules (2x/week, 3x/week) so commercial clients see the value of more frequent service.
- **Margin Visibility** — See your cost subtotal, markup percentage, markup dollar amount, and final price per visit. Adjust your markup on the fly to hit your target margins.

### Interactive Yard Measurement Tool
- **Satellite Imagery** — View any property on a high-resolution satellite map powered by Mapbox. Draw measurement polygons directly on the satellite view.
- **Precise Area Calculation** — Click to place points around the yard boundary. ScooPilot calculates the exact square footage using geodesic math. Supports multiple separate measurements per property.
- **Saved Measurement Images** — Each measurement is captured as a satellite image with the green polygon overlay clearly visible, automatically sized to fit the measured area regardless of property size. These images are attached to the quote and displayed in the proposal.
- **Auto-Classification** — Yards are automatically categorized as Small, Standard, Large, or Extra Large based on square footage, with corresponding pricing adjustments.

### Proposal Delivery & Acceptance
- **Branded Proposals** — Proposals display your company logo, name, contact information, and branding. Each proposal includes the property address, measurement images, pricing tiers, service features, and terms.
- **Custom Quote Numbers** — Assign your own quote numbering system or let ScooPilot auto-generate sequential numbers.
- **Client Portal** — Send proposals via email or SMS. Clients receive a branded link where they can view the full proposal, review measurement images, compare pricing tiers, and accept or decline — all without creating an account.
- **Expiration Dates** — Set proposal expiration dates to create urgency and keep your pipeline moving.
- **Internal Notes** — Add private notes visible only to your team, separate from client-facing notes on the proposal.
- **Quote Status Tracking** — Track every quote through its lifecycle: Draft → Sent → Viewed → Accepted → Declined. Know exactly where each opportunity stands.

---

## 4. Scheduling & Visit Management

ScooPilot's scheduling system handles recurring service plans, one-time cleanups, and everything in between — with visual calendar tools and automated visit generation.

- **Recurring Service Plans** — Set up weekly, bi-weekly, monthly, or custom schedules for each property. ScooPilot automatically generates visits based on the plan.
- **Calendar Views** — View your schedule by day, week, or month. See all visits across all technicians at a glance with color-coded status indicators.
- **Drag-and-Drop Rescheduling** — Need to move a visit? Drag it to a new day on the calendar. ScooPilot updates the schedule and can notify the affected client automatically.
- **Bulk Visit Generation** — Generate weeks or months of visits in advance from active service plans with a single click. No more manually creating each appointment.
- **Visit Status Tracking** — Every visit flows through clear statuses: Scheduled → In Progress → Completed / Skipped / Cancelled. Filter and report on completion rates across your team.
- **One-Time Services** — Schedule standalone cleanups, initial deep cleans, or special requests outside of recurring plans.
- **Service Pause & Resume** — Pause a client's service for vacations or seasonal breaks without losing their plan settings. Resume with one click when they're ready.
- **Stop-Only Visits** — Flag non-revenue stops (equipment checks, supply drops) so they appear on routes without affecting billing.

---

## 5. Route Optimization

ScooPilot's route builder helps you plan the most efficient paths for your crews, reducing drive time and fuel costs while maximizing the number of yards you can service each day.

- **Visual Route Builder** — Build routes on an interactive map. See all your stops plotted geographically and drag them into the optimal order. Assign stops to specific technicians and days of the week.
- **AI-Powered Optimization** — One-click route optimization uses nearest-neighbor TSP (Traveling Salesman Problem) with 2-opt improvement algorithms to find the shortest path through all your stops. Powered by Mapbox Directions API for real-world driving distances and times.
- **Route Lock** — Once you've perfected a route order, lock it so automated optimizations and bulk changes don't disrupt your carefully planned sequences.
- **Real-Time Progress** — Track visit completion in real-time as your technicians work through their daily routes. See which stops are done, in progress, or still pending.
- **Multi-Day Planning** — Assign stops to specific days of the week. See your Monday route separate from your Wednesday route. Balance workloads across days and crews.
- **Route Performance Metrics** — Track total drive distance, estimated drive time, number of stops, and estimated revenue for each route.
- **Drag-and-Drop Stop Ordering** — Manually reorder stops when you know the neighborhood better than the algorithm. Your local knowledge combined with AI optimization gives you the best of both worlds.

---

## 6. Field Technician Mobile App

ScooPilot includes a dedicated mobile-optimized interface for field technicians — no separate app download required. Techs access everything through their phone's browser.

- **Daily Route View** — Technicians see their assigned stops for the day in optimized order, with addresses, gate codes, dog information, and special instructions for each property.
- **One-Tap Visit Actions** — Start a visit, mark it complete, or skip it with a single tap. Each action is timestamped and logged automatically.
- **Proof-of-Service Photos** — Capture before/after photos directly from the mobile interface. Photos are uploaded to cloud storage and attached to the visit record for client verification.
- **GPS-Stamped "On My Way" SMS** — Send an automated text message to the client when you're heading to their property. The message includes your estimated arrival time based on real-time location.
- **Time Tracking** — Automatic start/stop timers for each visit. Track how long each yard takes to identify efficiency opportunities and validate your pricing.
- **Offline Mode** — Keep working even without cell service. The mobile app caches route and property data locally using IndexedDB. Completed visits sync automatically when connectivity returns via background sync.
- **Field Notes** — Add notes to any visit — gate was locked, extra dogs present, yard condition concerns. Notes sync to the office in real-time and appear in the client's activity history.
- **Navigation Integration** — One-tap navigation to the next stop using Google Maps or your preferred navigation app.

---

## 7. Invoicing & Payments

ScooPilot automates the entire billing cycle — from generating invoices when service is completed to processing credit card payments and recording them in your books.

- **Auto-Invoice Generation** — Invoices are created automatically when visits are completed. Choose to bill per service, per week, or per month based on your business model.
- **Batch Invoicing** — Generate invoices for all completed, unbilled visits across your entire client base with a single action. No more manually creating invoices one by one.
- **Stripe Payment Processing** — Accept credit and debit card payments directly through ScooPilot. Clients can pay online through their portal or via payment links sent by email/SMS.
- **Card-on-File Auto-Pay** — Store a client's payment method securely through Stripe and charge it automatically when invoices are generated. Set it and forget it — payments process without any manual effort.
- **Customer Tipping** — Clients can add a tip when paying their invoice through the payment portal. Tips are tracked separately in your financial records.
- **Payment Ledger** — A complete record of every payment received, including date, amount, method, and associated invoice. Filter by date range, client, or payment status.
- **Invoice Consolidation** — Group multiple visits into a single monthly invoice for clients who prefer consolidated billing. Supports per-service, weekly, and monthly billing frequencies.
- **Overdue Tracking** — Invoices are automatically flagged when they pass their due date. Send automated payment reminders to clients with outstanding balances.
- **Partial Payments** — Track partial payments against invoices with remaining balance calculations.
- **Tax Support** — Configure tax rates and have them automatically applied to invoices.

---

## 8. Client Portal

Give your clients a professional, self-service experience with ScooPilot's branded client portal — accessible from any device without downloading an app.

- **Service Schedule** — Clients can view their upcoming and past service visits, including dates, times, and completion status.
- **Invoice History & Payments** — Clients see all their invoices in one place and can pay outstanding balances online with a credit card. Payment confirmation is instant.
- **Dog Management** — Clients can update their dog information (count, breeds, notes) directly through the portal, keeping your records current without phone calls or emails.
- **Quote Review & Acceptance** — When you send a proposal, clients receive a branded link to review pricing tiers, view yard measurement images, and accept their preferred plan — all through the portal.
- **Service Requests** — Clients can request service changes, schedule one-time cleanups, or pause/resume their service directly through the portal. Requests appear in your dashboard for approval.
- **In-App Messaging** — Two-way messaging between clients and your office. Conversations are threaded and stored for reference.
- **Account Management** — Clients can update their contact information, manage payment methods, and view their complete service history.

---

## 9. AI-Powered Features

ScooPilot integrates artificial intelligence throughout the platform to help you work smarter, price better, and serve clients faster.

### Rover AI — Your In-App Business Assistant
- **Context-Aware Chat** — Rover is an AI chatbot built into your ScooPilot dashboard that knows your business. It has real-time access to your contact count, monthly recurring revenue, upcoming visits, and overdue invoices.
- **Live Data Queries** — Ask Rover questions like "How many active clients do I have?" or "What's my MRR?" and get instant, accurate answers pulled from your live data.
- **Action Suggestions** — Rover can suggest creating support tickets or feature requests based on your conversation, streamlining your workflow.
- **Streaming Responses** — Rover responds in real-time with streaming text, so you see answers as they're generated — no waiting for a full response.

### AI Pricing Optimizer
- **Market Benchmarking** — Compare your pricing against local competitor data to ensure you're positioned competitively in your market.
- **Price Elasticity Simulation** — Model how price changes would affect customer retention and net revenue before you make changes. See the projected impact of a 5%, 10%, or 15% increase.
- **Unprofitable Account Detection** — AI analyzes your per-customer profitability and flags accounts that are costing you money, with specific recommendations for price adjustments.

### AI-Assisted Data Import
- **Smart Column Mapping** — When importing CSV files from competitors or spreadsheets, AI automatically maps your columns to ScooPilot fields. It handles variations in column naming, date formats, phone number formats, and service frequency descriptions.
- **Data Cleaning** — Automatically standardizes phone numbers, addresses, and pricing data during import.

---

## 10. AI Voice Agent

ScooPilot integrates with Retell AI to provide an intelligent, always-available phone agent that handles inbound calls for your business — answering questions, looking up customers, and booking services.

- **Dedicated Local Phone Number** — Provision a local phone number in your preferred area code. Callers reach your AI agent at a real, local number that builds trust.
- **Company-Specific Knowledge** — The voice agent is automatically trained on your company's information, services, pricing, and service area. It answers questions accurately based on your actual business data.
- **Inbound Call Handling** — The AI agent picks up every call, 24/7. No more missed leads during busy service hours. It can look up existing customers, check availability, and provide service information.
- **Appointment Booking** — Callers can book new services, pause existing services, resume paused accounts, reschedule visits, or cancel — all through a natural voice conversation with the AI.
- **Call Summaries & Analysis** — Every call is recorded, transcribed, and summarized. Review call outcomes, duration, and success rates from your dashboard.
- **Usage Tracking & Billing** — Voice minutes are tracked and billed through your ScooPilot subscription. Monitor your monthly usage against your plan's included minutes.
- **Voice Plan Options** — Choose the plan that fits your call volume:
  - **Voice Starter** — $59/month ($49 for existing subscribers), includes 60 minutes
  - **Voice Pro** — $119/month ($99 for existing subscribers), includes 200 minutes

---

## 11. SMS & Communications

ScooPilot's built-in communication tools keep your clients informed at every stage — from service reminders to payment confirmations — with two-way SMS and automated messaging.

- **Two-Way SMS** — Send and receive text messages directly from ScooPilot. Conversations are threaded by contact so your team has full context for every interaction.
- **Multi-Provider Support** — Choose between Twilio (system default) or Telnyx as your SMS provider. Companies can configure their own Telnyx API keys and messaging profiles for custom sender IDs.
- **Automated Service Reminders** — Send "service scheduled for tomorrow" reminders automatically. Configure timing and message content to match your brand voice.
- **Invoice & Payment Reminders** — Automated text reminders for outstanding invoices. Set the timing and frequency of follow-ups.
- **Customizable Templates** — Create reusable message templates with dynamic placeholders like {firstName}, {serviceDate}, {total}, and {companyName}. Templates ensure consistent, professional communication.
- **Threaded Conversation Inbox** — View all SMS conversations in a unified inbox. See the full history with each contact, reply inline, and never lose track of a conversation.
- **Quiet Hours** — Configure business hours for automated messages. Reminders and notifications are held until your designated sending window so you never text a client at 3 AM.
- **SMS Usage Tracking** — Monitor your monthly SMS segment usage against your plan allowance. Usage is metered and billed through Stripe for transparent cost management.

---

## 12. Email Communications

ScooPilot handles transactional email delivery through SendGrid, ensuring your business communications reach your clients' inboxes reliably.

- **Transactional Emails** — Automated emails for invoice delivery, payment confirmations, quote proposals, service notifications, and account updates.
- **Notification Preferences** — Configure which events trigger email notifications and customize the content for your business.
- **Branded Communications** — Emails include your company logo and branding for a professional, consistent client experience.

---

## 13. QuickBooks Online Integration

Keep your books in sync automatically. ScooPilot's QuickBooks Online integration eliminates double data entry by syncing your customers, invoices, and payments bidirectionally.

- **Secure OAuth 2.0 Connection** — Connect your QuickBooks account with a secure, token-based authentication flow. Credentials are encrypted at rest.
- **Contact Sync** — ScooPilot contacts automatically sync to QuickBooks as Customers. The system matches by email or display name to prevent duplicate records.
- **Invoice Sync** — Invoices created in ScooPilot are pushed to QuickBooks with full line item detail, taxes, and due dates. Service items are mapped to QBO "Service" or "Non-Inventory" item types.
- **Payment Recording** — When an invoice is marked paid in ScooPilot, the corresponding payment is automatically recorded in QuickBooks — keeping your AR accurate without manual journal entries.
- **Sync Logs** — Every synchronization attempt is logged with success/error status and links to the corresponding QuickBooks entity IDs. Quickly identify and resolve any sync issues.
- **Manual Full Sync** — Trigger a complete sync of all active contacts and recent invoices/payments on demand. Useful after initial setup or if you need to reconcile records.

---

## 14. Subscription Plans & Billing

ScooPilot offers flexible pricing tiers that grow with your business, from solo operators to multi-crew enterprises. All plans include a 14-day free trial.

### SaaS Subscription Tiers
| Plan | Price | Max Users | Best For |
|------|-------|-----------|----------|
| **Solo** | $29/month | 1 | Solo operators |
| **Walk** | $49/month | 3 | Small teams |
| **Run** | $99/month | 6 | Growing businesses |
| **Grow** | $149/month | 12 | Multi-crew operations |
| **Enterprise** | Custom | Unlimited | Large organizations |

- **Additional Users** — Add team members beyond your plan limit for $7/user/month.
- **14-Day Free Trial** — Every new account starts with a full-featured, no-commitment trial. No credit card required to start.

### Stripe Connect for Your Clients
- **Accept Payments Through Your Brand** — ScooPilot uses Stripe Connect to let you accept credit card payments from your clients under your own business name. Funds are deposited directly to your bank account.
- **Platform Fee** — A transparent 2.9% platform fee on processed payments, in addition to standard Stripe processing fees.

### Metered Billing
- **Pay for What You Use** — SMS segments, voice agent minutes, and additional user seats are tracked and billed automatically based on actual usage. No surprises — usage dashboards show exactly where you stand against your plan limits.

### Billing Management
- **Stripe Customer Portal** — Manage your subscription, update payment methods, view invoices, and change plans through a secure Stripe-hosted billing portal.
- **Automated Account Management** — Failed payments trigger automatic notifications and account status updates. Accounts with persistent payment failures are frozen to prevent unbilled service delivery.

---

## 15. Automation Engine

ScooPilot's automation engine lets you create "if this, then that" rules that eliminate repetitive tasks and ensure nothing falls through the cracks.

- **Event Triggers** — Kick off automations when specific events happen:
  - **Lead Created** — A new prospect is added (including from external webhooks)
  - **Service Completed** — A technician marks a visit as done
  - **Payment Failed** — A payment attempt is declined
  - **Invoice Created** — A new invoice is generated
- **Automated Actions** — Each trigger can fire one or more actions:
  - **Create Task** — Automatically generate follow-up tasks for your team
  - **Send Email** — Fire off notification or transactional emails
  - **Send Webhook** — Push event data to external systems and tools
- **Configurable Rules** — Set up as many automation rules as you need. Enable, disable, or modify them at any time without affecting your other operations.

---

## 16. Webhooks & API Integration

ScooPilot is built to integrate with your existing tools and external services through a robust webhook and API system.

### Outbound Webhooks
- **Event Notifications** — Push real-time event data to external URLs when key events occur: contact created, contact updated, visit completed, invoice created, invoice paid, payment failed.
- **HMAC Security** — Every outbound webhook is signed with HMAC SHA256 so the receiving system can verify it came from ScooPilot. Your data integrity is protected.
- **Reliable Delivery** — Built-in retry logic attempts delivery up to 5 times with exponential backoff. Delivery logs show the status of every webhook attempt.

### Inbound Lead Capture Webhook
- **External Lead Forms** — Accept leads from your website, landing pages, or any external system via a dedicated webhook endpoint. ScooPilot automatically:
  - Creates a new contact with "lead" status
  - Geocodes the address and creates a property record
  - Calculates a recommended price based on yard size and dog count
  - Sends an auto-quote SMS to the lead if a phone number is provided
- **API Key Authentication** — Secure your webhook endpoints with scoped API keys. Each key can be restricted to specific operations.

### Voice Agent Scheduling API
- **Platform-Agnostic REST API** — A dedicated API for AI voice agents (or any external system) to perform caller lookup, check service availability, book new services, pause/resume accounts, reschedule visits, cancel services, and retrieve call logs.

---

## 17. Analytics & Business Intelligence

ScooPilot gives you a clear picture of your business health with real-time dashboards, KPI tracking, and visual analytics.

### Customizable Dashboard
- **Drag-and-Drop Widgets** — Build your perfect dashboard by adding, removing, and rearranging widgets. Choose from MRR, revenue, team size, client count, visit progress, and more.
- **Client Request Inbox** — See service change requests, portal messages, and one-time cleanup leads directly on your dashboard.
- **Today's Operations** — Real-time progress bar showing how many of today's visits are completed, plus a weekly upcoming visit summary.
- **5-Day Weather Forecast** — Plan around the weather with an integrated forecast widget. Know when rain or extreme temperatures might affect your service schedule.

### Business Metrics
- **Monthly Recurring Revenue (MRR)** — Track your predictable revenue with real-time MRR calculations based on active service plans.
- **Customer Acquisition** — Monitor new customer growth rates, lead sources, and conversion rates from lead to paying client.
- **Visit Completion Rates** — Track the percentage of scheduled visits that are completed vs. skipped or cancelled. Identify patterns and address issues.
- **Revenue Trends** — Visualize monthly revenue trends with interactive charts. Spot seasonality and growth patterns.
- **Lead Source Distribution** — See where your leads are coming from (website, referral, phone, webhook) with pie and bar chart breakdowns.
- **Route Performance** — Compare routes by efficiency metrics: stops per hour, revenue per mile, and completion rates.

---

## 18. Profitability Tools

ScooPilot goes beyond revenue tracking to show you true profitability — accounting for labor, travel, equipment, and overhead costs at the per-customer and per-route level.

- **Per-Customer Profitability** — See exactly how much profit (or loss) each customer generates after accounting for all direct and allocated costs. Identify your most and least profitable accounts.
- **Per-Route Profitability** — Analyze profitability at the route level. Understand which days and which geographic areas are most profitable for your business.
- **Cost Breakdown** — Detailed decomposition of costs into labor, travel (fuel + vehicle), equipment, and overhead categories. Configure your cost inputs to match your actual business expenses.
- **Route Profit Maps** — Geographic visualization showing profitable zones (green) and unprofitable zones (red) on an interactive map. See at a glance where your money is being made and where it's being lost.
- **AI Recommendations** — ScooPilot identifies unprofitable accounts and provides specific, actionable recommendations: raise the price by X%, consolidate with a nearby route, or consider dropping the account.
- **Pricing Simulation** — Model "what if" scenarios before making changes. See how a price increase would affect your margins, factoring in estimated customer churn rates.

---

## 19. Data Migration & Import

Switching to ScooPilot from another platform? The migration tools make it painless to bring your existing data — clients, properties, service plans, and invoice history — into your new system.

### Competitor-Specific Import
- **Sweep & Go** — Purpose-built parser for Sweep & Go exports. Automatically maps fields, handles their specific data formats, and imports contacts, properties, and invoice history.
- **Jobber** — Dedicated import support for Jobber data exports with field mapping tailored to Jobber's export format.

### General Import Tools
- **CSV Upload** — Upload any CSV file and use the interactive column mapping wizard to match your columns to ScooPilot fields.
- **AI-Assisted Mapping** — When column names don't match exactly, AI suggests the best field mapping. It handles variations like "Customer Name" → "Contact Name" or "Svc Freq" → "Service Frequency."
- **Data Preview** — Review your imported data before committing. See warnings for potential issues (missing required fields, format mismatches) and fix them before import.
- **Duplicate Detection** — The import system checks for existing records and gives you the option to skip duplicates or update existing records with new data.
- **Invoice History Import** — Bring your historical invoices into ScooPilot so your financial records are complete from day one.
- **JSON Import** — For more technical integrations, import contact data via JSON format with full schema validation.

---

## 20. Platform Administration

For ScooPilot platform operators, a dedicated admin dashboard provides oversight across all tenant companies.

- **Multi-Tenant Management** — View and manage all companies on the platform. See subscription status, user counts, usage metrics, and account health at a glance.
- **Platform Analytics** — Executive-level dashboards showing total platform MRR, active tenants, growth trends, and churn rates.
- **Subscription Tier Management** — Configure and manage the available subscription tiers, pricing, and feature limits.
- **Security Controls** — Platform-wide security settings, user management, and access controls.

---

## 21. Client Signup Widget

A public-facing signup and quote page that you can link from your website to capture leads and provide instant pricing.

- **Instant Pricing** — Prospects enter their address, number of dogs, and yard size to get an immediate price estimate — no phone call required.
- **Automatic Lead Creation** — Every signup creates a contact and property record in your ScooPilot account, ready for follow-up.
- **Seamless Integration** — Link to the signup widget from your website, social media profiles, Google Business listing, or anywhere else you interact with prospects.

---

## 22. Settings & Configuration

ScooPilot is deeply configurable to match how your specific business operates.

- **Company Branding** — Upload your logo, set your company colors, and configure your business information. Your branding appears on proposals, invoices, the client portal, and email communications.
- **Timezone & Service Area** — Set your operating timezone and define your service area for accurate scheduling and client expectations.
- **Pricing Engine Configuration** — Fine-tune the variables that drive your pricing: base labor rates, burden multipliers (taxes, insurance, workers comp), travel cost per mile, equipment costs, and overhead allocation. These feed into both your pricing calculator and profitability analysis.
- **SMS Provider Setup** — Configure Twilio or Telnyx as your SMS provider. Set up your own API keys and messaging profiles for branded communication.
- **Integration Management** — Connect and manage QuickBooks Online, Stripe, and other integrations from a centralized settings panel.
- **Notification Preferences** — Control which events trigger notifications and how they're delivered (email, SMS, in-app).
- **Team Management** — Add team members, assign roles (admin, office, technician), and manage permissions. Each user seat beyond your plan limit is $7/month.

---

## 23. Dark Mode

ScooPilot supports full dark mode across the entire application. Toggle between light and dark themes based on your preference. The dark theme is carefully designed to maintain readability and visual hierarchy across all screens, maps, charts, and data tables.

---

## 24. Security & Reliability

ScooPilot is built with enterprise-grade security practices to protect your business data and your clients' information.

- **Multi-Tenant Data Isolation** — Every company's data is strictly isolated at the database query level. Every API call is scoped to the authenticated company, ensuring tenant data remains separate and secure.
- **Role-Based Access Control** — Assign roles (platform admin, company admin, office staff, technician) with appropriate permission levels. Technicians see only their routes; admins see everything.
- **API Key Scoping** — API keys can be restricted to specific operations, limiting the blast radius if a key is compromised.
- **Encrypted Communications** — All data in transit is encrypted via TLS/SSL. Sensitive credentials (QuickBooks tokens, API keys) are encrypted at rest.
- **Rate Limiting** — API endpoints are rate-limited to prevent abuse and ensure platform stability for all users.
- **CORS & Helmet Protection** — Industry-standard HTTP security headers and cross-origin request protections are enforced on every request.
- **Webhook Signature Verification** — All outbound webhooks include HMAC SHA256 signatures. Inbound webhooks from Stripe, QuickBooks, and Twilio are verified before processing.

---

## 25. Technical Foundation

ScooPilot is built on a modern, scalable technology stack designed for reliability and performance.

- **Cloud-Native Architecture** — Runs on managed cloud infrastructure with automatic scaling, zero-downtime deployments, and global CDN delivery.
- **Real-Time Updates** — WebSocket connections deliver instant updates to your dashboard, route progress, and conversation inbox without page refreshes.
- **Progressive Web App (PWA)** — The technician mobile interface supports PWA features including offline caching, background sync, and home screen installation — delivering a native app experience without app store distribution.
- **Responsive Design** — Every screen in ScooPilot is fully responsive, working seamlessly on desktop monitors, tablets, and mobile phones.
- **PostgreSQL Database** — Enterprise-grade relational database for reliable, ACID-compliant data storage with full backup and recovery.
- **Object Storage** — Cloud-based file storage for proof-of-service photos, yard measurement images, company logos, and document attachments.

---

*ScooPilot is continuously updated with new features and improvements. For the latest information, visit [app.scoopilot.com](https://app.scoopilot.com).*

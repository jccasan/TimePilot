/* eslint-disable @typescript-eslint/no-explicit-any */
import OpenAI from "openai";
import { db } from "../db";
import { trackApiCall } from "./api-usage";
import {
  contacts,
  invoices,
  visits,
  routes,
  servicePlans,
  companyUsers,
  users,
  companies,
  notifications,
  properties,
} from "@shared/schema";
import type { InsertContact, InsertProperty } from "@shared/schema";
import { desc } from "drizzle-orm";
import { eq, and, sql, gte, lte, count, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { sendEmail } from "./email";
import * as crypto from "crypto";
import { geocodeAddress } from "./geocode";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

const KNOWLEDGE_BASE = `
ScooPilot is a vertical SaaS for pet waste removal businesses. Here's what you need to know:

CORE MODULES:
- Dashboard: Overview with key metrics (active clients, visits, revenue, recent activity). Widgets are customizable via drag-and-drop.
- Contacts/CRM: Manage clients with statuses (lead, estimate, active, paused, cancelled). Add properties, tags, service plans.
- Properties: Service locations tied to contacts. Include address, gate code, yard size, dog count, special instructions. Auto-geocoded.
- Pipeline: Visual Kanban-style board for tracking leads through stages (new lead, contacted, quoted, won, lost).
- Quotes & Proposals: Create and send professional service quotes to potential clients with detailed pricing breakdowns. Convert accepted quotes directly into active jobs.
- Messages: Unified inbox for all SMS and email conversations with clients. View automated message history alongside manual replies.
- Routes: Organize daily service stops. Drag-and-drop Route Builder, route optimization algorithm, dispatch to technicians. Complete visits with a proof photo or use the "No gate" option for properties without a gate or for logging past visits without a photo.
- Scheduling: The unified hub for jobs and the service calendar. Create one-time or recurring jobs directly from this page using the "Add Job" button. When you create a job, visits are generated automatically for the next 6 months — no extra steps needed. You can set job type (recurring or one-time), assign a team member, choose frequency (weekly, biweekly, monthly, one-time), pick service days, set time windows or mark as "anytime," add visit instructions, and configure end conditions (ongoing, number of visits, or end date). The calendar view shows all upcoming visits. There is no separate Jobs page — everything is managed from Scheduling.
- Invoicing: Create invoices with line items, tax, discounts. A live revenue dashboard at the top shows This Week's revenue, Outstanding, Overdue, and Collected totals. Invoices are grouped into sections (Overdue, Unpaid, Draft, Paid). Use batch actions — select multiple invoices and click Send All, Charge All (autopay via Stripe), or Mark Paid — to process your queue at once. Stripe payment integration. Auto-invoice capability.
- Live Field Map: Real-time map showing all technicians' locations and stop statuses. Admins can monitor the entire crew throughout the day.
- Command Center: Admin-only real-time operations overview showing all active routes, technician locations, and today's visit status across the entire team.
- Reports & Analytics: Service reports, revenue analytics, visit history, and team performance trends. Export data or view charts.
- Technician Mobile View: Simplified mobile view for technicians showing their assigned route stops, client info, gate codes, and dog count. Mark visits complete, add notes, upload proof photos, or use No Gate mode.
- Client Portal: Self-service view for customers — schedule, visit history, invoices, pause/resume service, messaging.
- Communication: Send emails and SMS. All logged in Messages tab. Automation rules for event-triggered messages.
- Automation Rules: Trigger actions on events (new lead → welcome email, completed service → follow-up).
- Settings: Company profile, team, service pricing, notifications, API keys, integrations, reminder configuration, Stripe connection.
- CSV Import / Data Migration: Bulk-import contacts via CSV with AI-assisted column mapping.
- Tags: Custom colored tags for organizing/filtering contacts.
- Notifications: Real-time bell alerts for new leads, completed visits, overdue invoices, portal messages.
- API & Webhooks: REST API with scoped keys, webhooks for real-time event notifications.
- Reminders: Automated service reminders via email/SMS with configurable timing and quiet hours.
- Profitability: See which customers, routes, and service areas are profitable. Make data-driven pricing decisions.
- Route Profit Maps: Geographic heatmap showing profitability by neighborhood.
- Pricing Tools: Price Calculator (measure yards, calculate service pricing based on actual costs) and Pricing Simulator (test pricing changes before rolling them out to see impact on revenue and margins).
- Expenses: Track overhead costs and business expenses for accurate profitability analysis.

NAVIGATION:
- Sidebar sections:
  - CRM: Contacts, Pipeline, Quotes & Proposals, Messages
  - Operations: Command Center (admin only), Scheduling, Routes, Live Field Map, Invoices, Reports & Analytics
  - Business: Profitability, Route Profit Maps, Expenses, Pricing Tools
  - Settings: Settings, Automation, Pricing Plans, Subscription, API Keys, Webhooks, Data Migration
- Quick Create button in sidebar: New Contact, New Quote, New Invoice, New Job (opens Add Job on Scheduling page)
- Top bar: Search, notifications bell, theme toggle, logout button
- Rover (me!): The green "Ask Rover" floating button — drag it anywhere on screen

KEY WORKFLOWS:
- Adding a new job: Go to Scheduling > click "Add Job" (or use Quick Create > New Job). Fill in customer, property, job type, frequency, services, and schedule. Visits are auto-generated.
- Reactivating a paused job: Edit the service plan from the Scheduling page. When you change status back to active, visits are automatically regenerated.
- Changing a schedule: Edit the service plan's frequency or service day. Future visits are automatically cancelled and regenerated with the new schedule.
- Creating an invoice: Go to Invoices > Create Invoice, or use Quick Create > New Invoice. Select customer, add line items, and send.
- Batch invoicing: On the Invoices page, select multiple invoices with checkboxes and use Send All, Charge All, or Mark Paid to process them at once.
- Completing a visit with no gate: On the Routes page, click Complete on a stop. In the dialog, check "No gate" — the proof photo becomes optional and the customer message is adjusted. Works for past dates too (no SMS will be sent for past visits).
- Importing contacts: Go to Data Migration under Settings. Upload a CSV and map columns to contact fields using AI-assisted matching.
`;

interface UserContext {
  userName: string;
  userRole: string;
  companyName: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  remindersEnabled: boolean;
  autoVisitsEnabled: boolean;
  roverAiEnabled: boolean;
  timezone: string;
  contactCount: number;
  activeContactCount: number;
  invoiceCount: number;
  overdueInvoiceCount: number;
  mrrDollars: string;
  teamSize: number;
  routeCount: number;
  recentNotifications: { title: string; type: string; isRead: boolean }[];
}

export async function buildUserContext(companyId: string, userId: string): Promise<UserContext> {
  const [company] = await db
    .select({
      name: companies.name,
      subscriptionTier: companies.subscriptionTier,
      subscriptionStatus: companies.subscriptionStatus,
      remindersEnabled: companies.remindersEnabled,
      autoVisitsEnabled: companies.autoVisitsEnabled,
      roverAiEnabled: companies.roverAiEnabled,
      timezone: companies.timezone,
      mrrCents: companies.mrrCents,
    })
    .from(companies)
    .where(eq(companies.id, companyId));

  const [membership] = await db
    .select({ role: companyUsers.role })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)));

  const [user] = await db
    .select({ firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, userId));

  const [contactStats] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${contacts.status} = 'active')`,
    })
    .from(contacts)
    .where(eq(contacts.companyId, companyId));

  const today = new Date().toISOString().split("T")[0];
  const [invoiceStats] = await db
    .select({
      total: count(),
      overdue: sql<number>`count(*) filter (where ${invoices.status} = 'sent' AND ${invoices.dueDate} < ${today})`,
    })
    .from(invoices)
    .where(eq(invoices.companyId, companyId));

  const [teamCount] = await db
    .select({ count: count() })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.isActive, true)));

  const [routeCount] = await db
    .select({ count: count() })
    .from(routes)
    .where(eq(routes.companyId, companyId));

  const recentNotifs = await db
    .select({
      title: notifications.title,
      type: notifications.type,
      isRead: notifications.isRead,
    })
    .from(notifications)
    .where(eq(notifications.companyId, companyId))
    .orderBy(desc(notifications.createdAt))
    .limit(5);

  return {
    userName: user ? `${user.firstName} ${user.lastName}`.trim() : "User",
    userRole: membership?.role || "tech",
    companyName: company?.name || "your company",
    subscriptionTier: company?.subscriptionTier || "tier_1",
    subscriptionStatus: company?.subscriptionStatus || "active",
    remindersEnabled: company?.remindersEnabled ?? false,
    autoVisitsEnabled: company?.autoVisitsEnabled ?? false,
    roverAiEnabled: company?.roverAiEnabled ?? true,
    timezone: company?.timezone || "America/New_York",
    contactCount: contactStats?.total || 0,
    activeContactCount: contactStats?.active || 0,
    invoiceCount: invoiceStats?.total || 0,
    overdueInvoiceCount: invoiceStats?.overdue || 0,
    mrrDollars: company ? `$${(company.mrrCents / 100).toFixed(2)}` : "$0.00",
    teamSize: teamCount?.count || 0,
    routeCount: routeCount?.count || 0,
    recentNotifications: recentNotifs,
  };
}

export function buildSystemPrompt(ctx: UserContext): string {
  return `You are Rover, a friendly and knowledgeable AI assistant for ScooPilot — a business management platform for pet waste removal companies.

CURRENT USER CONTEXT:
- User: ${ctx.userName} (role: ${ctx.userRole})
- Company: ${ctx.companyName}
- Subscription: ${ctx.subscriptionTier} (${ctx.subscriptionStatus})
- Timezone: ${ctx.timezone}
- Features enabled: ${
    [
      ctx.remindersEnabled ? "automated reminders" : null,
      ctx.autoVisitsEnabled ? "auto visit generation" : null,
      ctx.roverAiEnabled ? "Rover AI" : null,
    ]
      .filter(Boolean)
      .join(", ") || "none"
  }

${
  ["owner", "admin"].includes(ctx.userRole)
    ? `ACCOUNT STATS (live snapshot):
- Total contacts: ${ctx.contactCount} (${ctx.activeContactCount} active)
- Invoices: ${ctx.invoiceCount} total (${ctx.overdueInvoiceCount} overdue)
- MRR: ${ctx.mrrDollars}
- Team members: ${ctx.teamSize}
- Routes: ${ctx.routeCount}
${ctx.recentNotifications.length > 0 ? `\nRecent notifications:\n${ctx.recentNotifications.map((n) => `- [${n.isRead ? "read" : "unread"}] (${n.type}) ${n.title}`).join("\n")}` : ""}`
    : `ACCOUNT STATS (limited - tech role):
- Routes: ${ctx.routeCount}`
}

${KNOWLEDGE_BASE}

GUIDELINES:
- Be concise and helpful. Keep answers focused and actionable.
- When explaining features, tell the user WHERE to find them in the app.
- Tailor your advice to the user's role. Technicians have limited access (only their assigned routes). Owners and admins have full access.
- If the user describes a bug or problem, empathize and offer to help them submit a trouble ticket.
- If the user asks about something outside ScooPilot's scope, politely redirect.
- Use a warm, professional tone. No emojis.
- When you detect the user is reporting a bug or requesting a feature, end your response with exactly one of these markers on its own line:
  [SUGGEST_TICKET] — if it sounds like a bug report or issue
  [SUGGEST_FEATURE] — if it sounds like a feature request
  Additionally, after the marker, include a suggested subject and description for the ticket on the next two lines:
  SUBJECT: <brief summary>
  DESCRIPTION: <detailed description based on the conversation>
- You can query live business data using your available tools. Use them when the user asks about their specific metrics.
- Format numbers nicely (e.g., "$1,234.56" for currency).
- For lists, use bullet points. Keep responses under 200 words unless the topic requires more detail.
- When a generate_invoice tool result includes a "contactName" field, always name the client in your reply (e.g., "Generated a draft invoice for Jane Doe totalling $120.00."). Never invoice silently.
- When a generate_invoice tool result has error "AMBIGUOUS_CONTACT", do not proceed. Instead, relay the clarification question from the message field verbatim so the user can pick the right client.
- ADDRESS CONFIRMATION GATE: When you are helping a user add a new property or collect an address for a client, you must display the full address back to the user and wait for their explicit confirmation (e.g., "yes", "confirm", "correct", "that's right") before any property creation or geocoding is triggered. Never create a property or request geocoding while the address is still being collected, edited, or clarified. Only proceed after the user has clearly confirmed the address is correct.`;
}

export const ROVER_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_business_stats",
      description:
        "Get high-level business statistics: total contacts by status, active service plans, route count, team size, and monthly revenue.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_overdue_invoices",
      description:
        "Get a summary of overdue (unpaid, past-due) invoices including count and total amount.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_visits",
      description: "Get upcoming scheduled visits for the next 7 days, including count by day.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Number of days ahead to look (default 7, max 14)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_activity",
      description:
        "Get a summary of recent activity: visits completed today, new contacts this week, invoices sent this week.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "optimize_route",
      /**
       * Rover uses `routeRef` (name / number / UUID) instead of the raw `routeId` UUID
       * that `/api/skills/run` accepts. This is intentional: Rover resolves the human-
       * readable reference via `resolveRouteRef()` before calling `runSkill`, so users can
       * say "optimize route 3" without knowing the underlying UUID.
       */
      description:
        "Optimize the stop order for a specific route to minimize drive distance and time. Use this when the user asks to optimize a route or says something like 'optimize route 3' or 'optimize the Monday route'. Supply routeRef as the route name, number, or UUID.",
      parameters: {
        type: "object",
        properties: {
          routeRef: {
            type: "string",
            description:
              "The route to optimize — can be a route name (e.g. 'Route 3', 'Monday'), a number (e.g. '3'), or a UUID. The system will resolve this to the correct route.",
          },
        },
        required: ["routeRef"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_invoice",
      /**
       * Rover uses `contactRef` (name or UUID) instead of the raw `contactId` UUID
       * that `/api/skills/run` accepts. This is intentional: Rover resolves the human-
       * readable reference via `resolveContactRef()` before calling `runSkill`, so users
       * can say "generate invoice for Jane Doe" without knowing the underlying UUID.
       */
      description:
        "Generate draft invoice(s) for completed, uninvoiced visits. Use when the user says something like 'generate invoices for all clients', 'invoice all pending work', or 'create an invoice for [client name/id]'. If a specific client is mentioned, supply their name or UUID as contactRef; otherwise use allPending: true to invoice everyone with outstanding work.",
      parameters: {
        type: "object",
        properties: {
          contactRef: {
            type: "string",
            description:
              "The client to invoice — can be a full name (e.g. 'Jane Doe', 'John Smith'), a partial name, or a UUID. The system will resolve this to the correct contact. Omit to invoice all pending clients.",
          },
          allPending: {
            type: "boolean",
            description:
              "Set to true to generate invoices for all contacts with uninvoiced completed visits.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_visits",
      description:
        "Look up recent visit history for a specific client. Use when the user asks about a client's past visits, service history, or upcoming scheduled visits. Supply the client's name or UUID as contactRef.",
      parameters: {
        type: "object",
        properties: {
          contactRef: {
            type: "string",
            description:
              "The client to look up — can be a full name (e.g. 'Jane Doe', 'John Smith'), a partial name, or a UUID. The system will resolve this to the correct contact.",
          },
          limit: {
            type: "number",
            description: "Number of recent visits to return (default 10, max 20).",
          },
        },
        required: ["contactRef"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_service_plan",
      description:
        "Check the active service plan(s) for a specific client — frequency, day of week, property, and whether the plan is active. Use when the user asks what schedule or plan a client is on. Supply the client's name or UUID as contactRef.",
      parameters: {
        type: "object",
        properties: {
          contactRef: {
            type: "string",
            description:
              "The client to look up — can be a full name (e.g. 'Jane Doe', 'John Smith'), a partial name, or a UUID. The system will resolve this to the correct contact.",
          },
        },
        required: ["contactRef"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_portal_invite",
      description:
        "Send a client portal invite to a specific client, granting them access to the self-service portal. Use when the user asks to send a portal invite or enable portal access for a client. The client must have an email address on file. Supply the client's name or UUID as contactRef.",
      parameters: {
        type: "object",
        properties: {
          contactRef: {
            type: "string",
            description:
              "The client to invite — can be a full name (e.g. 'Jane Doe', 'John Smith'), a partial name, or a UUID. The system will resolve this to the correct contact.",
          },
        },
        required: ["contactRef"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_contact_with_property",
      description:
        "Create a new client contact and their service property address. IMPORTANT: You must collect the full address first, display it back to the user, and only call this tool AFTER the user has explicitly confirmed the address is correct (e.g., 'yes', 'confirm', 'that's right'). Never call this tool while the address is still being collected or clarified. The 'confirmed' field must be true — set it to false if the user has not yet confirmed.",
      parameters: {
        type: "object",
        properties: {
          firstName: { type: "string", description: "Client's first name." },
          lastName: { type: "string", description: "Client's last name." },
          email: { type: "string", description: "Client's email address (optional)." },
          phone: { type: "string", description: "Client's phone number (optional)." },
          streetAddress: { type: "string", description: "Service property street address." },
          city: { type: "string", description: "City." },
          state: { type: "string", description: "State or province abbreviation." },
          zipCode: { type: "string", description: "ZIP or postal code." },
          numberOfDogs: {
            type: "number",
            description: "Number of dogs at the property (optional).",
          },
          yardSize: {
            type: "string",
            description: "Yard size descriptor, e.g. 'small', 'medium', 'large' (optional).",
          },
          confirmed: {
            type: "boolean",
            description:
              "REQUIRED: Set to true only after the user has explicitly confirmed the address. Set to false if confirmation has not been received — the system will reject the call.",
          },
        },
        required: ["firstName", "streetAddress", "confirmed"],
      },
    },
  },
];

const USER_CONFIRMATION_RE =
  /\b(yes|yep|yup|confirm(ed)?|correct|right|that'?s?\s+(right|correct)|go\s+ahead|proceed|please\s+do|sure|absolutely|ok(ay)?|sounds\s+good|do\s+it)\b/i;

function hasUserConfirmedInHistory(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): boolean {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return false;
  const lastUserMsg = userMessages[userMessages.length - 1];
  const text =
    typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content
            .map((c) => {
              if (typeof c === "string") return c;
              if (c.type === "text") return c.text;
              return "";
            })
            .join(" ")
        : "";
  return USER_CONFIRMATION_RE.test(text.trim());
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  companyId: string,
  userId?: string,
  role?: string,
  messages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): Promise<string> {
  try {
    switch (toolName) {
      case "get_business_stats":
        return await getBusinessStats(companyId);
      case "get_overdue_invoices":
        return await getOverdueInvoices(companyId);
      case "get_upcoming_visits":
        return await getUpcomingVisits(companyId, args.days || 7);
      case "get_recent_activity":
        return await getRecentActivity(companyId);
      case "optimize_route": {
        const routeRef: string = String(args.routeRef ?? "").trim();
        if (!routeRef) {
          return JSON.stringify({
            success: false,
            message:
              "A route name or ID is required. Please specify which route to optimize (e.g. 'optimize route 3').",
            error: "MISSING_ROUTE_REF",
          });
        }
        const resolvedRouteId = await resolveRouteRef(routeRef, companyId);
        if (!resolvedRouteId) {
          return JSON.stringify({
            success: false,
            message: `Could not find a route matching "${routeRef}". Check the route name and try again.`,
            error: "ROUTE_NOT_FOUND",
          });
        }
        const { runSkill } = await import("./skills/index");
        const result = await runSkill(
          "optimize_route",
          { routeId: resolvedRouteId },
          { companyId, userId: userId ?? "", role: role ?? "system" }
        );
        return JSON.stringify(result);
      }
      case "generate_invoice": {
        const contactRef: string = args.contactRef ? String(args.contactRef).trim() : "";
        let contactId: string | undefined;
        let resolvedContactName: string | undefined;
        if (contactRef) {
          const resolved = await resolveContactRef(contactRef, companyId);
          if (resolved.type === "not_found") {
            return JSON.stringify({
              success: false,
              message: `Could not find a client matching "${contactRef}". Check the name and try again.`,
              error: "CONTACT_NOT_FOUND",
            });
          }
          if (resolved.type === "ambiguous") {
            const nameList = resolved.matches
              .map((m) => (m.hint ? `${m.name} (${m.hint})` : m.name))
              .join(", ");
            return JSON.stringify({
              success: false,
              error: "AMBIGUOUS_CONTACT",
              message: `Multiple clients match "${contactRef}": ${nameList}. Please provide the full name of the client you want to invoice so I can proceed with the right one.`,
              matches: resolved.matches,
            });
          }
          contactId = resolved.id;
          resolvedContactName = resolved.name;
        }
        const { runSkill } = await import("./skills/index");
        const skillParams: Record<string, unknown> = contactId
          ? { contactId }
          : { allPending: true };
        const result = await runSkill("generate_invoice", skillParams, {
          companyId,
          userId: userId ?? "",
          role: role ?? "system",
        });
        const resultObj = result as Record<string, unknown>;
        if (resolvedContactName) {
          // Always surface who was matched, regardless of skill success/failure.
          resultObj.contactName = resolvedContactName;
          if (resultObj.success) {
            const baseMsg = typeof resultObj.message === "string" ? resultObj.message : "";
            // Transform "Generated 1 draft invoice totalling …" →
            // "Generated 1 draft invoice for Jane Doe totalling …"
            const transformed = baseMsg.replace(
              /^(Generated \d+ draft invoices?) /,
              `$1 for ${resolvedContactName} `
            );
            // If the regex didn't fire (e.g., "No uninvoiced work found…"), prefix the
            // message with the client name so the matched contact is always visible.
            resultObj.message =
              transformed !== baseMsg
                ? transformed
                : baseMsg
                  ? `${resolvedContactName}: ${baseMsg}`
                  : `Checked invoices for ${resolvedContactName}.`;
          } else {
            // On failure (e.g., no uninvoiced work), prefix the message with the
            // resolved client name so the user knows which client was checked.
            const baseMsg = typeof resultObj.message === "string" ? resultObj.message : "";
            if (baseMsg && !baseMsg.includes(resolvedContactName)) {
              resultObj.message = `${resolvedContactName}: ${baseMsg}`;
            }
          }
        }
        return JSON.stringify(resultObj);
      }
      case "get_client_visits": {
        const contactRef: string = String(args.contactRef ?? "").trim();
        if (!contactRef) {
          return JSON.stringify({
            success: false,
            message: "A client name or ID is required.",
            error: "MISSING_CONTACT_REF",
          });
        }
        const resolvedId = await resolveContactRef(contactRef, companyId);
        if (resolvedId.type !== "found") {
          return JSON.stringify({
            success: false,
            message: `Could not find a client matching "${contactRef}". Check the name and try again.`,
            error: "CONTACT_NOT_FOUND",
          });
        }
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
        return await getClientVisits(companyId, resolvedId.id, limit);
      }
      case "get_client_service_plan": {
        const contactRef: string = String(args.contactRef ?? "").trim();
        if (!contactRef) {
          return JSON.stringify({
            success: false,
            message: "A client name or ID is required.",
            error: "MISSING_CONTACT_REF",
          });
        }
        const resolvedId = await resolveContactRef(contactRef, companyId);
        if (resolvedId.type !== "found") {
          return JSON.stringify({
            success: false,
            message: `Could not find a client matching "${contactRef}". Check the name and try again.`,
            error: "CONTACT_NOT_FOUND",
          });
        }
        return await getClientServicePlan(companyId, resolvedId.id);
      }
      case "send_portal_invite": {
        const contactRef: string = String(args.contactRef ?? "").trim();
        if (!contactRef) {
          return JSON.stringify({
            success: false,
            message: "A client name or ID is required.",
            error: "MISSING_CONTACT_REF",
          });
        }
        const resolvedId = await resolveContactRef(contactRef, companyId);
        if (resolvedId.type !== "found") {
          return JSON.stringify({
            success: false,
            message: `Could not find a client matching "${contactRef}". Check the name and try again.`,
            error: "CONTACT_NOT_FOUND",
          });
        }
        return await sendPortalInvite(companyId, resolvedId.id);
      }
      case "create_contact_with_property": {
        if (args.confirmed !== true || !hasUserConfirmedInHistory(messages ?? [])) {
          return JSON.stringify({
            success: false,
            error: "ADDRESS_NOT_CONFIRMED",
            message:
              "The address has not been confirmed by the user. Please display the full address to the user and wait for their explicit confirmation (e.g. 'yes', 'correct', 'confirm') before creating the contact.",
          });
        }
        const firstName: string = String(args.firstName ?? "").trim();
        const streetAddress: string = String(args.streetAddress ?? "").trim();
        if (!firstName || !streetAddress) {
          return JSON.stringify({
            success: false,
            error: "MISSING_REQUIRED_FIELDS",
            message: "First name and street address are required.",
          });
        }
        const contactPayload: InsertContact = {
          companyId,
          firstName,
          lastName: String(args.lastName ?? "").trim(),
          email: args.email ? String(args.email).trim() : undefined,
          phone: args.phone ? String(args.phone).trim() : undefined,
          status: "lead",
        };
        const contact = await storage.createContact(contactPayload);
        const cityArg = args.city ? String(args.city).trim() : "";
        const stateArg = args.state ? String(args.state).trim() : "";
        const zipArg = args.zipCode ? String(args.zipCode).trim() : "";
        const existingProperties = await storage.getProperties(companyId);
        const normalizedStreet = streetAddress.trim().toLowerCase();
        const matchingProp = existingProperties.find(
          (p) =>
            p.streetAddress?.trim().toLowerCase() === normalizedStreet &&
            p.city?.trim().toLowerCase() === cityArg.toLowerCase() &&
            (p.state?.trim().toLowerCase() ?? "") === stateArg.toLowerCase() &&
            (p.zipCode?.trim() ?? "") === zipArg &&
            p.latitude &&
            p.longitude
        );
        let latitude: string | null = null;
        let longitude: string | null = null;
        if (matchingProp) {
          latitude = matchingProp.latitude ?? null;
          longitude = matchingProp.longitude ?? null;
        } else {
          const coords = await geocodeAddress(
            streetAddress,
            cityArg || null,
            stateArg || null,
            zipArg || null
          );
          if (coords) {
            latitude = coords.latitude;
            longitude = coords.longitude;
          }
        }
        const propertyPayload: InsertProperty = {
          companyId,
          contactId: contact.id,
          streetAddress,
          city: cityArg,
          state: stateArg,
          zipCode: zipArg,
          numberOfDogs: args.numberOfDogs ? Number(args.numberOfDogs) : undefined,
          yardSize: args.yardSize ? String(args.yardSize).trim() : undefined,
          latitude: latitude ?? undefined,
          longitude: longitude ?? undefined,
        };
        const property = await storage.createProperty(propertyPayload);
        return JSON.stringify({
          success: true,
          message: `Created contact ${firstName} ${args.lastName ?? ""} and property at ${streetAddress}${cityArg ? `, ${cityArg}` : ""}. They are now in the system as a lead.`,
          contactId: contact.id,
          propertyId: property.id,
          geocoded: !!(latitude && longitude),
        });
      }
      default:
        return JSON.stringify({ error: "Unknown tool" });
    }
  } catch (err) {
    console.error(`Rover tool error (${toolName}):`, err);
    return JSON.stringify({ error: "Failed to fetch data" });
  }
}

async function resolveRouteRef(routeRef: string, companyId: string): Promise<string | null> {
  const normalized = routeRef.trim().toLowerCase();
  if (!normalized) return null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(normalized)) {
    const [row] = await db
      .select({ id: routes.id })
      .from(routes)
      .where(and(eq(routes.id, routeRef), eq(routes.companyId, companyId)))
      .limit(1);
    return row?.id ?? null;
  }
  const allRoutes = await db
    .select({ id: routes.id, name: routes.name })
    .from(routes)
    .where(eq(routes.companyId, companyId));
  const exact = allRoutes.find((r) => r.name.toLowerCase() === normalized);
  if (exact) return exact.id;
  // For pure numeric refs like "3", match routes whose name contains the number
  // as a word boundary (e.g. "Route 3", "3rd Route") — deterministic digit resolution.
  if (/^\d+$/.test(normalized)) {
    const numericMatch = allRoutes.find((r) =>
      new RegExp(`\\b${normalized}\\b`).test(r.name.toLowerCase())
    );
    if (numericMatch) return numericMatch.id;
  }
  if (normalized.length >= 2) {
    const partial = allRoutes.find((r) => r.name.toLowerCase().includes(normalized));
    if (partial) return partial.id;
  }
  return null;
}

type ContactMatch = { id: string; name: string; hint: string };
type ContactRefResult =
  | { type: "found"; id: string; name: string }
  | { type: "ambiguous"; matches: ContactMatch[] }
  | { type: "not_found" };

async function resolveContactRef(contactRef: string, companyId: string): Promise<ContactRefResult> {
  const normalized = contactRef.trim().toLowerCase();
  if (!normalized) return { type: "not_found" };
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(normalized)) {
    const [row] = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
      })
      .from(contacts)
      .where(and(eq(contacts.id, contactRef), eq(contacts.companyId, companyId)))
      .limit(1);
    if (!row) return { type: "not_found" };
    return { type: "found", id: row.id, name: `${row.firstName} ${row.lastName}`.trim() };
  }
  const allContacts = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
    })
    .from(contacts)
    .where(eq(contacts.companyId, companyId));

  const toName = (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim();
  const toHint = (c: { email: string | null }) =>
    c.email ? c.email.replace(/(?<=^.{2}).+(?=@)/, "…") : "";
  const toMatch = (c: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
  }): ContactMatch => ({ id: c.id, name: toName(c), hint: toHint(c) });

  // Exact full-name match (could still be multiple people with the same name)
  const exactMatches = allContacts.filter(
    (c) =>
      toName(c).toLowerCase() === normalized ||
      `${c.lastName} ${c.firstName}`.toLowerCase() === normalized
  );
  if (exactMatches.length === 1)
    return { type: "found", id: exactMatches[0].id, name: toName(exactMatches[0]) };
  if (exactMatches.length > 1) {
    return { type: "ambiguous", matches: exactMatches.map(toMatch) };
  }

  if (normalized.length >= 2) {
    // Partial / fuzzy match — contacts whose full name contains the ref
    const partialMatches = allContacts.filter((c) => toName(c).toLowerCase().includes(normalized));
    if (partialMatches.length === 1)
      return { type: "found", id: partialMatches[0].id, name: toName(partialMatches[0]) };
    if (partialMatches.length > 1) {
      return { type: "ambiguous", matches: partialMatches.map(toMatch) };
    }

    // Match on last name alone
    const lastNameMatches = allContacts.filter((c) => c.lastName.toLowerCase() === normalized);
    if (lastNameMatches.length === 1)
      return { type: "found", id: lastNameMatches[0].id, name: toName(lastNameMatches[0]) };
    if (lastNameMatches.length > 1) {
      return { type: "ambiguous", matches: lastNameMatches.map(toMatch) };
    }

    // Match on first name alone
    const firstNameMatches = allContacts.filter((c) => c.firstName.toLowerCase() === normalized);
    if (firstNameMatches.length === 1)
      return { type: "found", id: firstNameMatches[0].id, name: toName(firstNameMatches[0]) };
    if (firstNameMatches.length > 1) {
      return { type: "ambiguous", matches: firstNameMatches.map(toMatch) };
    }
  }

  return { type: "not_found" };
}

async function getClientVisits(
  companyId: string,
  contactId: string,
  limit: number
): Promise<string> {
  const contactPlans = await db
    .select({
      id: servicePlans.id,
      propertyId: servicePlans.propertyId,
      frequency: servicePlans.frequency,
    })
    .from(servicePlans)
    .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.contactId, contactId)));

  if (contactPlans.length === 0) {
    return JSON.stringify({
      visits: [],
      total: 0,
      note: "No service plans found for this client.",
    });
  }

  const planIds = contactPlans.map((p) => p.id);

  const [countResult] = await db
    .select({ count: count() })
    .from(visits)
    .where(and(eq(visits.companyId, companyId), inArray(visits.servicePlanId, planIds)));
  const total = countResult?.count ?? 0;

  const recentVisits = await db
    .select({
      id: visits.id,
      scheduledDate: visits.scheduledDate,
      status: visits.status,
      servicePlanId: visits.servicePlanId,
      completedAt: visits.completedAt,
    })
    .from(visits)
    .where(and(eq(visits.companyId, companyId), inArray(visits.servicePlanId, planIds)))
    .orderBy(desc(visits.scheduledDate))
    .limit(limit);

  const planMap = new Map(contactPlans.map((p) => [p.id, p]));
  const propertyIds = Array.from(new Set(contactPlans.map((p) => p.propertyId)));
  const propsList =
    propertyIds.length > 0
      ? await db
          .select({
            id: properties.id,
            streetAddress: properties.streetAddress,
            city: properties.city,
          })
          .from(properties)
          .where(inArray(properties.id, propertyIds))
      : [];
  const propMap = new Map(propsList.map((p) => [p.id, p]));

  const enriched = recentVisits.map((v) => {
    const plan = planMap.get(v.servicePlanId);
    const prop = plan ? propMap.get(plan.propertyId) : undefined;
    return {
      id: v.id,
      scheduledDate: v.scheduledDate,
      status: v.status,
      servicePlanFrequency: plan?.frequency ?? "unknown",
      propertyAddress: prop
        ? `${prop.streetAddress}${prop.city ? `, ${prop.city}` : ""}`
        : "Unknown",
      completedAt: v.completedAt ?? null,
    };
  });

  return JSON.stringify({ visits: enriched, total, showing: enriched.length });
}

async function getClientServicePlan(companyId: string, contactId: string): Promise<string> {
  const plans = await db
    .select({
      id: servicePlans.id,
      frequency: servicePlans.frequency,
      dayOfWeek: servicePlans.dayOfWeek,
      isActive: servicePlans.isActive,
      propertyId: servicePlans.propertyId,
    })
    .from(servicePlans)
    .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.contactId, contactId)));

  if (plans.length === 0) {
    return JSON.stringify({ plans: [], note: "No service plans found for this client." });
  }

  const propertyIds = Array.from(new Set(plans.map((p) => p.propertyId)));
  const propsList =
    propertyIds.length > 0
      ? await db
          .select({
            id: properties.id,
            streetAddress: properties.streetAddress,
            city: properties.city,
          })
          .from(properties)
          .where(inArray(properties.id, propertyIds))
      : [];
  const propMap = new Map(propsList.map((p) => [p.id, p]));

  const enriched = plans.map((plan) => {
    const prop = propMap.get(plan.propertyId);
    return {
      id: plan.id,
      frequency: plan.frequency,
      dayOfWeek: plan.dayOfWeek,
      isActive: plan.isActive,
      propertyAddress: prop
        ? `${prop.streetAddress}${prop.city ? `, ${prop.city}` : ""}`
        : "Unknown",
    };
  });

  return JSON.stringify({ plans: enriched, total: enriched.length });
}

async function sendPortalInvite(companyId: string, contactId: string): Promise<string> {
  const [contact] = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      hasPortalAccess: contacts.hasPortalAccess,
    })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId)))
    .limit(1);

  if (!contact) {
    return JSON.stringify({
      success: false,
      message: "Contact not found.",
      error: "CONTACT_NOT_FOUND",
    });
  }
  if (!contact.email) {
    return JSON.stringify({
      success: false,
      message: `${contact.firstName} ${contact.lastName} does not have an email address on file. Add an email to their contact record before sending a portal invite.`,
      error: "NO_EMAIL",
    });
  }

  const tempPassword = crypto.randomBytes(4).toString("hex") + "A1!";
  const salt = crypto.randomBytes(16).toString("hex");
  const portalPasswordHash = await new Promise<string>((resolve, reject) => {
    crypto.scrypt(tempPassword, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(`${salt}:${key.toString("hex")}`);
    });
  });

  await storage.updateContact(contactId, companyId, { hasPortalAccess: true, portalPasswordHash });

  const [company] = await db
    .select({ name: companies.name, email: companies.email })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const portalBaseUrl =
    process.env.PUBLIC_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  const portalUrl = `${portalBaseUrl}/portal/login`;

  try {
    await sendEmail({
      companyId,
      to: contact.email,
      subject: `Your ${company?.name || "ScooPilot"} Client Portal Access`,
      senderName: company?.name || undefined,
      replyTo: company?.email || undefined,
      text: `Hi ${contact.firstName},\n\nYou now have access to the client portal for ${company?.name || "ScooPilot"}.\n\nPortal Link: ${portalUrl}\nEmail: ${contact.email}\nTemporary Password: ${tempPassword}\n\nPlease log in and change your password.\n\nThank you!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">${company?.name || "ScooPilot"}</h1>
          </div>
          <div style="padding: 20px; border: 1px solid #e5e7eb;">
            <p>Hi ${contact.firstName},</p>
            <p>You now have access to the client portal.</p>
            <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0 0 8px 0; font-weight: bold;">Your Login Credentials:</p>
              <p style="margin: 0;">Email: <strong>${contact.email}</strong></p>
              <p style="margin: 0;">Temporary Password: <strong>${tempPassword}</strong></p>
            </div>
            <a href="${portalUrl}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin: 16px 0;">Log In to Portal</a>
            <p style="color: #6b7280; font-size: 14px;">Or copy this link: ${portalUrl}</p>
            <p style="color: #6b7280; font-size: 14px;">View your service schedule, invoices, and manage your account.</p>
          </div>
        </div>
      `,
    });
  } catch (emailErr) {
    console.error("Rover: Failed to send portal access email:", emailErr);
    return JSON.stringify({
      success: false,
      message: `Portal access was enabled for ${contact.firstName} ${contact.lastName}, but the invite email could not be delivered to ${contact.email}. You can resend it from their contact page.`,
      error: "EMAIL_DELIVERY_FAILED",
    });
  }

  return JSON.stringify({
    success: true,
    message: `Portal invite sent to ${contact.firstName} ${contact.lastName} at ${contact.email}. They will receive a temporary password by email.`,
    alreadyHadAccess: contact.hasPortalAccess,
  });
}

async function getBusinessStats(companyId: string): Promise<string> {
  const [contactStats] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${contacts.status} = 'active')`,
      leads: sql<number>`count(*) filter (where ${contacts.status} = 'lead')`,
      paused: sql<number>`count(*) filter (where ${contacts.status} = 'paused')`,
      cancelled: sql<number>`count(*) filter (where ${contacts.status} = 'cancelled')`,
    })
    .from(contacts)
    .where(eq(contacts.companyId, companyId));

  const [planStats] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${servicePlans.isActive} = true)`,
    })
    .from(servicePlans)
    .where(eq(servicePlans.companyId, companyId));

  const [routeCount] = await db
    .select({ count: count() })
    .from(routes)
    .where(eq(routes.companyId, companyId));

  const [teamCount] = await db
    .select({ count: count() })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.isActive, true)));

  const [company] = await db
    .select({ mrrCents: companies.mrrCents })
    .from(companies)
    .where(eq(companies.id, companyId));

  return JSON.stringify({
    contacts: contactStats,
    servicePlans: { total: planStats.total, active: planStats.active },
    routes: routeCount.count,
    teamMembers: teamCount.count,
    monthlyRevenue: company ? `$${(company.mrrCents / 100).toFixed(2)}` : "$0.00",
  });
}

async function getOverdueInvoices(companyId: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const overdueRows = await db
    .select({
      count: count(),
      totalCents: sql<number>`coalesce(sum(${invoices.total}::numeric * 100), 0)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(invoices.status, "sent"),
        sql`${invoices.dueDate} < ${today}`
      )
    );

  const row = overdueRows[0];
  return JSON.stringify({
    overdueCount: row.count,
    overdueTotal: `$${(Number(row.totalCents) / 100).toFixed(2)}`,
  });
}

async function getUpcomingVisits(companyId: string, days: number): Promise<string> {
  const clampedDays = Math.min(Math.max(days, 1), 14);
  const today = new Date().toISOString().split("T")[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + clampedDays);
  const end = endDate.toISOString().split("T")[0];

  const visitRows = await db
    .select({
      date: visits.scheduledDate,
      count: count(),
    })
    .from(visits)
    .where(
      and(
        eq(visits.companyId, companyId),
        eq(visits.status, "scheduled"),
        gte(visits.scheduledDate, today),
        lte(visits.scheduledDate, end)
      )
    )
    .groupBy(visits.scheduledDate)
    .orderBy(visits.scheduledDate);

  const totalCount = visitRows.reduce((sum, r) => sum + r.count, 0);
  return JSON.stringify({
    totalScheduled: totalCount,
    byDay: visitRows.map((r) => ({ date: r.date, count: r.count })),
    period: `${today} to ${end}`,
  });
}

async function getRecentActivity(companyId: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const [completedToday] = await db
    .select({ count: count() })
    .from(visits)
    .where(
      and(
        eq(visits.companyId, companyId),
        eq(visits.status, "completed"),
        eq(visits.scheduledDate, today)
      )
    );

  const [newContacts] = await db
    .select({ count: count() })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), gte(contacts.createdAt, weekAgo)));

  const [invoicesSent] = await db
    .select({ count: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(invoices.status, "sent"),
        gte(invoices.createdAt, weekAgo)
      )
    );

  return JSON.stringify({
    visitsCompletedToday: completedToday.count,
    newContactsThisWeek: newContacts.count,
    invoicesSentThisWeek: invoicesSent.count,
  });
}

export async function streamRoverChat(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  companyId: string,
  userId: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
  signal?: { aborted: boolean }
): Promise<void> {
  const userCtx = await buildUserContext(companyId, userId);
  const systemPrompt = buildSystemPrompt(userCtx);

  const isPrivileged = ["owner", "admin"].includes(userCtx.userRole);
  const availableTools = isPrivileged ? ROVER_TOOLS : [];

  const fullMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const OPENAI_TIMEOUT_MS = 30000;

  try {
    const response = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: fullMessages,
        tools: availableTools.length > 0 ? availableTools : undefined,
        stream: true,
        max_completion_tokens: 8192,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("OPENAI_TIMEOUT")), OPENAI_TIMEOUT_MS)
      ),
    ]);
    trackApiCall("openai", "rover_chat");

    let fullResponse = "";
    let toolCalls: { id: string; name: string; arguments: string }[] = [];

    for await (const chunk of response) {
      if (signal?.aborted) return;
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        fullResponse += delta.content;
        onChunk(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined) {
            while (toolCalls.length <= tc.index) {
              toolCalls.push({ id: "", name: "", arguments: "" });
            }
            if (tc.id) toolCalls[tc.index].id = tc.id;
            if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
            if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
          }
        }
      }
    }

    if (signal?.aborted) return;

    if (toolCalls.length > 0 && toolCalls[0].name) {
      const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      toolResults.push({
        role: "assistant",
        content: fullResponse || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of toolCalls) {
        if (signal?.aborted) return;
        if (!isPrivileged) {
          toolResults.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              error: "Access denied. Data tools are only available to owners and admins.",
            }),
          });
          continue;
        }
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(tc.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await executeToolCall(
          tc.name,
          args,
          companyId,
          userId,
          userCtx.userRole,
          fullMessages
        );
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      if (signal?.aborted) return;

      const followUp = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [...fullMessages, ...toolResults],
        stream: true,
        max_completion_tokens: 8192,
      });
      trackApiCall("openai", "rover_chat");

      fullResponse = "";
      for await (const chunk of followUp) {
        if (signal?.aborted) return;
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
          onChunk(content);
        }
      }
    }

    if (!signal?.aborted) {
      onDone(fullResponse);
    }
  } catch (err: any) {
    if (signal?.aborted) return;
    console.error("Rover AI error:", err);
    onError(err.message || "AI service unavailable");
  }
}

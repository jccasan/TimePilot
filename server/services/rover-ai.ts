import OpenAI from "openai";
import { db } from "../db";
import { contacts, invoices, visits, routes, servicePlans, companyUsers, users, companies, notifications } from "@shared/schema";
import { desc } from "drizzle-orm";
import { eq, and, sql, gte, lte, count } from "drizzle-orm";

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
- Routes: Organize daily service stops. Drag-and-drop Route Builder, route optimization algorithm, dispatch to technicians.
- Jobs/Service Plans: Set up recurring (weekly, biweekly, monthly) or one-time schedules. Auto-generates visits and assigns to routes.
- Invoicing: Create invoices with line items, tax, discounts. Send via email. Stripe payment integration. Auto-invoice capability.
- Technician/Field View: Simplified mobile view showing assigned routes and client info. Mark visits complete, add notes, upload proof photos.
- Client Portal: Self-service view for customers — schedule, visit history, invoices, pause/resume service, messaging.
- Communication: Send emails and SMS. All logged in Messages tab. Automation rules for event-triggered messages.
- Automation Rules: Trigger actions on events (new lead → welcome email, completed service → follow-up).
- Settings: Company profile, team, service pricing, notifications, API keys, integrations, reminder configuration.
- CSV Import: Bulk-import contacts via CSV with column mapping.
- Tags: Custom colored tags for organizing/filtering contacts.
- Notifications: Real-time bell alerts for new leads, completed visits, overdue invoices, portal messages.
- API & Webhooks: REST API with scoped keys, webhooks for real-time event notifications.
- Estimates: Create and send service estimates to potential clients.
- Reminders: Automated service reminders via email/SMS with configurable timing and quiet hours.

NAVIGATION:
- Main sidebar: Dashboard, Contacts, Routes, Jobs, Invoices, Estimates, Messages, Automation, Settings
- Top bar: Search, notifications bell, user menu
- Rover (me!): Floating chat button in bottom-right corner
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
- Features enabled: ${[
    ctx.remindersEnabled ? "automated reminders" : null,
    ctx.autoVisitsEnabled ? "auto visit generation" : null,
    ctx.roverAiEnabled ? "Rover AI" : null,
  ].filter(Boolean).join(", ") || "none"}

${["owner", "admin"].includes(ctx.userRole) ? `ACCOUNT STATS (live snapshot):
- Total contacts: ${ctx.contactCount} (${ctx.activeContactCount} active)
- Invoices: ${ctx.invoiceCount} total (${ctx.overdueInvoiceCount} overdue)
- MRR: ${ctx.mrrDollars}
- Team members: ${ctx.teamSize}
- Routes: ${ctx.routeCount}
${ctx.recentNotifications.length > 0 ? `\nRecent notifications:\n${ctx.recentNotifications.map((n) => `- [${n.isRead ? "read" : "unread"}] (${n.type}) ${n.title}`).join("\n")}` : ""}` : `ACCOUNT STATS (limited - tech role):
- Routes: ${ctx.routeCount}`}

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
- For lists, use bullet points. Keep responses under 200 words unless the topic requires more detail.`;
}

export const ROVER_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_business_stats",
      description: "Get high-level business statistics: total contacts by status, active service plans, route count, team size, and monthly revenue.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_overdue_invoices",
      description: "Get a summary of overdue (unpaid, past-due) invoices including count and total amount.",
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
      description: "Get a summary of recent activity: visits completed today, new contacts this week, invoices sent this week.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  companyId: string
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
      default:
        return JSON.stringify({ error: "Unknown tool" });
    }
  } catch (err) {
    console.error(`Rover tool error (${toolName}):`, err);
    return JSON.stringify({ error: "Failed to fetch data" });
  }
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
  const weekStart = weekAgo.toISOString().split("T")[0];

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
    .where(
      and(
        eq(contacts.companyId, companyId),
        gte(contacts.createdAt, weekAgo)
      )
    );

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
            content: JSON.stringify({ error: "Access denied. Data tools are only available to owners and admins." }),
          });
          continue;
        }
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(tc.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await executeToolCall(tc.name, args, companyId);
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

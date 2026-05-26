import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, gte, inArray, desc, asc } from "drizzle-orm";
import { contacts, quotes } from "@shared/schema";
import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  handleError,
  API_KEY_ALLOWED_ROUTES,
} from "./shared";
import { syncLeadResponseConfigToAirtable } from "../services/airtable";
import { sendEmail } from "../services/email";

/**
 * Routes that lead_response_operator users are permitted to access.
 * All other /api/* routes return 403 for this role.
 */
const LR_OPERATOR_PERMITTED_PATTERNS = [
  /^\/api\/lead-response\//,
  /^\/api\/contacts($|\?|\/)/,
  /^\/api\/conversations($|\?|\/)/,
  /^\/api\/messages($|\?|\/)/,
  /^\/api\/company\/settings/,
  /^\/api\/billing/,
  /^\/api\/auth\//,
];

export async function blockLeadResponseOperator(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) return next();
  try {
    const memberships = await storage.getCompaniesForUser(userId as string);
    if (!memberships.length) return next();
    const pinnedId = req.session?.activeCompanyId;
    const activeMembership =
      (pinnedId ? memberships.find((m) => m.companyId === pinnedId) : undefined) ?? memberships[0];
    const role = activeMembership.role;
    if (role !== "lead_response_operator") return next();
    req._isLeadResponseOperator = true;
    const path = req.path;
    const permitted = LR_OPERATOR_PERMITTED_PATTERNS.some((pattern) => pattern.test(path));
    if (!permitted) {
      res.status(403).json({ error: "Access restricted for Lead Response accounts." });
      return;
    }
  } catch {
    // Don't block on lookup error — let downstream handlers deal with auth
  }
  next();
}

const VALID_LR_STATUS = [
  "new",
  "estimate_sent",
  "deposit_pending",
  "deposit_paid",
  "scheduled",
  "dead",
] as const;
type LeadResponseStatusValue = (typeof VALID_LR_STATUS)[number];

export async function registerLeadResponseRoutes(app: Express): Promise<void> {
  /**
   * POST /api/lead-response/status
   * Auth: API key (existing SP API key pattern)
   * Body: { contactId, leadResponseStatus, depositAmount?, depositPaidAt? }
   *
   * Updates leadResponseStatus, depositAmount, and depositPaidAt on a contact.
   * Used by external lead response platforms and AI agents.
   */
  app.post("/api/lead-response/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { contactId, leadResponseStatus, depositAmount, depositPaidAt } = req.body;

      if (!contactId || typeof contactId !== "string") {
        return res.status(400).json({ error: "contactId is required" });
      }

      if (!leadResponseStatus || typeof leadResponseStatus !== "string") {
        return res.status(400).json({ error: "leadResponseStatus is required" });
      }

      if (!(VALID_LR_STATUS as readonly string[]).includes(leadResponseStatus)) {
        return res.status(400).json({
          error: `Invalid leadResponseStatus. Must be one of: ${VALID_LR_STATUS.join(", ")}`,
        });
      }

      const contact = await storage.getContact(contactId, companyId);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }

      const updates: Record<string, unknown> = {
        leadResponseStatus: leadResponseStatus as LeadResponseStatusValue,
      };

      if (depositAmount !== undefined && depositAmount !== null) {
        const parsed = parseFloat(String(depositAmount));
        if (isNaN(parsed) || parsed < 0) {
          return res.status(400).json({ error: "depositAmount must be a non-negative number" });
        }
        updates.depositAmount = String(parsed.toFixed(2));
      }

      if (depositPaidAt !== undefined && depositPaidAt !== null) {
        const parsed = new Date(depositPaidAt);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "depositPaidAt must be a valid date string" });
        }
        updates.depositPaidAt = parsed;
      }

      await storage.updateContact(
        contactId,
        companyId,
        updates as Parameters<typeof storage.updateContact>[2]
      );

      console.log(
        `[LR Status] Updated contact ${contactId} — status=${leadResponseStatus}` +
          (updates.depositAmount ? ` deposit=$${updates.depositAmount}` : "") +
          (updates.depositPaidAt ? ` paidAt=${updates.depositPaidAt}` : "")
      );

      return res.json({
        success: true,
        contactId,
        status: leadResponseStatus,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/lead-response/config
   * Auth: user session (owner/admin)
   * Returns the Lead Response config for the current company.
   */
  app.get("/api/lead-response/config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const config = await storage.getLeadResponseConfig(companyId);
      return res.json(config || { leadResponseActive: false });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/lead-response/dashboard
   * Auth: user session
   * Returns 6 summary card metrics for the Lead Response dashboard.
   * All queries scoped to the calling company, filtered to leadSource = 'lead_response'.
   */
  app.get("/api/lead-response/dashboard", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        newTodayResult,
        estimateSentResult,
        depositPendingResult,
        depositPaidResult,
        scheduledResult,
        deadResult,
      ] = await Promise.all([
        // New leads today
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, companyId),
              eq(contacts.leadSource, "lead_response"),
              eq(contacts.leadResponseStatus, "new"),
              gte(contacts.createdAt, todayStart)
            )
          ),

        // Estimates sent (last 30 days) — contacts updated to estimate_sent or beyond within 30 days
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, companyId),
              eq(contacts.leadSource, "lead_response"),
              inArray(contacts.leadResponseStatus, [
                "estimate_sent",
                "deposit_pending",
                "deposit_paid",
                "scheduled",
              ]),
              gte(contacts.updatedAt, last30Start)
            )
          ),

        // Deposit pending count + total value
        db
          .select({
            count: sql<number>`COUNT(*)::int`,
            total: sql<number>`COALESCE(SUM(deposit_amount), 0)`,
          })
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, companyId),
              eq(contacts.leadSource, "lead_response"),
              eq(contacts.leadResponseStatus, "deposit_pending")
            )
          ),

        // Deposit paid this month + total value
        db
          .select({
            count: sql<number>`COUNT(*)::int`,
            total: sql<number>`COALESCE(SUM(deposit_amount), 0)`,
          })
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, companyId),
              eq(contacts.leadSource, "lead_response"),
              eq(contacts.leadResponseStatus, "deposit_paid"),
              gte(contacts.depositPaidAt, monthStart)
            )
          ),

        // Scheduled this month
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, companyId),
              eq(contacts.leadSource, "lead_response"),
              eq(contacts.leadResponseStatus, "scheduled"),
              gte(contacts.updatedAt, monthStart)
            )
          ),

        // Dead leads this month
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, companyId),
              eq(contacts.leadSource, "lead_response"),
              eq(contacts.leadResponseStatus, "dead"),
              gte(contacts.updatedAt, monthStart)
            )
          ),
      ]);

      return res.json({
        newToday: newTodayResult[0]?.count ?? 0,
        estimateSentLast30: estimateSentResult[0]?.count ?? 0,
        depositPendingCount: depositPendingResult[0]?.count ?? 0,
        depositPendingValue: Number(depositPendingResult[0]?.total ?? 0),
        depositPaidMonthCount: depositPaidResult[0]?.count ?? 0,
        depositPaidMonthValue: Number(depositPaidResult[0]?.total ?? 0),
        scheduledThisMonth: scheduledResult[0]?.count ?? 0,
        deadThisMonth: deadResult[0]?.count ?? 0,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/lead-response/leads
   * Auth: user session
   * Returns paginated, sortable list of lead_response contacts.
   * Scoped to the calling company.
   */
  app.get("/api/lead-response/leads", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10)));
      const offset = (page - 1) * limit;
      const sortField = String(req.query.sortField ?? "createdAt");
      const sortDir = String(req.query.sortDir ?? "desc");

      const validSortFields: Record<
        string,
        typeof contacts.createdAt | typeof contacts.leadResponseStatus
      > = {
        createdAt: contacts.createdAt,
        status: contacts.leadResponseStatus,
      };
      const sortCol = validSortFields[sortField] ?? contacts.createdAt;
      const orderFn = sortDir === "asc" ? asc : desc;

      const whereClause = and(
        eq(contacts.companyId, companyId),
        eq(contacts.leadSource, "lead_response")
      );

      // Subquery: most recent non-draft quote selectedPrice for each contact
      const latestQuoteSq = db
        .select({
          contactId: quotes.contactId,
          estimateAmount: sql<string | null>`MAX(${quotes.selectedPrice})`,
        })
        .from(quotes)
        .where(and(eq(quotes.companyId, companyId), sql`${quotes.status} <> 'draft'`))
        .groupBy(quotes.contactId)
        .as("latest_quote");

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: sql<number>`COUNT(*)::int` })
          .from(contacts)
          .where(whereClause),
        db
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            phone: contacts.phone,
            streetAddress: contacts.streetAddress,
            city: contacts.city,
            state: contacts.state,
            yardSize: contacts.yardSize,
            numberOfDogs: contacts.numberOfDogs,
            leadResponseStatus: contacts.leadResponseStatus,
            depositAmount: contacts.depositAmount,
            estimateAmount: latestQuoteSq.estimateAmount,
            createdAt: contacts.createdAt,
          })
          .from(contacts)
          .leftJoin(latestQuoteSq, eq(contacts.id, latestQuoteSq.contactId))
          .where(whereClause)
          .orderBy(orderFn(sortCol))
          .limit(limit)
          .offset(offset),
      ]);

      return res.json({
        leads: rows,
        total: countResult[0]?.total ?? 0,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * PATCH /api/lead-response/config
   * Auth: user session (owner/admin)
   * Save Lead Response settings. Syncs to Airtable after save.
   */
  app.patch("/api/lead-response/config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (role !== "owner" && role !== "admin") {
        return res
          .status(403)
          .json({ error: "Only owners and admins can update Lead Response settings" });
      }

      const {
        billingMode,
        depositPercent,
        schedulingPlatform,
        hcpApiKey,
        serviceZipCodes,
        outOfAreaMessage,
        pricingTiers,
        perDogAdder,
        firstTimeCleanupFee,
        followUpDelayHours,
      } = req.body;

      const updates: Record<string, unknown> = {};
      if (billingMode !== undefined) updates.billingMode = billingMode;
      if (depositPercent !== undefined) updates.depositPercent = depositPercent;
      if (schedulingPlatform !== undefined) updates.schedulingPlatform = schedulingPlatform;
      if (hcpApiKey !== undefined) updates.hcpApiKey = hcpApiKey;
      if (serviceZipCodes !== undefined) updates.serviceZipCodes = serviceZipCodes;
      if (outOfAreaMessage !== undefined) updates.outOfAreaMessage = outOfAreaMessage;
      if (pricingTiers !== undefined) updates.pricingTiers = pricingTiers;
      if (perDogAdder !== undefined) updates.perDogAdder = perDogAdder;
      if (firstTimeCleanupFee !== undefined) updates.firstTimeCleanupFee = firstTimeCleanupFee;
      if (followUpDelayHours !== undefined) updates.followUpDelayHours = followUpDelayHours;

      const saved = await storage.upsertLeadResponseConfig(
        companyId,
        updates as Parameters<typeof storage.upsertLeadResponseConfig>[1]
      );

      // Airtable sync — fire-and-forget, don't block the response
      const company = await storage.getCompany(companyId);
      if (company) {
        syncLeadResponseConfigToAirtable(
          {
            id: company.id,
            name: company.name,
            email: company.email ?? null,
            phone: company.phone ?? null,
          },
          saved,
          saved.airtableOperatorId
        )
          .then(async (airtableId) => {
            if (airtableId && airtableId !== saved.airtableOperatorId) {
              await storage.upsertLeadResponseConfig(companyId, { airtableOperatorId: airtableId });
            }
          })
          .catch((err) => console.error("[LR Settings] Airtable sync failed:", err));
      }

      return res.json(saved);
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * GET /api/lead-response/funnel
   * Auth: user session
   * Returns counts for each funnel stage for the calling company.
   */
  app.get("/api/lead-response/funnel", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);

      const stages = [
        { stage: "new", label: "New" },
        { stage: "estimate_sent", label: "Estimate Sent" },
        { stage: "deposit_pending", label: "Deposit Pending" },
        { stage: "deposit_paid", label: "Deposit Paid" },
        { stage: "scheduled", label: "Scheduled" },
      ];

      const results = await Promise.all(
        stages.map(async ({ stage, label }) => {
          const rows = await db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(contacts)
            .where(
              and(
                eq(contacts.companyId, companyId),
                eq(contacts.leadSource, "lead_response"),
                eq(contacts.leadResponseStatus, stage)
              )
            );
          return { stage, label, count: rows[0]?.count ?? 0 };
        })
      );

      return res.json(results);
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * POST /api/lead-response/request-number-change
   * Auth: user session (owner/admin)
   * Sets portingRequested=true and notifies admin.
   */
  app.post(
    "/api/lead-response/request-number-change",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        if (role !== "owner" && role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only owners and admins can request a number change" });
        }

        const { portingPhoneNumber } = req.body;

        const saved = await storage.upsertLeadResponseConfig(companyId, {
          portingRequested: true,
        });

        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
          const company = await storage.getCompany(companyId);
          const portingLine = portingPhoneNumber
            ? `\nNumber to port: ${portingPhoneNumber}`
            : "";
          sendEmail({
            to: adminEmail,
            subject: `[Lead Response] Number change requested — ${company?.name ?? companyId}`,
            text: `Company ${company?.name ?? companyId} (ID: ${companyId}) has requested a Lead Response phone number change.\n\nCurrent number: ${saved.lrPhoneNumber ?? "none"}${portingLine}\n\nPlease review and process the request.`,
          }).catch((err) => console.error("[LR] Failed to send number-change admin email:", err));
        }

        return res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  /**
   * POST /api/lead-response/provision-number
   * Auth: session (owner/admin)
   * Body: { areaCode: string, companyId?: string }
   *
   * Provisions a Telnyx phone number for the Lead Response product.
   * Currently runs in TEST MODE — no real Telnyx API calls or number purchases are made.
   * The provisioned number is saved to lead_response_config.lrPhoneNumber.
   *
   * TODO: SWITCH TO LIVE MODE — replace the test simulation block below with
   * a real Telnyx API call to search & order a number in the given area code.
   * See: https://developers.telnyx.com/api/numbers/get-available-phone-numbers
   */
  app.post(
    "/api/lead-response/provision-number",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);

        const { areaCode } = req.body;
        if (!areaCode || typeof areaCode !== "string") {
          return res.status(400).json({ error: "areaCode is required" });
        }
        const cleanCode = areaCode.replace(/\D/g, "").slice(0, 3);
        if (cleanCode.length !== 3) {
          return res.status(400).json({ error: "areaCode must be a 3-digit number" });
        }

        // ── TEST MODE SIMULATION ──────────────────────────────────────────────
        // TODO: SWITCH TO LIVE MODE — replace this block with a real Telnyx API call.
        // Real implementation should:
        //   1. GET https://api.telnyx.com/v2/available_phone_numbers?filter[national_destination_code]=${cleanCode}&filter[features][]=sms
        //   2. Pick the first available number from the response
        //   3. POST https://api.telnyx.com/v2/number_orders to purchase it
        //   4. Return the purchased number
        // If no numbers are available in the area code, return a 409 with error message.
        const simulatedNumber = `+1${cleanCode}5550${Math.floor(1000 + Math.random() * 9000)}`;
        // ── END TEST MODE ─────────────────────────────────────────────────────

        await storage.upsertLeadResponseConfig(companyId, {
          lrPhoneNumber: simulatedNumber,
        });

        console.log(
          `[LR Provision] TEST MODE: Simulated number ${simulatedNumber} for company ${companyId} (area code ${cleanCode})`
        );

        return res.json({ success: true, phoneNumber: simulatedNumber, testMode: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );
}

// Register the POST /api/lead-response/status route as API-key accessible
API_KEY_ALLOWED_ROUTES.push({
  method: "POST",
  pathRegex: /^\/api\/lead-response\/status\/?$/,
});

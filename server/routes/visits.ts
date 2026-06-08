import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and } from "drizzle-orm";
import { contacts, reminderLogs, type InsertVisit, type Visit } from "@shared/schema";
import { ObjectStorageService } from "../replit_integrations/object_storage";
import { sendEmail } from "../services/email";
import {
  sendSmsForCompany,
  isSmsConfiguredForCompany,
  getFromPhoneForCompany,
} from "../services/sms";
import { getAppBaseUrl } from "../services/invoice-email";
import { haversineDistance, fetchMapboxDirections } from "../services/route-optimizer";
import { insertVisitSchema, reviewTokens, reviewResponses } from "@shared/schema";
import { computeSemiMonthlyVisitDates } from "@shared/frequency-utils";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  requireApiKeyScope,
  handleError,
  p,
  notify,
  escapeHtml,
  buildVisitLineItemsWithAddOns,
} from "./shared";
const _objStorage = new ObjectStorageService();

export async function registerVisitsRoutes(app: Express): Promise<void> {
  // ================ Visit Routes ================

  app.get("/api/visits/today", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      const dateParam = req.query.date as string | undefined;
      const targetDate = dateParam || new Date().toISOString().split("T")[0];

      // Query 1 of 2: routes (needed for tech filtering and route name/color)
      const isTech = role === "tech";
      const companyRoutes = await storage.getRoutes(companyId);
      const routeMap = new Map(companyRoutes.map((r) => [r.id, r]));
      const techRouteIds = isTech
        ? new Set(companyRoutes.filter((r) => r.technicianId === userId).map((r) => r.id))
        : null;

      // Query 2 of 2: single JOIN across visits + plans + properties + contacts + add-ons
      // Filters by company_id + date, eliminating the old getVisits() call entirely
      type JoinRow = {
        visit_id: string;
        v_service_plan_id: string;
        v_job_id: string | null;
        v_property_id: string;
        v_route_id: string | null;
        v_scheduled_date: string;
        v_status: string;
        v_en_route_at: Date | null;
        v_started_at: Date | null;
        v_completed_at: Date | null;
        v_completed_by: string | null;
        v_proof: string | null;
        v_proof_before: string | null;
        v_gate_closed: string | null;
        v_extra_photos: unknown;
        v_tech_notes: string | null;
        v_invoice_id: string | null;
        v_reminder_sent_at: Date | null;
        v_time_window_type: string | null;
        v_scheduled_time_start: string | null;
        v_scheduled_time_end: string | null;
        v_created_at: Date;
        v_updated_at: Date;
        stop_order: number | null;
        sp_contact_id: string | null;
        service_name: string | null;
        frequency: string | null;
        street_address: string | null;
        city: string | null;
        prop_state: string | null;
        gate_code: string | null;
        special_instructions: string | null;
        measured_yard_sqft: number | null;
        lot_size: string | null;
        number_of_dogs: number | null;
        has_dangerous_dog: boolean | null;
        dangerous_dog_notes: string | null;
        latitude: string | null;
        longitude: string | null;
        contact_id_col: string | null;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        contact_notes: string | null;
        addon_name: string | null;
        addon_price: string | null;
      };
      const joinRows = (
        await db.execute(sql`
          SELECT
            v.id                             AS visit_id,
            v.service_plan_id                AS v_service_plan_id,
            v.job_id                         AS v_job_id,
            v.property_id                    AS v_property_id,
            v.route_id                       AS v_route_id,
            v.scheduled_date                 AS v_scheduled_date,
            v.status                         AS v_status,
            v.en_route_at                    AS v_en_route_at,
            v.started_at                     AS v_started_at,
            v.completed_at                   AS v_completed_at,
            v.completed_by                   AS v_completed_by,
            v.proof_of_service_photo         AS v_proof,
            v.proof_of_service_photo_before  AS v_proof_before,
            v.gate_closed_photo              AS v_gate_closed,
            v.extra_photos                   AS v_extra_photos,
            v.technician_notes               AS v_tech_notes,
            v.invoice_id                     AS v_invoice_id,
            v.service_reminder_sent_at       AS v_reminder_sent_at,
            v.time_window_type               AS v_time_window_type,
            v.scheduled_time_start           AS v_scheduled_time_start,
            v.scheduled_time_end             AS v_scheduled_time_end,
            v.created_at                     AS v_created_at,
            v.updated_at                     AS v_updated_at,
            sp.stop_order                    AS stop_order,
            sp.contact_id                    AS sp_contact_id,
            sp.service_name                  AS service_name,
            sp.frequency                     AS frequency,
            p.street_address                 AS street_address,
            p.city                           AS city,
            p.state                          AS prop_state,
            p.gate_code                      AS gate_code,
            p.special_instructions           AS special_instructions,
            p.measured_yard_sqft             AS measured_yard_sqft,
            p.lot_size                       AS lot_size,
            p.number_of_dogs                 AS number_of_dogs,
            p.has_dangerous_dog              AS has_dangerous_dog,
            p.dangerous_dog_notes            AS dangerous_dog_notes,
            p.latitude                       AS latitude,
            p.longitude                      AS longitude,
            c.id                             AS contact_id_col,
            c.first_name                     AS first_name,
            c.last_name                      AS last_name,
            c.phone                          AS phone,
            c.notes                          AS contact_notes,
            spa.name                         AS addon_name,
            spa.price                        AS addon_price
          FROM visits v
          LEFT JOIN service_plans sp  ON sp.id = v.service_plan_id AND sp.company_id = v.company_id
          LEFT JOIN properties p      ON p.id = v.property_id AND p.company_id = v.company_id
          LEFT JOIN contacts c        ON c.id = sp.contact_id AND c.company_id = v.company_id
          LEFT JOIN service_plan_add_ons spa
                 ON spa.service_plan_id = v.service_plan_id AND spa.is_active = true
          WHERE v.company_id = ${companyId} AND v.scheduled_date = ${targetDate}
        `)
      ).rows as JoinRow[];

      // Build visit objects and per-visit aggregated data in a single pass
      type AggData = {
        stopOrder: number | null;
        contactId: string | null;
        serviceName: string | null;
        frequency: string | null;
        property: {
          streetAddress: string | null;
          city: string | null;
          state: string | null;
          gateCode: string | null;
          specialInstructions: string | null;
          measuredYardSqft: number | null;
          lotSize: string | null;
          numberOfDogs: number | null;
          hasDangerousDog: boolean | null;
          dangerousDogNotes: string | null;
          latitude: number | null;
          longitude: number | null;
        } | null;
        contact: {
          id: string;
          firstName: string;
          lastName: string;
          phone: string | null;
          notes: string | null;
        } | null;
        addOns: { name: string; price: string }[];
      };
      const visitMap = new Map<string, Visit>();
      const visitDataMap = new Map<string, AggData>();
      for (const row of joinRows) {
        if (!visitMap.has(row.visit_id)) {
          visitMap.set(row.visit_id, {
            id: row.visit_id,
            companyId,
            servicePlanId: row.v_service_plan_id,
            jobId: row.v_job_id,
            propertyId: row.v_property_id,
            routeId: row.v_route_id,
            scheduledDate: row.v_scheduled_date,
            status: row.v_status as Visit["status"],
            enRouteAt: row.v_en_route_at,
            startedAt: row.v_started_at,
            completedAt: row.v_completed_at,
            completedBy: row.v_completed_by,
            proofOfServicePhoto: row.v_proof,
            proofOfServicePhotoBefore: row.v_proof_before,
            gateClosedPhoto: row.v_gate_closed,
            extraPhotos: row.v_extra_photos as Visit["extraPhotos"],
            technicianNotes: row.v_tech_notes,
            invoiceId: row.v_invoice_id,
            serviceReminderSentAt: row.v_reminder_sent_at,
            timeWindowType: (row.v_time_window_type as Visit["timeWindowType"]) ?? "anytime",
            scheduledTimeStart: row.v_scheduled_time_start ?? null,
            scheduledTimeEnd: row.v_scheduled_time_end ?? null,
            createdAt: row.v_created_at,
            updatedAt: row.v_updated_at,
          });
        }
        let entry = visitDataMap.get(row.visit_id);
        if (!entry) {
          entry = {
            stopOrder: row.stop_order,
            contactId: row.sp_contact_id,
            serviceName: row.service_name,
            frequency: row.frequency,
            property: row.street_address
              ? {
                  streetAddress: row.street_address,
                  city: row.city,
                  state: row.prop_state,
                  gateCode: row.gate_code,
                  specialInstructions: row.special_instructions,
                  measuredYardSqft: row.measured_yard_sqft,
                  lotSize: row.lot_size,
                  numberOfDogs: row.number_of_dogs,
                  hasDangerousDog: row.has_dangerous_dog,
                  dangerousDogNotes: row.dangerous_dog_notes,
                  latitude: row.latitude ? parseFloat(row.latitude) : null,
                  longitude: row.longitude ? parseFloat(row.longitude) : null,
                }
              : null,
            contact: row.contact_id_col
              ? {
                  id: row.contact_id_col,
                  firstName: row.first_name ?? "",
                  lastName: row.last_name ?? "",
                  phone: row.phone,
                  notes: row.contact_notes,
                }
              : null,
            addOns: [],
          };
          visitDataMap.set(row.visit_id, entry);
        }
        if (row.addon_name) {
          entry.addOns.push({ name: row.addon_name, price: row.addon_price ?? "0" });
        }
      }

      // Build enriched list; apply tech-route filter in memory
      const seen = new Set<string>();
      const enriched: ReturnType<typeof buildEnrichedVisit>[] = [];
      function buildEnrichedVisit(v: Visit) {
        const d = visitDataMap.get(v.id);
        const route = v.routeId ? routeMap.get(v.routeId) : null;
        return {
          ...v,
          stopOrder: d?.stopOrder ?? 999,
          routeName: route?.name ?? null,
          routeColor: route?.color ?? null,
          servicePlanName: d?.serviceName || (d?.frequency ? `${d.frequency} service` : null),
          addOns: d?.addOns ?? [],
          property: d?.property ?? null,
          contact: d?.contact ?? null,
        };
      }
      for (const row of joinRows) {
        if (seen.has(row.visit_id)) continue;
        seen.add(row.visit_id);
        const v = visitMap.get(row.visit_id)!;
        if (techRouteIds && !(v.routeId && techRouteIds.has(v.routeId))) continue;
        enriched.push(buildEnrichedVisit(v));
      }

      enriched.sort((a, b) => {
        const routeA = a.routeName ?? "";
        const routeB = b.routeName ?? "";
        if (routeA !== routeB) return routeA.localeCompare(routeB);
        return (a.stopOrder ?? 999) - (b.stopOrder ?? 999);
      });

      res.json(enriched);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/visits/range", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const start = req.query.start as string;
      const end = req.query.end as string;
      if (!start || !end)
        return res.status(400).json({ error: "start and end query params required" });
      const visitsList = await storage.getVisitsForDateRange(companyId, start, end);
      res.json(visitsList);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { date?: string; routeId?: string; status?: string } = {};
      if (req.query.date) filters.date = req.query.date as string;
      if (req.query.routeId) filters.routeId = req.query.routeId as string;
      if (req.query.status) filters.status = req.query.status as string;
      const visitsList = await storage.getVisits(companyId, filters);
      res.json(visitsList);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/visits/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const visit = await storage.getVisit(p(req.params.id), companyId);
      if (!visit) return res.status(404).json({ error: "Visit not found" });
      res.json(visit);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      if (req._apiKeyAuth) requireApiKeyScope(req, "crm:write");
      const parsed = insertVisitSchema.parse({ ...req.body, companyId });
      const visit = await storage.createVisit(parsed);
      if (!visit)
        return res.status(409).json({ error: "A visit for this plan on that date already exists" });
      res.status(201).json(visit);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ─── Public Review Router endpoints (no auth required) ───────────────────

  app.get("/api/review/token/:token", async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token);
      const [row] = await db
        .select()
        .from(reviewTokens)
        .where(eq(reviewTokens.token, token))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Invalid review link" });
      if (row.expiresAt < new Date())
        return res.status(410).json({ error: "This review link has expired" });
      if (row.usedAt)
        return res.status(410).json({ error: "This review link has already been used" });
      const company = await storage.getCompany(row.companyId);
      const contact = await storage.getContact(row.contactId, row.companyId);
      res.json({
        valid: true,
        used: false,
        companyName: company?.name || "Your service provider",
        companyLogoUrl: company?.logoUrl || null,
        contactFirstName: contact?.firstName || "there",
        googleReviewUrl: row.googleReviewUrl || company?.googleReviewUrl || null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/review/rate", async (req: Request, res: Response) => {
    try {
      const { token, rating } = req.body;
      if (!token || !rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "token and rating (1-5) are required" });
      }
      const [row] = await db
        .select()
        .from(reviewTokens)
        .where(eq(reviewTokens.token, token))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Invalid review link" });
      if (row.expiresAt < new Date())
        return res.status(410).json({ error: "This review link has expired" });
      const [consumed] = await db
        .update(reviewTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(reviewTokens.token, token), sql`used_at IS NULL`))
        .returning({ id: reviewTokens.id });
      if (!consumed)
        return res.status(410).json({ error: "This review link has already been used" });
      const branch = rating >= 4 ? "positive" : "negative";
      const [newResponse] = await db
        .insert(reviewResponses)
        .values({
          tokenId: consumed.id,
          rating,
          feedbackText: null,
          branch,
          alertSent: false,
        })
        .returning({ id: reviewResponses.id });
      const company = await storage.getCompany(row.companyId);

      // Fire an immediate owner alert for low ratings so negative feedback is
      // never silently lost if the customer closes the browser before typing text.
      if (branch === "negative" && newResponse) {
        try {
          const contact = await storage.getContact(row.contactId, row.companyId);
          if (company && contact) {
            const contactName = `${contact.firstName} ${contact.lastName}`.trim();
            const appBaseUrl = getAppBaseUrl();
            const contactLink = `${appBaseUrl}/contacts/${contact.id}`;
            const ownerEmails = await db.execute(sql`
              SELECT u.email FROM users u
              JOIN company_users cu ON cu.user_id = u.id
              WHERE cu.company_id = ${row.companyId} AND cu.role = 'owner' AND cu.is_active = true AND u.email IS NOT NULL
              LIMIT 3
            `);
            const safeContactName = escapeHtml(contactName);
            const emailSubject = `Customer left a low rating — ${contactName}`;
            const emailText = `A customer left a low rating. They may still submit written feedback, but you should follow up.\n\nCustomer: ${contactName}\nRating: ${rating}/5 stars\n\nView contact: ${contactLink}`;
            const emailHtml = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #dc2626; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="color: white; margin: 0; font-size: 20px;">Customer Left a Low Rating</h1>
                </div>
                <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                  <p style="margin: 0 0 16px; color: #111827; font-size: 15px;">A customer left a low rating. They may still leave written feedback, but you should reach out proactively.</p>
                  <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                    <p style="margin: 4px 0; font-size: 14px;"><strong>Customer:</strong> ${safeContactName}</p>
                    <p style="margin: 4px 0; font-size: 14px;"><strong>Rating:</strong> ${rating}/5 stars</p>
                    <p style="margin: 4px 0; font-size: 14px; color: #6b7280;">No written feedback submitted yet.</p>
                  </div>
                  <div style="text-align: center;">
                    <a href="${contactLink}" style="display: inline-block; background-color: #dc2626; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">View Customer in CRM</a>
                  </div>
                </div>
              </div>
            `;
            for (const emailRow of ownerEmails.rows) {
              const ownerEmail = String((emailRow as Record<string, unknown>).email ?? "");
              if (ownerEmail) {
                await sendEmail({
                  to: ownerEmail,
                  subject: emailSubject,
                  text: emailText,
                  html: emailHtml,
                  companyId: row.companyId,
                });
              }
            }
            const smsConfigured = await isSmsConfiguredForCompany(row.companyId);
            if (smsConfigured) {
              const ownerPhones = await db.execute(sql`
                SELECT u.phone FROM users u
                JOIN company_users cu ON cu.user_id = u.id
                WHERE cu.company_id = ${row.companyId} AND cu.role = 'owner' AND cu.is_active = true AND u.phone IS NOT NULL
                LIMIT 3
              `);
              const smsBody = `Alert: ${contactName} gave a ${rating}-star rating. No written feedback yet — log in to ScooPilot to follow up.`;
              for (const phoneRow of ownerPhones.rows) {
                const ownerPhone = String((phoneRow as Record<string, unknown>).phone ?? "");
                if (ownerPhone) {
                  await sendSmsForCompany({
                    to: ownerPhone,
                    body: smsBody,
                    companyId: row.companyId,
                  }).catch((e) => console.error("[ReviewRateAlert] SMS failed:", e));
                }
              }
            }
            await db
              .update(reviewResponses)
              .set({ alertSent: true })
              .where(eq(reviewResponses.id, newResponse.id));
          }
        } catch (alertErr) {
          console.error("[ReviewRateAlert] Failed to send rating alert:", alertErr);
        }
      }

      res.json({
        tokenId: consumed.id,
        branch,
        googleReviewUrl: row.googleReviewUrl || company?.googleReviewUrl || null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/review/submit", async (req: Request, res: Response) => {
    try {
      const { token, feedbackText } = req.body;
      if (!token) {
        return res.status(400).json({ error: "token is required" });
      }
      if (!feedbackText || feedbackText.trim().length < 10) {
        return res.status(400).json({ error: "Please provide at least 10 characters of feedback" });
      }
      const [row] = await db
        .select()
        .from(reviewTokens)
        .where(eq(reviewTokens.token, token))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Invalid review link" });
      if (row.expiresAt < new Date())
        return res.status(410).json({ error: "This review link has expired" });
      if (!row.usedAt) return res.status(400).json({ error: "Rating not yet recorded" });
      const [existingResponse] = await db
        .select()
        .from(reviewResponses)
        .where(eq(reviewResponses.tokenId, row.id))
        .limit(1);
      if (!existingResponse) return res.status(404).json({ error: "Rating not yet recorded" });
      if (existingResponse.branch !== "negative")
        return res.status(400).json({ error: "Only negative responses require text feedback" });
      if (existingResponse.feedbackText && existingResponse.feedbackText.trim().length > 0) {
        return res.status(409).json({ error: "Feedback already submitted" });
      }
      const updated = await db
        .update(reviewResponses)
        .set({ feedbackText: feedbackText.trim(), submittedAt: new Date() })
        .where(and(eq(reviewResponses.id, existingResponse.id), sql`feedback_text IS NULL`))
        .returning();
      if (updated.length === 0) {
        return res.status(409).json({ error: "Feedback already submitted" });
      }
      // Only alert if no alert was already sent at rating time; prevents double-alerting.
      if (!existingResponse.alertSent) {
        try {
          const company = await storage.getCompany(row.companyId);
          const contact = await storage.getContact(row.contactId, row.companyId);
          if (company && contact) {
            const contactName = `${contact.firstName} ${contact.lastName}`.trim();
            const appBaseUrl = getAppBaseUrl();
            const contactLink = `${appBaseUrl}/contacts/${contact.id}`;
            const ownerEmails = await db.execute(sql`
            SELECT u.email FROM users u
            JOIN company_users cu ON cu.user_id = u.id
            WHERE cu.company_id = ${row.companyId} AND cu.role = 'owner' AND cu.is_active = true AND u.email IS NOT NULL
            LIMIT 3
          `);
            const safeContactName = escapeHtml(contactName);
            const safeFeedback = escapeHtml(feedbackText.trim());
            const emailSubject = `⚠️ Urgent: Customer Needs Attention — ${contactName}`;
            const emailText = `A customer left a low rating and needs your attention.\n\nCustomer: ${contactName}\nRating: ${existingResponse.rating}/5 stars\nFeedback: ${feedbackText.trim()}\n\nView contact: ${contactLink}`;
            const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #dc2626; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 20px;">⚠️ Customer Needs Attention</h1>
              </div>
              <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="margin: 0 0 16px; color: #111827; font-size: 15px;">A customer left a low rating and needs your personal follow-up.</p>
                <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                  <p style="margin: 4px 0; font-size: 14px;"><strong>Customer:</strong> ${safeContactName}</p>
                  <p style="margin: 4px 0; font-size: 14px;"><strong>Rating:</strong> ${"⭐".repeat(existingResponse.rating)} (${existingResponse.rating}/5)</p>
                  <p style="margin: 4px 0; font-size: 14px;"><strong>Feedback:</strong> ${safeFeedback}</p>
                </div>
                <div style="text-align: center;">
                  <a href="${contactLink}" style="display: inline-block; background-color: #dc2626; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">View Customer in CRM</a>
                </div>
              </div>
            </div>
          `;
            for (const emailRow of ownerEmails.rows) {
              const ownerEmail = String((emailRow as Record<string, unknown>).email ?? "");
              if (ownerEmail) {
                await sendEmail({
                  to: ownerEmail,
                  subject: emailSubject,
                  text: emailText,
                  html: emailHtml,
                  companyId: row.companyId,
                });
              }
            }
            const smsConfigured = await isSmsConfiguredForCompany(row.companyId);
            if (smsConfigured) {
              const ownerPhones = await db.execute(sql`
              SELECT u.phone FROM users u
              JOIN company_users cu ON cu.user_id = u.id
              WHERE cu.company_id = ${row.companyId} AND cu.role = 'owner' AND cu.is_active = true AND u.phone IS NOT NULL
              LIMIT 3
            `);
              const smsBody = `Action needed: ${contactName} left a ${existingResponse.rating}-star rating that needs your attention. Check your email or log in to ScooPilot.`;
              for (const phoneRow of ownerPhones.rows) {
                const ownerPhone = String((phoneRow as Record<string, unknown>).phone ?? "");
                if (ownerPhone) {
                  await sendSmsForCompany({
                    to: ownerPhone,
                    body: smsBody,
                    companyId: row.companyId,
                  }).catch((e) => console.error("[ReviewAlert] SMS failed:", e));
                }
              }
            }
            await db
              .update(reviewResponses)
              .set({ alertSent: true })
              .where(eq(reviewResponses.id, existingResponse.id));
          }
        } catch (alertErr) {
          console.error("[ReviewAlert] Failed to send owner alert:", alertErr);
        }
      } // end if (!existingResponse.alertSent)
      res.json({ success: true, branch: existingResponse.branch });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/review/responses", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      try {
        const rows = await db.execute(sql`
          SELECT rr.id, rr.rating, rr.feedback_text, rr.branch, rr.submitted_at, rr.alert_sent,
                 rt.contact_id, rt.token,
                 c.first_name, c.last_name
          FROM review_responses rr
          JOIN review_tokens rt ON rt.id = rr.token_id
          JOIN contacts c ON c.id = rt.contact_id
          WHERE rt.company_id = ${companyId}
            AND rr.branch = 'negative'
            AND rr.feedback_text IS NOT NULL
            AND length(trim(coalesce(rr.feedback_text, ''))) > 0
          ORDER BY rr.submitted_at DESC
          LIMIT 50
        `);
        res.json(rows.rows);
      } catch (_reviewErr) {
        // Tables may not exist yet; return empty array as safe default
        res.json([]);
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  // ─── End public Review Router endpoints ─────────────────────────────────

  async function maybeFireReviewRequest(companyId: string, contactId: string, visitId: string) {
    try {
      const company = await storage.getCompany(companyId);
      if (!company?.reviewRequestEnabled || !company.googleReviewUrl) return;
      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return;
      if (contact.googleReviewLeft) {
        console.log(`[ReviewRequest] Skipping contact ${contactId} — review already left`);
        return;
      }
      const threshold = company.reviewRequestAfterVisits || 3;
      const currentCount = contact.visitsSinceLastReviewRequest ?? 0;
      const newCount = currentCount + 1;
      if (newCount >= threshold) {
        const useRouter = company.reviewRouterEnabled !== false;
        let reviewLink = company.googleReviewUrl;
        if (useRouter) {
          const token = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
          await db.insert(reviewTokens).values({
            companyId,
            contactId,
            token,
            expiresAt,
            googleReviewUrl: company.googleReviewUrl,
          });
          const appBase = getAppBaseUrl();
          reviewLink = `${appBase}/review/${token}`;
        }
        const customMsg = company.reviewRequestCustomMessage;
        const message = customMsg
          ? customMsg
              .replace(/\{firstName\}/g, contact.firstName)
              .replace(/\{companyName\}/g, company.name)
              .replace(/\{reviewLink\}/g, reviewLink)
          : `Hi ${contact.firstName}! We'd love to hear about your experience with ${company.name}. Would you mind leaving us a quick Google review? It really helps! ${reviewLink}`;
        if (contact.phone) {
          try {
            await sendSmsForCompany({
              to: contact.phone,
              body: message,
              companyId,
              contactId: contact.id,
            });
          } catch (smsErr) {
            console.error("[ReviewRequest] SMS send failed:", smsErr);
          }
        }
        await db.insert(reminderLogs).values({
          companyId,
          contactId,
          visitId,
          reminderType: "review_request",
          channel: contact.phone ? "sms" : "none",
          messagePreview: message.slice(0, 200),
          deliveryStatus: "sent",
          sentAt: new Date(),
        });
        await db
          .update(contacts)
          .set({
            visitsSinceLastReviewRequest: 0,
            reviewRequestSentCount: sql`${contacts.reviewRequestSentCount} + 1`,
            lastReviewRequestSentAt: new Date(),
          })
          .where(eq(contacts.id, contactId));
        console.log(`[ReviewRequest] Sent to contact ${contactId} (visit ${visitId})`);
      } else {
        await db
          .update(contacts)
          .set({
            visitsSinceLastReviewRequest: newCount,
          })
          .where(eq(contacts.id, contactId));
      }
    } catch (err) {
      console.error("[ReviewRequest] Error in maybeFireReviewRequest:", err);
    }
  }

  app.patch("/api/visits/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const existing = await storage.getVisit(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Visit not found" });

      if (role === "tech") {
        if (!existing.routeId) {
          return res.status(403).json({ error: "Visit has no assigned route" });
        }
        const route = await storage.getRoute(existing.routeId, companyId);
        if (!route || route.technicianId !== userId) {
          return res.status(403).json({ error: "You are not assigned to this visit's route" });
        }
      }

      const validVisitStatuses = ["scheduled", "in_progress", "completed", "skipped", "cancelled"];
      if (req.body.status && !validVisitStatuses.includes(req.body.status)) {
        return res
          .status(400)
          .json({ error: `Invalid status. Must be one of: ${validVisitStatuses.join(", ")}` });
      }
      const allowedTransitions: Record<string, string[]> = {
        scheduled: ["in_progress", "completed", "skipped", "cancelled"],
        in_progress: ["completed", "skipped", "cancelled"],
        completed: ["scheduled"],
        skipped: ["scheduled"],
        cancelled: ["scheduled"],
      };
      if (req.body.status && req.body.status !== existing.status) {
        const allowed = allowedTransitions[existing.status] || [];
        if (!allowed.includes(req.body.status)) {
          return res
            .status(400)
            .json({ error: `Cannot transition from '${existing.status}' to '${req.body.status}'` });
        }
      }
      const allowedFields = [
        "status",
        "scheduledDate",
        "routeId",
        "startedAt",
        "completedAt",
        "proofOfServicePhoto",
        "proofOfServicePhotoBefore",
        "gateClosedPhoto",
        "extraPhotos",
        "technicianNotes",
        "timeWindowType",
        "scheduledTimeStart",
        "scheduledTimeEnd",
      ];
      const updates: Partial<InsertVisit> = {};
      for (const key of allowedFields as (keyof InsertVisit)[]) {
        if (req.body[key] !== undefined) (updates as Record<string, unknown>)[key] = req.body[key];
      }
      if (req.body.status === "completed") {
        (updates as Record<string, unknown>).completedBy = userId;
      }
      const timestampFields = ["startedAt", "completedAt"];
      for (const field of timestampFields as (keyof InsertVisit)[]) {
        if (field in updates && updates[field] !== null) {
          (updates as Record<string, unknown>)[field] = new Date(
            (updates as Record<string, unknown>)[field] as string | number
          );
        }
      }
      let visit: Awaited<ReturnType<typeof storage.updateVisit>>;
      try {
        visit = await storage.updateVisit(p(req.params.id), companyId, updates);
      } catch (updateErr: unknown) {
        const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
        const causeMsg =
          updateErr instanceof Error && updateErr.cause instanceof Error
            ? updateErr.cause.message
            : "";
        if (
          msg.includes("unique constraint") ||
          msg.includes("duplicate key") ||
          causeMsg.includes("unique constraint") ||
          causeMsg.includes("duplicate key")
        ) {
          return res
            .status(409)
            .json({ error: "A visit with this service plan already exists on the selected date" });
        }
        throw updateErr;
      }

      if (req.body.status === "completed" && existing.status !== "completed") {
        try {
          const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
          if (plan) {
            const contact = await storage.getContact(plan.contactId, companyId);
            if (
              contact &&
              contact.autoInvoiceEnabled !== false &&
              contact.invoiceTiming === "after_service" &&
              contact.invoiceFrequency === "per_service"
            ) {
              const alreadyInvoiced = await storage.isVisitInvoiced(visit.id);
              if (!alreadyInvoiced) {
                const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
                const planMap = new Map([[plan.id, plan]]);
                const lineItems = await buildVisitLineItemsWithAddOns([visit], planMap);
                const subtotal = lineItems.reduce((sum, li) => sum + parseFloat(li.total), 0);
                const autoInvoice = await storage.createInvoiceWithLineItems(
                  {
                    companyId,
                    contactId: plan.contactId,
                    invoiceNumber,
                    dueDate: new Date().toISOString().split("T")[0],
                    subtotal: subtotal.toFixed(2),
                    tax: "0",
                    total: subtotal.toFixed(2),
                    status: "draft",
                    autoGenerated: true,
                    paymentAttempts: 0,
                  },
                  lineItems
                );
                await storage.updateVisit(visit.id, companyId, { invoiceId: autoInvoice.id });
              }
            }
          }
        } catch (autoErr) {
          console.error("Auto-invoice generation failed:", autoErr);
        }
        notify(
          companyId,
          "visit_completed",
          "Visit Completed",
          `Visit on ${visit.scheduledDate} has been marked as completed.`,
          `/scheduling`
        );
        try {
          const { fireAutomationTrigger } = await import("../services/automation-runner");
          await fireAutomationTrigger("service_completed", companyId, {
            visitId: visit.id,
            servicePlanId: visit.servicePlanId,
            scheduledDate: visit.scheduledDate,
          });
        } catch (autoErr) {
          console.error("[automation] service_completed trigger error:", autoErr);
        }
        try {
          const planForReview = await storage.getServicePlan(visit.servicePlanId, companyId);
          if (planForReview?.contactId) {
            await maybeFireReviewRequest(companyId, planForReview.contactId, visit.id);
          }
        } catch (reviewErr) {
          console.error("Review request check failed:", reviewErr);
        }
      }

      res.json(visit);
    } catch (err) {
      handleError(res, err);
    }
  });

  const onMyWayCooldowns = new Map<string, number>();

  app.post("/api/visits/:id/on-my-way", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const visit = await storage.getVisit(p(req.params.id), companyId);
      if (!visit) return res.status(404).json({ error: "Visit not found" });

      if (role === "tech") {
        if (!visit.routeId) return res.status(403).json({ error: "Visit has no assigned route" });
        const route = await storage.getRoute(visit.routeId, companyId);
        if (!route || route.technicianId !== userId)
          return res.status(403).json({ error: "You are not assigned to this visit's route" });
      }

      const lat = Number(req.body.latitude);
      const lon = Number(req.body.longitude);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        return res.status(400).json({ error: "Valid latitude and longitude are required" });
      }

      const cooldownKey = `${companyId}:${p(req.params.id)}`;
      const lastSent = onMyWayCooldowns.get(cooldownKey);
      if (lastSent && Date.now() - lastSent < 5 * 60 * 1000) {
        const waitSec = Math.ceil((5 * 60 * 1000 - (Date.now() - lastSent)) / 1000);
        return res.status(429).json({
          error: `Please wait ${waitSec} seconds before sending another on-my-way SMS for this stop`,
        });
      }

      const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
      if (!plan) return res.status(404).json({ error: "Service plan not found" });

      const contact = await storage.getContact(plan.contactId, companyId);
      if (!contact?.phone) return res.status(400).json({ error: "Customer has no phone number" });

      const property = await storage.getProperty(visit.propertyId, companyId);
      if (!property) return res.status(404).json({ error: "Property not found" });

      const destLat = parseFloat(String(property.latitude));
      const destLon = parseFloat(String(property.longitude));
      if (!Number.isFinite(destLat) || !Number.isFinite(destLon))
        return res.status(400).json({ error: "Property is not geocoded" });

      const company = await storage.getCompany(companyId);
      const companyName = company?.name || "Your service provider";

      let travelMinutes = 10;
      const mapbox = await fetchMapboxDirections(
        [
          { longitude: lon, latitude: lat },
          { longitude: destLon, latitude: destLat },
        ],
        companyId
      );
      if (mapbox) {
        travelMinutes = mapbox.duration;
      } else {
        const miles = haversineDistance(lat, lon, destLat, destLon);
        travelMinutes = (miles / 25) * 60;
      }

      const roundedMinutes = Math.max(5, Math.ceil(travelMinutes / 5) * 5);

      const smsReady = await isSmsConfiguredForCompany(companyId);
      if (!smsReady) return res.status(503).json({ error: "SMS is not configured" });

      const etaMsg = `Hi ${contact.firstName}, ${companyName} is on the way! Estimated arrival in about ${roundedMinutes} minutes. Please ensure your yard is accessible and any dogs are inside. See you soon!`;

      const smsResult = await sendSmsForCompany({
        to: contact.phone,
        body: etaMsg,
        companyId,
        contactId: contact.id,
      });
      if (!smsResult.success)
        return res.status(500).json({ error: smsResult.error || "Failed to send SMS" });

      onMyWayCooldowns.set(cooldownKey, Date.now());

      try {
        await storage.updateVisit(p(req.params.id), companyId, { enRouteAt: new Date() });
      } catch (stampErr) {
        console.error("Failed to stamp enRouteAt on visit:", stampErr);
      }

      try {
        const fromPhone = await getFromPhoneForCompany(companyId);
        await storage.createMessage({
          companyId,
          contactId: contact.id,
          channel: "sms",
          direction: "outbound",
          status: "sent",
          fromAddress: fromPhone,
          toAddress: contact.phone,
          body: etaMsg,
          externalId: smsResult.messageSid,
        });
      } catch (logErr) {
        console.error("On-my-way message logging failed (SMS was sent):", logErr);
      }

      res.json({
        sent: true,
        etaMinutes: roundedMinutes,
        contactName: `${contact.firstName} ${contact.lastName}`,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/visits/:id/start", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const visit = await storage.getVisit(p(req.params.id), companyId);
      if (!visit) return res.status(404).json({ error: "Visit not found" });

      if (visit.status === "completed" || visit.status === "cancelled") {
        return res.status(409).json({ error: `Visit is already ${visit.status}` });
      }

      if (role === "tech") {
        if (!visit.routeId) return res.status(403).json({ error: "Visit has no assigned route" });
        const route = await storage.getRoute(visit.routeId, companyId);
        if (!route || route.technicianId !== userId)
          return res.status(403).json({ error: "You are not assigned to this visit's route" });
      }

      const updated = await storage.updateVisit(p(req.params.id), companyId, {
        status: "in_progress",
        startedAt: new Date(),
      });

      res.json(updated);
    } catch (err) {
      handleError(res, err);
    }
  });

  const customSmsCooldowns = new Map<string, number>();
  app.post(
    "/api/visits/:id/send-custom-sms",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        const visit = await storage.getVisit(p(req.params.id), companyId);
        if (!visit) return res.status(404).json({ error: "Visit not found" });

        if (role === "tech") {
          if (!visit.routeId) return res.status(403).json({ error: "Visit has no assigned route" });
          const route = await storage.getRoute(visit.routeId, companyId);
          if (!route || route.technicianId !== userId) {
            return res.status(403).json({ error: "You are not assigned to this visit's route" });
          }
        }

        if (typeof req.body.message !== "string") {
          return res.status(400).json({ error: "Message must be a string" });
        }
        const messageBody = req.body.message.trim();
        if (!messageBody || messageBody.length > 1000) {
          return res
            .status(400)
            .json({ error: "Message is required and must be under 1000 characters" });
        }

        const cooldownKey = `${companyId}:${visit.id}`;
        const lastSent = customSmsCooldowns.get(cooldownKey);
        if (lastSent && Date.now() - lastSent < 5 * 60 * 1000) {
          const secsLeft = Math.ceil((5 * 60 * 1000 - (Date.now() - lastSent)) / 1000);
          return res.status(429).json({
            error: `Please wait ${secsLeft}s before sending another message for this visit`,
          });
        }

        const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
        if (!plan) return res.status(404).json({ error: "Service plan not found" });

        const contact = await storage.getContact(plan.contactId, companyId);
        if (!contact?.phone)
          return res.status(400).json({ error: "Customer has no phone number on file" });

        const smsReady = await isSmsConfiguredForCompany(companyId);
        if (!smsReady)
          return res.status(503).json({ error: "SMS is not configured for your company" });

        const smsResult = await sendSmsForCompany({
          to: contact.phone,
          body: messageBody,
          companyId,
          contactId: contact.id,
        });
        if (!smsResult.success)
          return res.status(500).json({ error: smsResult.error || "Failed to send SMS" });

        customSmsCooldowns.set(cooldownKey, Date.now());

        try {
          const fromPhone = await getFromPhoneForCompany(companyId);
          await storage.createMessage({
            companyId,
            contactId: contact.id,
            channel: "sms",
            direction: "outbound",
            status: "sent",
            fromAddress: fromPhone,
            toAddress: contact.phone,
            body: messageBody,
            externalId: smsResult.messageSid,
          });
        } catch (logErr) {
          console.error("Custom visit SMS message logging failed (SMS was sent):", logErr);
        }

        res.json({ sent: true, contactName: `${contact.firstName} ${contact.lastName}` });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/visits/:id/complete-notify",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        const existing = await storage.getVisit(p(req.params.id), companyId);
        if (!existing) return res.status(404).json({ error: "Visit not found" });

        if (role === "tech") {
          if (!existing.routeId) {
            return res.status(403).json({ error: "Visit has no assigned route" });
          }
          const route = await storage.getRoute(existing.routeId, companyId);
          if (!route || route.technicianId !== userId) {
            return res.status(403).json({ error: "You are not assigned to this visit's route" });
          }
        }

        if (existing.status === "completed")
          return res.json({
            visit: existing,
            completionSms: null,
            etaSms: null,
            alreadyCompleted: true,
          });
        if (existing.status !== "in_progress") {
          return res.status(400).json({
            error: `Cannot complete visit from '${existing.status}' status. Visit must be started first.`,
          });
        }

        const { gateClosedPhoto, extraPhotos, technicianNotes, noGate } = req.body;
        if (!noGate && (!gateClosedPhoto || typeof gateClosedPhoto !== "string")) {
          return res.status(400).json({ error: "gateClosedPhoto is required" });
        }
        if (extraPhotos && !Array.isArray(extraPhotos)) {
          return res.status(400).json({ error: "extraPhotos must be an array of strings" });
        }

        const visit = await storage.updateVisit(p(req.params.id), companyId, {
          status: "completed",
          completedAt: new Date(),
          completedBy: userId,
          gateClosedPhoto: gateClosedPhoto || null,
          extraPhotos: extraPhotos || null,
          proofOfServicePhoto: gateClosedPhoto || existing.proofOfServicePhoto,
          technicianNotes: technicianNotes || existing.technicianNotes,
        });

        // Mark visit photos as public so they can be served via /objects/ without auth.
        // Photos are intentionally shared with customers (portal + SMS), so public
        // visibility is the appropriate ACL policy for this object type.
        const photoPaths: string[] = [];
        if (gateClosedPhoto && typeof gateClosedPhoto === "string")
          photoPaths.push(gateClosedPhoto);
        if (Array.isArray(extraPhotos))
          photoPaths.push(...extraPhotos.filter((p: unknown) => typeof p === "string"));
        if (photoPaths.length > 0) {
          const publicAcl = { owner: userId, visibility: "public" as const };
          await Promise.allSettled(
            photoPaths.map((path) => _objStorage.trySetObjectEntityAclPolicy(path, publicAcl))
          );
        }

        const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
        if (!plan) return res.json({ visit, completionSms: null, etaSms: null });

        const contact = await storage.getContact(plan.contactId, companyId);
        const company = await storage.getCompany(companyId);
        if (!contact || !company) return res.json({ visit, completionSms: null, etaSms: null });

        if (
          contact.autoInvoiceEnabled !== false &&
          contact.invoiceTiming === "after_service" &&
          contact.invoiceFrequency === "per_service"
        ) {
          try {
            const alreadyInvoiced = await storage.isVisitInvoiced(visit.id);
            if (!alreadyInvoiced) {
              const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
              const planMap = new Map([[plan.id, plan]]);
              const lineItems = await buildVisitLineItemsWithAddOns([visit], planMap);
              const subtotal = lineItems.reduce((sum, li) => sum + parseFloat(li.total), 0);
              const autoInv = await storage.createInvoiceWithLineItems(
                {
                  companyId,
                  contactId: plan.contactId,
                  invoiceNumber,
                  dueDate: new Date().toISOString().split("T")[0],
                  subtotal: subtotal.toFixed(2),
                  tax: "0",
                  total: subtotal.toFixed(2),
                  status: "draft",
                  autoGenerated: true,
                  paymentAttempts: 0,
                },
                lineItems
              );
              await storage.updateVisit(visit.id, companyId, { invoiceId: autoInv.id });
            }
          } catch (autoErr) {
            console.error("Auto-invoice generation failed:", autoErr);
          }
        }

        notify(
          companyId,
          "visit_completed",
          "Visit Completed",
          `Visit on ${visit.scheduledDate} has been marked as completed.`,
          `/scheduling`
        );

        try {
          if (plan?.contactId) {
            await maybeFireReviewRequest(companyId, plan.contactId, visit.id);
          }
        } catch (reviewErr) {
          console.error("Review request check failed:", reviewErr);
        }

        let completionSmsResult: { success: boolean; messageSid?: string } | null = null;
        let etaSmsResult: { success: boolean; messageSid?: string } | null = null;

        const todayStr = new Date().toISOString().split("T")[0];
        const isScheduledForToday = visit.scheduledDate === todayStr;

        if (isScheduledForToday) {
          const appBaseUrl = `https://${req.get("host")}`;
          const gatePhotoFullUrl = gateClosedPhoto ? `${appBaseUrl}${gateClosedPhoto}` : undefined;

          const completionSmsReady = await isSmsConfiguredForCompany(companyId);
          if (contact.phone && completionSmsReady) {
            const completionMsg = noGate
              ? `Hi ${contact.firstName}. ${company.name} just finished your poop scoop service. Let us know if there is anything we can do.`
              : `Hi ${contact.firstName}. ${company.name} just finished your poop scoop service. Here is your gate closed image. Let us know if there is anything we can do.`;
            completionSmsResult = await sendSmsForCompany({
              to: contact.phone,
              body: completionMsg,
              mediaUrl: noGate ? undefined : gatePhotoFullUrl,
              companyId,
              contactId: contact.id,
            });

            if (completionSmsResult.success) {
              const completionFrom = await getFromPhoneForCompany(companyId);
              await storage.createMessage({
                companyId,
                contactId: contact.id,
                channel: "sms",
                direction: "outbound",
                status: "sent",
                fromAddress: completionFrom,
                toAddress: contact.phone,
                body: completionMsg,
                externalId: completionSmsResult.messageSid,
              });
            }
          }
        }

        if (isScheduledForToday && visit.routeId) {
          try {
            const allPlansOnRoute = await storage.getServicePlans(companyId, {
              routeId: visit.routeId,
              isActive: true,
            });
            const sorted = allPlansOnRoute.sort((a, b) => a.stopOrder - b.stopOrder);
            const currentIdx = sorted.findIndex((sp) => sp.id === visit.servicePlanId);

            if (currentIdx >= 0) {
              const today = new Date().toISOString().split("T")[0];
              const todayVisits = await storage.getVisits(companyId, { date: today });

              let nextPlan = null;
              let nextVisit = null;
              for (let i = currentIdx + 1; i < sorted.length; i++) {
                const candidatePlan = sorted[i];
                const candidateVisit = todayVisits.find(
                  (v) =>
                    v.servicePlanId === candidatePlan.id &&
                    (v.status === "scheduled" || v.status === "in_progress")
                );
                if (candidateVisit) {
                  nextPlan = candidatePlan;
                  nextVisit = candidateVisit;
                  break;
                }
              }

              if (nextVisit && nextPlan) {
                const nextContact = await storage.getContact(nextPlan.contactId, companyId);
                const currentProperty = await storage.getProperty(visit.propertyId, companyId);
                const nextProperty = await storage.getProperty(nextVisit.propertyId, companyId);

                const nextSmsReady = await isSmsConfiguredForCompany(companyId);
                if (nextContact?.phone && currentProperty && nextProperty && nextSmsReady) {
                  let travelMinutes = 10;

                  const curLat = currentProperty.latitude
                    ? parseFloat(currentProperty.latitude)
                    : null;
                  const curLon = currentProperty.longitude
                    ? parseFloat(currentProperty.longitude)
                    : null;
                  const nxtLat = nextProperty.latitude ? parseFloat(nextProperty.latitude) : null;
                  const nxtLon = nextProperty.longitude ? parseFloat(nextProperty.longitude) : null;

                  if (curLat && curLon && nxtLat && nxtLon) {
                    const mapbox = await fetchMapboxDirections(
                      [
                        { longitude: curLon, latitude: curLat },
                        { longitude: nxtLon, latitude: nxtLat },
                      ],
                      companyId
                    );

                    if (mapbox) {
                      travelMinutes = mapbox.duration;
                    } else {
                      const miles = haversineDistance(curLat, curLon, nxtLat, nxtLon);
                      travelMinutes = (miles / 25) * 60;
                    }
                  }

                  const roundedMinutes = Math.max(5, Math.floor(travelMinutes / 5) * 5);

                  const etaMsg = `Hi ${nextContact.firstName}, ${company.name} is on its way to your house for your poop scoop appointment. We'll be there in about ${roundedMinutes} minutes. Please ensure your yard is accessible and any dogs are inside. See you soon!`;

                  etaSmsResult = await sendSmsForCompany({
                    to: nextContact.phone,
                    body: etaMsg,
                    companyId,
                    contactId: nextContact.id,
                  });

                  if (etaSmsResult.success) {
                    const etaFrom = await getFromPhoneForCompany(companyId);
                    await storage.createMessage({
                      companyId,
                      contactId: nextContact.id,
                      channel: "sms",
                      direction: "outbound",
                      status: "sent",
                      fromAddress: etaFrom,
                      toAddress: nextContact.phone,
                      body: etaMsg,
                      externalId: etaSmsResult.messageSid,
                    });
                  }
                }
              }
            }
          } catch (etaErr) {
            console.error("ETA notification failed:", etaErr);
          }
        }

        res.json({
          visit,
          completionSms: completionSmsResult,
          etaSms: etaSmsResult,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/visits/generate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required" });
      }

      const allPlans = await storage.getServicePlans(companyId, { isActive: true });
      const plans = allPlans.filter((p) => !p.pausedAt);
      const existingVisits = await storage.getVisitsForDateRange(companyId, startDate, endDate);
      const existingKeys = new Set(
        existingVisits.map((v) => `${v.servicePlanId}_${v.scheduledDate}`)
      );

      const planIds = plans.map((p) => p.id);
      const allHolds = await storage.getVacationHoldsForPlans(planIds);
      const holdsByPlan = new Map<string, typeof allHolds>();
      for (const hold of allHolds) {
        const existing = holdsByPlan.get(hold.servicePlanId) || [];
        existing.push(hold);
        holdsByPlan.set(hold.servicePlanId, existing);
      }

      const dayMap: Record<string, number> = {
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
        sunday: 0,
      };

      const created: unknown[] = [];
      const start = new Date(startDate + "T00:00:00Z");
      const end = new Date(endDate + "T00:00:00Z");

      for (const plan of plans) {
        // Semi-monthly: two visits per calendar month on operator-specified days
        // of the month. Driven by day-of-month, not day-of-week, so it is handled
        // separately and does not require a dayOfWeek.
        if (plan.frequency === "semi_monthly") {
          const planStart = plan.startDate ? new Date(plan.startDate + "T00:00:00Z") : start;
          const planEnd = plan.endDate ? new Date(plan.endDate + "T00:00:00Z") : end;
          const effectiveStart = planStart > start ? planStart : start;
          const effectiveEnd = planEnd < end ? planEnd : end;
          const planHolds = holdsByPlan.get(plan.id) || [];
          const day1 = plan.semiMonthlyDay1 ?? 1;
          const day2 = plan.semiMonthlyDay2 ?? 15;

          const semiMonthlyDates = computeSemiMonthlyVisitDates(
            effectiveStart,
            effectiveEnd,
            day1,
            day2
          );
          for (const dateStr of semiMonthlyDates) {
            const key = `${plan.id}_${dateStr}`;
            const inVacation = planHolds.some((h) => dateStr >= h.startDate && dateStr <= h.endDate);
            if (existingKeys.has(key) || inVacation) continue;

            const visit = await storage.createVisit({
              companyId,
              servicePlanId: plan.id,
              propertyId: plan.propertyId,
              routeId: plan.routeId || null,
              scheduledDate: dateStr,
              status: "scheduled",
            });
            if (visit) created.push(visit);
            existingKeys.add(key);
          }
          continue;
        }

        if (!plan.dayOfWeek) continue;
        const targetDay = dayMap[plan.dayOfWeek];
        if (targetDay === undefined) continue;

        const planStart = plan.startDate ? new Date(plan.startDate + "T00:00:00Z") : start;
        const planEnd = plan.endDate ? new Date(plan.endDate + "T00:00:00Z") : end;
        const effectiveStart = planStart > start ? planStart : start;
        const effectiveEnd = planEnd < end ? planEnd : end;

        const planHolds = holdsByPlan.get(plan.id) || [];

        const current = new Date(effectiveStart);
        while (current <= effectiveEnd) {
          if (current.getUTCDay() === targetDay) {
            const dateStr = current.toISOString().split("T")[0];
            const key = `${plan.id}_${dateStr}`;

            const inVacation = planHolds.some(
              (h) => dateStr >= h.startDate && dateStr <= h.endDate
            );

            if (!existingKeys.has(key) && !inVacation) {
              let shouldGenerate = true;

              if (plan.frequency === "biweekly") {
                const planStartDate = new Date(plan.startDate + "T00:00:00Z");
                const diffMs = current.getTime() - planStartDate.getTime();
                const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
                const diffWeeks = Math.floor(diffDays / 7);
                if (diffWeeks % 2 !== 0) shouldGenerate = false;
              } else if (plan.frequency === "monthly") {
                const planStartDate = new Date(plan.startDate + "T00:00:00Z");
                if (
                  current.getUTCMonth() === planStartDate.getUTCMonth() &&
                  current.getUTCFullYear() === planStartDate.getUTCFullYear()
                ) {
                  shouldGenerate = true;
                } else {
                  const firstOfMonth = new Date(
                    Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1)
                  );
                  let firstTargetDay = new Date(firstOfMonth);
                  while (firstTargetDay.getUTCDay() !== targetDay) {
                    firstTargetDay.setUTCDate(firstTargetDay.getUTCDate() + 1);
                  }
                  if (current.getTime() !== firstTargetDay.getTime()) shouldGenerate = false;
                }
              } else if (plan.frequency === "onetime") {
                if (dateStr !== plan.startDate) {
                  shouldGenerate = false;
                }
              }

              if (shouldGenerate) {
                const visit = await storage.createVisit({
                  companyId,
                  servicePlanId: plan.id,
                  propertyId: plan.propertyId,
                  routeId: plan.routeId || null,
                  scheduledDate: dateStr,
                  status: "scheduled",
                });
                if (visit) created.push(visit);
                existingKeys.add(key);
              }
            }

            if (plan.frequency === "weekly" || plan.frequency === "biweekly") {
              current.setUTCDate(current.getUTCDate() + 7);
              continue;
            }
          }
          current.setUTCDate(current.getUTCDate() + 1);
        }
      }

      res.json({ generated: created.length, visits: created });
    } catch (err) {
      handleError(res, err);
    }
  });
}

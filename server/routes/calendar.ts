import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { contacts, properties, routes, servicePlans } from "@shared/schema";
import { isAuthenticated, getCompanyContext, getBaseUrl, handleError } from "./shared";
import { generateIcsForCompany, type CalendarVisit } from "../services/calendar";

function buildFeedUrl(req: Request, token: string): string {
  const appUrl = process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEPLOYMENT_URL
      ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
      : process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : getBaseUrl(req);
  return `${appUrl}/api/calendar/${token}/feed.ics`;
}

export async function registerCalendarRoutes(app: Express): Promise<void> {
  // ── Public feed endpoint — no auth required ───────────────────────────────
  app.get("/api/calendar/:token/feed.ics", async (req: Request, res: Response) => {
    try {
      const rawToken = req.params.token;
      const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
      if (!token || token.length < 10) {
        return res.status(400).type("text/plain").send("Invalid calendar token");
      }

      const company = await storage.getCompanyByCalendarToken(token);

      if (!company) {
        return res.status(404).type("text/plain").send("Calendar not found");
      }

      const today = new Date();
      const pastDate = new Date(today);
      pastDate.setDate(pastDate.getDate() - 30);
      const futureDate = new Date(today);
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const formatDate = (d: Date) => d.toISOString().slice(0, 10);
      const rawVisits = await storage.getVisitsForDateRange(
        company.id,
        formatDate(pastDate),
        formatDate(futureDate)
      );

      // Filter only scheduled/in-progress visits
      const activeVisits = rawVisits.filter((v) => ["scheduled", "in_progress"].includes(v.status));

      if (activeVisits.length === 0) {
        const emptyCompany = {
          id: company.id,
          name: company.name,
          timezone: company.timezone,
          calendarFeedMode: (company.calendarFeedMode as "summary" | "detailed") ?? "summary",
        };
        const ics = generateIcsForCompany(emptyCompany, []);
        res.setHeader("Content-Type", "text/calendar; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="scoopilot-calendar.ics"`);
        return res.send(ics);
      }

      // Fetch all related data in parallel
      const propertyIds = [...new Set(activeVisits.map((v) => v.propertyId).filter(Boolean))];
      const routeIds = [...new Set(activeVisits.map((v) => v.routeId).filter(Boolean))] as string[];

      const [allProperties, allRoutes, allServicePlans] = await Promise.all([
        propertyIds.length > 0
          ? db.select().from(properties).where(eq(properties.companyId, company.id))
          : Promise.resolve([]),
        routeIds.length > 0
          ? db.select().from(routes).where(eq(routes.companyId, company.id))
          : Promise.resolve([]),
        db
          .select({ id: servicePlans.id, stopOrder: servicePlans.stopOrder })
          .from(servicePlans)
          .where(eq(servicePlans.companyId, company.id)),
      ]);

      const contactIds = [
        ...new Set(allProperties.map((p) => p.contactId).filter(Boolean)),
      ] as string[];

      const allContacts =
        contactIds.length > 0
          ? await db
              .select({
                id: contacts.id,
                firstName: contacts.firstName,
                lastName: contacts.lastName,
              })
              .from(contacts)
              .where(eq(contacts.companyId, company.id))
          : [];

      const propertyMap = new Map(allProperties.map((p) => [p.id, p]));
      const routeMap = new Map(allRoutes.map((r) => [r.id, r]));
      const contactMap = new Map(allContacts.map((c) => [c.id, c]));
      const spStopOrderMap = new Map(allServicePlans.map((sp) => [sp.id, sp.stopOrder]));

      const enrichedVisits: CalendarVisit[] = activeVisits.map((v) => {
        const prop = v.propertyId ? propertyMap.get(v.propertyId) : undefined;
        const contact = prop ? contactMap.get(prop.contactId) : undefined;
        const route = v.routeId ? routeMap.get(v.routeId) : undefined;
        return {
          id: v.id,
          scheduledDate: v.scheduledDate,
          routeId: v.routeId ?? null,
          propertyId: v.propertyId,
          servicePlanId: v.servicePlanId,
          stopOrder: spStopOrderMap.get(v.servicePlanId) ?? null,
          timeWindowType: v.timeWindowType,
          scheduledTimeStart: v.scheduledTimeStart ?? null,
          scheduledTimeEnd: v.scheduledTimeEnd ?? null,
          property: prop
            ? {
                id: prop.id,
                streetAddress: prop.streetAddress,
                city: prop.city,
                state: prop.state,
                contactId: prop.contactId,
                numberOfDogs: prop.numberOfDogs ?? null,
                yardSize: prop.yardSize ?? null,
                gateCode: prop.gateCode ?? null,
                specialInstructions: prop.specialInstructions ?? null,
              }
            : null,
          contact: contact
            ? { id: contact.id, firstName: contact.firstName, lastName: contact.lastName }
            : null,
          route: route ? { id: route.id, name: route.name, date: route.date ?? null } : null,
        };
      });

      const calCompany = {
        id: company.id,
        name: company.name,
        timezone: company.timezone,
        calendarFeedMode: (company.calendarFeedMode as "summary" | "detailed") ?? "summary",
      };

      const ics = generateIcsForCompany(calCompany, enrichedVisits);
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="scoopilot-calendar.ics"`);
      return res.send(ics);
    } catch (err) {
      console.error("[Calendar] feed error:", err);
      return res.status(500).type("text/plain").send("Calendar generation failed");
    }
  });

  // ── Authenticated management endpoints ────────────────────────────────────

  app.get("/api/calendar/token", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      let token = company.calendarToken;
      if (!token) {
        token = crypto.randomUUID();
        await storage.updateCompany(companyId, { calendarToken: token });
      }

      const feedUrl = buildFeedUrl(req, token);
      return res.json({
        token,
        feed_url: feedUrl,
        feed_mode: company.calendarFeedMode ?? "summary",
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/calendar/regenerate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const newToken = crypto.randomUUID();
      await storage.updateCompany(companyId, { calendarToken: newToken });
      const feedUrl = buildFeedUrl(req, newToken);
      return res.json({ feed_url: feedUrl, token: newToken });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/calendar/settings", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { feed_mode } = req.body;
      if (!feed_mode || !["summary", "detailed"].includes(feed_mode)) {
        return res.status(400).json({ error: "feed_mode must be 'summary' or 'detailed'" });
      }
      await storage.updateCompany(companyId, {
        calendarFeedMode: feed_mode as "summary" | "detailed",
      });
      return res.json({ feed_mode });
    } catch (err) {
      handleError(res, err);
    }
  });
}

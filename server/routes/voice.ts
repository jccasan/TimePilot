import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { registerRetellWebhook, getRetellAgentWebhookUrl, getAppBaseUrl } from "../services/retell";
import { insertWebhookSchema, type Contact } from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  handleError,
  auditLog,
  p,
  notify,
  createPropertyWithGeocode,
  suggestServiceDay,
} from "./shared";

export async function registerVoiceRoutes(app: Express): Promise<void> {
  // ================ Retell AI Voice Agent Routes ================

  function verifyRetellApiKey(req: Request, res: Response): boolean {
    const apiKey = req.headers["x-retell-api-key"] || req.query.api_key;
    const expected = process.env.RETELL_API_KEY;
    if (!expected) {
      res.status(503).json({ error: "Retell API key not configured" });
      return false;
    }
    if (apiKey !== expected) {
      res.status(401).json({ error: "Invalid API key" });
      return false;
    }
    return true;
  }

  app.get("/api/retell/tenant-profile", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const to = req.query.to as string;
      if (!to) {
        return res.status(400).json({ error: "Missing 'to' query parameter (phone number)" });
      }

      const company = await storage.getCompanyByPhone(to);
      if (!company) {
        return res.status(404).json({ error: "Tenant not found for this phone number" });
      }

      const servicePricingItems = await storage.getServicePricing(company.id);
      const packages = await storage.getServicePackages(company.id);
      const serviceZones = await storage.getServiceZones(company.id);

      const pricingSummary =
        company.voiceAgentPricingSummary ||
        servicePricingItems
          .filter((sp) => sp.isActive)
          .map((sp) => `${sp.name}: $${sp.basePrice}/${sp.unit.replace("per_", "")}`)
          .join("; ") ||
        "Contact us for pricing";

      const packagesSummary = packages
        .filter((p) => p.isActive)
        .map((p) => `${p.name} (${p.frequency}): $${p.basePrice}`)
        .join("; ");

      const zipRouting: Record<string, string[]> = {};
      for (const zone of serviceZones.filter((z) => z.isActive)) {
        if (!zipRouting[zone.zipCode]) zipRouting[zone.zipCode] = [];
        const dayLabel = zone.dayOfWeek.charAt(0).toUpperCase() + zone.dayOfWeek.slice(1);
        if (!zipRouting[zone.zipCode].includes(dayLabel)) {
          zipRouting[zone.zipCode].push(dayLabel);
        }
      }

      const policiesRaw = company.voiceAgentPolicies || "";
      const policies = policiesRaw
        ? policiesRaw
            .split(/\n+/)
            .map((l) => l.trim())
            .filter(Boolean)
        : [];

      res.json({
        tenantId: company.id,
        businessName: company.name,
        businessPhone: company.phone,
        businessEmail: company.email,
        serviceArea: company.voiceAgentServiceArea || company.address || "",
        zipRouting,
        pricingSummary,
        packages: packagesSummary || undefined,
        policies,
        specialLines: company.voiceAgentSpecialLines || "",
        greeting:
          company.voiceAgentGreeting ||
          `Thank you for calling ${company.name}! How can I help you today?`,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/retell/create-lead", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const {
        tenantId,
        firstName,
        lastName,
        email,
        phone,
        street,
        city,
        state,
        zipCode,
        notes,
        numberOfDogs,
      } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
      if (!firstName) return res.status(400).json({ error: "firstName is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      const contact = await storage.createContact({
        companyId: tenantId,
        firstName,
        lastName: lastName || "",
        email: email || null,
        phone: phone || null,
        status: "lead",
        leadSource: "voice_agent",
        notes: notes || null,
      });

      if (street) {
        await createPropertyWithGeocode({
          companyId: tenantId,
          contactId: contact.id,
          streetAddress: street,
          city: city || null,
          state: state || null,
          zipCode: zipCode || null,
          numberOfDogs: numberOfDogs ? parseInt(numberOfDogs) : null,
        });
      }

      notify(
        tenantId,
        "new_lead",
        "New Lead (Voice Agent)",
        `${firstName} ${lastName || ""} called in and was added as a new lead.`.trim(),
        `/contacts/${contact.id}`
      );

      res.status(201).json({
        success: true,
        contactId: contact.id,
        message: `Lead created: ${firstName} ${lastName || ""}`.trim(),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/retell/lookup-customer", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const { tenantId, phone, email } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
      if (!phone && !email) return res.status(400).json({ error: "phone or email is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      const allContacts = await storage.getContacts(tenantId);
      let match = null;

      if (phone) {
        const digits = phone.replace(/\D/g, "");
        match = allContacts.find((c) => {
          const cDigits = (c.phone || "").replace(/\D/g, "");
          return cDigits.length >= 10 && digits.length >= 10 && digits.endsWith(cDigits.slice(-10));
        });
      }
      if (!match && email) {
        match = allContacts.find((c) => c.email?.toLowerCase() === email.toLowerCase());
      }

      if (!match) {
        return res.json({ found: false });
      }

      const properties = await storage.getProperties(tenantId, match.id);
      const servicePlans = await storage.getServicePlans(tenantId, {
        contactId: match.id,
        isActive: true,
      });

      res.json({
        found: true,
        customer: {
          id: match.id,
          firstName: match.firstName,
          lastName: match.lastName,
          email: match.email,
          phone: match.phone,
          status: match.status,
          properties: properties.map((p) => ({
            address: p.streetAddress,
            city: p.city,
            numberOfDogs: p.numberOfDogs,
          })),
          servicePlans: servicePlans.map((sp) => ({
            frequency: sp.frequency,
            dayOfWeek: sp.dayOfWeek,
            price: sp.pricePerVisit,
            isActive: sp.isActive,
          })),
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/retell/log-call", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const { tenantId, contactId, callerPhone, summary, duration, outcome } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      if (contactId) {
        const contact = await storage.getContact(tenantId, contactId);
        if (!contact) return res.status(404).json({ error: "Contact not found in this tenant" });

        await storage.createMessage({
          companyId: tenantId,
          contactId,
          channel: "sms",
          direction: "inbound",
          status: "received",
          fromAddress: callerPhone || "voice_agent",
          toAddress: company.phone || "",
          body: `[Voice Agent Call] ${summary || "No summary"} | Duration: ${duration || "unknown"} | Outcome: ${outcome || "unknown"}`,
        });
      }

      notify(
        tenantId,
        "new_message",
        "Voice Agent Call",
        `Call ${outcome || "completed"}: ${summary || "No summary provided"}`,
        contactId ? `/contacts/${contactId}` : undefined
      );

      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/retell/create-booking", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const {
        tenantId,
        callerName,
        phone,
        email,
        address,
        zip,
        dogs,
        yardSize,
        fenced,
        serviceType,
        frequency,
        preferredDayOfWeek,
        accessNotes,
        specialInstructions,
      } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
      if (!callerName) return res.status(400).json({ error: "callerName is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      const nameParts = callerName.trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || "";

      let contact: Contact | undefined = undefined;
      if (phone || email) {
        const allContacts = await storage.getContacts(tenantId);
        if (phone) {
          const digits = phone.replace(/\D/g, "");
          contact = allContacts.find((c) => {
            const cDigits = (c.phone || "").replace(/\D/g, "");
            return (
              cDigits.length >= 10 && digits.length >= 10 && digits.endsWith(cDigits.slice(-10))
            );
          });
        }
        if (!contact && email) {
          contact = allContacts.find((c) => c.email?.toLowerCase() === email.toLowerCase());
        }
      }

      if (!contact) {
        contact = await storage.createContact({
          companyId: tenantId,
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          status: "lead",
          leadSource: "voice_agent",
          notes: null,
        });
      }

      const bookingNotes = [
        serviceType ? `Service: ${serviceType}` : null,
        frequency ? `Frequency: ${frequency}` : null,
        preferredDayOfWeek ? `Preferred day: ${preferredDayOfWeek}` : null,
        fenced != null ? `Fenced: ${fenced}` : null,
        accessNotes ? `Access: ${accessNotes}` : null,
        specialInstructions ? `Instructions: ${specialInstructions}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      let property = null;
      if (address) {
        property = await createPropertyWithGeocode({
          companyId: tenantId,
          contactId: contact.id,
          streetAddress: address,
          zipCode: zip || null,
          numberOfDogs: dogs ? parseInt(dogs) : null,
          yardSize: yardSize || null,
          specialInstructions: bookingNotes || null,
        });
      }

      await storage.createMessage({
        companyId: tenantId,
        contactId: contact.id,
        channel: "sms",
        direction: "inbound",
        status: "received",
        fromAddress: phone || "voice_agent",
        toAddress: company.phone || "",
        body: `[Voice Agent Booking] ${callerName} requested a booking.\n${bookingNotes}`,
      });

      notify(
        tenantId,
        "new_lead",
        "New Booking Request (Voice Agent)",
        `${callerName} requested a booking via voice agent. Status: pending confirmation.`,
        `/contacts/${contact.id}`
      );

      res.json({
        status: "received",
        contactId: contact.id,
        propertyId: property?.id || null,
        message: "Booking request recorded; team will confirm by email.",
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/retell/suggest-day", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const { tenantId, lat, lng, zipCode, address } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      let resolvedLat: number | null = lat ? parseFloat(lat) : null;
      let resolvedLng: number | null = lng ? parseFloat(lng) : null;

      // If no coordinates, geocode from address or zip using Mapbox
      if ((!resolvedLat || !resolvedLng) && (address || zipCode)) {
        const query = address || zipCode;
        const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
        if (token && query) {
          try {
            const params = new URLSearchParams({
              q: query,
              access_token: token,
              types: "address,postcode",
              limit: "1",
            });
            const geoRes = await fetch(
              `https://api.mapbox.com/search/geocode/v6/forward?${params}`
            );
            if (geoRes.ok) {
              const geoData = await geoRes.json();
              const coords = geoData.features?.[0]?.geometry?.coordinates;
              if (coords) {
                resolvedLng = coords[0];
                resolvedLat = coords[1];
              }
            }
          } catch {
            /* ignore geocode failure, fall through to fallback */
          }
        }
      }

      if (!resolvedLat || !resolvedLng) {
        return res.status(400).json({
          error: "Could not determine coordinates. Provide lat/lng or a valid address/zipCode.",
        });
      }

      const result = await suggestServiceDay(tenantId, resolvedLat, resolvedLng);
      if (!result) return res.json({ suggestedDay: null, message: "No routes configured yet." });

      const dayLabel = result.day.charAt(0).toUpperCase() + result.day.slice(1);
      const distanceMi = result.distanceKm > 0 ? (result.distanceKm * 0.621371).toFixed(1) : null;

      res.json({
        suggestedDay: dayLabel,
        routeName: result.routeName,
        distanceMiles: distanceMi ? parseFloat(distanceMi) : null,
        message: distanceMi
          ? `Based on your location, ${dayLabel} works best — our nearest stop is about ${distanceMi} miles away.`
          : `Based on your location, ${dayLabel} is recommended.`,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Retell Webhook Status (Settings) ================

  app.get(
    "/api/settings/retell-webhook-status",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);

        const retellApiKey = process.env.RETELL_API_KEY;
        if (!retellApiKey) {
          return res.json({ configured: false, reason: "RETELL_API_KEY not set" });
        }

        const company = await storage.getCompany(companyId);
        const agentId = company?.retellAgentId || process.env.RETELL_AGENT_ID || null;
        if (!agentId) {
          return res.json({
            configured: false,
            reason: "No Retell agent ID configured for this account",
          });
        }

        const expectedUrl = getAppBaseUrl() ? `${getAppBaseUrl()}/api/webhooks/retell` : null;

        const agentRes = await fetch(`https://api.retellai.com/get-agent/${agentId}`, {
          headers: {
            Authorization: `Bearer ${retellApiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!agentRes.ok) {
          const body = await agentRes.text();
          return res.json({
            configured: true,
            agentId,
            registered: false,
            reason: `Retell API error (${agentRes.status}): ${body}`,
            expectedUrl,
            currentUrl: null,
          });
        }

        const agentData = (await agentRes.json()) as { webhook_url?: string };
        const currentUrl: string | null = agentData.webhook_url || null;
        const registered = !!currentUrl && !!expectedUrl && currentUrl === expectedUrl;

        res.json({ configured: true, agentId, registered, currentUrl, expectedUrl });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/settings/retell-register-webhook",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);

        const retellApiKey = process.env.RETELL_API_KEY;
        if (!retellApiKey) {
          return res.status(400).json({ error: "RETELL_API_KEY not configured" });
        }

        const company = await storage.getCompany(companyId);
        const agentId = company?.retellAgentId || process.env.RETELL_AGENT_ID || null;
        if (!agentId) {
          return res.status(400).json({ error: "No Retell agent ID configured for this account" });
        }

        let oldUrl: string | null = null;
        try {
          oldUrl = await getRetellAgentWebhookUrl(agentId);
        } catch (fetchErr) {
          console.warn(
            `[retell-register-webhook] Could not fetch current webhook URL for agent ${agentId}:`,
            fetchErr instanceof Error ? fetchErr.message : fetchErr
          );
        }

        await registerRetellWebhook(agentId);
        const { userId } = await getCompanyContext(req);
        const baseUrl = getAppBaseUrl();
        const newUrl = `${baseUrl}/api/webhooks/retell`;

        await storage.createRetellWebhookRepair({
          companyId,
          agentId,
          oldUrl: oldUrl ?? undefined,
          newUrl,
          triggeredBy: "manual",
        });
        auditLog(
          companyId,
          userId,
          "settings",
          companyId,
          "update",
          { new: { retellWebhook: newUrl } },
          req.ip || undefined
        );

        res.json({ success: true, webhookUrl: newUrl });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/settings/retell-webhook-repairs",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const repairs = await storage.listRetellWebhookRepairs(companyId, 50);
        res.json(repairs);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Voice Agent Config & AI Endpoints ================

  app.get("/api/voice/config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      res.json({
        voiceAreaCodePreference: company.voiceAreaCodePreference || null,
        voiceNumberPortingStatus: company.voiceNumberPortingStatus || null,
        dedicatedPhoneNumber: company.dedicatedPhoneNumber || null,
        portingPhoneNumber: company.portingPhoneNumber || null,
        websiteUrl: (company as Record<string, unknown>).websiteUrl || null,
        voiceAgentGreeting: company.voiceAgentGreeting || null,
        voiceAgentPricingSummary: company.voiceAgentPricingSummary || null,
        voiceAgentServiceArea: company.voiceAgentServiceArea || null,
        voiceAgentPolicies: company.voiceAgentPolicies || null,
        voiceAgentSpecialLines: company.voiceAgentSpecialLines || null,
        retellAgentId: company.retellAgentId || null,
        retellKnowledgeBaseId: company.retellKnowledgeBaseId || null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/voice/config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);

      const allowed = [
        "voiceAreaCodePreference",
        "websiteUrl",
        "voiceAgentGreeting",
        "voiceAgentPricingSummary",
        "voiceAgentServiceArea",
        "voiceAgentPolicies",
        "voiceAgentSpecialLines",
      ] as const;

      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (key in req.body) {
          updates[key] = req.body[key] ?? null;
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      // Server-side validation for sensitive fields
      if (
        updates.voiceAreaCodePreference !== null &&
        updates.voiceAreaCodePreference !== undefined
      ) {
        const ac = String(updates.voiceAreaCodePreference);
        if (!/^\d{3}$/.test(ac)) {
          return res
            .status(400)
            .json({ error: "voiceAreaCodePreference must be exactly 3 digits (e.g. 206)" });
        }
      }
      if (updates.websiteUrl !== null && updates.websiteUrl !== undefined) {
        try {
          const u = new URL(String(updates.websiteUrl));
          if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol");
        } catch {
          return res.status(400).json({ error: "websiteUrl must be a valid HTTP or HTTPS URL" });
        }
      }

      const updated = await storage.updateCompany(
        companyId,
        updates as Parameters<typeof storage.updateCompany>[1]
      );
      auditLog(
        companyId,
        userId,
        "settings",
        companyId,
        "update",
        { new: updates },
        req.ip || undefined
      );

      res.json({ success: true, company: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/generate-docs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!company.voicePlanStatus || company.voicePlanStatus !== "active") {
        return res.status(403).json({ error: "Voice plan not active" });
      }

      const servicePricingItems = await storage.getServicePricing(companyId);
      const serviceZones = await storage.getServiceZones(companyId);

      const pricingLines = servicePricingItems
        .filter((sp) => sp.isActive)
        .map((sp) => `${sp.name}: $${sp.basePrice}/${sp.unit.replace("per_", "")}`)
        .join("; ");

      const serviceAreaZips = [
        ...new Set(serviceZones.filter((z) => z.isActive).map((z) => z.zipCode)),
      ].join(", ");

      const contextData = {
        companyName: company.name,
        businessEmail: company.email,
        businessPhone: company.phone,
        businessAddress: company.address,
        websiteUrl: (company as Record<string, unknown>).websiteUrl,
        businessDescription: (company as Record<string, unknown>).businessDescription,
        serviceAreaDescription: (company as Record<string, unknown>).serviceAreaDescription,
        serviceAreaZips,
        pricingLines,
        existingGreeting: company.voiceAgentGreeting,
        existingPolicies: company.voiceAgentPolicies,
        existingServiceArea: company.voiceAgentServiceArea,
      };

      const { openai } = await import("../replit_integrations/audio/client");

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a professional business assistant helping configure an AI voice receptionist for a pet waste removal company. Generate natural, professional content for the agent. Return ONLY valid JSON with these fields: greeting (string, warm phone greeting under 50 words), pricingSummary (string, clear pricing overview for callers, under 100 words), serviceArea (string, service area description for callers, under 60 words), policies (string, key business policies the agent should know, under 150 words, newline-separated). All content should be conversational and friendly.`,
          },
          {
            role: "user",
            content: `Generate voice agent content for: ${JSON.stringify(contextData)}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 600,
      });

      const raw = completion.choices[0]?.message?.content || "{}";
      let generated: Record<string, string>;
      try {
        generated = JSON.parse(raw);
      } catch {
        generated = {};
      }

      res.json({
        success: true,
        greeting:
          generated.greeting || `Thank you for calling ${company.name}! How can I help you today?`,
        pricingSummary:
          generated.pricingSummary || pricingLines || "Contact us for pricing information.",
        serviceArea: generated.serviceArea || serviceAreaZips || "We serve your local area.",
        policies: generated.policies || "We're here to help. Please call during business hours.",
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/upload-document", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!company.voicePlanStatus || company.voicePlanStatus !== "active") {
        return res.status(403).json({ error: "Voice plan not active" });
      }

      const retellApiKey = process.env.RETELL_API_KEY;
      if (!retellApiKey) return res.status(400).json({ error: "RETELL_API_KEY not configured" });

      const kbId = company.retellKnowledgeBaseId;
      if (!kbId) {
        return res.status(400).json({
          error:
            "No knowledge base configured for this agent. Run 'Push to Agent' first to create one.",
        });
      }

      const multer = (await import("multer")).default;
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          const allowed = [
            "application/pdf",
            "text/plain",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ];
          if (allowed.includes(file.mimetype) || file.originalname.match(/\.(pdf|txt|docx)$/i)) {
            cb(null, true);
          } else {
            cb(new Error("Only PDF, TXT, and DOCX files are supported"));
          }
        },
      }).single("file");

      await new Promise<void>((resolve, reject) => {
        upload(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      // Step 1: Persist file to object storage (.private) for tenant record-keeping
      let objectPath: string | null = null;
      try {
        const { ObjectStorageService } =
          await import("../replit_integrations/object_storage/objectStorage");
        const oss = new ObjectStorageService();
        const uploadURL = await oss.getObjectEntityUploadURL();
        objectPath = oss.normalizeObjectEntityPath(uploadURL);
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: file.buffer,
          headers: { "Content-Type": file.mimetype || "application/octet-stream" },
        });
        if (!putRes.ok) {
          console.warn(
            `[voice/upload-doc] Object storage PUT failed (${putRes.status}) — continuing`
          );
          objectPath = null;
        }
      } catch (storageErr) {
        console.warn("[voice/upload-doc] Object storage unavailable — continuing:", storageErr);
      }

      // Step 2: Push file to Retell knowledge base
      const formData = new FormData();
      const blob = new Blob([file.buffer], { type: file.mimetype });
      formData.append("file", blob, file.originalname);
      formData.append("knowledge_base_id", kbId);

      const uploadRes = await fetch("https://api.retellai.com/upload-knowledge-base-file", {
        method: "POST",
        headers: { Authorization: `Bearer ${retellApiKey}` },
        body: formData,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error(`[Retell KB upload] Failed (${uploadRes.status}): ${errText}`);
        return res.status(502).json({
          error: `Failed to upload document to knowledge base: ${uploadRes.statusText}`,
        });
      }

      res.json({
        success: true,
        message: `"${file.originalname}" uploaded to the knowledge base.`,
        objectPath,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/sync-agent", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!company.voicePlanStatus || company.voicePlanStatus !== "active") {
        return res.status(403).json({ error: "Voice plan not active" });
      }

      const retellApiKey = process.env.RETELL_API_KEY;
      if (!retellApiKey) return res.status(400).json({ error: "RETELL_API_KEY not configured" });

      const agentId = company.retellAgentId || process.env.RETELL_AGENT_ID || null;
      if (!agentId) return res.status(400).json({ error: "No Retell agent ID configured" });

      const results: string[] = [];

      const websiteUrl = (company as Record<string, unknown>).websiteUrl as string | null;

      if (!company.dedicatedPhoneNumber && !company.portingPhoneNumber) {
        try {
          const { provisionRetellNumber } = await import("../services/retell");
          const areaCode =
            company.voiceAreaCodePreference ||
            (company.phone ? company.phone.replace(/\D/g, "").slice(0, 3) : "703");
          const phoneNumber = await provisionRetellNumber({ areaCode, agentId });
          await storage.updateCompany(companyId, {
            dedicatedPhoneNumber: phoneNumber,
          } as Parameters<typeof storage.updateCompany>[1]);
          results.push(`Provisioned phone number: ${phoneNumber}`);
        } catch (phoneErr) {
          console.warn("[voice/sync-agent] Phone provisioning failed:", phoneErr);
          results.push("Phone provisioning skipped (will retry next sync)");
        }
      }

      if (websiteUrl && !company.retellKnowledgeBaseId) {
        try {
          const { seedRetellKnowledgeBase } = await import("../services/retell");
          const kbId = await seedRetellKnowledgeBase({
            tenantId: companyId,
            agentId,
            websiteUrl,
          });
          await storage.updateCompany(companyId, { retellKnowledgeBaseId: kbId } as Parameters<
            typeof storage.updateCompany
          >[1]);
          results.push("Knowledge base created from website");
        } catch (kbErr) {
          console.warn("[voice/sync-agent] KB creation failed:", kbErr);
          results.push("Knowledge base creation failed — check website URL and retry");
        }
      } else if (websiteUrl && company.retellKnowledgeBaseId) {
        try {
          const patchRes = await fetch(
            `https://api.retellai.com/update-knowledge-base/${company.retellKnowledgeBaseId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${retellApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ knowledge_base_urls: [websiteUrl] }),
            }
          );
          if (patchRes.ok) results.push("Knowledge base URL refreshed");
          else results.push("Knowledge base URL update skipped");
        } catch {
          results.push("Knowledge base URL refresh skipped");
        }
      }

      const promptSections: string[] = [];
      if (company.voiceAgentGreeting) {
        promptSections.push(`GREETING:\n${company.voiceAgentGreeting}`);
      }
      if (company.voiceAgentPricingSummary) {
        promptSections.push(`PRICING:\n${company.voiceAgentPricingSummary}`);
      }
      if (company.voiceAgentServiceArea) {
        promptSections.push(`SERVICE AREA:\n${company.voiceAgentServiceArea}`);
      }
      if (company.voiceAgentPolicies) {
        promptSections.push(`POLICIES:\n${company.voiceAgentPolicies}`);
      }
      if (company.voiceAgentSpecialLines) {
        promptSections.push(`SPECIAL INSTRUCTIONS:\n${company.voiceAgentSpecialLines}`);
      }

      if (promptSections.length > 0) {
        const agentPrompt = `You are an AI phone receptionist for ${company.name}, a pet waste removal service.\n\n${promptSections.join("\n\n")}`;
        try {
          const patchRes = await fetch(`https://api.retellai.com/update-agent/${agentId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${retellApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ agent_prompt: agentPrompt }),
          });
          if (patchRes.ok) results.push("Agent prompt updated with all configured fields");
          else results.push("Agent prompt update skipped (Retell API error)");
        } catch {
          results.push("Agent prompt update skipped");
        }
      }

      try {
        await registerRetellWebhook(agentId);
        results.push("Webhook registered");
      } catch (whErr) {
        console.warn("[voice/sync-agent] Webhook registration failed:", whErr);
        results.push("Webhook registration failed — try Re-register Webhook manually");
      }

      auditLog(
        companyId,
        userId,
        "settings",
        companyId,
        "update",
        { new: { voiceAgentSync: true } },
        req.ip || undefined
      );
      const freshCompany = await storage.getCompany(companyId);

      res.json({
        success: true,
        results,
        dedicatedPhoneNumber: freshCompany?.dedicatedPhoneNumber || null,
        retellKnowledgeBaseId: freshCompany?.retellKnowledgeBaseId || null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Voice Agent Webhook Status (voice-plan-gated) ================

  app.get("/api/voice/webhook-status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);

      const company = await storage.getCompany(companyId);
      if (!company?.voicePlanStatus || company.voicePlanStatus !== "active") {
        return res.status(403).json({ error: "Voice plan not active" });
      }

      const retellApiKey = process.env.RETELL_API_KEY;
      if (!retellApiKey) {
        return res.json({ configured: false, reason: "RETELL_API_KEY not set" });
      }

      const agentId = company.retellAgentId || process.env.RETELL_AGENT_ID || null;
      if (!agentId) {
        return res.json({
          configured: false,
          reason: "No Retell agent ID configured for this account",
        });
      }

      const expectedUrl = getAppBaseUrl() ? `${getAppBaseUrl()}/api/webhooks/retell` : null;

      const agentRes = await fetch(`https://api.retellai.com/get-agent/${agentId}`, {
        headers: {
          Authorization: `Bearer ${retellApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!agentRes.ok) {
        const body = await agentRes.text();
        return res.json({
          configured: true,
          agentId,
          registered: false,
          reason: `Retell API error (${agentRes.status}): ${body}`,
          expectedUrl,
          currentUrl: null,
        });
      }

      const agentData = (await agentRes.json()) as { webhook_url?: string };
      const currentUrl: string | null = agentData.webhook_url || null;
      const registered = !!currentUrl && !!expectedUrl && currentUrl === expectedUrl;

      res.json({ configured: true, agentId, registered, currentUrl, expectedUrl });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/register-webhook", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);

      const company = await storage.getCompany(companyId);
      if (!company?.voicePlanStatus || company.voicePlanStatus !== "active") {
        return res.status(403).json({ error: "Voice plan not active" });
      }

      const retellApiKey = process.env.RETELL_API_KEY;
      if (!retellApiKey) {
        return res.status(400).json({ error: "RETELL_API_KEY not configured" });
      }

      const agentId = company.retellAgentId || process.env.RETELL_AGENT_ID || null;
      if (!agentId) {
        return res.status(400).json({ error: "No Retell agent ID configured for this account" });
      }

      const baseUrl = getAppBaseUrl();
      if (!baseUrl) {
        return res.status(400).json({
          error: "APP_BASE_URL is not configured — cannot determine the correct webhook URL",
        });
      }

      let oldUrl: string | null = null;
      try {
        oldUrl = await getRetellAgentWebhookUrl(agentId);
      } catch (fetchErr) {
        console.warn(
          `[voice-register-webhook] Could not fetch current webhook URL for agent ${agentId}:`,
          fetchErr instanceof Error ? fetchErr.message : fetchErr
        );
      }

      await registerRetellWebhook(agentId);
      const newUrl = `${baseUrl}/api/webhooks/retell`;

      await storage.createRetellWebhookRepair({
        companyId,
        agentId,
        oldUrl: oldUrl ?? undefined,
        newUrl,
        triggeredBy: "manual",
      });
      auditLog(
        companyId,
        userId,
        "settings",
        companyId,
        "update",
        { new: { retellWebhook: newUrl } },
        req.ip || undefined
      );

      res.json({ success: true, webhookUrl: newUrl });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Voice Call Log ================

  app.get("/api/voice/calls", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin", "tech"]);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const calls = await storage.getVoiceCalls(companyId, limit);
      res.json(calls);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/voice/calls/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin", "tech"]);
      const call = await storage.getVoiceCallById(companyId, p(req.params.id));
      if (!call) return res.status(404).json({ error: "Call not found" });
      res.json(call);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Webhook Routes ================

  app.get("/api/webhooks", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const webhooksList = await storage.getWebhooks(companyId);
      res.json(webhooksList);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/webhooks", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const secret = crypto.randomBytes(32).toString("hex");
      const parsed = insertWebhookSchema.parse({ ...req.body, companyId, secret });
      const webhook = await storage.createWebhook(parsed);
      const { userId } = await getCompanyContext(req);
      auditLog(
        companyId,
        userId,
        "webhook",
        webhook.id,
        "create",
        { new: { url: parsed.url, events: parsed.events } },
        req.ip || undefined
      );
      res.status(201).json(webhook);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/webhooks/deliveries", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const limit = parseInt(req.query.limit as string) || 100;
      const deliveries = await storage.getWebhookDeliveriesForCompany(companyId, limit);
      res.json(deliveries);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/webhooks/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const existingWebhooks = await storage.getWebhooks(companyId);
      const existingWh = existingWebhooks.find((w) => w.id === p(req.params.id));
      if (!existingWh) return res.status(404).json({ error: "Webhook not found" });
      const webhook = await storage.updateWebhook(p(req.params.id), companyId, req.body);
      const { userId } = await getCompanyContext(req);
      auditLog(
        companyId,
        userId,
        "webhook",
        p(req.params.id),
        "update",
        { old: { url: existingWh.url, isActive: existingWh.isActive }, new: req.body },
        req.ip || undefined
      );
      res.json(webhook);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/webhooks/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const allWebhooks = await storage.getWebhooks(companyId);
      const whToDelete = allWebhooks.find((w) => w.id === p(req.params.id));
      await storage.deleteWebhook(p(req.params.id), companyId);
      const { userId } = await getCompanyContext(req);
      auditLog(
        companyId,
        userId,
        "webhook",
        p(req.params.id),
        "delete",
        { deleted: { url: whToDelete?.url, events: whToDelete?.events } },
        req.ip || undefined
      );
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/webhooks/:id/deliveries", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const existing = await storage.getWebhooks(companyId);
      if (!existing.find((w) => w.id === p(req.params.id)))
        return res.status(404).json({ error: "Webhook not found" });
      const limit = parseInt(req.query.limit as string) || 50;
      const deliveries = await storage.getWebhookDeliveries(p(req.params.id), limit);
      res.json(deliveries);
    } catch (err) {
      handleError(res, err);
    }
  });
}

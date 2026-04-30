import { Pool } from "pg";
import { randomUUID, randomBytes, scrypt } from "crypto";

const SCRYPT_KEYLEN = 64;

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString("hex");
    scrypt(password, salt, SCRYPT_KEYLEN, (err: Error | null, key: Buffer) => {
      if (err) return reject(err);
      resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

type IdMap = Map<string, string>;

export interface CloneResult {
  newCompanyId: string;
  newUserId: string;
  name: string;
  counts: Record<string, number>;
}

export async function cloneCompany(
  sourceCompanyId: string,
  targetCompanyName: string,
  newUserEmail: string,
  newUserPassword: string,
  pool: Pool
): Promise<CloneResult> {
  const counts: Record<string, number> = {};

  const srcCheck = await pool.query(`SELECT * FROM companies WHERE id = $1`, [sourceCompanyId]);
  if (!srcCheck.rows.length) throw new Error(`Source company ${sourceCompanyId} not found`);
  const srcCompany = srcCheck.rows[0];

  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const newCompanyId = randomUUID();
    await client.query(
      `INSERT INTO companies (
        id, name, email, phone, address, start_address, start_latitude, start_longitude,
        logo_url, subscription_tier, subscription_status, charge_timing, invoice_theme,
        mrr_cents, route_credits, reminders_enabled, reminder_settings,
        invoice_reminder_settings, auto_visits_enabled, dashboard_layout, settings_layout,
        dashboard_notes, ai_import_mapping_enabled, rover_ai_enabled, pricing_config,
        quote_defaults, voice_agent_service_area, voice_agent_pricing_summary,
        voice_agent_policies, voice_agent_special_lines, voice_agent_greeting,
        lead_webhook_sms_template, quote_auto_follow_up_enabled,
        quote_follow_up_sms_template, quote_follow_up_email_enabled,
        quote_follow_up_email_subject, quote_follow_up_email_body, quote_form_layout,
        timezone, billing_cadence, billing_trigger, default_payment_behavior,
        max_stops_per_route, message_retention_days, country, currency, tax_rate_percent,
        demo_unlimited_credits, demo_bypass_limits, demo_auto_complete_today,
        demo_auto_pay_invoices, demo_live_playback_enabled,
        review_request_enabled, review_router_enabled, google_review_url,
        review_request_after_visits, review_request_custom_message,
        client_notifications_suppressed, pass_stripe_fees, venmo_handle,
        stripe_customer_id, stripe_subscription_id, stripe_connect_account_id,
        stripe_connect_onboarded, qbo_realm_id, qbo_access_token, qbo_refresh_token,
        qbo_token_expires_at, qbo_connected_at, qbo_income_account_ref, qbo_fee_account_ref,
        telnyx_api_key, telnyx_phone_number, telnyx_messaging_profile_id,
        retell_agent_id, retell_knowledge_base_id, dedicated_phone_number,
        stripe_voice_subscription_id, voice_plan_tier, voice_plan_status,
        voice_plan_included_minutes, voice_plan_overage_rate, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
        $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,
        $47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,
        NULL,NULL,NULL,false,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,NULL,NULL,NOW(),NOW()
      )`,
      [
        newCompanyId, targetCompanyName, srcCompany.email, srcCompany.phone,
        srcCompany.address, srcCompany.start_address, srcCompany.start_latitude, srcCompany.start_longitude,
        srcCompany.logo_url, srcCompany.subscription_tier, srcCompany.subscription_status,
        srcCompany.charge_timing, srcCompany.invoice_theme, srcCompany.mrr_cents,
        srcCompany.route_credits, srcCompany.reminders_enabled, srcCompany.reminder_settings,
        srcCompany.invoice_reminder_settings, srcCompany.auto_visits_enabled,
        srcCompany.dashboard_layout, srcCompany.settings_layout, srcCompany.dashboard_notes,
        srcCompany.ai_import_mapping_enabled, srcCompany.rover_ai_enabled, srcCompany.pricing_config,
        srcCompany.quote_defaults, srcCompany.voice_agent_service_area, srcCompany.voice_agent_pricing_summary,
        srcCompany.voice_agent_policies, srcCompany.voice_agent_special_lines, srcCompany.voice_agent_greeting,
        srcCompany.lead_webhook_sms_template, srcCompany.quote_auto_follow_up_enabled,
        srcCompany.quote_follow_up_sms_template, srcCompany.quote_follow_up_email_enabled,
        srcCompany.quote_follow_up_email_subject, srcCompany.quote_follow_up_email_body,
        srcCompany.quote_form_layout, srcCompany.timezone, srcCompany.billing_cadence,
        srcCompany.billing_trigger, srcCompany.default_payment_behavior, srcCompany.max_stops_per_route,
        srcCompany.message_retention_days, srcCompany.country, srcCompany.currency, srcCompany.tax_rate_percent,
        srcCompany.demo_unlimited_credits, srcCompany.demo_bypass_limits, srcCompany.demo_auto_complete_today,
        srcCompany.demo_auto_pay_invoices, srcCompany.demo_live_playback_enabled,
        srcCompany.review_request_enabled, srcCompany.review_router_enabled, srcCompany.google_review_url,
        srcCompany.review_request_after_visits, srcCompany.review_request_custom_message,
        srcCompany.client_notifications_suppressed, srcCompany.pass_stripe_fees, srcCompany.venmo_handle,
      ]
    );

    // Create or reuse user, always reset to requested password
    const existingUser = await client.query(`SELECT id FROM users WHERE email = $1`, [newUserEmail.toLowerCase()]);
    let newUserId: string;
    const passwordHash = await hashPassword(newUserPassword);
    if (existingUser.rows.length > 0) {
      newUserId = existingUser.rows[0].id;
      await client.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, newUserId]);
    } else {
      newUserId = randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at)
         VALUES ($1, $2, $3, 'Jeremy', 'Demo', NOW(), NOW())`,
        [newUserId, newUserEmail.toLowerCase(), passwordHash]
      );
    }
    await client.query(
      `INSERT INTO company_users (id, company_id, user_id, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner', true, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [randomUUID(), newCompanyId, newUserId]
    );

    async function cloneTable(tableName: string): Promise<IdMap> {
      const idMap: IdMap = new Map();
      const { rows } = await client.query(`SELECT * FROM ${tableName} WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const oldId = row.id;
        const newId = randomUUID();
        idMap.set(oldId, newId);
        const cols = Object.keys(row);
        const vals = cols.map(c => c === "id" ? newId : c === "company_id" ? newCompanyId : row[c]);
        const ph = vals.map((_: unknown, i: number) => `$${i + 1}`).join(", ");
        await client.query(`INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${ph}) ON CONFLICT DO NOTHING`, vals);
      }
      counts[tableName] = rows.length;
      return idMap;
    }

    // Tier 1: simple company-scoped tables (no cross-company FKs)
    const tagMap = await cloneTable("tags");
    await cloneTable("lead_sources");
    const servicePricingMap = await cloneTable("service_pricing");
    await cloneTable("service_packages");
    await cloneTable("overhead_costs");
    await cloneTable("competitor_pricing");
    await cloneTable("service_zones");
    await cloneTable("automation_rules");

    {
      const { rows } = await client.query(`SELECT * FROM service_billing_rules WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newSvcId = servicePricingMap.get(row.service_pricing_id);
        if (!newSvcId) continue;
        await client.query(
          `INSERT INTO service_billing_rules (id, company_id, service_pricing_id, billing_cadence, billing_trigger, payment_behavior, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [randomUUID(), newCompanyId, newSvcId, row.billing_cadence, row.billing_trigger, row.payment_behavior]
        );
      }
      counts["service_billing_rules"] = rows.length;
    }

    // Tier 2: contacts, routes
    const contactMap: IdMap = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM contacts WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        contactMap.set(row.id, newId);
        await client.query(
          `INSERT INTO contacts (
            id, company_id, first_name, last_name, email, phone, street_address, address_2,
            city, state, zip_code, yard_size, number_of_dogs, service_frequency, lead_source,
            service_day, status, has_portal_access, invoice_timing, invoice_frequency,
            referral_source, auto_pay_enabled, auto_invoice_enabled, referral_code,
            reminder_preferences, notes, cost_overrides, billing_cadence_override,
            billing_trigger_override, payment_behavior_override,
            visits_since_last_review_request, review_request_sent_count,
            google_review_left, dismissed_opportunities, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, row.first_name, row.last_name, row.email, row.phone,
            row.street_address, row.address_2, row.city, row.state, row.zip_code,
            row.yard_size, row.number_of_dogs, row.service_frequency, row.lead_source,
            row.service_day, row.status, row.has_portal_access, row.invoice_timing,
            row.invoice_frequency, row.referral_source, row.auto_pay_enabled, row.auto_invoice_enabled,
            row.referral_code, row.reminder_preferences, row.notes, row.cost_overrides,
            row.billing_cadence_override, row.billing_trigger_override, row.payment_behavior_override,
            row.visits_since_last_review_request, row.review_request_sent_count,
            row.google_review_left, row.dismissed_opportunities,
          ]
        );
      }
      counts["contacts"] = rows.length;
    }

    const routeMap: IdMap = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM routes WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        routeMap.set(row.id, newId);
        await client.query(
          `INSERT INTO routes (id, company_id, name, day_of_week, date, technician_id, color, is_locked, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [newId, newCompanyId, row.name, row.day_of_week, row.date, row.color, row.is_locked]
        );
      }
      counts["routes"] = rows.length;
    }

    // Tier 3: properties, estimates, quotes, agreements (service_plan_id deferred — set after Tier 4)
    const propertyMap: IdMap = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM properties WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        propertyMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        if (!newContactId) continue;
        await client.query(
          `INSERT INTO properties (
            id, company_id, contact_id, street_address, city, state, zip_code,
            number_of_dogs, yard_size, gate_code, special_instructions, latitude, longitude,
            lot_size, yard_polygon, measured_yard_sqft, yard_difficulty, has_dangerous_dog,
            dangerous_dog_notes, dog_names, dog_breeds, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId, row.street_address, row.city, row.state, row.zip_code,
            row.number_of_dogs, row.yard_size, row.gate_code, row.special_instructions,
            row.latitude, row.longitude, row.lot_size, row.yard_polygon, row.measured_yard_sqft,
            row.yard_difficulty, row.has_dangerous_dog, row.dangerous_dog_notes, row.dog_names, row.dog_breeds,
          ]
        );
      }
      counts["properties"] = rows.length;
    }

    const estimateMap: IdMap = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM estimates WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        estimateMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        if (!newContactId) continue;
        await client.query(
          `INSERT INTO estimates (id, company_id, contact_id, property_id, description, items, total_cents, status, sent_at, responded_at, response_note, admin_note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId,
            row.property_id ? (propertyMap.get(row.property_id) || null) : null,
            row.description, row.items, row.total_cents, row.status, row.sent_at, row.responded_at, row.response_note, row.admin_note
          ]
        );
      }
      counts["estimates"] = rows.length;
    }

    {
      const { rows } = await client.query(`SELECT * FROM quotes WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        await client.query(
          `INSERT INTO quotes (
            id, company_id, contact_id, property_id, quote_number, type, status,
            contact_name, contact_email, contact_phone, property_address,
            dog_count, yard_size, station_count, common_area_minutes, time_per_station,
            mileage_distance, dump_fee, crew_size, site_sqft, frequency, is_first_time,
            essential_price, premium_price, deluxe_price, initial_clean_fee,
            selected_tier, selected_price, essential_features, premium_features, deluxe_features,
            pricing_breakdown, images, notes, internal_notes, expires_at, sent_at, accepted_at, declined_at,
            created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
            $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,NOW(),NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            randomUUID(), newCompanyId,
            row.contact_id ? (contactMap.get(row.contact_id) || null) : null,
            row.property_id ? (propertyMap.get(row.property_id) || null) : null,
            row.quote_number, row.type, row.status, row.contact_name, row.contact_email,
            row.contact_phone, row.property_address, row.dog_count, row.yard_size,
            row.station_count, row.common_area_minutes, row.time_per_station, row.mileage_distance,
            row.dump_fee, row.crew_size, row.site_sqft, row.frequency, row.is_first_time,
            row.essential_price, row.premium_price, row.deluxe_price, row.initial_clean_fee,
            row.selected_tier, row.selected_price, row.essential_features, row.premium_features,
            row.deluxe_features, row.pricing_breakdown, row.images, row.notes, row.internal_notes,
            row.expires_at, row.sent_at, row.accepted_at, row.declined_at,
          ]
        );
      }
      counts["quotes"] = rows.length;
    }

    // agreements: insert WITHOUT service_plan_id first (circular ref — patched after Tier 4)
    // Track old agreement → old service_plan_id for back-patching after service_plans are cloned
    const agreementMap: IdMap = new Map();
    const oldAgreementToOldServicePlanId: Map<string, string> = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM agreements WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        agreementMap.set(row.id, newId);
        if (row.service_plan_id) oldAgreementToOldServicePlanId.set(row.id, row.service_plan_id);
        const newContactId = contactMap.get(row.contact_id);
        if (!newContactId) continue;
        await client.query(
          `INSERT INTO agreements (id, company_id, contact_id, frequency, price_per_visit, is_active, paused_at, start_date, end_date, ends_after_count, ends_after_unit, estimate_id, service_plan_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId, row.frequency, row.price_per_visit,
            row.is_active, row.paused_at, row.start_date, row.end_date,
            row.ends_after_count, row.ends_after_unit,
            row.estimate_id ? (estimateMap.get(row.estimate_id) || null) : null,
          ]
        );
      }
      counts["agreements"] = rows.length;
    }

    // Tier 4: service_plans, jobs
    // service_plans does NOT have agreement_id — it's a standalone company-scoped entity
    const servicePlanMap: IdMap = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM service_plans WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        servicePlanMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        const newPropertyId = propertyMap.get(row.property_id);
        if (!newContactId || !newPropertyId) continue;
        await client.query(
          `INSERT INTO service_plans (
            id, company_id, contact_id, property_id, frequency, day_of_week, price_per_visit,
            discount, is_active, paused_at, start_date, end_date, route_id, stop_order,
            service_name, job_type, job_status, start_time, end_time, anytime,
            ends_after_count, ends_after_unit, visit_instructions, assigned_user_id,
            estimate_id, is_stop_only, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NULL,$24,$25,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId, newPropertyId, row.frequency, row.day_of_week,
            row.price_per_visit, row.discount, row.is_active, row.paused_at, row.start_date, row.end_date,
            row.route_id ? (routeMap.get(row.route_id) || null) : null, row.stop_order,
            row.service_name, row.job_type, row.job_status, row.start_time, row.end_time, row.anytime,
            row.ends_after_count, row.ends_after_unit, row.visit_instructions,
            row.estimate_id ? (estimateMap.get(row.estimate_id) || null) : null, row.is_stop_only,
          ]
        );
      }
      counts["service_plans"] = rows.length;
    }

    const jobMap: IdMap = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM jobs WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        jobMap.set(row.id, newId);
        const newPropertyId = propertyMap.get(row.property_id);
        const newAgreementId = agreementMap.get(row.agreement_id);
        if (!newPropertyId || !newAgreementId) continue;
        const newServicePlanId = row.service_plan_id ? (servicePlanMap.get(row.service_plan_id) || null) : null;
        await client.query(
          `INSERT INTO jobs (id, company_id, agreement_id, property_id, route_id, stop_order, day_of_week, service_name, job_type, job_status, start_time, end_time, anytime, visit_instructions, assigned_user_id, is_stop_only, service_plan_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15,$16,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newAgreementId, newPropertyId,
            row.route_id ? (routeMap.get(row.route_id) || null) : null,
            row.stop_order, row.day_of_week, row.service_name, row.job_type, row.job_status,
            row.start_time, row.end_time, row.anytime, row.visit_instructions, row.is_stop_only,
            newServicePlanId,
          ]
        );
      }
      counts["jobs"] = rows.length;
    }

    // Back-patch agreements.service_plan_id now that service_plans exist
    // (agreements were inserted with service_plan_id = NULL to break the circular reference)
    for (const [oldAgreementId, oldServicePlanId] of oldAgreementToOldServicePlanId) {
      const newAgreementId = agreementMap.get(oldAgreementId);
      const newServicePlanId = servicePlanMap.get(oldServicePlanId);
      if (!newAgreementId || !newServicePlanId) continue;
      await client.query(
        `UPDATE agreements SET service_plan_id = $1 WHERE id = $2`,
        [newServicePlanId, newAgreementId]
      );
    }

    // Tier 5: visits, invoices
    const visitMap: IdMap = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM visits WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        visitMap.set(row.id, newId);
        const newServicePlanId = servicePlanMap.get(row.service_plan_id);
        const newPropertyId = propertyMap.get(row.property_id);
        if (!newServicePlanId || !newPropertyId) continue;
        await client.query(
          `INSERT INTO visits (id, company_id, service_plan_id, job_id, property_id, route_id, scheduled_date, status, en_route_at, started_at, completed_at, completed_by, proof_of_service_photo, proof_of_service_photo_before, gate_closed_photo, extra_photos, technician_notes, invoice_id, service_reminder_sent_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14,$15,$16,NULL,NULL,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newServicePlanId,
            row.job_id ? (jobMap.get(row.job_id) || null) : null,
            newPropertyId,
            row.route_id ? (routeMap.get(row.route_id) || null) : null,
            row.scheduled_date, row.status, row.en_route_at, row.started_at, row.completed_at,
            row.proof_of_service_photo, row.proof_of_service_photo_before,
            row.gate_closed_photo, row.extra_photos, row.technician_notes,
          ]
        );
      }
      counts["visits"] = rows.length;
    }

    const invoiceMap: IdMap = new Map();
    {
      const { rows } = await client.query(`SELECT * FROM invoices WHERE company_id = $1`, [sourceCompanyId]);
      for (const row of rows) {
        const newId = randomUUID();
        invoiceMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        if (!newContactId) continue;
        await client.query(
          `INSERT INTO invoices (id, company_id, contact_id, invoice_number, due_date, subtotal, tax_rate, tax, discount_type, discount_value, discount_amount, total, tip_amount, status, auto_generated, paid_at, payment_attempts, source, issued_date, notes, exclude_from_reminders, reminder_count, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId, row.invoice_number, row.due_date,
            row.subtotal, row.tax_rate, row.tax, row.discount_type, row.discount_value, row.discount_amount,
            row.total, row.tip_amount, row.status, row.auto_generated, row.paid_at, row.payment_attempts,
            row.source, row.issued_date, row.notes, row.exclude_from_reminders, row.reminder_count,
          ]
        );
      }
      counts["invoices"] = rows.length;
    }

    // Tier 6: invoice line items, payments, add-ons, tags, vacation holds
    {
      const { rows } = await client.query(
        `SELECT ili.* FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id WHERE i.company_id = $1`,
        [sourceCompanyId]
      );
      let ct = 0;
      for (const row of rows) {
        const newInvoiceId = invoiceMap.get(row.invoice_id);
        if (!newInvoiceId) continue;
        await client.query(
          `INSERT INTO invoice_line_items (id, invoice_id, visit_id, service_pricing_id, description, quantity, unit_price, total, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT DO NOTHING`,
          [
            randomUUID(), newInvoiceId,
            row.visit_id ? (visitMap.get(row.visit_id) || null) : null,
            row.service_pricing_id ? (servicePricingMap.get(row.service_pricing_id) || null) : null,
            row.description, row.quantity, row.unit_price, row.total
          ]
        );
        ct++;
      }
      counts["invoice_line_items"] = ct;
    }

    {
      const { rows } = await client.query(`SELECT * FROM invoice_payments WHERE company_id = $1`, [sourceCompanyId]);
      let ct = 0;
      for (const row of rows) {
        const newInvoiceId = invoiceMap.get(row.invoice_id);
        if (!newInvoiceId) continue;
        await client.query(
          `INSERT INTO invoice_payments (id, company_id, invoice_id, amount_cents, paid_at, method, reference, source, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT DO NOTHING`,
          [randomUUID(), newCompanyId, newInvoiceId, row.amount_cents, row.paid_at, row.method, row.reference, row.source]
        );
        ct++;
      }
      counts["invoice_payments"] = ct;
    }

    {
      const { rows } = await client.query(
        `SELECT jao.* FROM job_add_ons jao JOIN jobs j ON j.id = jao.job_id WHERE j.company_id = $1`, [sourceCompanyId]
      );
      let ct = 0;
      for (const row of rows) {
        const newJobId = jobMap.get(row.job_id);
        const newSvcId = servicePricingMap.get(row.service_pricing_id);
        if (!newJobId || !newSvcId) continue;
        await client.query(
          `INSERT INTO job_add_ons (id, job_id, service_pricing_id, name, price, is_active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
          [randomUUID(), newJobId, newSvcId, row.name, row.price, row.is_active]
        );
        ct++;
      }
      counts["job_add_ons"] = ct;
    }

    {
      const { rows } = await client.query(
        `SELECT spa.* FROM service_plan_add_ons spa JOIN service_plans sp ON sp.id = spa.service_plan_id WHERE sp.company_id = $1`, [sourceCompanyId]
      );
      let ct = 0;
      for (const row of rows) {
        const newPlanId = servicePlanMap.get(row.service_plan_id);
        const newSvcId = servicePricingMap.get(row.service_pricing_id);
        if (!newPlanId || !newSvcId) continue;
        await client.query(
          `INSERT INTO service_plan_add_ons (id, service_plan_id, service_pricing_id, name, price, is_active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
          [randomUUID(), newPlanId, newSvcId, row.name, row.price, row.is_active]
        );
        ct++;
      }
      counts["service_plan_add_ons"] = ct;
    }

    {
      const { rows } = await client.query(
        `SELECT ct.* FROM contact_tags ct JOIN contacts c ON c.id = ct.contact_id WHERE c.company_id = $1`, [sourceCompanyId]
      );
      let ct = 0;
      for (const row of rows) {
        const newContactId = contactMap.get(row.contact_id);
        const newTagId = tagMap.get(row.tag_id);
        if (!newContactId || !newTagId) continue;
        await client.query(
          `INSERT INTO contact_tags (id, contact_id, tag_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [randomUUID(), newContactId, newTagId]
        );
        ct++;
      }
      counts["contact_tags"] = ct;
    }

    {
      const { rows } = await client.query(
        `SELECT vh.* FROM vacation_holds vh JOIN service_plans sp ON sp.id = vh.service_plan_id WHERE sp.company_id = $1`, [sourceCompanyId]
      );
      let ct = 0;
      for (const row of rows) {
        const newPlanId = servicePlanMap.get(row.service_plan_id);
        if (!newPlanId) continue;
        await client.query(
          `INSERT INTO vacation_holds (id, service_plan_id, agreement_id, start_date, end_date, reason, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
          [
            randomUUID(), newPlanId,
            row.agreement_id ? (agreementMap.get(row.agreement_id) || null) : null,
            row.start_date, row.end_date, row.reason
          ]
        );
        ct++;
      }
      counts["vacation_holds"] = ct;
    }

    await client.query("COMMIT");
    return { newCompanyId, newUserId, name: targetCompanyName, counts };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

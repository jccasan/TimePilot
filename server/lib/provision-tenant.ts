import crypto from "crypto";
import { db } from "../db";
import { storage } from "../storage";
import {
  createUserWithTempPassword,
  getUserByEmail,
  claimOnboardingEmailSend,
  resetOnboardingEmailSent,
} from "../services/app-auth";
import { sendEmail, sendAdminSignupNotification } from "../services/email";
import { seedDefaultLeadSources } from "../routes/shared";

export interface ProvisionTenantParams {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  companyName?: string;
  source?: string;
  appUrl: string;
}

export interface ProvisionTenantResult {
  alreadyExists: false;
  user: Awaited<ReturnType<typeof createUserWithTempPassword>>;
  company: { id: string; name: string; slug: string | null };
  tempPassword: string;
}

export interface ProvisionTenantAlreadyExists {
  alreadyExists: true;
}

export async function provisionNewTenant(
  params: ProvisionTenantParams
): Promise<ProvisionTenantResult | ProvisionTenantAlreadyExists> {
  const {
    firstName,
    lastName,
    email,
    companyName: rawCompanyName,
    source = "Direct",
    appUrl,
  } = params;

  const normalizedEmail = email.toLowerCase().trim();
  const companyName = rawCompanyName?.trim() || `${firstName}'s Pet Services`;
  const safeFirst = firstName.trim();
  const safeLast = lastName?.trim() || "";

  const existingUser = await getUserByEmail(normalizedEmail);
  if (existingUser) {
    console.log(
      `[ProvisionTenant] Skipping — user already exists: ${normalizedEmail.replace(/@.+/, "@***")}`
    );
    return { alreadyExists: true };
  }

  const tempPassword = crypto.randomBytes(6).toString("base64url");

  const { companies, companyUsers } = await import("@shared/schema");

  const { user, company } = await db.transaction(async (tx) => {
    const txUser = await createUserWithTempPassword(
      normalizedEmail,
      safeFirst,
      safeLast,
      tempPassword
    );

    const baseSlug =
      companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "company";
    let slug = baseSlug;
    let slugSuffix = 1;
    while (true) {
      const existing = await storage.getCompanyBySlug(slug);
      if (!existing) break;
      slug = `${baseSlug}-${slugSuffix++}`;
    }

    const [txCompany] = await tx
      .insert(companies)
      .values({
        name: companyName,
        email: normalizedEmail,
        slug,
        subscriptionTier: "free_trial",
        subscriptionStatus: "trialing",
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        signupCountry: "US",
      })
      .returning();

    await tx.insert(companyUsers).values({
      userId: txUser.id,
      companyId: txCompany.id,
      role: "owner",
    });

    return { user: txUser, company: txCompany };
  });

  await seedDefaultLeadSources(company.id);
  await storage.seedDefaultPricing(company.id);

  const claimed = await claimOnboardingEmailSend(user.id).catch(() => false);
  if (claimed) {
    try {
      await sendEmail({
        companyId: company.id,
        to: normalizedEmail,
        subject: "Welcome to ScooPilot - Your login credentials",
        text: [
          `Hi ${safeFirst},`,
          "",
          "Your ScooPilot free trial is active!",
          "",
          `Company: ${companyName}`,
          `Login: ${appUrl}`,
          `Email: ${normalizedEmail}`,
          `Temporary Password: ${tempPassword}`,
          "",
          "You'll be asked to set a new password on your first login.",
        ].join("\n"),
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">ScooPilot</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
              <h2 style="margin-top: 0;">Your Free Trial is Active!</h2>
              <p>Hi ${safeFirst},</p>
              <p>Your ScooPilot account <strong>"${companyName}"</strong> is ready. You have 14 days to explore everything free.</p>
              <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 4px 0;"><strong>Email:</strong> ${normalizedEmail}</p>
                <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
              </div>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">You'll be asked to set a new password when you first log in.</p>
            </div>
          </div>
        `,
      });
      console.log(
        `[ProvisionTenant] Welcome email sent to ${normalizedEmail.replace(/@.+/, "@***")}`
      );
    } catch (emailErr) {
      console.error(
        `[ProvisionTenant] Welcome email failed for ${normalizedEmail.replace(/@.+/, "@***")}:`,
        emailErr
      );
      await resetOnboardingEmailSent(user.id).catch(() => {});
    }
  } else {
    console.log(
      `[ProvisionTenant] Onboarding email already sent for ${normalizedEmail.replace(/@.+/, "@***")}, skipping.`
    );
  }

  sendAdminSignupNotification({
    companyName,
    ownerEmail: normalizedEmail,
    ownerName: [safeFirst, safeLast].filter(Boolean).join(" "),
    tier: "free_trial",
    source,
  }).catch((err) => console.error("[ProvisionTenant] Admin signup notification failed:", err));

  return { alreadyExists: false, user, company, tempPassword };
}

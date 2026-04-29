import crypto from "crypto";
import { db } from "../db";
import { users, passwordResetTokens } from "@shared/models/auth";
import { eq, and, gt, sql } from "drizzle-orm";

const SCRYPT_KEYLEN = 64;
const RESET_TOKEN_EXPIRY_HOURS = 1;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => {
      if (err) reject(err);
      resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => {
      if (err) reject(err);
      resolve(key.toString("hex") === hash);
    });
  });
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function registerUser(email: string, password: string, firstName: string, lastName: string) {
  if (!email || !password) return { error: "Email and password are required" };
  if (password.length < 8) return { error: "Password must be at least 8 characters" };

  const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (existing.length > 0) return { error: "An account with this email already exists" };

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({
    email: email.toLowerCase(),
    passwordHash,
    firstName: firstName || null,
    lastName: lastName || null,
  }).returning();

  return { user };
}

export async function loginUser(email: string, password: string) {
  if (!email || !password) return { error: "Email and password are required" };

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!user || !user.passwordHash) return { error: "Invalid email or password" };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { error: "Invalid email or password" };

  return { user };
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user || null;
}

export async function createPasswordResetToken(email: string): Promise<{ token: string } | { error: string }> {
  if (!email) return { error: "Email is required" };

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!user) {
    return { token: "noop" };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHashed = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: tokenHashed,
    expiresAt,
  });

  return { token };
}

export async function createUserWithTempPassword(email: string, firstName: string, lastName: string, tempPassword: string) {
  const passwordHash = await hashPassword(tempPassword);
  const [user] = await db.insert(users).values({
    email: email.toLowerCase(),
    passwordHash,
    firstName: firstName || null,
    lastName: lastName || null,
    mustChangePassword: true,
  }).returning();
  return user;
}

export async function getUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return user || null;
}

export async function claimOnboardingEmailSend(userId: string): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ onboardingEmailSentAt: new Date() })
    .where(and(eq(users.id, userId), sql`onboarding_email_sent_at IS NULL`))
    .returning({ id: users.id });
  return result.length > 0;
}

export async function resetOnboardingEmailSent(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ onboardingEmailSentAt: null })
    .where(eq(users.id, userId));
}

export async function changePassword(userId: string, newPassword: string): Promise<{ success: boolean } | { error: string }> {
  if (!newPassword || newPassword.length < 8) return { error: "Password must be at least 8 characters" };
  const passwordHash = await hashPassword(newPassword);
  await db.update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return { success: true };
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<{ success: boolean } | { error: string }> {
  if (!token || !newPassword) return { error: "Token and new password are required" };
  if (newPassword.length < 8) return { error: "Password must be at least 8 characters" };

  const tokenHashed = hashToken(token);

  const [resetRecord] = await db.select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHashed),
        eq(passwordResetTokens.used, false),
        gt(passwordResetTokens.expiresAt, new Date())
      )
    );

  if (!resetRecord) return { error: "Invalid or expired reset link. Please request a new one." };

  const passwordHash = await hashPassword(newPassword);

  await db.update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, resetRecord.userId));

  await db.update(passwordResetTokens)
    .set({ used: true })
    .where(eq(passwordResetTokens.id, resetRecord.id));

  return { success: true };
}

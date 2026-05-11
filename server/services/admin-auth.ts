import crypto from "crypto";
import { db } from "../db";
import { adminUsers, adminSessions } from "@shared/schema";
import { eq, lte } from "drizzle-orm";

const SCRYPT_KEYLEN = 64;
const SESSION_DURATION_HOURS = 8;
const PASSWORD_MAX_AGE_DAYS = 90;
const MIN_PASSWORD_LENGTH = 16;

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

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a number";
  if (!/[^a-zA-Z0-9]/.test(password)) return "Password must contain a symbol";
  return null;
}

export async function seedAdminUser(email: string, password: string) {
  const hashed = await hashPassword(password);
  const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  if (existing.length > 0) {
    // Always sync the password to the current ADMIN_INITIAL_PASSWORD secret so that
    // updating the secret and redeploying resets the admin password.
    await db
      .update(adminUsers)
      .set({ passwordHash: hashed, passwordChangedAt: new Date() })
      .where(eq(adminUsers.email, email));
    return;
  }
  await db.insert(adminUsers).values({ email, passwordHash: hashed });
}

export async function loginAdmin(
  email: string,
  password: string
): Promise<{ token: string; mustChangePassword: boolean } | { error: string }> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  if (!user) return { error: "Invalid credentials" };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { error: "Invalid credentials" };

  const token = crypto.randomBytes(32).toString("hex");
  const tokenH = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

  await db.insert(adminSessions).values({
    adminUserId: user.id,
    tokenHash: tokenH,
    expiresAt,
  });

  const daysSinceChange = (Date.now() - user.passwordChangedAt.getTime()) / (1000 * 60 * 60 * 24);
  const mustChangePassword = daysSinceChange >= PASSWORD_MAX_AGE_DAYS;

  return { token, mustChangePassword };
}

export async function validateAdminSession(
  token: string
): Promise<{ userId: string; email: string } | null> {
  const tokenH = hashToken(token);
  const [session] = await db
    .select()
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenH));
  if (!session || session.expiresAt < new Date()) return null;

  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, session.adminUserId));
  if (!user) return null;

  return { userId: user.id, email: user.email };
}

export async function logoutAdmin(token: string) {
  const tokenH = hashToken(token);
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenH));
}

export async function changeAdminPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ error?: string }> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, userId));
  if (!user) return { error: "User not found" };

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) return { error: "Current password is incorrect" };

  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) return { error: policyError };

  for (const prevHash of user.previousPasswordHashes) {
    const reused = await verifyPassword(newPassword, prevHash);
    if (reused) return { error: "Cannot reuse a previous password" };
  }
  const alsoCheckCurrent = await verifyPassword(newPassword, user.passwordHash);
  if (alsoCheckCurrent) return { error: "Cannot reuse your current password" };

  const newHash = await hashPassword(newPassword);
  const updatedPrevious = [...user.previousPasswordHashes, user.passwordHash].slice(-10);

  await db
    .update(adminUsers)
    .set({
      passwordHash: newHash,
      previousPasswordHashes: updatedPrevious,
      passwordChangedAt: new Date(),
    })
    .where(eq(adminUsers.id, userId));

  return {};
}

export async function cleanExpiredAdminSessions() {
  await db.delete(adminSessions).where(lte(adminSessions.expiresAt, new Date()));
}

export async function isPasswordExpired(userId: string): Promise<boolean> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, userId));
  if (!user) return false;
  const daysSinceChange = (Date.now() - user.passwordChangedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceChange >= PASSWORD_MAX_AGE_DAYS;
}

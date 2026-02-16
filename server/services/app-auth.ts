import crypto from "crypto";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";

const SCRYPT_KEYLEN = 64;

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

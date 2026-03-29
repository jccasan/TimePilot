import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("No encryption key available (SESSION_SECRET or ENCRYPTION_KEY)");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === TAG_LENGTH * 2;
}

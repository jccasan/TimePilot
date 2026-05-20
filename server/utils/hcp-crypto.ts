import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getHcpKey(): Buffer {
  const secret = process.env.HCP_ENCRYPTION_KEY;
  if (!secret) {
    const fallback = process.env.SESSION_SECRET;
    if (!fallback)
      throw new Error(
        "HCP_ENCRYPTION_KEY is required for HCP API key encryption. Set it in environment secrets."
      );
    return crypto.createHash("sha256").update(`hcp:${fallback}`).digest();
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptHcpApiKey(plaintext: string): string {
  const key = getHcpKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `hcp:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptHcpApiKey(ciphertext: string): string {
  if (!ciphertext.startsWith("hcp:")) {
    return ciphertext;
  }
  const key = getHcpKey();
  const rest = ciphertext.slice(4);
  const parts = rest.split(":");
  if (parts.length !== 3) throw new Error("Invalid HCP API key ciphertext format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function isHcpEncrypted(value: string): boolean {
  if (!value.startsWith("hcp:")) return false;
  const rest = value.slice(4);
  const parts = rest.split(":");
  return (
    parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === TAG_LENGTH * 2
  );
}

import crypto from "crypto";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyTelnyxSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  timestamp: string | undefined
): boolean {
  try {
    const publicKeyEnv = process.env.TELNYX_PUBLIC_KEY;
    if (!publicKeyEnv || !signature || !timestamp) return false;

    const ts = parseInt(timestamp, 10);
    if (isNaN(ts)) return false;
    const ageMs = Date.now() - ts * 1000;
    if (ageMs > FIVE_MINUTES_MS || ageMs < -FIVE_MINUTES_MS) return false;

    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    const signingPayload = Buffer.from(`${timestamp}|${bodyStr}`, "utf8");
    const signatureBuffer = Buffer.from(signature, "base64");

    const rawKeyBase64 = publicKeyEnv.startsWith("phk_") ? publicKeyEnv.slice(4) : publicKeyEnv;
    const rawKeyBuf = Buffer.from(rawKeyBase64, "base64");
    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawKeyBuf]);
    const keyObject = crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });

    return crypto.verify(null, signingPayload, keyObject, signatureBuffer);
  } catch {
    return false;
  }
}

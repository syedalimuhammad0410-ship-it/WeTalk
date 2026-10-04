import "./guard";
import crypto from "node:crypto";
import { env } from "./env";
import { AppError } from "./errors";

function key(): Buffer {
  const raw = env.encryptionKey();
  if (!raw || raw.length < 32) {
    throw new AppError(
      "NOT_CONFIGURED",
      "APP_ENCRYPTION_KEY is missing or shorter than 32 characters. Set it on the server before storing credentials.",
    );
  }
  return crypto.createHash("sha256").update(raw).digest();
}

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) throw new AppError("INTERNAL", "Stored credential is corrupted. Reconnect the integration.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
export const secretHint = (secret: string) => (secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`);
export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

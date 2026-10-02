import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { storage } from "./storage";

/**
 * Provider settings. Secret keys come from environment variables first; users may
 * also store their own keys ("bring your own key"), which are encrypted at rest with
 * AES-256-GCM using a key derived from AUTH_SECRET and are never returned to the client.
 */
export const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "TAVILY_API_KEY",
  "SERPAPI_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_CLOUD_VISION_API_KEY",
  "YOUTUBE_API_KEY",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export interface UserPrefs {
  aiModel: string;
  aiEnabled: boolean;
  webProvider: "auto" | "brave" | "tavily" | "wikipedia";
  mapProvider: "osm" | "google";
  ocrProvider: "tesseract" | "google-vision";
  imageSearchProvider: "commons" | "serpapi-lens";
  animation: "full" | "reduced" | "off";
  maxQueriesQuick: number;
  maxQueriesDeep: number;
  retentionDays: number;
  officialSourcesOnly: boolean;
  debug: boolean;
}

export const DEFAULT_PREFS: UserPrefs = {
  aiModel: process.env.AI_MODEL || "claude-opus-5-5",
  aiEnabled: true,
  webProvider: "auto",
  mapProvider: "osm",
  ocrProvider: "tesseract",
  imageSearchProvider: "commons",
  animation: "full",
  maxQueriesQuick: 12,
  maxQueriesDeep: 40,
  retentionDays: 0,
  officialSourcesOnly: false,
  debug: false,
};

interface StoredSettings {
  prefs: Partial<UserPrefs>;
  secrets: Partial<Record<SecretKey, string>>; // encrypted
}

const ownerKey = (email: string) => `settings/${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24)}`;

function aesKey() {
  return createHash("sha256").update(`trace-settings:${process.env.AUTH_SECRET || "dev-insecure"}`).digest();
}

function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

function decrypt(blob: string) {
  try {
    const [iv, tag, data] = blob.split(".").map((x) => Buffer.from(x, "base64"));
    const d = createDecipheriv("aes-256-gcm", aesKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

async function load(email: string): Promise<StoredSettings> {
  return (await storage().getJSON<StoredSettings>(ownerKey(email))) || { prefs: {}, secrets: {} };
}

export async function getPrefs(email: string): Promise<UserPrefs> {
  const s = await load(email);
  return { ...DEFAULT_PREFS, ...s.prefs };
}

export async function savePrefs(email: string, prefs: Partial<UserPrefs>) {
  const s = await load(email);
  s.prefs = { ...s.prefs, ...prefs };
  await storage().setJSON(ownerKey(email), s);
  return { ...DEFAULT_PREFS, ...s.prefs };
}

export async function setSecret(email: string, key: SecretKey, value: string | null) {
  const s = await load(email);
  if (value) s.secrets[key] = encrypt(value);
  else delete s.secrets[key];
  await storage().setJSON(ownerKey(email), s);
}

/** Resolves secrets: environment variables win, then user-stored keys. */
export async function getSecrets(email: string): Promise<Partial<Record<SecretKey, string>>> {
  const s = await load(email);
  const out: Partial<Record<SecretKey, string>> = {};
  for (const k of SECRET_KEYS) {
    const env = process.env[k];
    if (env) out[k] = env;
    else if (s.secrets[k]) out[k] = decrypt(s.secrets[k]!);
  }
  return out;
}

export async function secretStatus(email: string) {
  const s = await load(email);
  return Object.fromEntries(
    SECRET_KEYS.map((k) => [k, process.env[k] ? "environment" : s.secrets[k] ? "user" : "missing"]),
  ) as Record<SecretKey, "environment" | "user" | "missing">;
}

export interface ProviderContext {
  email: string;
  prefs: UserPrefs;
  secrets: Partial<Record<SecretKey, string>>;
}

export async function providerContext(email: string): Promise<ProviderContext> {
  const [prefs, secrets] = await Promise.all([getPrefs(email), getSecrets(email)]);
  return { email, prefs, secrets };
}

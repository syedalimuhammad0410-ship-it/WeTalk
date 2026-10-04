import "./guard";

/** Centralised, server-only access to environment configuration. Never import from client code. */
export const env = {
  appUrl: () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  encryptionKey: () => process.env.APP_ENCRYPTION_KEY || "",
  anthropicKey: () => process.env.ANTHROPIC_API_KEY || "",
  googleMapsKey: () => process.env.GOOGLE_MAPS_API_KEY || "",
  googleClientId: () => process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: () => process.env.GOOGLE_CLIENT_SECRET || "",
  googleOAuthConfigured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  jobRunner: () => (process.env.JOB_RUNNER === "external" ? "external" : "inline") as "inline" | "external",
  sandboxEmailEnabled: () => process.env.ENABLE_EMAIL_SANDBOX !== "false",
  systemAdminEmails: () =>
    (process.env.SYSTEM_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  isProduction: () => process.env.NODE_ENV === "production",
};

// Central configuration. All secrets come from environment variables — never hard-coded.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency). Values already in the environment win.
const envFile = path.resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const env = process.env;
export const config = {
  appName: env.APP_NAME || 'Mathly',
  port: Number(env.PORT || 8787),
  isProd: env.NODE_ENV === 'production',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.NODE_ENV === 'production' ? env.PORT || 8787 : 5173}`).replace(/\/$/, ''),
  dbPath: path.resolve(env.DATABASE_PATH || 'data/mathly.db'),
  uploadDir: path.resolve(env.UPLOAD_DIR || 'data/uploads'),
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  ai: {
    provider: (env.AI_PROVIDER || 'anthropic') as 'anthropic' | 'none',
    // ANTHROPIC_API_KEY is read by the SDK itself; we only need to know whether it is set.
    configured: !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) && env.AI_PROVIDER !== 'none',
    model: env.AI_MODEL || 'claude-opus-5-5',
    rateLimitPerMin: Number(env.AI_RATE_LIMIT_PER_MIN || 20),
  },
  oauth: {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    microsoft: { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, tenant: env.MICROSOFT_TENANT || 'common' },
    apple: { clientId: env.APPLE_CLIENT_ID, teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_KEY_ID, privateKey: env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n') },
  },
  sessionDays: Number(env.SESSION_DAYS || 30),
  guestSessionDays: 365,
};

export const oauthConfigured = {
  google: !!(config.oauth.google.clientId && config.oauth.google.clientSecret),
  microsoft: !!(config.oauth.microsoft.clientId && config.oauth.microsoft.clientSecret),
  apple: !!(config.oauth.apple.clientId && config.oauth.apple.teamId && config.oauth.apple.keyId && config.oauth.apple.privateKey),
};

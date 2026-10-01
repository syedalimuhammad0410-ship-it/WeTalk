// Mathly API app (shared by the standalone server and the Netlify function).
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, oauthConfigured } from './config.ts';
import './db.ts';
import { seed } from './seed.ts';
import { authRouter, loadSession } from './auth.ts';
import { oauthRouter } from './oauth.ts';
import { csrfGuard, errorHandler, rateLimit, securityHeaders } from './security.ts';
import { profilesRouter, familyRouter } from './routes/profiles.ts';
import { learnRouter } from './routes/learn.ts';
import { aiRouter } from './routes/ai.ts';
import { plansRouter } from './routes/plans.ts';
import { adminRouter } from './routes/admin.ts';
import { aiConfigured } from './ai/provider.ts';
import { APP_NAME } from '../shared/curriculum.ts';

seed();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(express.json({ limit: '12mb' })); // homework images arrive base64-encoded (≤ 8 MB binary)
app.use(express.urlencoded({ extended: false, limit: '64kb' })); // Apple OAuth form_post
app.use(cookieParser());
app.use(loadSession);

const api = express.Router();
api.use(rateLimit('api', 600, 60_000, (req) => req.user?.id ?? req.ip ?? 'anon'));
api.use(csrfGuard);
api.get('/health', (_req, res) => res.json({ ok: true, app: APP_NAME }));
api.get('/config', (_req, res) => res.json({ appName: config.appName, ai: { configured: aiConfigured() }, oauth: oauthConfigured }));
api.use('/auth/oauth', oauthRouter);
api.use('/auth', authRouter);
api.use('/profiles', profilesRouter);
api.use('/family', familyRouter);
api.use('/admin', adminRouter);
api.use('/me', learnRouter, aiRouter, plansRouter);
api.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));
app.use('/api', api);

// Production: serve the built single-page app.
// (Skipped when bundled as a serverless function, where the CDN serves the app and import.meta.url is unavailable.)
const dist = import.meta.url ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist') : '';
if (dist && existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => { if (file.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);

export { app };

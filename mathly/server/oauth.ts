// OAuth / OpenID Connect sign-in for Google, Microsoft and Apple.
// Each provider activates only when its environment variables are set (see .env.example).
import { createHash, createSign, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { config, oauthConfigured } from './config.ts';
import { audit, one, run } from './db.ts';
import { HttpError } from './security.ts';
import { createSession, mergeGuestInto } from './auth.ts';
import { track } from './analytics.ts';

type Provider = 'google' | 'microsoft' | 'apple';
const PROVIDERS: Record<Provider, { authUrl: string; tokenUrl: string; scope: string }> = {
  google: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scope: 'openid email profile' },
  microsoft: { authUrl: `https://login.microsoftonline.com/${config.oauth.microsoft.tenant}/oauth2/v2.0/authorize`, tokenUrl: `https://login.microsoftonline.com/${config.oauth.microsoft.tenant}/oauth2/v2.0/token`, scope: 'openid email profile' },
  apple: { authUrl: 'https://appleid.apple.com/auth/authorize', tokenUrl: 'https://appleid.apple.com/auth/token', scope: 'name email' },
};
const redirectUri = (p: Provider) => `${config.publicUrl}/api/auth/oauth/${p}/callback`;
const b64url = (b: Buffer) => b.toString('base64url');

function appleClientSecret() {
  const { teamId, clientId, keyId, privateKey } = config.oauth.apple;
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(Buffer.from(JSON.stringify({ iss: teamId, iat: now, exp: now + 3600, aud: 'https://appleid.apple.com', sub: clientId })));
  const signer = createSign('SHA256'); signer.update(`${header}.${payload}`);
  const sig = signer.sign({ key: privateKey!, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

function decodeIdToken(idToken: string): Record<string, unknown> {
  // The token comes directly from the provider's token endpoint over TLS (server-to-server), so the
  // payload can be trusted without re-verifying the signature (per OIDC Core §3.1.3.7, item 6).
  const part = idToken.split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export const oauthRouter = Router();

oauthRouter.get('/:provider/start', (req, res) => {
  const provider = req.params.provider as Provider;
  if (!(provider in PROVIDERS)) throw new HttpError(404, 'Unknown sign-in provider');
  if (!oauthConfigured[provider]) return res.redirect(`/setup?missing=${provider}`);
  const state = b64url(randomBytes(24)); const verifier = b64url(randomBytes(32));
  run('INSERT INTO oauth_states (state, provider, verifier, guest_user_id) VALUES (?, ?, ?, ?)', state, provider, verifier, req.user?.is_guest ? req.user.id : null);
  const cfg = PROVIDERS[provider]; const clientId = config.oauth[provider].clientId!;
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(provider), response_type: 'code', scope: cfg.scope, state });
  if (provider === 'apple') params.set('response_mode', 'form_post');
  else { params.set('code_challenge', b64url(createHash('sha256').update(verifier).digest())); params.set('code_challenge_method', 'S256'); }
  res.redirect(`${cfg.authUrl}?${params}`);
});

async function handleCallback(provider: Provider, code: string, state: string, res: import('express').Response, appleUser?: string) {
  const st = one<{ provider: string; verifier: string; guest_user_id: string | null; created_at: string }>('SELECT * FROM oauth_states WHERE state = ?', state);
  run('DELETE FROM oauth_states WHERE state = ?', state);
  if (!st || st.provider !== provider) throw new HttpError(400, 'Sign-in expired. Please try again.');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(provider), client_id: config.oauth[provider].clientId! });
  if (provider === 'apple') body.set('client_secret', appleClientSecret());
  else { body.set('client_secret', (config.oauth[provider] as { clientSecret?: string }).clientSecret!); body.set('code_verifier', st.verifier); }
  const tr = await fetch(PROVIDERS[provider].tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!tr.ok) throw new HttpError(502, 'The sign-in provider did not respond correctly. Please try again.');
  const tokens = (await tr.json()) as { id_token?: string };
  if (!tokens.id_token) throw new HttpError(502, 'Sign-in failed. Please try again.');
  const claims = decodeIdToken(tokens.id_token);
  const sub = String(claims.sub ?? ''); const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  let name = typeof claims.name === 'string' ? claims.name : null;
  if (appleUser) { try { const u = JSON.parse(appleUser); name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(' ') || name; } catch { /* ignore */ } }
  if (!sub) throw new HttpError(502, 'Sign-in failed. Please try again.');

  let user = one<{ id: string }>('SELECT id FROM users WHERE oauth_provider = ? AND oauth_sub = ?', provider, sub);
  if (!user && email) {
    const existing = one<{ id: string }>('SELECT id FROM users WHERE email = ?', email);
    if (existing) { run('UPDATE users SET oauth_provider = ?, oauth_sub = ? WHERE id = ?', provider, sub, existing.id); user = existing; }
  }
  if (!user) {
    const id = randomUUID();
    const role = email && config.adminEmails.includes(email) ? 'admin' : 'user';
    run('INSERT INTO users (id, email, display_name, role, oauth_provider, oauth_sub) VALUES (?, ?, ?, ?, ?, ?)', id, email, name ?? email?.split('@')[0] ?? 'Learner', role, provider, sub);
    user = { id };
    audit(id, 'account.register', provider);
  }
  if (st.guest_user_id) mergeGuestInto(st.guest_user_id, user.id);
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  createSession(res, user.id);
  track('login', { method: provider });
  res.redirect('/profiles');
}

oauthRouter.get('/:provider/callback', async (req, res) => {
  const provider = req.params.provider as Provider;
  if (req.query.error) return res.redirect('/welcome?error=oauth_cancelled');
  await handleCallback(provider, String(req.query.code ?? ''), String(req.query.state ?? ''), res);
});
// Apple uses response_mode=form_post
oauthRouter.post('/:provider/callback', async (req, res) => {
  const provider = req.params.provider as Provider;
  if (req.body?.error) return res.redirect('/welcome?error=oauth_cancelled');
  await handleCallback(provider, String(req.body?.code ?? ''), String(req.body?.state ?? ''), res, req.body?.user);
});

// Typed fetch wrapper. Adds the CSRF header and active-profile header, and turns
// failures into friendly, user-facing messages (never raw stack traces).
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') { super(message); this.status = status; this.code = code; }
}

let profileId: string | null = null;
export const setApiProfile = (id: string | null) => { profileId = id; };

type Opts = { method?: string; body?: unknown; signal?: AbortSignal };
export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-mathly': '1' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (profileId) headers['x-profile-id'] = profileId;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, navigator.onLine ? 'We couldn’t reach Mathly. Please check your connection and try again.' : 'You’re offline. Your saved lessons remain available.', 'offline');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Request failed.');
    if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mathly:unauthenticated'));
    throw new ApiError(res.status, msg, (data as { code?: string }).code);
  }
  return data as T;
}
export const get = <T>(p: string, signal?: AbortSignal) => api<T>(p, { signal });
export const post = <T>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const patch = <T>(p: string, body: unknown = {}) => api<T>(p, { method: 'PATCH', body });
export const put = <T>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const del = <T>(p: string, body?: unknown) => api<T>(p, { method: 'DELETE', body });
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

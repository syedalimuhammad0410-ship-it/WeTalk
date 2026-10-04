"use client";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Fetch wrapper for our API: JSON in/out, surfaces the server's user-facing error message. */
export async function apiFetch<T = unknown>(url: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", "X-Requested-With": "webscout" },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Network error — check your connection and try again.", "NETWORK", 0);
  }
  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError("Your session has expired. Please sign in again.", "UNAUTHENTICATED", 401);
  }
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status}).`, err?.code ?? "ERROR", res.status);
  }
  return data as T;
}

export function setThemeCookie(pref: "light" | "dark" | "system") {
  document.cookie = `ws_theme=${pref}; path=/; max-age=31536000; samesite=lax`;
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePref = pref;
}

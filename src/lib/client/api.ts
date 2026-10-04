"use client";
import type { ImageRecord, Investigation, InvestigationSummary } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit & { json?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json", ...(init?.headers || {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(401, "Session expired.");
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || j.detail || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  post: <T>(url: string, json: unknown, signal?: AbortSignal) => call<T>(url, { method: "POST", json, signal }),
  get: <T>(url: string) => call<T>(url),
  list: () => call<{ investigations: InvestigationSummary[] }>("/api/investigations"),
  create: (body: { title?: string; mode?: string; customInstructions?: string; demo?: boolean }) => call<{ investigation: Investigation }>("/api/investigations", { method: "POST", json: body }),
  load: (id: string) => call<{ investigation: Investigation }>(`/api/investigations/${id}`),
  save: (inv: Investigation) => call<{ investigation: Investigation }>(`/api/investigations/${inv.id}`, { method: "PUT", json: { investigation: inv } }),
  rename: (id: string, title: string) => call<{ investigation: Investigation }>(`/api/investigations/${id}`, { method: "PATCH", json: { title } }),
  remove: (id: string) => call<{ ok: boolean }>(`/api/investigations/${id}`, { method: "DELETE" }),
  duplicate: (id: string) => call<{ investigation: Investigation }>(`/api/investigations/${id}/duplicate`, { method: "POST" }),
  upload: async (invId: string, blob: Blob, meta: { name: string; width: number; height: number; enhancedFrom?: string; enhancements?: string[] }) => {
    const fd = new FormData();
    fd.append("file", blob, meta.name);
    fd.append("name", meta.name);
    fd.append("width", String(meta.width));
    fd.append("height", String(meta.height));
    if (meta.enhancedFrom) fd.append("enhancedFrom", meta.enhancedFrom);
    if (meta.enhancements) fd.append("enhancements", meta.enhancements.join(","));
    return call<{ image: ImageRecord; sanitized: boolean }>(`/api/investigations/${invId}/images`, { method: "POST", body: fd });
  },
  importExample: (investigationId: string, exampleId: string) => call<{ image: ImageRecord }>("/api/examples/import", { method: "POST", json: { investigationId, exampleId } }),
};

export const imageUrl = (key: string) => `/api/images/${key}`;
// Mapillary's CDN serves signed, CORS-enabled (Access-Control-Allow-Origin: *) image URLs that must be
// fetched exactly as issued, so the browser loads those directly; everything else goes through the proxy.
export const proxied = (url: string) => (/^https:\/\/scontent[\w-]*\.xx\.fbcdn\.net\/m1\/v\/t6\//.test(url) ? url : `/api/image-proxy?url=${encodeURIComponent(url)}`);

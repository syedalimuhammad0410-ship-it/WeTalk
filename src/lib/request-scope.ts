import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";

/**
 * Per-request state for runtimes that forbid sharing I/O objects across
 * requests (Cloudflare Workers). Stored on globalThis so the Worker entry
 * (bundled separately by wrangler) and the Next.js server bundle share it.
 */
export type RequestScope = {
  client?: PrismaClient;
  /** Connection string for this scope (e.g. a Cloudflare Hyperdrive binding); overrides DATABASE_URL. */
  databaseUrl?: string;
};

const KEY = Symbol.for("webscout.requestScope");
const g = globalThis as unknown as Record<symbol, AsyncLocalStorage<RequestScope> | undefined>;
export const requestScope: AsyncLocalStorage<RequestScope> = (g[KEY] ??= new AsyncLocalStorage<RequestScope>());

export function runInRequestScope<T>(fn: () => T, init: Omit<RequestScope, "client"> = {}): T {
  return requestScope.run({ ...init }, fn);
}

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { requestScope } from "./request-scope";

/** True when running inside a Cloudflare Worker (workerd), where I/O objects cannot be shared across requests. */
export const isWorkerRuntime = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: isWorkerRuntime ? 5 : 10 }),
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function currentClient(): PrismaClient {
  // On Workers each request (and each cron invocation) gets its own client; see worker.ts.
  const store = requestScope.getStore();
  if (store) return (store.client ??= createPrismaClient(store.databaseUrl ?? process.env.DATABASE_URL));
  if (isWorkerRuntime) throw new Error("Database used outside a request scope on Cloudflare Workers.");
  return (globalForPrisma.prisma ??= createPrismaClient());
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = currentClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

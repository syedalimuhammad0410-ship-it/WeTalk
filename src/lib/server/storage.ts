import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Storage adapter. Production uses Netlify Blobs (durable, strongly consistent);
 * local development falls back to the filesystem under .data/. A Postgres/Supabase
 * adapter can implement the same interface (see db/schema.sql).
 */
export interface StorageAdapter {
  readonly name: string;
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  getBinary(key: string): Promise<{ data: ArrayBuffer; mime: string } | null>;
  setBinary(key: string, data: ArrayBuffer, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

class FsStorage implements StorageAdapter {
  readonly name = "filesystem (.data)";
  constructor(private root: string) {}
  private file(key: string) {
    const safe = key.replace(/[^a-zA-Z0-9/_\-.]/g, "_").replace(/\.\.+/g, "_");
    return path.join(this.root, safe);
  }
  async getJSON<T>(key: string) {
    try {
      return JSON.parse(await fs.readFile(this.file(key) + ".json", "utf8")) as T;
    } catch {
      return null;
    }
  }
  private chains = new Map<string, Promise<void>>();
  async setJSON(key: string, value: unknown) {
    const f = this.file(key) + ".json";
    const body = JSON.stringify(value);
    // serialize writes per key and write atomically via a unique temp file
    const prev = this.chains.get(f) || Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(f), { recursive: true });
        const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await fs.writeFile(tmp, body);
        await fs.rename(tmp, f);
      });
    this.chains.set(f, next);
    try {
      await next;
    } finally {
      if (this.chains.get(f) === next) this.chains.delete(f);
    }
  }
  async getBinary(key: string) {
    try {
      const data = await fs.readFile(this.file(key) + ".bin");
      const mime = (await fs.readFile(this.file(key) + ".mime", "utf8").catch(() => "application/octet-stream")).trim();
      return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, mime };
    } catch {
      return null;
    }
  }
  async setBinary(key: string, data: ArrayBuffer, mime: string) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f + ".bin", Buffer.from(data));
    await fs.writeFile(f + ".mime", mime);
  }
  async delete(key: string) {
    for (const ext of [".json", ".bin", ".mime"]) await fs.rm(this.file(key) + ext, { force: true });
  }
  async list(prefix: string) {
    const dir = this.file(prefix.endsWith("/") ? prefix : path.dirname(prefix));
    try {
      const files = await fs.readdir(dir);
      const base = prefix.endsWith("/") ? prefix : path.dirname(prefix) + "/";
      return Array.from(new Set(files.map((f) => base + f.replace(/\.(json|bin|mime)$/, "")))).filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  }
}

class BlobStorage implements StorageAdapter {
  readonly name = "Netlify Blobs";
  // Netlify injects a short-lived Blobs token per request: never cache the store client.
  private async store() {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: process.env.TRACE_STORE_NAME || "trace", consistency: "strong" });
  }
  async getJSON<T>(key: string) {
    const s = await this.store();
    return ((await s.get(key, { type: "json" })) as T) ?? null;
  }
  async setJSON(key: string, value: unknown) {
    const s = await this.store();
    await s.setJSON(key, value);
  }
  async getBinary(key: string) {
    const s = await this.store();
    const r = await s.getWithMetadata(key, { type: "arrayBuffer" });
    if (!r) return null;
    return { data: r.data as ArrayBuffer, mime: String((r.metadata as { mime?: string })?.mime || "application/octet-stream") };
  }
  async setBinary(key: string, data: ArrayBuffer, mime: string) {
    const s = await this.store();
    await s.set(key, data, { metadata: { mime } });
  }
  async delete(key: string) {
    const s = await this.store();
    await s.delete(key);
  }
  async list(prefix: string) {
    const s = await this.store();
    const { blobs } = await s.list({ prefix });
    return blobs.map((b) => b.key);
  }
}

let adapter: StorageAdapter | null = null;

export function isNetlifyRuntime() {
  return Boolean(
    process.env.NETLIFY ||
      process.env.NETLIFY_BLOBS_CONTEXT ||
      process.env.NETLIFY_LOCAL ||
      (globalThis as { netlifyBlobsContext?: unknown }).netlifyBlobsContext ||
      (process.env.SITE_ID && process.env.DEPLOY_ID),
  );
}

export function storage(): StorageAdapter {
  if (adapter) return adapter;
  const pref = process.env.TRACE_STORAGE;
  const useBlobs = pref === "blobs" || (pref !== "fs" && isNetlifyRuntime());
  adapter = useBlobs ? new BlobStorage() : new FsStorage(path.join(process.cwd(), ".data"));
  return adapter;
}

import "server-only";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

// Format: scrypt:N:r:p:<salt b64>:<hash b64>  ("$" separators also accepted).
// Colons avoid `$` expansion by .env loaders.
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string, N = 2 ** 15, r = 8, p = 1) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, r, p);
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.trim().split(stored.includes(":") ? ":" : "$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await scryptAsync(password, Buffer.from(saltB64, "base64"), Number(N), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

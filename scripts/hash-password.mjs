// Usage: npm run hash-password -- 'your password'
// Prints a value for the AUTH_PASSWORD_HASH environment variable.
import { scrypt, randomBytes } from "node:crypto";

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: npm run hash-password -- '<password>'");
  process.exit(1);
}
const N = 2 ** 15, r = 8, p = 1;
const salt = randomBytes(16);
scrypt(pw, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => {
  if (err) throw err;
  console.log(`scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${key.toString("base64")}`);
});

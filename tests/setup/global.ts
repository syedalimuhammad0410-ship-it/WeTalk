import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/** Applies migrations to the dedicated test database and clears its rows. Refuses to touch any DB not named *_test. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://webscout:webscout@localhost:5432/webscout_test";
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to run tests against non-test database "${dbName}".`);
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const db = new PrismaClient({ datasources: { db: { url } } });
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.$disconnect();
}

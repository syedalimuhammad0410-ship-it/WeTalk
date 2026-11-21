import "../guard";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { zip } from "../zip";
import { appUrl } from "./connections";

/** Packs companion/ into the Claude Desktop extension (.mcpb = zip with manifest.json). */
export async function buildExtension() {
  const dir = path.join(process.cwd(), "companion");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
  manifest.homepage = appUrl();
  const server = await readFile(path.join(dir, "server", "index.js"));
  return zip([
    { name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: "server/index.js", data: server },
  ]);
}

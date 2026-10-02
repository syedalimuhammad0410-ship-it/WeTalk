import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/server/api";
import { getInvestigation, imageKeyFor } from "@/lib/server/investigations";
import { sanitizeImage } from "@/lib/server/images";
import { storage } from "@/lib/server/storage";
import { commonsFileInfo } from "@/lib/providers/search";
import { USER_AGENT } from "@/lib/server/http";
import { EXAMPLES } from "@/lib/examples";
import { uid } from "@/lib/util";
import type { ImageRecord } from "@/lib/types";

/** Imports a public Wikimedia Commons example photo into an investigation (with attribution). */
export const POST = route(async (req, { user }) => {
  const b = await readJson(req, z.object({ investigationId: z.string().max(64), exampleId: z.string().max(40) }));
  const ex = EXAMPLES.find((e) => e.id === b.exampleId);
  if (!ex) throw new HttpError(404, "Unknown example.");
  await getInvestigation(user.email, b.investigationId);
  const info = await commonsFileInfo(ex.file);
  if (!info) throw new HttpError(502, "Wikimedia Commons did not return this file. Try again shortly.");
  let res: Response | null = null;
  for (let i = 0; i < 3; i++) {
    res = await fetch(info.imageUrl, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (res.ok) break;
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  if (!res?.ok) throw new HttpError(502, `Could not download the example image (${res?.status}).`);
  const clean = await sanitizeImage(await res.arrayBuffer(), 1600);
  const id = uid("img");
  const key = imageKeyFor(user.email, id);
  await storage().setBinary(key, clean.data, clean.mime);
  const image: ImageRecord = {
    id,
    name: ex.file,
    key,
    mime: clean.mime,
    size: clean.data.byteLength,
    width: clean.width,
    height: clean.height,
    sha256: clean.sha256,
    createdAt: new Date().toISOString(),
    demoSource: { title: info.title, url: info.url, license: info.license, author: info.author },
  };
  return { image, example: ex };
}, { limit: 20, name: "example-import" });

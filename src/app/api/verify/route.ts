import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { verifyCandidates } from "@/lib/server/research";

const Body = z.object({
  candidates: z.array(z.object({ id: z.string().max(64), name: z.string().max(200), city: z.string().max(120).optional(), kind: z.string().max(60), activeFrom: z.string().max(20).optional(), activeTo: z.string().max(20).optional(), teamName: z.string().max(200).optional() })).max(5),
  yearHint: z.number().int().min(1600).max(2100).optional(),
  mode: z.string().max(30),
  kinds: z.array(z.enum(["web", "news", "videos", "history"])).max(4),
});

/** Disconfirmation searches: actively looks for evidence that the leading candidates are wrong. */
export const POST = route(async (req, { user }) => verifyCandidates(await readJson(req, Body), await providerContext(user.email)), { limit: 20, name: "verify" });

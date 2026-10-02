import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { createInvestigation, deleteInvestigation, listInvestigations } from "@/lib/server/investigations";
import { getPrefs } from "@/lib/server/settings";

export const GET = route(async (_req, { user }) => {
  let list = await listInvestigations(user.email);
  // data retention: purge investigations not updated within the configured window
  const { retentionDays } = await getPrefs(user.email);
  if (retentionDays > 0) {
    const cutoff = Date.now() - retentionDays * 86400000;
    for (const s of list.filter((x) => Date.parse(x.updatedAt) < cutoff)) await deleteInvestigation(user.email, s.id).catch(() => undefined);
    list = list.filter((x) => Date.parse(x.updatedAt) >= cutoff);
  }
  return { investigations: list };
});

const Create = z.object({
  title: z.string().min(1).max(200).optional(),
  mode: z.enum(["quick", "deep", "visual", "location", "document", "sports", "building", "historical", "custom"]).optional(),
  customInstructions: z.string().max(4000).optional(),
  demo: z.boolean().optional(),
});

export const POST = route(async (req, { user }) => {
  const body = await readJson(req, Create);
  const inv = await createInvestigation(user.email, {
    title: body.title || "Untitled investigation",
    mode: body.mode || "deep",
    customInstructions: body.customInstructions,
    demo: body.demo,
  });
  return { investigation: inv };
}, { limit: 30, name: "create-investigation" });

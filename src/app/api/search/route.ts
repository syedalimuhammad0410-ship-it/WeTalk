import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { runSearch } from "@/lib/server/research";

const Body = z.object({
  kind: z.enum(["web", "news", "videos", "images", "history", "knowledge"]),
  query: z.string().min(2).max(300),
  branch: z.string().max(40).default("manual"),
  officialOnly: z.boolean().optional(),
  userAdded: z.boolean().optional(),
});

/** Single search through the provider abstraction (web/news/videos/images/history). */
export const POST = route(async (req, { user }) => runSearch(await readJson(req, Body), await providerContext(user.email)), { limit: 60, name: "search" });

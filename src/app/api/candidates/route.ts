import { readJson, route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { knowledgeCandidates } from "@/lib/server/research";
import { CandidateBody } from "@/lib/server/schemas";


/** Knowledge-graph candidate generation (team → venues, named places with coordinates). */
export const POST = route(async (req, { user }) => knowledgeCandidates(await readJson(req, CandidateBody), await providerContext(user.email)), { limit: 30, name: "candidates" });

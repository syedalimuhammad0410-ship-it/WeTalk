import { readJson, route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { placeCandidates } from "@/lib/server/research";
import { CandidateBody } from "@/lib/server/schemas";

/** Map-based candidate generation (EXIF GPS, landmarks, named places/streets/addresses). */
export const POST = route(async (req, { user }) => placeCandidates(await readJson(req, CandidateBody), await providerContext(user.email)), { limit: 30, name: "candidates-places" });

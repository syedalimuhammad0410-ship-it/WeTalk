import { route } from "@/lib/server/api";
import { duplicateInvestigation } from "@/lib/server/investigations";

export const POST = route<{ id: string }>(async (_req, { user, params }) => ({ investigation: await duplicateInvestigation(user.email, params.id) }), {
  limit: 20,
  name: "duplicate",
});

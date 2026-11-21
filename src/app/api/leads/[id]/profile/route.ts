import { api } from "@/lib/server/api";
import { businessProfile } from "@/lib/server/profile";

export const GET = api({ permission: "leads.view" }, async (_req, ctx, p) => businessProfile(ctx.workspace.id, p.id!));

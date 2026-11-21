import { api } from "@/lib/server/api";
import { revokeConnection } from "@/lib/server/claude/connections";

export const DELETE = api({ permission: "integrations.manage" }, async (_req, ctx, p) => revokeConnection(ctx.workspace.id, ctx.user.id, p.id!));

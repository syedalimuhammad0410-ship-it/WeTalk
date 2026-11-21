import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { liveControl, liveState, type LiveKind } from "@/lib/server/live";

const kindOf = (k: string | undefined): LiveKind => {
  if (k === "claude" || k === "search") return k;
  throw new AppError("NOT_FOUND", "Unknown live view.");
};

export const GET = api({ permission: "leads.view" }, async (_req, ctx, p) => liveState(ctx.workspace.id, kindOf(p.kind), p.id!));

export const POST = api({ permission: "discovery.run" }, async (req, ctx, p) => {
  const b = await parseBody(req, z.object({ action: z.enum(["pause", "resume", "cancel"]) }));
  return liveControl(ctx.workspace.id, ctx.user.id, kindOf(p.kind), p.id!, b.action);
});

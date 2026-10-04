import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { unknownVariables } from "@/lib/server/email/templates";

export const TemplateBody = z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(["OUTREACH", "FOLLOW_UP", "REPLY"]), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(10000) });

export const GET = api({}, async (_req, ctx) => db.emailTemplate.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }));

export const POST = api({ permission: "templates.manage" }, async (req, ctx) => {
  const b = await parseBody(req, TemplateBody);
  const bad = unknownVariables(`${b.subject} ${b.body}`);
  if (bad.length) throw new AppError("VALIDATION", `Unknown variable(s): ${bad.map((v) => `{{${v}}}`).join(", ")}`);
  return db.emailTemplate.create({ data: { workspaceId: ctx.workspace.id, ...b } });
});

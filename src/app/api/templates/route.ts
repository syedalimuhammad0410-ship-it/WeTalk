import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { unknownVariables } from "@/lib/server/email/templates";
import { TemplateBody } from "@/lib/schemas";


export const GET = api({}, async (_req, ctx) => db.emailTemplate.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }));

export const POST = api({ permission: "templates.manage" }, async (req, ctx) => {
  const b = await parseBody(req, TemplateBody);
  const bad = unknownVariables(`${b.subject} ${b.body}`);
  if (bad.length) throw new AppError("VALIDATION", `Unknown variable(s): ${bad.map((v) => `{{${v}}}`).join(", ")}`);
  return db.emailTemplate.create({ data: { workspaceId: ctx.workspace.id, ...b } });
});

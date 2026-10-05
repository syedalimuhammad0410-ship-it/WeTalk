import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { unknownVariables } from "@/lib/server/email/templates";
import { TemplateBody } from "@/lib/schemas";

export const PATCH = api({ permission: "templates.manage" }, async (req, ctx, p) => {
  const t = await db.emailTemplate.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!t) throw new AppError("NOT_FOUND", "Template not found.");
  const b = await parseBody(req, TemplateBody.partial());
  const bad = unknownVariables(`${b.subject ?? ""} ${b.body ?? ""}`);
  if (bad.length) throw new AppError("VALIDATION", `Unknown variable(s): ${bad.map((v) => `{{${v}}}`).join(", ")}`);
  return db.emailTemplate.update({ where: { id: t.id }, data: b });
});

export const DELETE = api({ permission: "templates.manage" }, async (_req, ctx, p) => {
  const t = await db.emailTemplate.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!t) throw new AppError("NOT_FOUND", "Template not found.");
  await db.emailTemplate.delete({ where: { id: t.id } });
  return { ok: true };
});

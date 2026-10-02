import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/server/api";
import { deleteInvestigation, getInvestigation, saveInvestigation } from "@/lib/server/investigations";

type P = { id: string };

export const GET = route<P>(async (_req, { user, params }) => ({ investigation: await getInvestigation(user.email, params.id) }));

export const PUT = route<P>(async (req, { user, params }) => {
  const body = await readJson(req, z.object({ investigation: z.record(z.string(), z.unknown()) }), 9_000_000);
  if (body.investigation.id !== params.id) throw new HttpError(400, "ID mismatch.");
  return { investigation: await saveInvestigation(user.email, body.investigation) };
}, { limit: 240, name: "save-investigation" });

export const PATCH = route<P>(async (req, { user, params }) => {
  const body = await readJson(req, z.object({ title: z.string().min(1).max(200) }));
  const inv = await getInvestigation(user.email, params.id);
  inv.title = body.title;
  return { investigation: await saveInvestigation(user.email, inv) };
});

export const DELETE = route<P>(async (_req, { user, params }) => {
  await deleteInvestigation(user.email, params.id);
  return { ok: true };
});

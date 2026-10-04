import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/server/workspace";
import { hashPassword } from "@/lib/server/auth";
import type { Role } from "@prisma/client";
import { setAiFactoryForTests, type AiProvider } from "@/lib/server/ai/client";

let n = 0;
export async function makeUser(name = "Test User") {
  n++;
  return db.user.create({ data: { email: `u${Date.now()}-${n}@example.com`, name, passwordHash: await hashPassword("password-123") } });
}

export async function makeWorkspace(opts: { sandbox?: boolean; company?: Record<string, unknown> } = {}) {
  const owner = await makeUser("Owner");
  const ws = await createWorkspace(owner.id, `WS ${Date.now()}-${++n}`);
  await db.workspace.update({ where: { id: ws.id }, data: { onboardingCompleted: true } });
  await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { minMinutesBetweenSends: 0, minDaysBetweenContacts: 0 } });
  if (opts.sandbox !== false) await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "SANDBOX", emailAddress: "agency@studio.test", displayName: "Alex", isDefault: true } });
  await db.companyProfile.update({ where: { workspaceId: ws.id }, data: { companyName: "Studio", senderName: "Alex", services: ["Website design"], ...(opts.company ?? {}) } });
  return { ws, owner };
}

export async function addMember(workspaceId: string, role: Role) {
  const u = await makeUser(role);
  await db.workspaceMember.create({ data: { workspaceId, userId: u.id, role } });
  return u;
}

/** Scriptable fake Claude: responses are chosen by `feature`. */
export function fakeAi(handlers: Partial<Record<string, (prompt: string) => unknown>>, calls: { feature: string; prompt: string }[] = []) {
  const provider: AiProvider = {
    model: "fake-model",
    async json(req) {
      calls.push({ feature: req.feature, prompt: req.prompt });
      const h = handlers[req.feature];
      if (!h) throw new Error(`No fake for ${req.feature}`);
      return req.schema.parse(h(req.prompt));
    },
    async text(req) {
      calls.push({ feature: req.feature, prompt: req.prompt });
      const h = handlers[req.feature];
      if (!h) throw new Error(`No fake for ${req.feature}`);
      return String(h(req.prompt));
    },
  };
  setAiFactoryForTests(async () => provider);
  return calls;
}

export function noAi() {
  setAiFactoryForTests(async () => null);
}

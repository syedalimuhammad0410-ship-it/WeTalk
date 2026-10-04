import "../guard";
import type { Job } from "@prisma/client";
import { db } from "../../db";
import { describeError } from "../errors";
import { notify } from "../activity";
import { runWebsiteAudit } from "../audit/service";
import { DiscoveryInput, runDiscovery } from "../discovery/service";
import { generateOutreachDraft } from "../email/compose";
import { syncAccount } from "../email/inbound";
import { dispatchDueFollowUps } from "../followups";
import { generatePrompt } from "../prompts/service";
import { analyzeInboundMessage } from "../replies/analyze";
import type { JobContext } from "./queue";

type Handler = (job: Job, ctx: JobContext) => Promise<unknown>;

async function forEachLead(ids: string[], ctx: JobContext, verb: string, fn: (id: string) => Promise<void>) {
  const failures: { id: string; error: string }[] = [];
  await ctx.progress({ total: ids.length, processed: 0, message: `${verb}…` });
  let done = 0;
  for (const id of ids) {
    if (await ctx.isCancelled()) break;
    try {
      await fn(id);
    } catch (e) {
      failures.push({ id, error: describeError(e) });
    }
    done++;
    await ctx.progress({ processed: done, message: `${verb} ${done}/${ids.length}${failures.length ? ` (${failures.length} failed)` : ""}` });
  }
  return { processed: done, failed: failures.length, failures: failures.slice(0, 50) };
}

export const HANDLERS: Record<Job["type"], Handler> = {
  async DISCOVERY(job, ctx) {
    const p = job.payload as Record<string, unknown>;
    const input = DiscoveryInput.parse(p.input);
    const r = await runDiscovery(job.workspaceId, input, ctx, job.createdById);
    await notify({ workspaceId: job.workspaceId, type: "JOB_COMPLETED", title: "Business discovery finished", body: r.message, link: "/leads?sort=newest" });
    return r;
  },
  async WEBSITE_AUDIT(job, ctx) {
    const ids = ((job.payload as { businessIds?: string[] }).businessIds ?? []).slice(0, 1000);
    const r = await forEachLead(ids, ctx, "Analysing websites", async (id) => {
      await runWebsiteAudit(job.workspaceId, id, { userId: job.createdById });
    });
    await notify({ workspaceId: job.workspaceId, type: "JOB_COMPLETED", title: "Website audits completed", body: `${r.processed - r.failed} analysed${r.failed ? `, ${r.failed} failed` : ""}.`, link: "/audits" });
    return r;
  },
  async PROMPT_GENERATION(job, ctx) {
    const ids = (job.payload as { businessIds?: string[] }).businessIds ?? [];
    return forEachLead(ids, ctx, "Generating prompts", async (id) => {
      await generatePrompt(job.workspaceId, id, job.createdById);
    });
  },
  async OUTREACH_GENERATION(job, ctx) {
    const p = job.payload as { businessIds?: string[]; templateId?: string | null; campaignId?: string | null };
    return forEachLead(p.businessIds ?? [], ctx, "Generating emails", async (id) => {
      await generateOutreachDraft(job.workspaceId, id, job.createdById, { templateId: p.templateId, campaignId: p.campaignId });
    });
  },
  async BULK_ACTION(job, ctx) {
    // Bulk outreach send: spaced by the workspace's minimum delay; limits enforced by sendEmail.
    const p = job.payload as { messageIds?: string[] };
    const { sendEmail } = await import("../email/send");
    const ids = p.messageIds ?? [];
    const results = await forEachLead(ids, ctx, "Sending emails", async (mid) => {
      const m = await db.emailMessage.findFirst({ where: { id: mid, workspaceId: job.workspaceId, status: "DRAFT" } });
      if (!m) throw new Error("Draft no longer exists");
      for (let attempt = 0; ; attempt++) {
        try {
          await sendEmail({ workspaceId: job.workspaceId, userId: job.createdById, to: m.toAddress, subject: m.subject, body: m.bodyText, kind: "OUTREACH", businessId: m.businessId, campaignId: m.campaignId, draftMessageId: m.id, aiGenerated: m.aiGenerated });
          return;
        } catch (e) {
          const retry = (e as { details?: { retryAfter?: number } }).details?.retryAfter;
          if (retry && attempt < 30 && !(await ctx.isCancelled())) {
            await ctx.progress({ message: `Waiting ${retry}s (minimum delay between sends)…` });
            await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
            continue;
          }
          throw e;
        }
      }
    });
    return results;
  },
  async EMAIL_SYNC(job) {
    const accounts = await db.emailAccount.findMany({ where: { workspaceId: job.workspaceId, provider: "GMAIL", status: { not: "DISCONNECTED" } } });
    const out = [];
    for (const a of accounts) {
      try {
        out.push({ account: a.emailAddress, ...(await syncAccount(a)) });
      } catch (e) {
        await db.emailAccount.update({ where: { id: a.id }, data: { status: "ERROR", lastError: describeError(e).slice(0, 500) } });
        await notify({ workspaceId: job.workspaceId, type: "API_FAILURE", title: `Inbox sync failed for ${a.emailAddress}`, body: describeError(e), link: "/settings/email" });
        out.push({ account: a.emailAddress, error: describeError(e) });
      }
    }
    return out;
  },
  async INBOUND_ANALYSIS(job) {
    const { messageId } = job.payload as { messageId: string };
    return analyzeInboundMessage(job.workspaceId, messageId);
  },
  async FOLLOW_UP_DISPATCH(job) {
    return dispatchDueFollowUps(job.workspaceId);
  },
};

import "./guard";
import { db } from "../db";
import { createWorkspace } from "./workspace";
import { upsertBusiness } from "./leads";
import { runWebsiteAudit } from "./audit/service";
import { classifyBusinessType } from "./intel/classify-type";

const DEMO_BUSINESSES = [
  { name: "[DEMO] Maple Leaf Cleaning Co.", category: "House cleaning service", city: "Mississauga", phone: "(905) 555-0142", email: "hello@demo-mapleleafcleaning.invalid" },
  { name: "[DEMO] Riverside Trattoria", category: "Italian restaurant", city: "Mississauga", phone: "(905) 555-0187", email: "info@demo-riversidetrattoria.invalid" },
  { name: "[DEMO] Northside Plumbing & Drains", category: "Plumber", city: "Brampton", phone: "(905) 555-0119", email: "service@demo-northsideplumbing.invalid" },
  { name: "[DEMO] Fade Factory Barbers", category: "Barber shop", city: "Toronto", phone: "(416) 555-0166", email: null },
  { name: "[DEMO] Greenline Landscaping", category: "Landscaper", city: "Oakville", phone: "(905) 555-0133", email: "quotes@demo-greenline.invalid" },
  { name: "[DEMO] Bright Smile Dental", category: "Dentist", city: "Mississauga", phone: "(905) 555-0171", email: "frontdesk@demo-brightsmile.invalid" },
  { name: "[DEMO] Peak Performance Gym", category: "Gym", city: "Toronto", phone: "(416) 555-0102", email: null },
  { name: "[DEMO] Little Sprouts Daycare", category: "Child care agency", city: "Milton", phone: "(905) 555-0158", email: "office@demo-littlesprouts.invalid" },
];

/**
 * Creates a SEPARATE workspace containing clearly labelled DEMO DATA.
 * Demo data never mixes with real workspaces; demo emails use .invalid domains
 * and a SANDBOX email account so nothing can ever be delivered.
 */
export async function createDemoWorkspace(userId: string) {
  const ws = await createWorkspace(userId, "Demo workspace (DEMO DATA)", { isDemo: true });
  await db.workspace.update({ where: { id: ws.id }, data: { onboardingCompleted: true, onboardingStep: 10 } });
  await db.companyProfile.update({
    where: { workspaceId: ws.id },
    data: { companyName: "[DEMO] Pixel & Pine Studio", senderName: "Alex (demo)", description: "A small web studio building fast, accessible websites for local businesses.", services: ["Website design", "Website development", "Local SEO setup", "Online booking integration"], brandVoice: "Plain-spoken, helpful, no hype." },
  });
  await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "SANDBOX", emailAddress: "demo@sandbox.invalid", displayName: "Alex (demo)", isDefault: true } });
  for (const b of DEMO_BUSINESSES) {
    const r = await upsertBusiness(ws.id, { ...b, source: "DEMO", sourceId: b.name, isDemo: true, emailSource: b.email ? "DEMO DATA" : null });
    const t = classifyBusinessType({ category: b.category, name: b.name });
    await db.business.update({ where: { id: r.business.id }, data: { businessType: t.playbook.id, businessTypeConfidence: t.confidence } });
    await runWebsiteAudit(ws.id, r.business.id, { userId });
  }
  return ws;
}

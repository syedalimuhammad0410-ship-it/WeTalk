import { describe, expect, it } from "vitest";
import { buildPromptContext } from "@/lib/server/prompts/context";
import { composeMasterPrompt, REQUIRED_SECTIONS } from "@/lib/server/prompts/composer";
import { scorePrompt } from "@/lib/server/prompts/quality";
import type { Business } from "@prisma/client";

const base = { id: "b", workspaceId: "w", normalizedName: "", address: "1 Main St", city: "Mississauga", region: "Ontario", phone: "(905) 555-0100", email: null, emailSource: null, website: null, websiteDomain: null, socialLinks: {}, rating: null, reviewCount: null, hours: [], source: "MANUAL", sourceFetchedAt: null, googleMapsUrl: null, businessTypeConfidence: 90 } as unknown as Business;
const make = (name: string, category: string, businessType: string) => composeMasterPrompt(buildPromptContext({ ...base, name, category, businessType } as Business, null, null));

describe("website master prompt", () => {
  const restaurant = make("Luigi's Trattoria", "Italian restaurant", "restaurant");
  const plumber = make("Mike's Plumbing", "Plumber", "plumber");

  it("contains every required section", () => {
    for (const s of REQUIRED_SECTIONS) expect(restaurant).toContain(s);
  });
  it("is long and detailed", () => expect(restaurant.split(/\s+/).length).toBeGreaterThan(3500));
  it("is business specific — a restaurant is not a plumber", () => {
    expect(restaurant).toContain("Online menu".replace("Online menu", "Mobile-friendly HTML menu"));
    expect(restaurant).toContain("Table reservations");
    expect(restaurant).not.toContain("Emergency service call-out");
    expect(plumber).toContain("Emergency service call-out");
    expect(plumber).toContain("Online quote / estimate request");
    expect(plumber).not.toContain("Table reservations");
    expect(restaurant).toContain("schema.org/Restaurant");
    expect(plumber).toContain("schema.org/HomeAndConstructionBusiness");
  });
  it("tells the builder not to invent facts and uses placeholders", () => {
    for (const t of ["Use verified information only", "Never write fake testimonials", "[ADD REAL TESTIMONIAL]", "[VERIFY HOURS]", "[BUSINESS TO PROVIDE PRICING]"]) expect(plumber).toContain(t);
  });
  it("never states unknown facts as verified", () => {
    expect(plumber).toContain("UNKNOWN INFORMATION");
    expect(plumber).toMatch(/Opening hours/);
    expect(plumber).not.toMatch(/since \d{4}/i);
  });
  it("scores ≥ 85 on the quality rubric", () => {
    const ctx = buildPromptContext({ ...base, name: "Mike's Plumbing", category: "Plumber", businessType: "plumber" } as Business, null, null);
    expect(scorePrompt(composeMasterPrompt(ctx), ctx).score).toBeGreaterThanOrEqual(85);
  });
  it("concise mode is shorter but keeps the factuality rules", () => {
    const ctx = buildPromptContext({ ...base, name: "Mike's Plumbing", category: "Plumber", businessType: "plumber" } as Business, null, null, { detail: "concise" });
    const c = composeMasterPrompt(ctx);
    expect(c.length).toBeLessThan(plumber.length);
    expect(c).toContain("Use verified information only");
  });
  it("supports adding and removing features", () => {
    const ctx = buildPromptContext({ ...base, name: "Luigi's", category: "Italian restaurant", businessType: "restaurant" } as Business, null, null, { addFeatures: ["live_chat"], removeFeatures: ["reservations"] });
    const p = composeMasterPrompt(ctx);
    expect(p).toContain("Live chat / messaging");
    expect(p).toContain("Explicitly excluded by request: Table reservations");
  });
});

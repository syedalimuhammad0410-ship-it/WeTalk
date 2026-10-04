import { describe, expect, it } from "vitest";
import { parseRobots } from "@/lib/server/audit/robots";
import { normalizeName, normalizePhone, normalizeWebsite } from "@/lib/server/leads";
import { renderTemplate, unknownVariables } from "@/lib/server/email/templates";
import { parseCsv } from "@/lib/csv";
import { findUnsupportedClaims } from "@/lib/server/prompts/quality";
import { scanCommitments } from "@/lib/server/email/safety";
import { classifyBusinessType } from "@/lib/server/intel/classify-type";
import { encryptSecret, decryptSecret } from "@/lib/server/crypto";
import { can } from "@/lib/permissions";
import { stripQuotedReply } from "@/lib/server/email/mime";

describe("robots.txt", () => {
  const txt = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: badbot\nDisallow: /";
  it("applies longest-match rules", () => {
    const r = parseRobots(txt);
    expect(r.isAllowed("/")).toBe(true);
    expect(r.isAllowed("/private/x")).toBe(false);
    expect(r.isAllowed("/private/ok/page")).toBe(true);
  });
  it("respects full disallow", () => expect(parseRobots("User-agent: *\nDisallow: /").isAllowed("/")).toBe(false));
  it("empty disallow allows all", () => expect(parseRobots("User-agent: *\nDisallow:").isAllowed("/x")).toBe(true));
});

describe("normalisation for de-duplication", () => {
  it("names", () => expect(normalizeName("The ABC Cleaning Co., Inc.")).toBe(normalizeName("ABC cleaning")));
  it("phones", () => expect(normalizePhone("+1 (905) 555-0100")).toBe("9055550100"));
  it("websites ignore shared hosts as dedupe keys", () => {
    expect(normalizeWebsite("www.example.com/path")?.domain).toBe("example.com");
    expect(normalizeWebsite("https://facebook.com/abc")?.domain).toBeNull();
    expect(normalizeWebsite("javascript:alert(1)")).toBeNull();
  });
});

describe("templates", () => {
  it("renders and reports missing variables", () => {
    const r = renderTemplate("Hi {{contact_name}} at {{business_name}} {{city}}", { contact_name: "there", business_name: "ABC" });
    expect(r.text).toBe("Hi there at ABC {{city}}");
    expect(r.missing).toEqual(["city"]);
  });
  it("detects unknown variables", () => expect(unknownVariables("{{business_name}} {{secret}}")).toEqual(["secret"]));
});

describe("csv", () => {
  it("parses quotes and newlines", () => expect(parseCsv('a,b\n"x, y","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]));
});

describe("anti-hallucination guards", () => {
  it("fact guard flags invented details", () => {
    const issues = findUnsupportedClaims("Call (416) 555-9999. Serving since 1998. Over 500 happy customers. Rated 4.9 stars. From $99.", "Phone: (905) 555-0100");
    expect(issues.map((i) => i.type)).toEqual(expect.arrayContaining(["phone number", "year", "customer count", "rating", "price"]));
  });
  it("fact guard accepts details present in the source", () => {
    expect(findUnsupportedClaims("Phone (905) 555-0100", "Phone: (905) 555-0100")).toEqual([]);
  });
  it("commitment scanner blocks unconfigured prices/guarantees/times", () => {
    const c = { pricingEnabled: false, pricingDetails: "", meetingLink: "", permittedClaims: "", services: [] };
    expect(scanCommitments("It would cost $1,500 and we guarantee results. How about 3pm?", c)).toHaveLength(3);
    expect(scanCommitments("Happy to put together a tailored quote.", c)).toEqual([]);
    expect(scanCommitments("Sites start at $2,500", { ...c, pricingEnabled: true, pricingDetails: "Sites start at $2,500" })).toEqual([]);
  });
});

describe("business type intelligence", () => {
  it.each([
    [{ googleTypes: ["italian_restaurant"], name: "Luigi's" }, "restaurant"],
    [{ category: "Plumber", name: "Mike's" }, "plumber"],
    [{ name: "Fade Factory Barbers" }, "barber"],
    [{ category: "Dentist", name: "Bright Smile" }, "dentist"],
    [{ name: "Zzyzx Holdings" }, "general"],
  ])("%o → %s", (sig, id) => expect(classifyBusinessType(sig).playbook.id).toBe(id));
});

describe("misc", () => {
  it("encrypts secrets reversibly", () => {
    process.env.APP_ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef-0123";
    const e = encryptSecret("sk-ant-123");
    expect(e).not.toContain("sk-ant");
    expect(decryptSecret(e)).toBe("sk-ant-123");
  });
  it("role matrix", () => {
    expect(can("VIEWER", "emails.send")).toBe(false);
    expect(can("MEMBER", "emails.send")).toBe(true);
    expect(can("MEMBER", "autoReplies.enable")).toBe(false);
    expect(can("ADMIN", "integrations.manage")).toBe(true);
    expect(can("ADMIN", "workspace.delete")).toBe(false);
    expect(can("OWNER", "workspace.delete")).toBe(true);
  });
  it("strips quoted history from replies", () => {
    expect(stripQuotedReply("Tuesday works.\n\nOn Mon, Alex wrote:\n> Would Tuesday at 10 suit?")).toBe("Tuesday works.");
  });
});

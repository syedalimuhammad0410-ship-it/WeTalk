import { describe, expect, it } from "vitest";
import { decodeCfEmail, revealCloudflareEmails } from "@/lib/server/contacts/cfemail";

describe("Cloudflare email protection", () => {
  const hex = "7c1b1d1010131d12181b15123c141308111d1510521f1311"; // galloandgin@hotmail.com

  it("decodes the hex the way a browser does", () => {
    expect(decodeCfEmail(hex)).toBe("galloandgin@hotmail.com");
    expect(decodeCfEmail("zz")).toBeNull();
  });

  it("puts the plain address back into the page", () => {
    const html = `<p>Email: <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</a></p><a href="/cdn-cgi/l/email-protection#${hex}">Write to us</a>`;
    const out = revealCloudflareEmails(html);
    expect(out).toContain("Email: galloandgin@hotmail.com</p>");
    expect(out).toContain('href="mailto:galloandgin@hotmail.com"');
    expect(revealCloudflareEmails("<p>plain</p>")).toBe("<p>plain</p>");
  });
});

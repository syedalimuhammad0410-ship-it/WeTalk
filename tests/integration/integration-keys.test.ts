import { afterEach, describe, expect, it } from "vitest";
import { resolveIntegrationKey, saveIntegrationKey } from "@/lib/server/workspace";
import { makeWorkspace } from "../helpers";

describe("integration keys reject masked or malformed values", () => {
  const original = process.env.GOOGLE_MAPS_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = original;
  });

  it("refuses to save a masked key and explains why", async () => {
    const { ws } = await makeWorkspace();
    await expect(saveIntegrationKey(ws.id, "GOOGLE_PLACES", "AIzaSyCn••••••••P5g")).rejects.toThrow(/masked/);
    await expect(saveIntegrationKey(ws.id, "GOOGLE_PLACES", "AIza Sy Cn with spaces")).rejects.toThrow(/invalid characters/);
  });

  it("strips surrounding quotes and whitespace from a pasted key", async () => {
    const { ws } = await makeWorkspace();
    await saveIntegrationKey(ws.id, "GOOGLE_PLACES", '  "AIzaTestKey1234567890"  ');
    expect(await resolveIntegrationKey(ws.id, "GOOGLE_PLACES")).toEqual({ key: "AIzaTestKey1234567890", source: "workspace" });
  });

  it("reports a masked server key with the setting name instead of a network error", async () => {
    const { ws } = await makeWorkspace();
    process.env.GOOGLE_MAPS_API_KEY = "AIzaSyCn••••••••P5g";
    await expect(resolveIntegrationKey(ws.id, "GOOGLE_PLACES")).rejects.toThrow(/GOOGLE_MAPS_API_KEY setting is invalid.*masked/);
  });
});

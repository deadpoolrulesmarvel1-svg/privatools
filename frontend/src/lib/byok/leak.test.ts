/**
 * The tests that matter most: a key must not escape through ANY surface.
 *
 * Written as a sweep rather than one assertion per path, so a new error branch
 * is covered by default instead of by someone remembering to add a test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "./client";
import { redact } from "./redact";

const KEY = "sk-ant-api03-DO-NOT-LEAK-ME-0123456789";

afterEach(() => vi.restoreAllMocks());

const FAILURES: Array<[string, () => void]> = [
  ["401 echoing the key", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      { ok: false, status: 401, json: async () => ({ error: `bad key ${KEY}` }) } as unknown as Response);
  }],
  ["429", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      { ok: false, status: 429, json: async () => ({ error: KEY }) } as unknown as Response);
  }],
  ["500 echoing the key", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      { ok: false, status: 500, json: async () => ({ error: KEY }) } as unknown as Response);
  }],
  ["network/CSP refusal carrying the key", () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`Failed to fetch ${KEY}`));
  }],
];

describe("no surface leaks the key", () => {
  it.each(FAILURES)("%s", async (_name, arrange) => {
    arrange();
    let thrown: unknown;
    try {
      await complete({
        providerId: "anthropic", apiKey: KEY, model: "m",
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (e) { thrown = e; }
    expect(JSON.stringify(redact(thrown))).not.toContain("DO-NOT-LEAK-ME");
  });

  it("the key never appears in the request URL", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "x" }] }) } as unknown as Response);
    await complete({
      providerId: "gemini", apiKey: "AIzaDO-NOT-LEAK-ME-123456789012",
      model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }],
    });
    expect(String(f.mock.calls[0][0])).not.toContain("DO-NOT-LEAK-ME");
  });

  it("redaction survives a key pasted into the prompt itself", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    let thrown: unknown;
    try {
      await complete({
        providerId: "openai", apiKey: KEY, model: "m",
        messages: [{ role: "user", content: `summarise this: ${KEY}` }],
      });
    } catch (e) { thrown = e; }
    expect(JSON.stringify(redact(thrown))).not.toContain("DO-NOT-LEAK-ME");
  });
});

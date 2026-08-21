import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "./client";
import type { ByokError } from "./errors";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);
}

describe("complete", () => {
  it("returns the text on success", async () => {
    mockFetch(200, { content: [{ type: "text", text: "hello" }] });
    const out = await complete({
      providerId: "anthropic", apiKey: "sk-ant-x-value", model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out).toBe("hello");
  });

  it("sends the key in a header and never in the URL", async () => {
    const f = mockFetch(200, { content: [{ type: "text", text: "ok" }] });
    await complete({
      providerId: "anthropic", apiKey: "sk-ant-SECRET-VALUE", model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(String(f.mock.calls[0][0])).not.toContain("sk-ant-SECRET-VALUE");
  });

  it("maps a 401 to BadKey", async () => {
    mockFetch(401, { error: "nope" });
    await expect(complete({ providerId: "openai", apiKey: "bad-key-value", model: "m", messages: [] }))
      .rejects.toMatchObject({ kind: "BadKey" });
  });

  it("a CSP/network refusal is reported as CspBlocked, not a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(complete({ providerId: "openai", apiKey: "some-key-value", model: "m", messages: [] }))
      .rejects.toMatchObject({ kind: "CspBlocked" });
  });

  it("an abort is Aborted, not a CSP failure", async () => {
    const err = new Error("aborted"); err.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(err);
    await expect(complete({ providerId: "openai", apiKey: "some-key-value", model: "m", messages: [] }))
      .rejects.toMatchObject({ kind: "Aborted" });
  });

  it("never lets the key reach the thrown error", async () => {
    mockFetch(500, { error: "upstream said sk-ant-LEAKED-VALUE-HERE" });
    try {
      await complete({ providerId: "anthropic", apiKey: "sk-ant-LEAKED-VALUE-HERE", model: "m", messages: [] });
      throw new Error("should have thrown");
    } catch (e) {
      const s = JSON.stringify({ m: (e as Error).message, u: (e as ByokError).userMessage });
      expect(s).not.toContain("LEAKED-VALUE-HERE");
    }
  });

  it("rejects an unknown provider rather than guessing", async () => {
    await expect(complete({ providerId: "nope", apiKey: "k-value-here", model: "m", messages: [] }))
      .rejects.toMatchObject({ kind: "Unsupported" });
  });

  it("the never-proxy promise is stated in the CspBlocked message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    try {
      await complete({ providerId: "openai", apiKey: "some-key-value", model: "m", messages: [] });
    } catch (e) {
      expect((e as ByokError).userMessage.toLowerCase()).toContain("will not route");
    }
  });
});

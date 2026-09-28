import { afterEach, describe, expect, it, vi } from "vitest";
import { friendlyError } from "@/lib/utils";
import { complete } from "./client";
import type { ByokError } from "./errors";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
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

describe("what a refusal says", () => {
  it("reports a Gemini key Google refuses with a 400 as a rejected key", async () => {
    mockFetch(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } });
    await expect(complete({ providerId: "gemini", apiKey: "AIza-dummy-value", model: "gemini-3.8-flash", messages: [{ role: "user", content: "hi" }] }))
      .rejects.toMatchObject({ kind: "BadKey" });
  });

  it("names the model a provider refused", async () => {
    mockFetch(404, { error: { message: "The model `gpt-9` does not exist or you do not have access to it.", code: "model_not_found" } });
    await expect(complete({ providerId: "openai", apiKey: "sk-dummy-value", model: "gpt-9", messages: [{ role: "user", content: "hi" }] }))
      .rejects.toMatchObject({ kind: "BadModel", userMessage: expect.stringContaining('OpenAI refused the model "gpt-9"') });
  });

  it("leads with the key when OpenAI's answer cannot be read, since that is how it refuses a key", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    let shown = "";
    try {
      await complete({ providerId: "openai", apiKey: "sk-dummy-value", model: "gpt-4o", messages: [] });
    } catch (e) {
      shown = (e as ByokError).userMessage;
    }
    expect(shown).toMatch(/^The browser could not read OpenAI's answer\./);
    expect(shown).toContain("check the key on OpenAI's site first");
    expect(friendlyError(shown)).toBe(shown);
  });

  it("keeps a blocked request's explanation through the pages' generic rewording", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    let shown = "";
    try {
      await complete({ providerId: "groq", apiKey: "gsk-dummy-value", model: "m", messages: [] });
    } catch (e) {
      shown = (e as ByokError).userMessage;
    }
    expect(shown).toContain("blocked the request to Groq");
    expect(friendlyError(shown)).toBe(shown);
  });
});

it("does not present an empty successful HTTP response as an AI answer", async () => {
  mockFetch(200, {choices:[]});
  await expect(complete({providerId:'openai-compatible', apiKey:'synthetic-local',model:'missing-model',baseUrl:'http://localhost:11434',messages:[]})).rejects.toMatchObject({userMessage:expect.stringMatching(/returned no answer/)});
});

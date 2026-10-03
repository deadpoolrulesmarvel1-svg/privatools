import { afterEach, describe, expect, it, vi } from "vitest";
import { friendlyError } from "@/lib/utils";
import { complete, transcribe } from "./client";
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
      providerId: "anthropic", apiKey: "sk-ant-x-value", model: "claude-sonnet-5-5",
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

  it("mentions an endpoint off the allowed list only for the custom endpoint, the one that can be", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const shownFor = async (providerId: string, baseUrl?: string) => {
      try {
        await complete({ providerId, apiKey: "synthetic-key-value", model: "m", baseUrl, messages: [] });
      } catch (e) {
        return (e as ByokError).userMessage;
      }
      throw new Error("expected a failure");
    };
    const hosted = await shownFor("groq");
    expect(hosted).not.toContain("custom endpoint");
    expect(hosted).toContain("Check that this device is online");
    expect(await shownFor("openai-compatible", "http://localhost:11434")).toContain("If you are using a custom endpoint it is probably not on the allowed list; otherwise check that this device is online");
  });
});

/**
 * Claude can stop short with HTTP 200: Sonnet 5.5's safety classifiers
 * decline some requests (stop_reason "refusal", content usually empty), and
 * an answer that reaches max_tokens, which its thinking counts toward, stops
 * there ("max_tokens"), possibly before any text. Anthropic's refusal docs say
 * to discard partial output. Both used to reach the pages as "returned no
 * answer. Check the model name", or as a cut-off answer passed off as whole.
 */
describe("when Claude stops short", () => {
  async function shownFor(body: unknown): Promise<ByokError> {
    mockFetch(200, body);
    try {
      await complete({ providerId: "anthropic", apiKey: "sk-ant-dummy-value", model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }] });
    } catch (e) {
      return e as ByokError;
    }
    throw new Error("expected complete() to reject");
  }

  it("says Claude declined, rather than that it gave no answer", async () => {
    const e = await shownFor({ content: [], stop_reason: "refusal", stop_details: { category: "general_harms", explanation: null } });
    expect(e).toMatchObject({ kind: "Declined" });
    expect(e.userMessage).toMatch(/^Claude declined to answer this request/);
    expect(e.userMessage).not.toMatch(/model name/);
    expect(friendlyError(e.userMessage)).toBe(e.userMessage);
  });

  it("discards what Claude wrote before declining", async () => {
    const e = await shownFor({ content: [{ type: "text", text: "Partial answer" }], stop_reason: "refusal" });
    expect(e).toMatchObject({ kind: "Declined" });
  });

  it("says the answer reached its length limit when thinking used it all", async () => {
    const e = await shownFor({ content: [{ type: "thinking", thinking: "…", signature: "s" }], stop_reason: "max_tokens" });
    expect(e).toMatchObject({ kind: "TooLong" });
    expect(e.userMessage).toMatch(/^Claude stopped before finishing its answer/);
    expect(friendlyError(e.userMessage)).toBe(e.userMessage);
  });

  it("does not pass off a cut-off answer as a whole one", async () => {
    for (const stop_reason of ["max_tokens", "model_context_window_exceeded"]) {
      const e = await shownFor({ content: [{ type: "text", text: "The first half of" }], stop_reason });
      expect(e).toMatchObject({ kind: "TooLong" });
    }
  });

  it("still returns a finished answer", async () => {
    mockFetch(200, { content: [{ type: "thinking", thinking: "…", signature: "s" }, { type: "text", text: "Done." }], stop_reason: "end_turn" });
    await expect(complete({ providerId: "anthropic", apiKey: "sk-ant-dummy-value", model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }] }))
      .resolves.toBe("Done.");
  });
});

it("does not present an empty successful HTTP response as an AI answer", async () => {
  mockFetch(200, {choices:[]});
  await expect(complete({providerId:'openai-compatible', apiKey:'synthetic-local',model:'missing-model',baseUrl:'http://localhost:11434',messages:[]})).rejects.toMatchObject({userMessage:expect.stringMatching(/returned no answer/)});
});

describe("transcribe", () => {
  const audio = () => new Blob(["synthetic audio"], { type: "audio/wav" });

  it.each([
    ["together", "https://api.together.xyz/v1/audio/transcriptions", "openai/whisper-large-v3"],
    ["mistral", "https://api.mistral.ai/v1/audio/transcriptions", "voxtral-mini-latest"],
    ["openrouter", "https://openrouter.ai/api/v1/audio/transcriptions", "openai/whisper-large-v3"],
    ["groq", "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3"],
  ])("sends %s its own model when the model box is left empty, and reads the JSON answer", async (providerId, url, model) => {
    const f = mockFetch(200, { text: " Hello from a synthetic recording. " });
    await expect(transcribe({ providerId, apiKey: "dummy-key-value", model: "", file: audio() })).resolves.toBe("Hello from a synthetic recording.");
    expect(f.mock.calls[0][0]).toBe(url);
    const body = f.mock.calls[0][1]!.body as FormData;
    expect(body.get("model")).toBe(model);
    expect(body.has("response_format")).toBe(false);
  });

  it.each(["deepseek", "anthropic", "gemini"])("refuses %s, which has no transcription endpoint, without sending anything", async providerId => {
    const f = vi.spyOn(globalThis, "fetch");
    const refused = transcribe({ providerId, apiKey: "dummy-key-value", model: "", file: audio() });
    await expect(refused).rejects.toMatchObject({ kind: "Unsupported" });
    await expect(refused).rejects.toMatchObject({ userMessage: expect.stringMatching(/use OpenAI, OpenRouter, Groq, Together AI, Mistral or a self-hosted endpoint\.$/) });
    expect(f).not.toHaveBeenCalled();
  });
});

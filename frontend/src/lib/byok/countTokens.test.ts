/**
 * countTokens: the BYOK client's third network call, to Anthropic's
 * count_tokens and Gemini's countTokens. Every provider answer here is a
 * mock; no test talks to a provider or uses a real key.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { friendlyError } from "@/lib/utils";
import { countTokens } from "./client";
import type { ByokError } from "./errors";
import { buildCountTokensRequest, parseCountTokensResponse, providerById, supportsTokenCount, PROVIDERS } from "./providers";
import { redact } from "./redact";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response);
}

const TEXT = "The quick brown fox jumps over the lazy dog.";

describe("the request each provider is sent", () => {
    it("asks Anthropic's count_tokens for the text as one user message, the key in a header", async () => {
        const f = mockFetch(200, { input_tokens: 14 });
        await expect(countTokens({ providerId: "anthropic", apiKey: "sk-ant-synthetic-key-0001", model: "claude-sonnet-5-5", text: TEXT })).resolves.toBe(14);
        expect(f).toHaveBeenCalledTimes(1);
        const [url, init] = f.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({
            "content-type": "application/json",
            "x-api-key": "sk-ant-synthetic-key-0001",
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        });
        expect(JSON.parse(init.body as string)).toEqual({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: TEXT }] });
    });

    it("asks Gemini's countTokens for the text as one user turn, the key in a header and not the URL", async () => {
        const f = mockFetch(200, { totalTokens: 11, promptTokensDetails: [{ modality: "TEXT", tokenCount: 11 }] });
        await expect(countTokens({ providerId: "gemini", apiKey: "AIzaSyntheticKey00000000000000000", model: "gemini-3.8-flash", text: TEXT })).resolves.toBe(11);
        const [url, init] = f.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens");
        expect(url).not.toContain("key=");
        expect(url).not.toContain("AIzaSyntheticKey");
        expect(init.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "AIzaSyntheticKey00000000000000000" });
        expect(JSON.parse(init.body as string)).toEqual({ contents: [{ role: "user", parts: [{ text: TEXT }] }] });
    });

    it("takes a Gemini model as Google's model list names it, and escapes what goes in the path", () => {
        const gemini = providerById("gemini")!;
        expect(buildCountTokensRequest(gemini, { apiKey: "k", model: "models/gemini-3.5-flash-lite", text: "x" }).url)
            .toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:countTokens");
        expect(buildCountTokensRequest(gemini, { apiKey: "k", model: "a/b?c", text: "x" }).url)
            .toBe("https://generativelanguage.googleapis.com/v1beta/models/a%2Fb%3Fc:countTokens");
    });

    it("sends the text exactly as given, special-token look-alikes and all", async () => {
        const f = mockFetch(200, { input_tokens: 9 });
        const text = "  <|endoftext|>\n\tcafé 数据 🙂  ";
        await countTokens({ providerId: "anthropic", apiKey: "sk-ant-synthetic-key-0002", model: "claude-haiku-4-5", text });
        expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).messages[0].content).toBe(text);
    });

    it("is offered only by providers with a count method", () => {
        expect(PROVIDERS.filter(supportsTokenCount).map(p => p.id)).toEqual(["anthropic", "gemini"]);
        expect(() => buildCountTokensRequest(providerById("openai")!, { apiKey: "k", model: "m", text: "x" })).toThrow();
    });

    it("refuses a provider without a count method before sending anything", async () => {
        const f = mockFetch(200, {});
        await expect(countTokens({ providerId: "openai", apiKey: "sk-synthetic-key-0003", model: "gpt-4o", text: TEXT }))
            .rejects.toMatchObject({ kind: "Unsupported" });
        await expect(countTokens({ providerId: "nope", apiKey: "k-synthetic-0004", model: "m", text: TEXT }))
            .rejects.toMatchObject({ kind: "Unsupported" });
        expect(f).not.toHaveBeenCalled();
    });
});

describe("reading the count", () => {
    it("accepts only a whole, non-negative count", () => {
        const anthropic = providerById("anthropic")!;
        const gemini = providerById("gemini")!;
        expect(parseCountTokensResponse(anthropic, { input_tokens: 0 })).toBe(0);
        expect(parseCountTokensResponse(gemini, { totalTokens: 123456 })).toBe(123456);
        for (const bad of [null, "14", {}, { input_tokens: "14" }, { input_tokens: -1 }, { input_tokens: 1.5 }, { totalTokens: 3 }]) {
            expect(parseCountTokensResponse(anthropic, bad)).toBeUndefined();
        }
        expect(parseCountTokensResponse(gemini, { input_tokens: 3 })).toBeUndefined();
    });

    it("does not invent a count when a successful answer has none", async () => {
        mockFetch(200, { something: "else" });
        await expect(countTokens({ providerId: "gemini", apiKey: "AIzaSyntheticKey00000000000000001", model: "gemini-3.8-flash", text: TEXT }))
            .rejects.toMatchObject({ kind: "Unknown", userMessage: expect.stringMatching(/^Google Gemini answered without a token count/) });
    });
});

describe("what a refusal says", () => {
    async function shownFor(providerId: string, status: number, body: unknown, model = "claude-sonnet-5-5"): Promise<ByokError> {
        mockFetch(status, body);
        try {
            await countTokens({ providerId, apiKey: providerId === "gemini" ? "AIzaSyntheticKey00000000000000002" : "sk-ant-synthetic-key-0005", model, text: TEXT });
        } catch (e) {
            return e as ByokError;
        }
        throw new Error("expected countTokens() to reject");
    }

    it("a key Anthropic refuses is a rejected key", async () => {
        const e = await shownFor("anthropic", 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
        expect(e).toMatchObject({ kind: "BadKey", userMessage: expect.stringMatching(/^That key was rejected/) });
        expect(friendlyError(e.userMessage)).toBe(e.userMessage);
    });

    it("a key Google refuses with a 400 is a rejected key", async () => {
        const e = await shownFor("gemini", 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, "gemini-3.8-flash");
        expect(e).toMatchObject({ kind: "BadKey" });
    });

    it("names the model a provider does not know", async () => {
        const claude = await shownFor("anthropic", 404, { type: "error", error: { type: "not_found_error", message: "model: claude-nonexistent" } }, "claude-nonexistent");
        expect(claude).toMatchObject({ kind: "BadModel", userMessage: expect.stringContaining('Anthropic (Claude) refused the model "claude-nonexistent"') });
        const gemini = await shownFor("gemini", 404, { error: { code: 404, message: "models/gemini-0 is not found for API version v1beta, or is not supported for countTokens.", status: "NOT_FOUND" } }, "gemini-0");
        expect(gemini).toMatchObject({ kind: "BadModel", userMessage: expect.stringContaining('Google Gemini refused the model "gemini-0"') });
    });

    it("says when the text is more than the provider takes at once", async () => {
        const e = await shownFor("anthropic", 413, { type: "error", error: { type: "request_too_large", message: "Request exceeds the maximum allowed number of bytes." } });
        expect(e).toMatchObject({ kind: "TooLong", userMessage: expect.stringMatching(/^Anthropic \(Claude\) refused this request because it holds more text/) });
    });

    it("says when the provider is limiting the key's requests", async () => {
        expect(await shownFor("anthropic", 429, { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } }))
            .toMatchObject({ kind: "RateLimited" });
    });

    it("puts a provider fault on the provider", async () => {
        expect(await shownFor("gemini", 503, { error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" } }, "gemini-3.8-flash"))
            .toMatchObject({ kind: "ProviderDown" });
    });

    it("a blocked or failed request is reported as blocked, and PrivaTools offers no detour", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
        let shown: ByokError | undefined;
        try {
            await countTokens({ providerId: "anthropic", apiKey: "sk-ant-synthetic-key-0006", model: "claude-sonnet-5-5", text: TEXT });
        } catch (e) { shown = e as ByokError; }
        expect(shown).toMatchObject({ kind: "CspBlocked" });
        expect(shown!.userMessage).toContain("blocked the request to Anthropic (Claude)");
        expect(shown!.userMessage).toContain("will not route your key or your file through its own server");
        // This page offers no custom endpoint, so the message names none.
        expect(shown!.userMessage).not.toContain("custom endpoint");
        expect(friendlyError(shown!.userMessage)).toBe(shown!.userMessage);
    });

    it("a cancel is Aborted", async () => {
        const err = new Error("aborted"); err.name = "AbortError";
        vi.spyOn(globalThis, "fetch").mockRejectedValue(err);
        await expect(countTokens({ providerId: "gemini", apiKey: "AIzaSyntheticKey00000000000000003", model: "gemini-3.8-flash", text: TEXT }))
            .rejects.toMatchObject({ kind: "Aborted" });
    });

    it("passes the caller's signal to the request", async () => {
        const f = mockFetch(200, { input_tokens: 1 });
        const controller = new AbortController();
        await countTokens({ providerId: "anthropic", apiKey: "sk-ant-synthetic-key-0007", model: "claude-sonnet-5-5", text: "a", signal: controller.signal });
        expect((f.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
    });
});

describe("the key never escapes", () => {
    const KEY = "sk-ant-api03-DO-NOT-LEAK-COUNT-0123456789";
    it.each([
        ["401 echoing the key", () => mockFetch(401, { error: { message: `invalid x-api-key ${KEY}` } })],
        ["500 echoing the key", () => mockFetch(500, { error: KEY })],
        ["a failed request carrying the key", () => vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`Failed to fetch ${KEY}`))],
        ["an answer with no count", () => mockFetch(200, { echo: KEY })],
    ])("%s", async (_name, arrange) => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        arrange();
        let thrown: unknown;
        try {
            await countTokens({ providerId: "anthropic", apiKey: KEY, model: "claude-sonnet-5-5", text: TEXT });
        } catch (e) { thrown = e; }
        expect(thrown).toBeDefined();
        expect(JSON.stringify(redact(thrown))).not.toContain("DO-NOT-LEAK-COUNT");
        expect(JSON.stringify({ m: (thrown as Error).message, u: (thrown as ByokError).userMessage })).not.toContain("DO-NOT-LEAK-COUNT");
        // Nothing about the request is logged, key or not.
        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });
});

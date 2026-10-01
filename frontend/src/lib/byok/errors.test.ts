import { describe, expect, it } from "vitest";
import { ByokError, classifyHttpStatus } from "./errors";

describe("classifyHttpStatus", () => {
  it("maps 401/403 to a bad key", () => {
    expect(classifyHttpStatus(401).kind).toBe("BadKey");
    expect(classifyHttpStatus(403).kind).toBe("BadKey");
  });
  it("maps 429 to rate limited", () => {
    expect(classifyHttpStatus(429).kind).toBe("RateLimited");
  });
  it("maps 402 to no credit", () => {
    expect(classifyHttpStatus(402).kind).toBe("NoCredit");
  });
  it("maps 5xx to provider down", () => {
    expect(classifyHttpStatus(500).kind).toBe("ProviderDown");
    expect(classifyHttpStatus(503).kind).toBe("ProviderDown");
  });
  it("every error carries a user-facing message that names a next step", () => {
    for (const s of [401, 402, 429, 500]) {
      expect(classifyHttpStatus(s).userMessage.length).toBeGreaterThan(20);
    }
  });
  it("a ByokError is a real Error so it survives throw/catch", () => {
    const e = new ByokError("CspBlocked", "blocked", "Explain it.");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("CspBlocked");
  });
});

/** Google's answer to a dummy key on 2026-09-28: a 400, not a 401. */
const GEMINI_BAD_KEY = JSON.stringify({ error: {
  code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT",
  details: [
    { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com", metadata: { service: "generativelanguage.googleapis.com" } },
    { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message: "API key not valid. Please pass a valid API key." },
  ],
} });

/** Refusals of a model, in the shape each API documents. */
const NO_SUCH_MODEL: [string, number, string][] = [
  ["OpenAI", 404, JSON.stringify({ error: { message: "The model `gpt-9` does not exist or you do not have access to it.", type: "invalid_request_error", param: null, code: "model_not_found" } })],
  ["Anthropic (Claude)", 404, JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: claude-9" } })],
  ["Google Gemini", 404, JSON.stringify({ error: { code: 404, message: "models/gemini-2.0-flash is not found for API version v1beta, or is not supported for generateContent.", status: "NOT_FOUND" } })],
  ["Groq", 404, JSON.stringify({ error: { message: "The model `llama-9` does not exist or you do not have access to it.", type: "invalid_request_error", code: "model_not_found" } })],
  ["OpenRouter", 400, JSON.stringify({ error: { message: "auto is not a valid model ID", code: 400 } })],
  ["Together AI", 404, JSON.stringify({ error: { message: "Unable to access model meta-llama/Llama-3-70b-chat-hf. Please visit https://api.together.ai/models to view the list of supported models.", type: "invalid_request_error", code: "model_not_available" } })],
  ["Mistral", 400, JSON.stringify({ object: "error", message: "Invalid model: mistral-9", type: "invalid_model", param: null, code: "1500" })],
  ["DeepSeek", 400, JSON.stringify({ error: { message: "Model Not Exist", type: "invalid_request_error", param: null, code: "invalid_request_error" } })],
  // OpenRouter, when the account's privacy settings leave no provider for the model.
  ["OpenRouter", 404, JSON.stringify({ error: { message: "No endpoints available matching your guardrail restrictions and data policy. Configure: https://openrouter.ai/settings/privacy", code: 404 } })],
  ["Local or self-hosted (OpenAI-compatible)", 404, JSON.stringify({ error: "model \"llama9\" not found, try pulling it first" })],
];

/** Requests refused for their size, in the shape each API documents. */
const TOO_MUCH_TEXT: [string, number, string][] = [
  ["OpenAI", 400, JSON.stringify({ error: { message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens.", type: "invalid_request_error", param: "messages", code: "context_length_exceeded" } })],
  ["Anthropic (Claude)", 400, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } })],
  ["Google Gemini", 400, JSON.stringify({ error: { code: 400, message: "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).", status: "INVALID_ARGUMENT" } })],
  ["Groq", 413, JSON.stringify({ error: { message: "Request too large for model `llama-3.3-70b-versatile` in organization `org_1` service tier `on_demand` on tokens per minute (TPM): Limit 12000, Requested 26000, please reduce your message size and try again.", type: "tokens", code: "rate_limit_exceeded" } })],
];

describe("classifyHttpStatus with the provider's answer", () => {
  it("reports a Gemini key Google refuses as a bad key, though Google answers 400", () => {
    const err = classifyHttpStatus(400, GEMINI_BAD_KEY, { label: "Google Gemini", model: "gemini-3.8-flash" });
    expect(err.kind).toBe("BadKey");
    expect(err.userMessage).toMatch(/key was rejected/);
  });

  it.each(NO_SUCH_MODEL)("says %s has no such model, naming it, when it refuses the model", (label, status, body) => {
    const err = classifyHttpStatus(status, body, { label, model: "the-model-asked-for" });
    expect(err.kind).toBe("BadModel");
    expect(err.userMessage).toContain(label);
    expect(err.userMessage).toContain('"the-model-asked-for"');
    expect(err.userMessage).toMatch(/Model field/);
  });

  it.each(TOO_MUCH_TEXT)("says the request held too much text when %s refuses it for size", (label, status, body) => {
    const err = classifyHttpStatus(status, body, { label, model: "m" });
    expect(err.kind).toBe("TooLong");
    expect(err.userMessage).toMatch(/shorter document/);
  });

  it("does not blame the key or the model for an address the provider does not serve", () => {
    const groq = JSON.stringify({ error: { message: "Unknown request URL: POST /v1/chat/completions. Please check the URL for typos, or see the docs at https://console.groq.com/docs/", type: "invalid_request_error", code: "unknown_url" } });
    for (const body of [groq, "<!DOCTYPE html><html><title>404</title></html>"]) {
      const err = classifyHttpStatus(404, body, { label: "Groq", model: "llama-3.3-70b-versatile" });
      expect(err.kind).toBe("Unknown");
      expect(err.userMessage).toMatch(/not in your key or your file/);
    }
    const custom = classifyHttpStatus(404, "", { label: "Local or self-hosted (OpenAI-compatible)", model: "llama3", customEndpoint: true });
    expect(custom.userMessage).toMatch(/Check the base URL/);
  });

  it("asks for a model name when the request named none", () => {
    const err = classifyHttpStatus(400, JSON.stringify({ error: { message: "model is required" } }), { label: "Local or self-hosted (OpenAI-compatible)", model: "", customEndpoint: true });
    expect(err.kind).toBe("BadModel");
    expect(err.userMessage).toMatch(/Type the name of a model/);
  });

  it("never repeats what the provider said, which can quote part of the key", () => {
    const body = JSON.stringify({ error: { message: "Incorrect API key provided: sk-dumm*****-key. You can find your API key at https://platform.openai.com/account/api-keys." } });
    for (const status of [400, 401, 404, 413, 500]) {
      const err = classifyHttpStatus(status, body, { label: "OpenAI", model: "gpt-4o" });
      expect(`${err.message} ${err.userMessage}`).not.toContain("sk-dumm");
    }
  });

  it("words nothing so that the page's generic rewording would read it as a server or network fault", () => {
    const messages = [GEMINI_BAD_KEY, ...NO_SUCH_MODEL.map(c => c[2]), ...TOO_MUCH_TEXT.map(c => c[2]), ""]
      .flatMap(body => [400, 401, 402, 404, 413, 429, 500].map(status => classifyHttpStatus(status, body, { label: "Groq", model: "m" }).userMessage));
    for (const message of messages) expect(message).not.toMatch(/network|connection|too large|timed? ?out|413|429|504|password|encrypt|protected/i);
  });
});

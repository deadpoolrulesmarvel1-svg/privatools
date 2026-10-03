import { describe, expect, it } from "vitest";
import { PROVIDERS, buildRequest, buildTranscribeRequest, parseResponse, providerById, reachedLengthLimit, stoppedShort, supportsTranscription, transcriptionProviderNames } from "./providers";

/**
 * Where each provider serves its API, from its own documentation. Checked on
 * 2026-09-28 with a dummy key: each address below refuses the key (401, or
 * 400 API_KEY_INVALID from Gemini), and Groq's and OpenRouter's old /v1
 * addresses answered 404, so every request to those two providers failed
 * whatever the key.
 */
const CHAT_ENDPOINTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models/some-model:generateContent",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  together: "https://api.together.xyz/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
};

describe("provider endpoints", () => {
  it.each(Object.entries(CHAT_ENDPOINTS))("%s requests go to its documented endpoint", (id, endpoint) => {
    const req = buildRequest(providerById(id)!, { apiKey: "k", model: "some-model", messages: [{ role: "user", content: "hi" }] });
    expect(req.url).toBe(endpoint);
  });

  it("every hosted provider has its endpoint checked here", () => {
    const hosted = PROVIDERS.filter(p => !p.customBaseUrl).map(p => p.id).sort();
    expect(Object.keys(CHAT_ENDPOINTS).sort()).toEqual(hosted);
  });

  /**
   * Model ids a provider no longer serves, never served, or has deprecated
   * with a shutdown date. The pages send the provider's first model when the
   * visitor leaves the model box empty, so a dead default fails every such
   * run. Sources, read 2026-09-28: Google's Gemini API changelog (2.0 Flash
   * shut down 2026-06-01; 2.0 Pro was never a stable id), DeepSeek's changelog
   * (deepseek-chat and deepseek-reasoner discontinued 2026-07-24),
   * OpenRouter's model list (its router is openrouter/auto; "auto" is no
   * model), Together's serverless model list, and Groq's deprecations and
   * models pages (Llama 3.3 70B and 3.1 8B shut down 2026-08-16 for free and
   * developer plans, which BYOK visitors hold; the models page lists them for
   * Enterprise only). Anthropic's deprecations page, read 2026-10-01: Opus 4.1
   * retired 2026-08-05; Sonnet 4.5 deprecated 2026-09-30, retiring 2026-11-30,
   * with claude-sonnet-5-5 named as its replacement.
   */
  const NOT_SERVED: Record<string, string[]> = {
    gemini: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-pro"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    openrouter: ["auto"],
    together: ["meta-llama/Llama-3-70b-chat-hf"],
    anthropic: ["claude-opus-4-1", "claude-sonnet-4-5"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  };

  it.each(Object.entries(NOT_SERVED))("%s offers no model it has shut down or deprecated", (id, gone) => {
    const models = providerById(id)!.models;
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) expect(gone).not.toContain(model);
  });

  it("sends a transcription to the provider's own API path", () => {
    const file = new Blob(["x"], { type: "audio/wav" });
    expect(buildTranscribeRequest(providerById("groq")!, { apiKey: "k", model: "whisper-large-v3", file }).url)
      .toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(buildTranscribeRequest(providerById("openai")!, { apiKey: "k", model: "whisper-1", file }).url)
      .toBe("https://api.openai.com/v1/audio/transcriptions");
  });
});

/**
 * Speech to text, from each provider's own documentation, read 2026-10-03:
 * OpenAI's audio/transcriptions; Groq's, under /openai/v1; Together's, whose
 * API reference lists openai/whisper-large-v3 as its model and default;
 * Mistral's, whose models are Voxtral (voxtral-mini-latest); and OpenRouter's
 * /api/v1/audio/transcriptions, added in July 2026, which takes OpenAI-style
 * multipart uploads. None of them serves a model called "whisper-1" except
 * OpenAI. DeepSeek, Anthropic and Gemini have no transcription endpoint.
 */
const TRANSCRIPTION: Record<string, { url: string; model: string }> = {
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
  openrouter: { url: "https://openrouter.ai/api/v1/audio/transcriptions", model: "openai/whisper-large-v3" },
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3" },
  together: { url: "https://api.together.xyz/v1/audio/transcriptions", model: "openai/whisper-large-v3" },
  mistral: { url: "https://api.mistral.ai/v1/audio/transcriptions", model: "voxtral-mini-latest" },
};

describe("transcription", () => {
  const audio = () => new Blob(["synthetic audio"], { type: "audio/wav" });

  it("is offered only by providers with a speech-to-text endpoint, and a self-hosted server", () => {
    expect(PROVIDERS.filter(supportsTranscription).map(p => p.id).sort())
      .toEqual([...Object.keys(TRANSCRIPTION), "openai-compatible"].sort());
    for (const id of ["deepseek", "anthropic", "gemini"]) {
      expect(() => buildTranscribeRequest(providerById(id)!, { apiKey: "k", model: "m", file: audio() })).toThrow(/no OpenAI-style transcription/);
    }
  });

  it.each(Object.entries(TRANSCRIPTION))("%s gets its own model at its documented endpoint", (id, { url, model }) => {
    const provider = providerById(id)!;
    expect(provider.transcribeModel).toBe(model);
    const request = buildTranscribeRequest(provider, { apiKey: "k", model, file: audio() });
    expect(request.url).toBe(url);
    expect(request.body.get("model")).toBe(model);
    // JSON is every one's default; Together and OpenRouter document no "text"
    // answer, and Mistral no response_format at all.
    expect(request.body.has("response_format")).toBe(false);
  });

  it("asks Together to detect the language, as the others do unasked", () => {
    for (const id of Object.keys(TRANSCRIPTION)) {
      const request = buildTranscribeRequest(providerById(id)!, { apiKey: "k", model: "m", file: audio() });
      // Together's language defaults to "en", which heard every recording as English.
      expect(request.body.get("language"), id).toBe(id === "together" ? "auto" : null);
    }
  });

  it("names the providers that can transcribe", () => {
    expect(transcriptionProviderNames()).toBe("OpenAI, OpenRouter, Groq, Together AI, Mistral or a self-hosted endpoint");
  });
});

describe("provider registry", () => {
  it("every provider declares an https origin, or loopback for local models", () => {
    for (const p of PROVIDERS) {
      expect(p.origin).toMatch(/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/);
    }
  });

  it("ids are unique", () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
  });

  it("anthropic sends the browser-access header CORS requires", () => {
    const req = buildRequest(providerById("anthropic")!, {
      apiKey: "sk-ant-test", model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }],
    });
    expect(req.headers["x-api-key"]).toBe("sk-ant-test");
    expect(req.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(req.headers["anthropic-version"]).toBeTruthy();
    expect(req.url).toContain("/v1/messages");
  });

  it("openai uses a bearer token", () => {
    const req = buildRequest(providerById("openai")!, {
      apiKey: "sk-test", model: "gpt-4o", messages: [{ role: "user", content: "hi" }],
    });
    expect(req.headers.authorization).toBe("Bearer sk-test");
    expect(req.url).toContain("/v1/chat/completions");
  });

  it("gemini puts the key in a header, never the URL", () => {
    const req = buildRequest(providerById("gemini")!, {
      apiKey: "AIzaTEST", model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }],
    });
    expect(req.headers["x-goog-api-key"]).toBe("AIzaTEST");
    // Regression guard: Google's own docs show ?key=..., which would put the
    // secret in history, logs and Referer headers.
    expect(req.url).not.toContain("AIzaTEST");
  });

  it("a custom OpenAI-compatible endpoint overrides the base url", () => {
    const req = buildRequest(providerById("openai-compatible")!, {
      apiKey: "k", model: "llama3", messages: [{ role: "user", content: "hi" }],
      baseUrl: "http://localhost:11434",
    });
    expect(req.url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("a custom endpoint with no base url is an error, not a silent default", () => {
    expect(() => buildRequest(providerById("openai-compatible")!, {
      apiKey: "k", model: "llama3", messages: [],
    })).toThrow();
  });

  it("parses each provider's response shape", () => {
    expect(parseResponse(providerById("anthropic")!, { content: [{ type: "text", text: "A" }] })).toBe("A");
    expect(parseResponse(providerById("openai")!, { choices: [{ message: { content: "B" } }] })).toBe("B");
    expect(parseResponse(providerById("gemini")!, { candidates: [{ content: { parts: [{ text: "C" }] } }] })).toBe("C");
  });

  it("parsing a malformed response yields empty string, not a crash", () => {
    for (const id of ["anthropic", "openai", "gemini"]) {
      expect(parseResponse(providerById(id)!, {})).toBe("");
    }
  });

  it("anthropic hoists system messages out of the turn list", () => {
    const req = buildRequest(providerById("anthropic")!, {
      apiKey: "k", model: "m",
      messages: [{ role: "system", content: "be terse" }, { role: "user", content: "hi" }],
    });
    const body = JSON.parse(req.body);
    expect(body.system).toBe("be terse");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });
});

/**
 * What a Claude request asks for, checked against Anthropic's documentation
 * on 2026-10-01. Sonnet 5.5 thinks before it answers (adaptive thinking, at
 * effort "high" unless told otherwise), and its thinking counts toward
 * max_tokens, so a 4,096 cap could end a long answer early, or before any
 * text. The effort level goes inside output_config, never at the top level,
 * and only to models that take one: the overview lists effort as "Not
 * supported" on Haiku 4.5. Temperature, top_p, top_k, a thinking budget and
 * an assistant prefill are refused by these models, so the bodies are
 * compared whole.
 */
describe("Anthropic request body", () => {
  const anthropic = () => providerById("anthropic")!;
  const messages = [{ role: "system" as const, content: "be terse" }, { role: "user" as const, content: "hi" }];
  const bodyFor = (model: string) => JSON.parse(buildRequest(anthropic(), { apiKey: "k", model, messages }).body);

  it("defaults to Sonnet 5.5, then Haiku 4.5", () => {
    expect(anthropic().models).toEqual(["claude-sonnet-5-5", "claude-haiku-4-5"]);
  });

  it("asks Sonnet 5.5 for medium effort, with room for its thinking and the answer", () => {
    expect(bodyFor("claude-sonnet-5-5")).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("never sends Haiku 4.5 an effort level", () => {
    expect(bodyFor("claude-haiku-4-5")).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 16000,
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it.each(["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-5-20251101"])(
    "sends an effort level to %s, which Anthropic lists as taking one", (model) => {
      expect(bodyFor(model).output_config).toEqual({ effort: "medium" });
    });

  it.each(["claude-haiku-4-5-20251001", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929", "my-custom-model"])(
    "sends no effort level to %s", (model) => {
      const body = bodyFor(model);
      expect(body).not.toHaveProperty("output_config");
      expect(body).not.toHaveProperty("effort");
    });

  it("keeps a page's own output cap", () => {
    const req = buildRequest(anthropic(), { apiKey: "k", model: "claude-sonnet-5-5", messages, maxTokens: 2000 });
    expect(JSON.parse(req.body).max_tokens).toBe(2000);
  });

  it("leaves other providers' default cap alone", () => {
    const req = buildRequest(providerById("openai")!, { apiKey: "k", model: "gpt-4o", messages });
    expect(JSON.parse(req.body).max_tokens).toBe(4096);
  });
});

describe("stoppedShort", () => {
  const anthropic = () => providerById("anthropic")!;

  it("reads Anthropic's refusal and length stops", () => {
    expect(stoppedShort(anthropic(), { content: [], stop_reason: "refusal", stop_details: { category: "cyber" } })).toBe("declined");
    expect(stoppedShort(anthropic(), { content: [], stop_reason: "max_tokens" })).toBe("cut-off");
    expect(stoppedShort(anthropic(), { content: [], stop_reason: "model_context_window_exceeded" })).toBe("cut-off");
  });

  it("finds nothing wrong with a finished answer, or a body that says nothing", () => {
    expect(stoppedShort(anthropic(), { content: [{ type: "text", text: "A" }], stop_reason: "end_turn" })).toBeUndefined();
    expect(stoppedShort(anthropic(), {})).toBeUndefined();
    expect(stoppedShort(anthropic(), null)).toBeUndefined();
  });

  it("reads only Anthropic's field", () => {
    expect(stoppedShort(providerById("openai")!, { stop_reason: "refusal" })).toBeUndefined();
  });
});

describe("reachedLengthLimit", () => {
  it("reads an OpenAI-shaped finish_reason and Gemini's finishReason", () => {
    expect(reachedLengthLimit(providerById("openai")!, { choices: [{ message: { content: "Half" }, finish_reason: "length" }] })).toBe(true);
    expect(reachedLengthLimit(providerById("groq")!, { choices: [{ message: { content: "All" }, finish_reason: "stop" }] })).toBe(false);
    expect(reachedLengthLimit(providerById("gemini")!, { candidates: [{ content: { parts: [{ text: "Half" }] }, finishReason: "MAX_TOKENS" }] })).toBe(true);
    expect(reachedLengthLimit(providerById("gemini")!, { candidates: [{ finishReason: "STOP" }] })).toBe(false);
  });

  it("leaves Claude's stop to stoppedShort, and a body that says nothing alone", () => {
    expect(reachedLengthLimit(providerById("anthropic")!, { stop_reason: "max_tokens" })).toBe(false);
    expect(reachedLengthLimit(providerById("openai")!, null)).toBe(false);
    expect(reachedLengthLimit(providerById("openai")!, {})).toBe(false);
  });
});

it("accepts an explicit v1 custom API base without duplicating its path", () => {
  expect(buildRequest(providerById('openai-compatible')!, { apiKey:'synthetic', model:'local', messages:[], baseUrl:'http://localhost:11434/v1/' }).url).toBe('http://localhost:11434/v1/chat/completions');
});
it("rejects credential-bearing or query-bearing custom endpoint URLs", () => {
  for (const baseUrl of ['https://user:password@example.test', 'https://example.test?token=secret', 'javascript:alert(1)']) {
    expect(() => buildRequest(providerById('openai-compatible')!, {apiKey:'synthetic',model:'local',messages:[],baseUrl})).toThrow(/without credentials/);
  }
});

import { describe, expect, it } from "vitest";
import { PROVIDERS, buildRequest, buildTranscribeRequest, parseResponse, providerById } from "./providers";

/**
 * Where each provider serves its API, from its own documentation. Checked on
 * 2026-09-28 with a dummy key: each address below answers 401 (key refused),
 * and Groq's and OpenRouter's old /v1 addresses answered 404, so every
 * request to those two providers failed whatever the key.
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

  it("sends a transcription to the provider's own API path", () => {
    const file = new Blob(["x"], { type: "audio/wav" });
    expect(buildTranscribeRequest(providerById("groq")!, { apiKey: "k", model: "whisper-large-v3", file }).url)
      .toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(buildTranscribeRequest(providerById("openai")!, { apiKey: "k", model: "whisper-1", file }).url)
      .toBe("https://api.openai.com/v1/audio/transcriptions");
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
      apiKey: "sk-ant-test", model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }],
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

it("accepts an explicit v1 custom API base without duplicating its path", () => {
  expect(buildRequest(providerById('openai-compatible')!, { apiKey:'synthetic', model:'local', messages:[], baseUrl:'http://localhost:11434/v1/' }).url).toBe('http://localhost:11434/v1/chat/completions');
});
it("rejects credential-bearing or query-bearing custom endpoint URLs", () => {
  for (const baseUrl of ['https://user:password@example.test', 'https://example.test?token=secret', 'javascript:alert(1)']) {
    expect(() => buildRequest(providerById('openai-compatible')!, {apiKey:'synthetic',model:'local',messages:[],baseUrl})).toThrow(/without credentials/);
  }
});

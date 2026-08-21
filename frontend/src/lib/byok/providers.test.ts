import { describe, expect, it } from "vitest";
import { PROVIDERS, buildRequest, parseResponse, providerById } from "./providers";

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

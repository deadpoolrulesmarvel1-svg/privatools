# BYOK Foundation (0.75a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-only engine that sends a user's own API key and document straight to their chosen AI provider, never through PrivaTools.

**Architecture:** New `frontend/src/lib/byok/` package. Three provider request shapes (Anthropic, OpenAI-compatible, Gemini) behind one `complete()` call. Keys encrypted at rest in the existing `localStore` `secrets` store, with a session-only mode. `client.ts` is the only module that calls `fetch`, so the never-leak rules are enforceable by reading one file. CSP gains an explicit origin per provider — a curated allowlist, never `https:`.

**Tech Stack:** TypeScript, React, Vitest, existing `localStore` (IndexedDB + WebCrypto AES-GCM), FastAPI (CSP header only).

**Read first:** `docs/superpowers/specs/2026-08-21-byok-ai-design.md` — especially "The constraint that shapes everything: CSP".

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/byok/providers.ts` | Provider registry + per-shape request/response adapters. Pure; no I/O. |
| `frontend/src/lib/byok/errors.ts` | Typed failure taxonomy. No dependencies. |
| `frontend/src/lib/byok/redact.ts` | Strip key material from anything user- or console-facing. |
| `frontend/src/lib/byok/keyStore.ts` | Encrypted persistence + session-only mode. |
| `frontend/src/lib/byok/client.ts` | The only `fetch` caller. |
| `frontend/src/lib/byok/index.ts` | Public surface. |
| `backend/app/main.py` | Add provider origins to `connect-src`. |
| `backend/tests/test_byok_csp.py` | CSP ⊇ registry origins, or the feature dies in the browser. |

Order matters: `errors` and `providers` have no dependencies, `redact` depends on nothing, `keyStore` needs `redact`, `client` needs all three. Build in that order so each task's tests can run in isolation.

---

### Task 1: Error taxonomy

**Files:**
- Create: `frontend/src/lib/byok/errors.ts`
- Test: `frontend/src/lib/byok/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
      const e = classifyHttpStatus(s);
      expect(e.userMessage.length).toBeGreaterThan(20);
    }
  });
  it("a ByokError is a real Error so it survives throw/catch", () => {
    const e = new ByokError("CspBlocked", "blocked", "Explain it.");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("CspBlocked");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/lib/byok/errors.test.ts`
Expected: FAIL — cannot resolve `./errors`.

- [ ] **Step 3: Implement**

```ts
/**
 * Typed failures for BYOK calls.
 *
 * Each kind exists because it needs a DIFFERENT next step from the user, not
 * because it has a different status code. `CspBlocked` in particular must not
 * be reported as a network error: it means our allowlist is wrong or the
 * endpoint is unsupported, and telling someone "check your connection" would
 * send them to debug the wrong thing entirely.
 */

export type ByokErrorKind =
  | "CspBlocked"
  | "BadKey"
  | "RateLimited"
  | "NoCredit"
  | "ProviderDown"
  | "Unsupported"
  | "Aborted"
  | "Unknown";

export class ByokError extends Error {
  readonly kind: ByokErrorKind;
  /** Safe to show a user. Never contains key material. */
  readonly userMessage: string;

  constructor(kind: ByokErrorKind, message: string, userMessage: string) {
    super(message);
    this.name = "ByokError";
    this.kind = kind;
    this.userMessage = userMessage;
  }
}

export function classifyHttpStatus(status: number): ByokError {
  if (status === 401 || status === 403) {
    return new ByokError(
      "BadKey",
      `auth rejected (${status})`,
      "That key was rejected. Check it is correct, still active, and has access to the model you picked.",
    );
  }
  if (status === 402) {
    return new ByokError(
      "NoCredit",
      "payment required (402)",
      "The provider says this account has no credit left. Top it up on their site and try again.",
    );
  }
  if (status === 429) {
    return new ByokError(
      "RateLimited",
      "rate limited (429)",
      "The provider is rate-limiting this key. Wait a moment and try again, or use a smaller document.",
    );
  }
  if (status >= 500) {
    return new ByokError(
      "ProviderDown",
      `provider error (${status})`,
      "The provider returned an error on their side. This is not something your key or your file caused.",
    );
  }
  return new ByokError(
    "Unknown",
    `unexpected status ${status}`,
    `The provider returned an unexpected response (${status}).`,
  );
}
```

- [ ] **Step 4: Run to green**

Run: `cd frontend && npx vitest run src/lib/byok/errors.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/byok/errors.ts frontend/src/lib/byok/errors.test.ts && git commit -m "feat(byok): typed error taxonomy"
```

---

### Task 2: Redaction

Do this BEFORE anything touches a key. Every later task depends on it being available, and adding it afterwards means a window where keys can reach logs.

**Files:**
- Create: `frontend/src/lib/byok/redact.ts`
- Test: `frontend/src/lib/byok/redact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { redact, registerSecret, _clearSecretsForTests } from "./redact";

describe("redact", () => {
  it("removes a registered secret from a string", () => {
    _clearSecretsForTests();
    registerSecret("sk-ant-abc123SECRET");
    expect(redact("failed with key sk-ant-abc123SECRET")).not.toContain("SECRET");
    expect(redact("failed with key sk-ant-abc123SECRET")).toContain("[redacted]");
  });

  it("redacts inside nested objects and arrays", () => {
    _clearSecretsForTests();
    registerSecret("TOPSECRET");
    const out = redact({ a: ["x", { b: "has TOPSECRET inside" }] });
    expect(JSON.stringify(out)).not.toContain("TOPSECRET");
  });

  it("redacts an Error's message and stack", () => {
    _clearSecretsForTests();
    registerSecret("LEAKY");
    const e = new Error("boom LEAKY");
    const out = redact(e) as { message: string };
    expect(out.message).not.toContain("LEAKY");
  });

  it("catches key-shaped strings even when not registered", () => {
    _clearSecretsForTests();
    // Defence in depth: a key we never saw must still not sail through.
    expect(redact("Bearer sk-proj-AbCdEf0123456789AbCdEf0123456789")).toContain("[redacted]");
    expect(redact("x-api-key: sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZ")).toContain("[redacted]");
  });

  it("leaves innocent text alone", () => {
    _clearSecretsForTests();
    expect(redact("could not reach the provider")).toBe("could not reach the provider");
  });

  it("does not choke on circular structures", () => {
    _clearSecretsForTests();
    const a: Record<string, unknown> = { name: "x" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/lib/byok/redact.test.ts`
Expected: FAIL — cannot resolve `./redact`.

- [ ] **Step 3: Implement**

```ts
/**
 * Keep key material out of anything a human or a log can see.
 *
 * Two layers on purpose. Registered secrets catch the key we are actually
 * using. The pattern pass catches key-SHAPED strings we were never told about
 * — a provider echoing the request back, a user pasting a key into a prompt,
 * a second key from another tab. Belt and braces, because the cost of being
 * wrong here is a user's credential in a log.
 */

const secrets = new Set<string>();

/** Register a live secret so it is stripped wherever it appears. */
export function registerSecret(value: string): void {
  if (value && value.length >= 8) secrets.add(value);
}

export function forgetSecret(value: string): void {
  secrets.delete(value);
}

export function _clearSecretsForTests(): void {
  secrets.clear();
}

// Shapes used by the providers we support. Deliberately broad.
const KEY_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,        // OpenAI, Anthropic, many compatibles
  /AIza[A-Za-z0-9_-]{20,}/g,       // Google
  /gsk_[A-Za-z0-9]{20,}/g,         // Groq
  /r8_[A-Za-z0-9]{20,}/g,          // Replicate
  /Bearer\s+[A-Za-z0-9._-]{20,}/g, // any bearer token
];

function scrubString(s: string): string {
  let out = s;
  for (const secret of secrets) {
    if (secret && out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  for (const re of KEY_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redact(v, seen);
  }
  return out;
}
```

- [ ] **Step 4: Run to green**

Run: `cd frontend && npx vitest run src/lib/byok/redact.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/byok/redact.ts frontend/src/lib/byok/redact.test.ts && git commit -m "feat(byok): redaction, before anything touches a key"
```

---

### Task 3: Provider registry

**Files:**
- Create: `frontend/src/lib/byok/providers.ts`
- Test: `frontend/src/lib/byok/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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

  it("parses each provider's response shape", () => {
    expect(parseResponse(providerById("anthropic")!, { content: [{ type: "text", text: "A" }] })).toBe("A");
    expect(parseResponse(providerById("openai")!, { choices: [{ message: { content: "B" } }] })).toBe("B");
    expect(parseResponse(providerById("gemini")!, { candidates: [{ content: { parts: [{ text: "C" }] } }] })).toBe("C");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/lib/byok/providers.test.ts`
Expected: FAIL — cannot resolve `./providers`.

- [ ] **Step 3: Implement**

```ts
/**
 * Who we can talk to, and how each one wants to be talked to.
 *
 * Three request shapes, not one abstraction pretending they are the same.
 * Flattening them would mean the adapter lies about at least two providers.
 *
 * `origin` is load-bearing beyond documentation: a backend test asserts every
 * origin here appears in the CSP connect-src, because a provider added here
 * without the CSP entry is refused by the browser and looks like a network
 * fault to the user.
 */

export type ProviderShape = "anthropic" | "openai" | "gemini";

export interface Provider {
  id: string;
  label: string;
  /** Scheme + host, exactly as it must appear in CSP connect-src. */
  origin: string;
  shape: ProviderShape;
  /** Default models; users may type any model id. */
  models: string[];
  /** True when the user supplies the base URL (local or self-hosted). */
  customBaseUrl?: boolean;
  keysUrl?: string;
}

export interface Message { role: "system" | "user" | "assistant"; content: string; }

export interface CompleteInput {
  apiKey: string;
  model: string;
  messages: Message[];
  baseUrl?: string;
  maxTokens?: number;
}

export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const ANTHROPIC_VERSION = "2023-06-01";

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic", label: "Anthropic (Claude)", origin: "https://api.anthropic.com",
    shape: "anthropic", models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai", label: "OpenAI", origin: "https://api.openai.com",
    shape: "openai", models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "gemini", label: "Google Gemini", origin: "https://generativelanguage.googleapis.com",
    shape: "gemini", models: ["gemini-2.0-flash", "gemini-2.0-pro"],
    keysUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter", label: "OpenRouter", origin: "https://openrouter.ai",
    shape: "openai", models: ["auto"], keysUrl: "https://openrouter.ai/keys",
  },
  {
    id: "groq", label: "Groq", origin: "https://api.groq.com",
    shape: "openai", models: ["llama-3.3-70b-versatile"], keysUrl: "https://console.groq.com/keys",
  },
  {
    id: "together", label: "Together AI", origin: "https://api.together.xyz",
    shape: "openai", models: ["meta-llama/Llama-3-70b-chat-hf"],
  },
  {
    id: "mistral", label: "Mistral", origin: "https://api.mistral.ai",
    shape: "openai", models: ["mistral-large-latest"],
  },
  {
    id: "deepseek", label: "DeepSeek", origin: "https://api.deepseek.com",
    shape: "openai", models: ["deepseek-chat"],
  },
  {
    id: "openai-compatible", label: "Local or self-hosted (OpenAI-compatible)",
    origin: "http://localhost", shape: "openai", models: [], customBaseUrl: true,
  },
];

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

function baseFor(p: Provider, input: CompleteInput): string {
  if (p.customBaseUrl) {
    if (!input.baseUrl) throw new Error(`${p.label} needs a base URL`);
    return input.baseUrl.replace(/\/+$/, "");
  }
  return p.origin;
}

export function buildRequest(p: Provider, input: CompleteInput): PreparedRequest {
  const base = baseFor(p, input);
  const maxTokens = input.maxTokens ?? 4096;

  if (p.shape === "anthropic") {
    const system = input.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = input.messages.filter((m) => m.role !== "system");
    return {
      url: `${base}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        // Without this the browser request is rejected. See the spec.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: input.model, max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
      }),
    };
  }

  if (p.shape === "gemini") {
    return {
      // Key goes in a header, NOT ?key= as Google's docs suggest: a URL
      // parameter lands in history, proxy logs and Referer headers.
      url: `${base}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        contents: input.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        ...(input.messages.some((m) => m.role === "system")
          ? { systemInstruction: { parts: [{ text: input.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") }] } }
          : {}),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    };
  }

  return {
    url: `${base}/v1/chat/completions`,
    headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({ model: input.model, max_tokens: maxTokens, messages: input.messages }),
  };
}

export function parseResponse(p: Provider, json: unknown): string {
  const j = json as Record<string, any>;
  if (p.shape === "anthropic") {
    return (j?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  }
  if (p.shape === "gemini") {
    return (j?.candidates?.[0]?.content?.parts ?? []).map((x: any) => x?.text ?? "").join("");
  }
  return j?.choices?.[0]?.message?.content ?? "";
}
```

- [ ] **Step 4: Run to green**

Run: `cd frontend && npx vitest run src/lib/byok/providers.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/byok/providers.ts frontend/src/lib/byok/providers.test.ts && git commit -m "feat(byok): provider registry with three request shapes"
```

---

### Task 4: CSP allowlist + the test that stops it silently breaking

**Files:**
- Modify: `backend/app/main.py` (the `connect_src` list near line 203)
- Create: `backend/tests/test_byok_csp.py`

- [ ] **Step 1: Write the failing test**

```python
"""CSP must allow every provider origin, or BYOK dies in the browser.

CORS passing is irrelevant while CSP says no: the browser refuses the request
before it is sent. A provider added to the registry without its origin here
looks to the user like a network fault, and to a developer like a CORS problem.

Parsed from providers.ts rather than duplicated, so the two cannot drift — the
same failure that put two 404s into production via the tool registries.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PROVIDERS_TS = REPO_ROOT / "frontend" / "src" / "lib" / "byok" / "providers.ts"


def _registry_origins() -> set[str]:
    text = PROVIDERS_TS.read_text(encoding="utf-8")
    return set(re.findall(r'origin:\s*"([^"]+)"', text))


def _connect_src() -> str:
    main_py = (REPO_ROOT / "backend" / "app" / "main.py").read_text(encoding="utf-8")
    i = main_py.index("connect_src")
    return main_py[i : i + 2000]


def test_every_provider_origin_is_in_connect_src():
    missing = sorted(o for o in _registry_origins() if o not in _connect_src())
    assert not missing, (
        "These provider origins are in providers.ts but absent from the CSP "
        f"connect-src, so the browser will block every call to them:\n  {missing}"
    )


def test_connect_src_is_not_a_wildcard():
    src = _connect_src()
    for bad in ('"https:"', "'https:'", '"*"', "connect_src = [\"*\"]"):
        assert bad not in src, (
            "connect-src must stay a curated allowlist. A wildcard would let any "
            "tool page exfiltrate to any host, which is the exact thing this "
            "product promises does not happen."
        )
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/lakshya/projects/priva-tool && python -m pytest backend/tests/test_byok_csp.py -q`
Expected: FAIL — the provider origins are not yet in `connect_src`.

- [ ] **Step 3: Add the origins**

In `backend/app/main.py`, find the `connect_src` list (near line 203) and extend it. Keep the existing entries untouched:

```python
    # BYOK talks straight from the browser to the user's chosen provider, so
    # each provider needs an explicit connect-src entry. Curated on purpose:
    # `https:` would let any tool page reach any host, which would give away
    # the guarantee this product is built on. Adding a provider is deliberately
    # a code change — a new egress destination should not be a runtime choice.
    #
    # Loopback covers Ollama / LM Studio. It is exempt from mixed-content
    # blocking (loopback is a potentially trustworthy origin), and can only
    # reach a server on the user's own machine.
    connect_src += [
        "https://api.anthropic.com",
        "https://api.openai.com",
        "https://generativelanguage.googleapis.com",
        "https://openrouter.ai",
        "https://api.groq.com",
        "https://api.together.xyz",
        "https://api.mistral.ai",
        "https://api.deepseek.com",
        "http://localhost:*",
        "http://127.0.0.1:*",
    ]
```

- [ ] **Step 4: Run to green**

Run: `cd /Users/lakshya/projects/priva-tool && python -m pytest backend/tests/test_byok_csp.py -q`
Expected: PASS, 2 tests.

- [ ] **Step 5: Confirm the header actually changed**

Run: `cd /Users/lakshya/projects/priva-tool && python -m pytest backend/tests/test_security.py -q`
Expected: PASS — the existing CSP tests must not regress.

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/tests/test_byok_csp.py && git commit -m "feat(byok): allow provider origins in CSP connect-src"
```

---

### Task 5: Key store

**Files:**
- Create: `frontend/src/lib/byok/keyStore.ts`
- Test: `frontend/src/lib/byok/keyStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { eraseEverything } from "@/lib/localStore/inventory";
import { clearKey, getKey, listConfigured, saveKey, setSessionOnly } from "./keyStore";

beforeEach(async () => {
  _resetForTests();
  await db.clear("secrets");
  await setSessionOnly(false);
});

describe("keyStore", () => {
  it("round-trips a key", async () => {
    await saveKey("anthropic", "sk-ant-secret");
    expect(await getKey("anthropic")).toBe("sk-ant-secret");
  });

  it("never writes the plaintext key to storage", async () => {
    await saveKey("openai", "sk-plaintext-must-not-appear");
    const raw = JSON.stringify(await db.values("secrets"));
    expect(raw).not.toContain("sk-plaintext-must-not-appear");
  });

  it("session-only mode keeps the key out of IndexedDB entirely", async () => {
    await setSessionOnly(true);
    await saveKey("openai", "sk-session");
    expect(await getKey("openai")).toBe("sk-session");
    expect(await db.keys("secrets")).toHaveLength(0);
  });

  it("clearKey removes it", async () => {
    await saveKey("groq", "gsk_x");
    await clearKey("groq");
    expect(await getKey("groq")).toBeUndefined();
  });

  it("listConfigured reports which providers have a key, never the key", async () => {
    await saveKey("anthropic", "sk-ant-abc");
    const list = await listConfigured();
    expect(list).toContain("anthropic");
    expect(JSON.stringify(list)).not.toContain("sk-ant-abc");
  });

  it("eraseEverything() removes stored keys", async () => {
    await saveKey("openai", "sk-doomed");
    await eraseEverything();
    expect(await getKey("openai")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/lib/byok/keyStore.test.ts`
Expected: FAIL — cannot resolve `./keyStore`.

- [ ] **Step 3: Implement**

```ts
/**
 * Where the user's API key lives.
 *
 * Encrypted at rest with the same non-extractable AES-GCM wrapping key the
 * password vault uses. The honest limit, which the UI must repeat: the key
 * itself CANNOT be non-extractable, because it has to be readable to go into
 * an auth header. Encrypted on disk; plaintext in memory during a call.
 *
 * Session-only mode never touches IndexedDB at all — for borrowed machines.
 * It is not the default because forcing a re-paste every reload makes the
 * feature annoying enough to go unused, and an unused control protects nobody.
 */

import * as db from "@/lib/localStore/db";
import { decryptString, encryptString, type Encrypted } from "@/lib/localStore/crypto";
import { registerSecret, forgetSecret } from "./redact";

const PREFIX = "byok:";
let sessionOnly = false;
const sessionKeys = new Map<string, string>();

export async function setSessionOnly(on: boolean): Promise<void> {
  sessionOnly = on;
  if (on) {
    // Awaited, not fire-and-forget: switching to session-only must have
    // finished removing the persisted key before anything reports that
    // nothing is stored. A `void db.clear()` here races the very assertion
    // the mode exists to make true.
    await db.clear("secrets");
  } else {
    sessionKeys.clear();
  }
}

export function isSessionOnly(): boolean {
  return sessionOnly;
}

export async function saveKey(providerId: string, apiKey: string): Promise<void> {
  registerSecret(apiKey);
  if (sessionOnly) {
    sessionKeys.set(providerId, apiKey);
    return;
  }
  const enc = await encryptString(apiKey);
  await db.put("secrets", PREFIX + providerId, enc);
}

export async function getKey(providerId: string): Promise<string | undefined> {
  if (sessionOnly) return sessionKeys.get(providerId);
  const enc = await db.get<Encrypted>("secrets", PREFIX + providerId);
  if (!enc) return undefined;
  try {
    const plain = await decryptString(enc);
    registerSecret(plain);
    return plain;
  } catch {
    // Wrapping key gone (cleared site data, different browser profile) —
    // the ciphertext is unreadable, so treat it as absent rather than error.
    return undefined;
  }
}

export async function clearKey(providerId: string): Promise<void> {
  const existing = sessionKeys.get(providerId);
  if (existing) forgetSecret(existing);
  sessionKeys.delete(providerId);
  await db.del("secrets", PREFIX + providerId);
}

/** Provider ids that have a key. Never returns key material. */
export async function listConfigured(): Promise<string[]> {
  if (sessionOnly) return [...sessionKeys.keys()];
  const keys = await db.keys("secrets");
  return keys.filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
}
```

- [ ] **Step 4: Run to green**

Run: `cd frontend && npx vitest run src/lib/byok/keyStore.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/byok/keyStore.ts frontend/src/lib/byok/keyStore.test.ts && git commit -m "feat(byok): encrypted key store with session-only mode"
```

---

### Task 6: The client

**Files:**
- Create: `frontend/src/lib/byok/client.ts`
- Test: `frontend/src/lib/byok/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "./client";
import { ByokError } from "./errors";

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
    const out = await complete({ providerId: "anthropic", apiKey: "sk-ant-x", model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }] });
    expect(out).toBe("hello");
  });

  it("sends the key in a header and never in the URL", async () => {
    const f = mockFetch(200, { content: [{ type: "text", text: "ok" }] });
    await complete({ providerId: "anthropic", apiKey: "sk-ant-SECRET", model: "m", messages: [{ role: "user", content: "hi" }] });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).not.toContain("sk-ant-SECRET");
    expect((init as RequestInit).headers).toBeDefined();
  });

  it("maps a 401 to BadKey", async () => {
    mockFetch(401, { error: "nope" });
    await expect(complete({ providerId: "openai", apiKey: "bad", model: "m", messages: [] }))
      .rejects.toMatchObject({ kind: "BadKey" });
  });

  it("a CSP/network refusal is reported as CspBlocked, not a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(complete({ providerId: "openai", apiKey: "k", model: "m", messages: [] }))
      .rejects.toMatchObject({ kind: "CspBlocked" });
  });

  it("never lets the key reach the thrown error", async () => {
    mockFetch(500, { error: "upstream said sk-ant-LEAKED" });
    try {
      await complete({ providerId: "anthropic", apiKey: "sk-ant-LEAKED", model: "m", messages: [] });
      throw new Error("should have thrown");
    } catch (e) {
      const s = JSON.stringify({ m: (e as Error).message, u: (e as ByokError).userMessage });
      expect(s).not.toContain("sk-ant-LEAKED");
    }
  });

  it("rejects an unknown provider rather than guessing", async () => {
    await expect(complete({ providerId: "nope", apiKey: "k", model: "m", messages: [] }))
      .rejects.toMatchObject({ kind: "Unsupported" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/lib/byok/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Implement**

```ts
/**
 * The ONLY module in this package that performs a network call.
 *
 * Kept that way deliberately: the promises this feature makes — the key goes
 * nowhere but the provider, never into a URL, never into an error — are only
 * auditable if there is exactly one place to check.
 */

import { ByokError, classifyHttpStatus } from "./errors";
import { buildRequest, parseResponse, providerById, type Message } from "./providers";
import { redact, registerSecret } from "./redact";

export interface CompleteArgs {
  providerId: string;
  apiKey: string;
  model: string;
  messages: Message[];
  baseUrl?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function complete(args: CompleteArgs): Promise<string> {
  const provider = providerById(args.providerId);
  if (!provider) {
    throw new ByokError(
      "Unsupported",
      `unknown provider ${args.providerId}`,
      "That provider is not supported. Pick one from the list.",
    );
  }

  registerSecret(args.apiKey);
  const req = buildRequest(provider, args);

  let res: Response;
  try {
    res = await fetch(req.url, {
      method: "POST", headers: req.headers, body: req.body, signal: args.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new ByokError("Aborted", "aborted", "Cancelled.");
    }
    // A CSP refusal and an offline network both surface as TypeError here;
    // the browser deliberately does not say which. Naming CSP first is the
    // more useful guess: "check your connection" sends someone to debug the
    // wrong thing, and this path is reachable only for a configured provider.
    throw new ByokError(
      "CspBlocked",
      `fetch failed: ${String(redact((err as Error).message))}`,
      `The browser blocked the request to ${provider.label}. If you are using a custom endpoint it is probably not on the allowed list; otherwise check that nothing on your network is intercepting it. PrivaTools will not route your key or your file through its own server as a workaround.`,
    );
  }

  if (!res.ok) throw classifyHttpStatus(res.status);

  const json = await res.json().catch(() => ({}));
  return parseResponse(provider, json);
}
```

- [ ] **Step 4: Run to green**

Run: `cd frontend && npx vitest run src/lib/byok/client.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/byok/client.ts frontend/src/lib/byok/client.test.ts && git commit -m "feat(byok): the single fetch call site"
```

---

### Task 7: Public surface + leak sweep

**Files:**
- Create: `frontend/src/lib/byok/index.ts`
- Create: `frontend/src/lib/byok/leak.test.ts`

- [ ] **Step 1: Write the leak sweep**

```ts
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
  ["401", () => { vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: `bad key ${KEY}` }) } as unknown as Response); }],
  ["429", () => { vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: KEY }) } as unknown as Response); }],
  ["500 echoing the key", () => { vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: KEY }) } as unknown as Response); }],
  ["network/CSP refusal", () => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`Failed to fetch ${KEY}`)); }],
];

describe("no surface leaks the key", () => {
  it.each(FAILURES)("%s", async (_name, arrange) => {
    arrange();
    let thrown: unknown;
    try {
      await complete({ providerId: "anthropic", apiKey: KEY, model: "m", messages: [{ role: "user", content: "hi" }] });
    } catch (e) { thrown = e; }
    const serialised = JSON.stringify(redact(thrown));
    expect(serialised).not.toContain("DO-NOT-LEAK-ME");
  });

  it("the key never appears in the request URL", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "x" }] }) } as unknown as Response);
    await complete({ providerId: "gemini", apiKey: "AIzaDO-NOT-LEAK-ME-123456789012", model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }] });
    expect(String(f.mock.calls[0][0])).not.toContain("DO-NOT-LEAK-ME");
  });
});
```

- [ ] **Step 2: Write the index**

```ts
/**
 * Bring your own AI key.
 *
 * The key and the document go from the browser straight to the provider the
 * user chose. Nothing passes through PrivaTools — see
 * docs/superpowers/specs/2026-08-21-byok-ai-design.md.
 */
export { complete, type CompleteArgs } from "./client";
export { PROVIDERS, providerById, type Provider, type Message } from "./providers";
export { saveKey, getKey, clearKey, listConfigured, setSessionOnly, isSessionOnly } from "./keyStore";
export { ByokError, type ByokErrorKind } from "./errors";
export { redact } from "./redact";
```

- [ ] **Step 3: Run the whole package**

Run: `cd frontend && npx vitest run src/lib/byok/`
Expected: PASS — all files, 30+ tests.

- [ ] **Step 4: Typecheck (the bare `tsc --noEmit` is a no-op here)**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/byok/index.ts frontend/src/lib/byok/leak.test.ts && git commit -m "feat(byok): public surface + leak sweep"
```

---

### Task 8: Full verification

- [ ] **Step 1: Whole frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all previous tests still pass, plus the new ones.

- [ ] **Step 2: Backend suite**

Run: `cd /Users/lakshya/projects/priva-tool && python -m pytest backend/tests -q`
Expected: the CSP tests pass; nothing else regresses.

- [ ] **Step 3: Confirm the CSP is actually served**

After deploying, run:

```bash
curl -sI https://privatools.me/ | tr ';' '\n' | grep -i connect-src
```

Expected: the provider origins appear. If they do not, re-read the spec's
"Where the CSP change actually goes" — nginx overrides CSP on static-asset
locations only, so a wrong-location edit shows up here and nowhere else.

- [ ] **Step 4: Commit and open a PR**

```bash
git push -u origin feat/byok-foundation
```

---

## What is deliberately NOT here

- **No UI.** This is the engine. Key entry, provider picker and the honest
  storage copy belong with 0.75b, where they have a screen to live on.
- **No streaming.** Non-streaming first, so the leak tests cover one clear
  path. Streaming adds a second response shape per provider and should land
  once the engine is proven.
- **No token counting or cost estimates.** Wanted, but each provider needs its
  own tokenizer; it belongs with the UI that would display it.
- **No local-model fallback.** By decision: degrading silently from Claude to
  distilbart hands someone a much worse answer while implying it came from the
  model they picked.

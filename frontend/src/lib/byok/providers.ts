/**
 * Who we can talk to, and how each one wants to be talked to.
 *
 * Three request shapes, not one abstraction pretending they are the same.
 * Flattening them would mean the adapter lies about at least two providers.
 *
 * `origin` is load-bearing beyond documentation: a backend test asserts every
 * origin here appears in the CSP connect-src, because a provider added here
 * without the CSP entry is refused by the browser and looks like a network
 * fault to the user and a CORS bug to a developer.
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

export interface Message { role: "system" | "user" | "assistant"; content: string }

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
        // Never guess a default here. Silently picking one would send the
        // user's key to a host they did not choose.
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
                // Without this the browser request is rejected outright.
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
        const system = input.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        return {
            // Key goes in a header, NOT ?key= as Google's docs suggest: a URL
            // parameter lands in history, proxy logs and Referer headers.
            url: `${base}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
            headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
            body: JSON.stringify({
                contents: input.messages
                    .filter((m) => m.role !== "system")
                    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
                ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
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
    const j = (json ?? {}) as Record<string, unknown>;
    if (p.shape === "anthropic") {
        const blocks = (j.content ?? []) as Array<{ type?: string; text?: string }>;
        return blocks.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("");
    }
    if (p.shape === "gemini") {
        const cands = (j.candidates ?? []) as Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        return (cands[0]?.content?.parts ?? []).map((x) => x?.text ?? "").join("");
    }
    const choices = (j.choices ?? []) as Array<{ message?: { content?: string } }>;
    return choices[0]?.message?.content ?? "";
}

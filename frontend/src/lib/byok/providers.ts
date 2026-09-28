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
    /**
     * Where an OpenAI-shaped provider serves its API under `origin`, when that
     * is not /v1. Groq serves it under /openai/v1 and OpenRouter under
     * /api/v1; both answer 404 at /v1, which is where every request to them
     * went until 2026-09-28, whatever the key.
     */
    apiPath?: string;
    shape: ProviderShape;
    /**
     * Suggested model ids; users may type any other. The first is what every
     * page sends when the model box is left empty, so it must be one the
     * provider still serves: a shut-down default fails every such request
     * (Gemini 2.0 Flash, shut down 2026-06-01, did until 2026-09-28).
     */
    models: string[];
    /** True when the user supplies the base URL (local or self-hosted). */
    customBaseUrl?: boolean;
    keysUrl?: string;
}

/** A message part — plain text, or an inline image for vision models. */
export type ContentPart =
    | { type: "text"; text: string }
    | { type: "image"; mimeType: string; dataBase64: string };

export interface Message { role: "system" | "user" | "assistant"; content: string | ContentPart[] }

function textOf(content: string | ContentPart[]): string {
    if (typeof content === "string") return content;
    return content.filter((c): c is Extract<ContentPart, { type: "text" }> => c.type === "text").map(c => c.text).join("\n");
}

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
        shape: "anthropic", models: ["claude-sonnet-4-5", "claude-haiku-4-5"],
        keysUrl: "https://console.anthropic.com/settings/keys",
    },
    {
        id: "openai", label: "OpenAI", origin: "https://api.openai.com",
        shape: "openai", models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
        keysUrl: "https://platform.openai.com/api-keys",
    },
    {
        id: "gemini", label: "Google Gemini", origin: "https://generativelanguage.googleapis.com",
        // Google's advice for new projects since 2026-09-18, when it limited
        // the 2.5 models to accounts that had already used them.
        shape: "gemini", models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
        keysUrl: "https://aistudio.google.com/apikey",
    },
    {
        id: "openrouter", label: "OpenRouter", origin: "https://openrouter.ai", apiPath: "/api/v1",
        shape: "openai", models: ["openrouter/auto"], keysUrl: "https://openrouter.ai/keys",
    },
    {
        id: "groq", label: "Groq", origin: "https://api.groq.com", apiPath: "/openai/v1",
        shape: "openai", models: ["llama-3.3-70b-versatile"], keysUrl: "https://console.groq.com/keys",
    },
    {
        id: "together", label: "Together AI", origin: "https://api.together.xyz",
        shape: "openai", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    },
    {
        id: "mistral", label: "Mistral", origin: "https://api.mistral.ai",
        shape: "openai", models: ["mistral-large-latest"],
    },
    {
        id: "deepseek", label: "DeepSeek", origin: "https://api.deepseek.com",
        shape: "openai", models: ["deepseek-flash"],
    },
    {
        id: "openai-compatible", label: "Local or self-hosted (OpenAI-compatible)",
        origin: "http://localhost", shape: "openai", models: [], customBaseUrl: true,
    },
];

export function providerById(id: string): Provider | undefined {
    return PROVIDERS.find((p) => p.id === id);
}

function customBaseUrl(value: string): string {
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error("Enter a complete endpoint URL, such as http://localhost:11434."); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("Use an HTTP or HTTPS endpoint without credentials, query parameters or a fragment.");
    }
    // Many OpenAI-compatible servers publish a base ending in /v1. Accept
    // both that form and the server root without constructing /v1/v1.
    return url.href.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function baseFor(p: Provider, baseUrl: string | undefined): string {
    if (p.customBaseUrl) {
        // Never guess a default here. Silently picking one would send the
        // user's key to a host they did not choose.
        if (!baseUrl) throw new Error(`${p.label} needs a base URL`);
        return customBaseUrl(baseUrl);
    }
    return p.origin;
}

/** What an OpenAI-shaped provider's endpoints hang off, such as
 *  https://api.openai.com/v1 or https://api.groq.com/openai/v1. */
function openAiRoot(p: Provider, baseUrl: string | undefined): string {
    return p.customBaseUrl ? `${baseFor(p, baseUrl)}/v1` : `${p.origin}${p.apiPath ?? "/v1"}`;
}

export function buildRequest(p: Provider, input: CompleteInput): PreparedRequest {
    const base = baseFor(p, input.baseUrl);
    const maxTokens = input.maxTokens ?? 4096;

    if (p.shape === "anthropic") {
        const system = input.messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
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
                messages: rest.map((m) => ({
                    role: m.role,
                    content: typeof m.content === "string" ? m.content : m.content.map((c) =>
                        c.type === "text"
                            ? { type: "text", text: c.text }
                            : { type: "image", source: { type: "base64", media_type: c.mimeType, data: c.dataBase64 } },
                    ),
                })),
            }),
        };
    }

    if (p.shape === "gemini") {
        const system = input.messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
        return {
            // Key goes in a header, NOT ?key= as Google's docs suggest: a URL
            // parameter lands in history, proxy logs and Referer headers.
            url: `${base}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
            headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
            body: JSON.stringify({
                contents: input.messages
                    .filter((m) => m.role !== "system")
                    .map((m) => ({
                        role: m.role === "assistant" ? "model" : "user",
                        parts: typeof m.content === "string" ? [{ text: m.content }] : m.content.map((c) =>
                            c.type === "text" ? { text: c.text } : { inlineData: { mimeType: c.mimeType, data: c.dataBase64 } },
                        ),
                    })),
                ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
                generationConfig: { maxOutputTokens: maxTokens },
            }),
        };
    }

    return {
        url: `${openAiRoot(p, input.baseUrl)}/chat/completions`,
        headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
        body: JSON.stringify({
            model: input.model, max_tokens: maxTokens,
            messages: input.messages.map((m) => ({
                role: m.role,
                content: typeof m.content === "string" ? m.content : m.content.map((c) =>
                    c.type === "text"
                        ? { type: "text", text: c.text }
                        : { type: "image_url", image_url: { url: `data:${c.mimeType};base64,${c.dataBase64}` } },
                ),
            })),
        }),
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

/** Providers whose API exposes OpenAI-style /v1/audio/transcriptions. */
export function supportsTranscription(p: Provider): boolean {
    return p.shape === "openai";
}

export const TRANSCRIBE_MODELS: Record<string, string> = {
    openai: "gpt-4o-mini-transcribe",
    groq: "whisper-large-v3",
};

export function buildTranscribeRequest(
    p: Provider,
    input: { apiKey: string; model: string; file: File | Blob; filename?: string; baseUrl?: string },
): { url: string; headers: Record<string, string>; body: FormData } {
    if (!supportsTranscription(p)) {
        throw new Error(`${p.label} has no OpenAI-style transcription endpoint`);
    }
    const root = openAiRoot(p, input.baseUrl);
    const body = new FormData();
    body.append("file", input.file, input.filename ?? (input.file instanceof File ? input.file.name : "audio.webm"));
    body.append("model", input.model);
    body.append("response_format", "text");
    return {
        url: `${root}/audio/transcriptions`,
        // No content-type: the browser sets the multipart boundary itself.
        headers: { authorization: `Bearer ${input.apiKey}` },
        body,
    };
}

export function parseTranscribeResponse(raw: string): string {
    // response_format=text returns plain text; some servers still send JSON.
    try {
        const j = JSON.parse(raw) as { text?: string };
        if (typeof j.text === "string") return j.text;
    } catch { /* plain text */ }
    return raw;
}

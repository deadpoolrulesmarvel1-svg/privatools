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
    /**
     * The model Transcribe Audio sends when the visitor names none. Set only
     * for a provider with an OpenAI-style speech-to-text endpoint
     * (audio/transcriptions), which is what offers it there: each provider
     * names its own models, and "whisper-1" is OpenAI's alone. Read from each
     * provider's documentation on 2026-10-03.
     */
    transcribeModel?: string;
    /**
     * The `language` to send for a provider that does not detect the spoken
     * language unless asked. Together's defaults to "en"; "auto" detects it.
     */
    transcribeLanguage?: string;
    /** True when the user supplies the base URL (local or self-hosted). */
    customBaseUrl?: boolean;
    keysUrl?: string;
    /**
     * True when the provider refuses a key without CORS headers, so the
     * browser reports only a failed request and the page cannot read why.
     * OpenAI's 401 carries no Access-Control-Allow-Origin, though its
     * preflight does (checked 2026-09-28).
     */
    refusalsUnreadable?: boolean;
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

/**
 * Claude's output cap. Sonnet 5.5 thinks before it answers unless told not
 * to (Opus 5.5 always does; Haiku 4.5 only when asked), and the thinking
 * counts toward max_tokens, so the cap must leave room for both. 16,000 is
 * the figure Anthropic's adaptive-thinking examples use; it is a ceiling,
 * billed only as used, to the visitor's own key.
 */
const ANTHROPIC_MAX_TOKENS = 16_000;

/**
 * Claude models that take an effort level: the supported-models list of
 * Anthropic's effort documentation (read 2026-10-01), which is Opus 4.5 and
 * the 4.6 generation onwards. Haiku 4.5 does not support effort, and a
 * visitor may type any model id, so only ids of that family are sent one.
 */
const TAKES_EFFORT = /^claude-(?:(?:opus|sonnet|fable|mythos)-(?:4-[6-9]|[5-9](?:-\d+)?)|opus-4-5|mythos-preview)(?:-\d{8})?$/;

export const PROVIDERS: Provider[] = [
    {
        // Sonnet 4.5 was deprecated on 2026-09-30 and retires on 2026-11-30;
        // Anthropic names Sonnet 5.5 as its replacement.
        id: "anthropic", label: "Anthropic (Claude)", origin: "https://api.anthropic.com",
        shape: "anthropic", models: ["claude-sonnet-5-5", "claude-haiku-4-5"],
        keysUrl: "https://console.anthropic.com/settings/keys",
    },
    {
        id: "openai", label: "OpenAI", origin: "https://api.openai.com",
        shape: "openai", models: ["gpt-4o", "gpt-4o-mini", "o3-mini"], transcribeModel: "gpt-4o-mini-transcribe",
        keysUrl: "https://platform.openai.com/api-keys", refusalsUnreadable: true,
    },
    {
        id: "gemini", label: "Google Gemini", origin: "https://generativelanguage.googleapis.com",
        // Google's advice for new projects since 2026-09-18, when it limited
        // the 2.5 models to accounts that had already used them.
        shape: "gemini", models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
        keysUrl: "https://aistudio.google.com/apikey",
    },
    {
        // Speech to text since July 2026, at /api/v1/audio/transcriptions.
        id: "openrouter", label: "OpenRouter", origin: "https://openrouter.ai", apiPath: "/api/v1",
        shape: "openai", models: ["openrouter/auto"], transcribeModel: "openai/whisper-large-v3", keysUrl: "https://openrouter.ai/keys",
    },
    {
        // Groq's named replacement for Llama 3.3 70B, which it shut down for
        // free and developer plans on 2026-08-16 (Enterprise only since).
        id: "groq", label: "Groq", origin: "https://api.groq.com", apiPath: "/openai/v1",
        shape: "openai", models: ["openai/gpt-oss-120b"], transcribeModel: "whisper-large-v3", keysUrl: "https://console.groq.com/keys",
    },
    {
        // The model its transcription reference names, and its default.
        id: "together", label: "Together AI", origin: "https://api.together.xyz",
        shape: "openai", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"], transcribeModel: "openai/whisper-large-v3", transcribeLanguage: "auto",
    },
    {
        // Mistral transcribes with its Voxtral models.
        id: "mistral", label: "Mistral", origin: "https://api.mistral.ai",
        shape: "openai", models: ["mistral-large-latest"], transcribeModel: "voxtral-mini-latest",
    },
    {
        id: "deepseek", label: "DeepSeek", origin: "https://api.deepseek.com",
        shape: "openai", models: ["deepseek-flash"],
    },
    {
        // A self-hosted server names its models itself; whisper-1 is the
        // OpenAI name many of them answer to, and the visitor can type another.
        id: "openai-compatible", label: "Local or self-hosted (OpenAI-compatible)",
        origin: "http://localhost", shape: "openai", models: [], transcribeModel: "whisper-1", customBaseUrl: true,
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
            // No temperature, top_p, top_k or thinking budget, which Sonnet
            // 5.5 answers with a 400, and no assistant prefill.
            body: JSON.stringify({
                model: input.model, max_tokens: input.maxTokens ?? ANTHROPIC_MAX_TOKENS,
                // Medium rather than Sonnet 5.5's default of high: these are
                // document tasks, and less thinking leaves more of the cap
                // for the answer, sooner and at lower cost. Anthropic's docs
                // put it inside output_config, not at the top level.
                ...(TAKES_EFFORT.test(input.model) ? { output_config: { effort: "medium" } } : {}),
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

/**
 * Why an answer is not a whole one, when the provider says so in a successful
 * response. Anthropic's stop_reason is "refusal" when Claude declined (its
 * docs say to discard any partial output), and "max_tokens" or
 * "model_context_window_exceeded" when the answer reached a length limit,
 * which thinking counts toward, so it can stop before any text at all.
 */
export function stoppedShort(p: Provider, json: unknown): "declined" | "cut-off" | undefined {
    if (p.shape !== "anthropic" || !json || typeof json !== "object") return undefined;
    const reason = (json as { stop_reason?: unknown }).stop_reason;
    if (reason === "refusal") return "declined";
    if (reason === "max_tokens" || reason === "model_context_window_exceeded") return "cut-off";
    return undefined;
}

/** Providers with an OpenAI-style speech-to-text endpoint (audio/transcriptions). */
export function supportsTranscription(p: Provider): boolean {
    return p.shape === "openai" && !!p.transcribeModel;
}

/** "OpenAI, OpenRouter, Groq, Together AI, Mistral or a self-hosted endpoint". */
export function transcriptionProviderNames(): string {
    const names = PROVIDERS.filter(supportsTranscription).map((p) => (p.customBaseUrl ? "a self-hosted endpoint" : p.label));
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names.join("");
}

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
    if (p.transcribeLanguage) body.append("language", p.transcribeLanguage);
    // No response_format: JSON with a "text" field is every provider's
    // default, while "text" is not one Together or OpenRouter documents, and
    // Mistral documents no response_format at all.
    return {
        url: `${root}/audio/transcriptions`,
        // No content-type: the browser sets the multipart boundary itself.
        headers: { authorization: `Bearer ${input.apiKey}` },
        body,
    };
}

export function parseTranscribeResponse(raw: string): string {
    // JSON with a "text" field by default; some self-hosted servers answer plain text.
    try {
        const j = JSON.parse(raw) as { text?: string };
        if (typeof j.text === "string") return j.text;
    } catch { /* plain text */ }
    return raw;
}

/**
 * Providers with a token-count method of their own: Anthropic's
 * /v1/messages/count_tokens and Gemini's models.countTokens. Neither writes an
 * answer; each says how many tokens the provider's tokenizer for the named
 * model makes of the text sent as one user message. No public tokenizer
 * matches current Claude models, so for Claude this is the only exact source.
 */
export function supportsTokenCount(p: Provider): boolean {
    return p.shape === "anthropic" || p.shape === "gemini";
}

export function buildCountTokensRequest(p: Provider, input: { apiKey: string; model: string; text: string }): PreparedRequest {
    if (p.shape === "anthropic") {
        return {
            url: `${p.origin}/v1/messages/count_tokens`,
            headers: {
                "content-type": "application/json",
                "x-api-key": input.apiKey,
                "anthropic-version": ANTHROPIC_VERSION,
                // Without this the browser request is rejected outright.
                "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: input.text }] }),
        };
    }
    if (p.shape === "gemini") {
        // Google's model list names models "models/gemini-…"; the path takes the bare id.
        const model = input.model.trim().replace(/^models\//, "");
        return {
            // The key goes in a header, never ?key=, as for generateContent.
            url: `${p.origin}/v1beta/models/${encodeURIComponent(model)}:countTokens`,
            headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: input.text }] }] }),
        };
    }
    throw new Error(`${p.label} has no token-count method`);
}

/** The count in a successful answer, or undefined when it holds none. */
export function parseCountTokensResponse(p: Provider, json: unknown): number | undefined {
    if (!json || typeof json !== "object") return undefined;
    const j = json as { input_tokens?: unknown; totalTokens?: unknown };
    const value = p.shape === "anthropic" ? j.input_tokens : p.shape === "gemini" ? j.totalTokens : undefined;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

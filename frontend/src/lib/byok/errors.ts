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
    | "BadModel"
    | "TooLong"
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

/** What a request asked for, so that its failure can be explained. */
export interface RequestContext {
    /** The provider's name as the pages show it. */
    label?: string;
    /** The model the request named; empty when it named none. */
    model?: string;
    /** True for an endpoint the visitor entered (a local or self-hosted server). */
    customEndpoint?: boolean;
}

/**
 * The provider's own explanation, read from its error body only to choose a
 * category. It is never shown or kept: providers quote part of a refused key
 * back (OpenAI's "Incorrect API key provided: sk-proj-...abcd").
 */
function providerExplanation(body: string): string {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return ""; } // an HTML error page names nothing useful
    if (!parsed || typeof parsed !== "object") return "";
    const { error, message, detail } = parsed as { error?: unknown; message?: unknown; detail?: unknown };
    const parts: unknown[] = [message, detail];
    if (typeof error === "string") parts.push(error);
    else if (error && typeof error === "object") {
        const e = error as { message?: unknown; status?: unknown; code?: unknown; type?: unknown; details?: unknown };
        // Google puts the reason, such as API_KEY_INVALID, in `details`.
        parts.push(e.message, e.status, e.code, e.type, JSON.stringify(e.details ?? null));
    }
    return parts.filter((p): p is string => typeof p === "string").join(" ");
}

/** A 400 that says the key is at fault: Google answers a bad Gemini key with
 *  400 INVALID_ARGUMENT, reason API_KEY_INVALID, rather than 401. */
const KEY_REFUSED = /API_KEY_INVALID|API key not valid|invalid api[ _-]?key|incorrect api key/i;
/** A request refused for its size: over the model's context window, or over
 *  what the key may send at once (Groq answers the latter with 413). */
const TOO_MUCH_TEXT = /context[ _]length|context window|too long|too large|maximum number of tokens|token count|tokens per minute|reduce (?:the length|your message)/i;
/** A refusal that names the model: missing, retired, or not open to this key.
 *  OpenRouter answers 404 "No endpoints available matching your guardrail
 *  restrictions and data policy" when the account's privacy settings leave no
 *  provider for the model; that is the account's settings, not PrivaTools. */
const NAMES_MODEL = /\bmodels?\b|model_not|no endpoints|data policy|guardrail/i;

export function classifyHttpStatus(status: number, body = "", context: RequestContext = {}): ByokError {
    const label = context.label ?? "The provider";
    const said = providerExplanation(body);
    if (status === 401 || status === 403 || (status === 400 && KEY_REFUSED.test(said))) {
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
    if (status === 413 || ((status === 400 || status === 422) && TOO_MUCH_TEXT.test(said))) {
        return new ByokError(
            "TooLong",
            `request refused for its size (${status})`,
            `${label} refused this request because it holds more text than the model, or this key's plan, accepts at once. Try a shorter document, or a model with a larger context window.`,
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
    if ((status === 400 || status === 404 || status === 422) && NAMES_MODEL.test(said)) {
        const model = context.model?.trim();
        return new ByokError(
            "BadModel",
            `model refused (${status})`,
            model
                ? `${label} refused the model "${model}": it is not one this key can use for this request. Type a model your account offers in the Model field, then try again.`
                : `${label} needs to be told which model to use. Type the name of a model it offers in the Model field, then try again.`,
        );
    }
    if (status === 404) {
        return new ByokError(
            "Unknown",
            "no such endpoint (404)",
            context.customEndpoint
                ? "Your endpoint answered 404 (not found). Check the base URL: it should be the server's own address, such as http://localhost:11434."
                : `${label} answered 404 (not found): it has no API at the address this request went to. That is a fault in PrivaTools, not in your key or your file.`,
        );
    }
    return new ByokError(
        "Unknown",
        `unexpected status ${status}`,
        `${label} returned an unexpected response (${status}).`,
    );
}

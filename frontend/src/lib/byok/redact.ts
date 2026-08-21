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

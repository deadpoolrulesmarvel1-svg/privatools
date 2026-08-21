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

/**
 * Account state shared by every skin's extension.
 *
 * The four skins render accounts in four different idioms, but they all talk to
 * the same endpoints and hold the same state. Keeping that here means a change
 * to the flow — a new field, a different error — happens once instead of four
 * times, which is the only way "every theme offers the same features" survives
 * contact with maintenance.
 *
 * Deliberately framework-light: the ported skins are class components generated
 * from their design sources, so this is a plain object they can drive from
 * `setState`, not a hook.
 */

import { isClerkEnabled } from "@/lib/clerk/instance";
import { clerkAccountApi, SOCIAL_PROVIDERS, type SocialProvider } from "@/lib/clerk/accountApi";

export interface ApiKey {
    key_id: string;
    label: string;
    created_at: string;
    last_used_at: string | null;
    revoked: boolean;
}

export interface AccountUser {
    id: string;
    email: string;
    created_at: string;
}

/**
 * Password strength, without a dependency.
 *
 * Deliberately length-led. Composition rules ("one capital, one symbol") push
 * people toward Password1! and are not what makes a password hard to guess;
 * length and unpredictability are. This scores what actually matters and says
 * so in the hint, rather than demanding character classes.
 */
export interface Strength {
    score: 0 | 1 | 2 | 3 | 4;
    label: string;
    hint: string;
}

/**
 * The shortest password this deployment will accept.
 *
 * Clerk enforces its own floor server-side (15 at the time of writing), so a
 * UI that promised less would cheerfully accept a password and then be
 * refused. Local auth keeps the 10 it always had.
 */
/**
 * What the account page says about where your credentials go.
 *
 * A factual claim about privacy, and it stops being true the moment identity
 * moves to Clerk: there *is* an email, there *is* a reset link, and the
 * password is checked by somebody else's server. Leaving the old wording in
 * place would be the worst outcome of this migration — worse than the
 * migration itself — so the copy follows the backing store, from one place
 * that all four themes read.
 */
export const ACCOUNT_COPY = isClerkEnabled()
    ? {
        storageHeading: "Clerk holds the sign-in.",
        storage:
            "They keep your email and password; we never see the password. "
            + "Deleting your account removes both, and every key here, immediately.",
        recovery:
            "Forgotten your password? Clerk emails you a reset link. Your files are "
            + "never involved — an account only ever issues API keys.",
    }
    : {
        storageHeading: "We store an email and a hash.",
        storage:
            "A scrypt hash of your password, never the password itself. "
            + "Deleting your account removes both, and every key, immediately.",
        recovery:
            "We send no email — not even a reset link. Instead you get a recovery code "
            + "at signup. It is the only way back in, so keep it somewhere safe.",
    };

/**
 * Social providers to offer, or empty when this deployment has no Clerk.
 *
 * Empty is the meaningful case: local auth has no way to authenticate against
 * Google, so the buttons must not be rendered at all rather than rendered and
 * throwing.
 */
export const SOCIAL_SIGN_IN = isClerkEnabled() ? SOCIAL_PROVIDERS : [];

/**
 * Whether password recovery goes through an emailed code (Clerk) or the
 * recovery code issued at signup (local auth). Markup branches on this —
 * the two flows ask for different things in a different order.
 */
export const EMAIL_RESET = isClerkEnabled();
export type { SocialProvider };

export const MIN_PASSWORD_LENGTH = isClerkEnabled() ? 15 : 10;

const COMMON = [
    "password", "qwerty", "letmein", "welcome", "admin", "iloveyou",
    "123456", "12345678", "abc123", "monkey", "dragon", "football",
];

export function strengthOf(password: string): Strength {
    const pw = password ?? "";
    // The floor tracks whoever is actually going to check it. Clerk enforces
    // its own server-side minimum, and a form that promised less would accept
    // a password and then be refused — which reads as a bug, not a rule.
    const min = MIN_PASSWORD_LENGTH;
    if (!pw) return { score: 0, label: "", hint: `At least ${min} characters.` };

    const lower = pw.toLowerCase();
    if (COMMON.some((c) => lower.includes(c))) {
        return { score: 0, label: "Too easy to guess", hint: "That contains a very common password." };
    }
    if (pw.length < min) {
        const short = min - pw.length;
        return { score: 0, label: "Too short", hint: `${short} more character${short === 1 ? "" : "s"} needed.` };
    }

    // Length does most of the work; variety is a modest bonus.
    const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(pw)).length;
    const unique = new Set(pw).size;
    let score = 1;
    if (pw.length >= 14) score += 1;
    if (pw.length >= 20) score += 1;
    if (variety >= 3 || unique >= 12) score += 1;

    const capped = Math.min(4, score) as 1 | 2 | 3 | 4;
    const labels: Record<number, string> = {
        1: "Weak", 2: "Fair", 3: "Good", 4: "Strong",
    };
    const hints: Record<number, string> = {
        1: "Longer is the easiest way to make it stronger.",
        2: "A few more words would help.",
        3: "Good. A longer passphrase would be better still.",
        4: "Hard to guess. Keep it somewhere you will not lose it.",
    };
    return { score: capped, label: labels[capped], hint: hints[capped] };
}

export interface AccountState {
    mode: "signin" | "signup" | "recover";
    email: string;
    password: string;
    busy: boolean;
    error: string;
    user: AccountUser | null;
    keys: ApiKey[];
    /** Shown once, immediately after creation. Never retrievable again. */
    freshKey: string;
    /** Delete needs a second press; this is the armed state. */
    confirmingDelete: boolean;
    /** Shown once, right after signup. There is no email to resend it to. */
    recoveryCode: string;
    /** The user has confirmed they saved the recovery code. */
    recoverySaved: boolean;
    /** Password field visibility — typing a long passphrase blind is hostile. */
    showPassword: boolean;
    /** Signing in, creating an account, or recovering one. */
    recoveryInput: string;
    /** The "replace my recovery code" form is open. */
    rotating: boolean;
    rotatePassword: string;
    /**
     * Clerk asked for the code it emailed before finishing sign-up.
     *
     * Local auth had no such step — it issued a recovery code and was done —
     * so this is only ever set when Clerk is the backing store. Treating it as
     * ordinary state rather than a separate mode keeps the four skins from
     * each growing a branch.
     */
    needsEmailCode: boolean;
    emailCode: string;
    /** Clerk recover only: the reset code has been emailed; show stage two. */
    resetEmailSent: boolean;
}

export const initialAccountState: AccountState = {
    mode: "signin", email: "", password: "", busy: false, error: "",
    user: null, keys: [], freshKey: "", confirmingDelete: false,
    recoveryCode: "", recoverySaved: false, showPassword: false, recoveryInput: "",
    rotating: false, rotatePassword: "",
    needsEmailCode: false, emailCode: "", resetEmailSent: false,
};

const BASE = "/api";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
        credentials: "same-origin",
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* empty or non-JSON */ }
    if (!res.ok) {
        const detail = (body as { detail?: string } | null)?.detail;
        throw new Error(detail || `Request failed (${res.status})`);
    }
    return body as T;
}

const localAccountApi = {
    me: () => call<{ user: AccountUser }>("/auth/me"),
    register: async (email: string, password: string) => {
        const res = await call<{ user: AccountUser; recovery_code: string }>(
            "/auth/register",
            { method: "POST", body: JSON.stringify({ email, password }) },
        );
        // Local sign-up is always finished in one step — there is no email to
        // verify against. Reported in the same shape as Clerk's so callers
        // branch on the status rather than on which backend they got.
        return { status: "complete" as const, ...res };
    },
    recover: (email: string, recoveryCode: string, newPassword: string) =>
        call<{ ok: true; recovery_code: string }>("/auth/recover", {
            method: "POST",
            body: JSON.stringify({ email, recovery_code: recoveryCode, new_password: newPassword }),
        }),
    /** Issue a fresh recovery code while signed in, replacing a mislaid one. */
    rotateRecovery: (currentPassword: string) =>
        call<{ ok: true; recovery_code: string }>("/auth/recovery-code", {
            method: "POST", body: JSON.stringify({ current_password: currentPassword }),
        }),
    changePassword: (currentPassword: string, newPassword: string) =>
        call<{ ok: true }>("/auth/password", {
            method: "POST",
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        }),
    login: (email: string, password: string) =>
        call<{ user: AccountUser }>("/auth/login", {
            method: "POST", body: JSON.stringify({ email, password }),
        }),
    logout: () => call<{ ok: true }>("/auth/logout", { method: "POST" }),
    deleteAccount: () => call<{ ok: true }>("/auth/me", { method: "DELETE" }),
    listKeys: () => call<{ keys: ApiKey[] }>("/keys"),
    createKey: (label: string) =>
        call<{ key: string; record: ApiKey }>("/keys", {
            method: "POST", body: JSON.stringify({ label }),
        }),
    revokeKey: (keyId: string) =>
        call<{ ok: true }>(`/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" }),
};

/**
 * The account API the UIs actually call.
 *
 * Two implementations behind one shape: Clerk when this deployment has a
 * publishable key, the local scrypt endpoints when it does not. The four skins
 * and AccountPage call this and never learn which they got — which is the only
 * reason moving identity to Clerk is not a change to four UIs and a generator.
 *
 * Resolved per call rather than once at module load, because Clerk arrives
 * asynchronously and a value captured at import time would be the wrong one.
 */
/**
 * What both implementations agree to provide.
 *
 * Written out rather than inferred from one side, because the two genuinely
 * differ and inferring from either would let the other quietly drift. The
 * methods local auth cannot honour are declared here and throw — a clear
 * refusal beats a missing property that only fails at the call site.
 */
export type AccountApi = Omit<typeof localAccountApi, "register"> & {
    register(
        email: string,
        password: string,
    ): Promise<
        | { status: "complete"; user: AccountUser; recovery_code: string }
        | { status: "needs_email_code"; user: null; recovery_code: string }
    >;
    verifyEmailCode(code: string): Promise<{ user: AccountUser }>;
    signInWithSocial(provider: SocialProvider): Promise<void>;
    startPasswordReset(email: string): Promise<{ ok: true }>;
    finishPasswordReset(code: string, newPassword: string): Promise<{ ok: true }>;
};

/** Only Clerk emails codes; local auth hands out a recovery code at signup. */
function notWithLocalAuth(what: string): never {
    throw new Error(`${what} needs email, which this deployment does not use. Use your recovery code.`);
}

const localOnlyStubs = {
    verifyEmailCode: () => notWithLocalAuth("Email verification"),
    startPasswordReset: () => notWithLocalAuth("Password reset by email"),
    finishPasswordReset: () => notWithLocalAuth("Password reset by email"),
    signInWithSocial: () => notWithLocalAuth("Signing in with Google, GitHub or Apple"),
};

export const accountApi = new Proxy({} as AccountApi, {
    get(_target, prop: string) {
        const impl: Record<string, unknown> = isClerkEnabled()
            ? (clerkAccountApi as unknown as Record<string, unknown>)
            : ({ ...localAccountApi, ...localOnlyStubs } as unknown as Record<string, unknown>);
        return impl[prop];
    },
});


/** A short, human description of a key for a list row. */
export function describeKey(key: ApiKey): string {
    const created = key.created_at.slice(0, 10);
    if (key.revoked) return `Revoked · created ${created}`;
    if (!key.last_used_at) return `Never used · created ${created}`;
    return `Last used ${key.last_used_at.slice(0, 10)} · created ${created}`;
}

/** Default label for a new key, so the user never has to name one to start. */
export function defaultKeyLabel(existing: ApiKey[]): string {
    return `Key ${existing.length + 1}`;
}

/**
 * Saves a recovery code to a file.
 *
 * A code is only useful if it survives the tab it was shown in, and "copy"
 * puts it somewhere a clipboard manager may hand to the next app that asks.
 * A file goes where the person chooses and is still there next year.
 *
 * The contents say what the code is for, because a bare string in Downloads a
 * year from now is indistinguishable from junk.
 */
export function downloadRecoveryCode(code: string, email: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const body = [
        "PrivaTools recovery code",
        "",
        `Account:  ${email}`,
        `Issued:   ${today}`,
        "",
        `    ${code}`,
        "",
        "This is the only way back into the account. PrivaTools sends no email,",
        "so there is no reset link. Keep this file, or put the code in a password",
        "manager.",
        "",
        "Using it resets the password, signs out every session, and issues a new",
        "code — this one stops working at that point.",
        "",
    ].join("\n");

    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `privatools-recovery-code-${today}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can race the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

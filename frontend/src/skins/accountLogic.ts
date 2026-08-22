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

const COMMON = [
    "password", "qwerty", "letmein", "welcome", "admin", "iloveyou",
    "123456", "12345678", "abc123", "monkey", "dragon", "football",
];

export function strengthOf(password: string): Strength {
    const pw = password ?? "";
    if (!pw) return { score: 0, label: "", hint: "At least 10 characters." };

    const lower = pw.toLowerCase();
    if (COMMON.some((c) => lower.includes(c))) {
        return { score: 0, label: "Too easy to guess", hint: "That contains a very common password." };
    }
    if (pw.length < 10) {
        return { score: 0, label: "Too short", hint: `${10 - pw.length} more character${10 - pw.length === 1 ? "" : "s"} needed.` };
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
}

export const initialAccountState: AccountState = {
    mode: "signin", email: "", password: "", busy: false, error: "",
    user: null, keys: [], freshKey: "", confirmingDelete: false,
    recoveryCode: "", recoverySaved: false, showPassword: false, recoveryInput: "",
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

export const accountApi = {
    me: () => call<{ user: AccountUser }>("/auth/me"),
    register: (email: string, password: string) =>
        call<{ user: AccountUser; recovery_code: string }>("/auth/register", {
            method: "POST", body: JSON.stringify({ email, password }),
        }),
    recover: (email: string, recoveryCode: string, newPassword: string) =>
        call<{ ok: true; recovery_code: string }>("/auth/recover", {
            method: "POST",
            body: JSON.stringify({ email, recovery_code: recoveryCode, new_password: newPassword }),
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

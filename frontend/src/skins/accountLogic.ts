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

export interface AccountState {
    mode: "signin" | "signup";
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
}

export const initialAccountState: AccountState = {
    mode: "signin", email: "", password: "", busy: false, error: "",
    user: null, keys: [], freshKey: "", confirmingDelete: false,
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
        call<{ user: AccountUser }>("/auth/register", {
            method: "POST", body: JSON.stringify({ email, password }),
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

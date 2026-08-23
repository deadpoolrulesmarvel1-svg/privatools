/**
 * `accountApi`, backed by Clerk.
 *
 * Same shape as the local-auth version in skins/accountLogic.ts, so the four
 * skins and AccountPage keep working without knowing which one they got. That
 * matters more than usual here: three of those skins are generated from design
 * sources and are extended by subclassing, so a change to the call shape is a
 * change to four UIs and a generator.
 *
 * Two places the shapes genuinely cannot match, and are handled rather than
 * papered over:
 *
 * - There is no recovery code. Clerk's way back in is an email, which is the
 *   whole reason for moving. `register` returns `recovery_code: ""`, and every
 *   caller already renders the recovery panel only when that string is
 *   non-empty, so the panel simply does not appear.
 *
 * - Signing up may not finish in one step. Clerk can require an emailed code,
 *   which local auth never did. `register` reports that as
 *   `status: "needs_email_code"` instead of pretending to be done, and the
 *   caller finishes with `verifyEmailCode`.
 */

import type { AccountUser, ApiKey } from "@/skins/accountLogic";
import { clerkToken, requireClerk } from "./instance";

const BASE = "/api";

/** Clerk errors carry the useful text in `errors[0]`, not in `message`. */
function readable(err: unknown): Error {
    const e = err as { errors?: Array<{ longMessage?: string; message?: string }>; message?: string };
    const first = e?.errors?.[0];
    return new Error(first?.longMessage || first?.message || e?.message || "Something went wrong.");
}

function toAccountUser(user: {
    id: string;
    primaryEmailAddress?: { emailAddress?: string } | null;
    createdAt?: Date | null;
}): AccountUser {
    return {
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress ?? "",
        created_at: (user.createdAt ?? new Date()).toISOString(),
    };
}

/**
 * A call to our own API, carrying the Clerk session token.
 *
 * The cookie the local flow relied on does not exist here, so the token is the
 * only thing identifying the caller. A missing token is reported as a plain
 * "not signed in" rather than being sent as an anonymous request that comes
 * back 401 from the far end.
 */
async function callWithToken<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await clerkToken();
    if (!token) throw new Error("Not signed in.");

    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(init?.headers ?? {}),
        },
    });
    let body: unknown = null;
    try {
        body = await res.json();
    } catch {
        /* empty or non-JSON */
    }
    if (!res.ok) {
        const detail = (body as { detail?: string } | null)?.detail;
        throw new Error(detail || `Request failed (${res.status})`);
    }
    return body as T;
}

export type RegisterResult =
    | { status: "complete"; user: AccountUser; recovery_code: string }
    | { status: "needs_email_code"; user: null; recovery_code: string };

export const clerkAccountApi = {
    me: async (): Promise<{ user: AccountUser }> => {
        const clerk = requireClerk();
        if (!clerk.user) throw new Error("Not signed in.");
        return { user: toAccountUser(clerk.user) };
    },

    register: async (email: string, password: string): Promise<RegisterResult> => {
        const clerk = requireClerk();
        try {
            const attempt = await clerk.client!.signUp.create({
                emailAddress: email,
                password,
            });
            if (attempt.status === "complete") {
                await clerk.setActive({ session: attempt.createdSessionId });
                return {
                    status: "complete",
                    user: toAccountUser(clerk.user!),
                    recovery_code: "",
                };
            }
            // Anything short of complete on a fresh email/password sign-up is
            // the email verification step.
            await attempt.prepareEmailAddressVerification({ strategy: "email_code" });
            return { status: "needs_email_code", user: null, recovery_code: "" };
        } catch (err) {
            throw readable(err);
        }
    },

    /** Second half of `register` when Clerk asked for an emailed code. */
    verifyEmailCode: async (code: string): Promise<{ user: AccountUser }> => {
        const clerk = requireClerk();
        try {
            const attempt = await clerk.client!.signUp.attemptEmailAddressVerification({ code });
            if (attempt.status !== "complete") {
                throw new Error("That code did not complete sign-up. Request a new one.");
            }
            await clerk.setActive({ session: attempt.createdSessionId });
            return { user: toAccountUser(clerk.user!) };
        } catch (err) {
            throw readable(err);
        }
    },

    login: async (email: string, password: string): Promise<{ user: AccountUser }> => {
        const clerk = requireClerk();
        try {
            const attempt = await clerk.client!.signIn.create({
                identifier: email,
                password,
            });
            if (attempt.status !== "complete") {
                // Second factor, or a reset Clerk wants done first. The local
                // flow had no equivalent, so say what happened rather than
                // failing silently.
                throw new Error(
                    "This account needs an extra step to sign in. Continue on the account page.",
                );
            }
            await clerk.setActive({ session: attempt.createdSessionId });
            return { user: toAccountUser(clerk.user!) };
        } catch (err) {
            throw readable(err);
        }
    },

    logout: async (): Promise<{ ok: true }> => {
        await requireClerk().signOut();
        return { ok: true };
    },

    changePassword: async (
        currentPassword: string,
        newPassword: string,
    ): Promise<{ ok: true }> => {
        const clerk = requireClerk();
        if (!clerk.user) throw new Error("Not signed in.");
        try {
            await clerk.user.updatePassword({
                currentPassword,
                newPassword,
                // Clerk can end other sessions on a password change. Left off so
                // this behaves like the local flow did, which kept them.
                signOutOfOtherSessions: false,
            });
            return { ok: true };
        } catch (err) {
            throw readable(err);
        }
    },

    deleteAccount: async (): Promise<{ ok: true }> => {
        const clerk = requireClerk();
        if (!clerk.user) throw new Error("Not signed in.");
        try {
            // Clerk owns the identity; the API keys are removed on this side
            // by the user.deleted webhook (backend/app/routes/clerk_webhook.py).
            // Without it, deleting an account here would leave live keys
            // authenticating and spending quota for a user who is gone.
            await clerk.user.delete();
            return { ok: true };
        } catch (err) {
            throw readable(err);
        }
    },

    /**
     * Start a password reset. Clerk emails a code.
     *
     * The local flow took a recovery code the user already held; this one has
     * to send something first, so it is two calls rather than one.
     */
    startPasswordReset: async (email: string): Promise<{ ok: true }> => {
        const clerk = requireClerk();
        try {
            await clerk.client!.signIn.create({
                strategy: "reset_password_email_code",
                identifier: email,
            });
            return { ok: true };
        } catch (err) {
            throw readable(err);
        }
    },

    finishPasswordReset: async (
        code: string,
        newPassword: string,
    ): Promise<{ ok: true }> => {
        const clerk = requireClerk();
        try {
            const attempt = await clerk.client!.signIn.attemptFirstFactor({
                strategy: "reset_password_email_code",
                code,
                password: newPassword,
            });
            if (attempt.status !== "complete") {
                throw new Error("That code did not complete the reset. Request a new one.");
            }
            await clerk.setActive({ session: attempt.createdSessionId });
            return { ok: true };
        } catch (err) {
            throw readable(err);
        }
    },

    // --- API keys stay ours -------------------------------------------------
    // Clerk holds the identity; the keys, their labels and their quota live in
    // our own database and are unchanged. Only the credential differs: a bearer
    // token instead of the session cookie.
    listKeys: () => callWithToken<{ keys: ApiKey[] }>("/keys"),
    createKey: (label: string) =>
        callWithToken<{ key: string; record: ApiKey }>("/keys", {
            method: "POST",
            body: JSON.stringify({ label }),
        }),
    revokeKey: (keyId: string) =>
        callWithToken<{ ok: true }>(`/keys/${encodeURIComponent(keyId)}`, {
            method: "DELETE",
        }),
};

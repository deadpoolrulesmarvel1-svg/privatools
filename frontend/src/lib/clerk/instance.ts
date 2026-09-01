/**
 * The Clerk instance, reachable from outside React.
 *
 * Clerk's API is hooks-first, and three of the four skins are class components
 * generated from their design sources — `withAccounts` subclasses them because
 * a subclass is the only edit that survives regeneration. Hooks cannot be used
 * there, and `accountApi` is a plain object by design so those classes can
 * drive it from `setState`.
 *
 * So a component inside <ClerkProvider> parks the instance here and everything
 * else reads it. Deliberately a module variable rather than `window.Clerk`:
 * that global is clerk-js's own business, not a documented contract, and this
 * way the dependency is visible in imports and can be faked in a test.
 */

import type { useClerk } from "@clerk/react";

export type ClerkInstance = ReturnType<typeof useClerk>;

let instance: ClerkInstance | null = null;

/**
 * Set when clerk-js never arrives.
 *
 * Ad blockers and privacy extensions routinely block anything on a `clerk.`
 * subdomain, and when they do the provider's script tag simply fails. Without
 * this flag every caller reports "still starting up", which is a lie: it is
 * never going to start. The distinction matters because the two states need
 * opposite advice — wait, versus change a browser setting.
 */
let loadFailed = false;

/** Called by <ClerkGate> when it sees the script fail. */
export function markClerkLoadFailed(): void {
    loadFailed = true;
}

export function clerkLoadFailed(): boolean {
    return loadFailed;
}

/** Shown wherever the blocked case surfaces, so the wording stays identical. */
export const CLERK_BLOCKED_MESSAGE =
    "Sign-in could not load. A browser extension or network filter is blocking clerk.privatools.me — allow it and reload the page. Every tool on the site works without an account.";

/** Set by <ClerkBridge>. Not for general use. */
export function setClerkInstance(next: ClerkInstance | null): void {
    instance = next;
}

/**
 * The live instance, or null before <ClerkBridge> mounts.
 *
 * Null is a real state, not an error: Clerk loads asynchronously, and when no
 * publishable key is configured it never loads at all.
 */
export function clerkInstance(): ClerkInstance | null {
    return instance;
}

/**
 * Whether this build was given a Clerk key.
 *
 * Read from the environment rather than from `instance`, so callers can branch
 * before Clerk has finished loading and get a stable answer either way.
 */
export function isClerkEnabled(): boolean {
    return Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
}

/** The instance, or a thrown error naming the actual problem. */
export function requireClerk(): ClerkInstance {
    const clerk = instance;
    if (!clerk) {
        throw new Error(
            loadFailed
                ? CLERK_BLOCKED_MESSAGE
                : isClerkEnabled()
                    ? "Accounts are still starting up. Try again in a moment."
                    : "Accounts are not configured on this deployment.",
        );
    }
    return clerk;
}

/**
 * Like `requireClerk`, but for callers about to touch `clerk.client` — the
 * piece that only exists once clerk-js has actually finished loading. A fast
 * click can beat that load, and a production instance on a foreign origin
 * (localhost against pk_live) never completes it at all. Either way the
 * caller would otherwise crash with "Cannot read properties of undefined",
 * which is not a message to show a person.
 */
export function requireClerkClient(): ClerkInstance {
    const clerk = requireClerk();
    if (!clerk.client) {
        throw new Error(
            loadFailed ? CLERK_BLOCKED_MESSAGE : "Accounts are still starting up. Try again in a moment.",
        );
    }
    return clerk;
}

/**
 * A session token for the API, or null when signed out.
 *
 * Short-lived by design — Clerk refreshes it — so fetch one per request rather
 * than holding onto it.
 */
export async function clerkToken(): Promise<string | null> {
    const clerk = instance;
    if (!clerk?.session) return null;
    try {
        return await clerk.session.getToken();
    } catch {
        return null;
    }
}

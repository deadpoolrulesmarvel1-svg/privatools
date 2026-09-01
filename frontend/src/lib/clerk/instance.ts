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
            isClerkEnabled()
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
        throw new Error("Accounts are still starting up. Try again in a moment.");
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

/**
 * Send the first-party pageview beacon.
 *
 * `/api/analytics/pageview` has existed on the backend, and the privacy page
 * has described it in the present tense, for a long time — but nothing in the
 * browser ever called it. GA4 was empty because no pageview was ever sent, not
 * because a key was missing.
 *
 * Everything here is deliberately small: a path, a title, a same-origin
 * referrer and an anonymous id. No file names, no query strings, no uploads.
 * The backend re-sanitises all of it before forwarding, so this is the polite
 * version of a contract it already enforces.
 */

import { readAnalyticsPrivacyPreference } from "./analyticsPrivacy";

const CLIENT_ID_KEY = "pt-analytics-cid";
const SESSION_KEY = "pt-analytics-session";
const ENDPOINT = "/api/analytics/pageview";
/** GA4's own definition of a session: 30 minutes of inactivity ends it. */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * A random id, kept in localStorage so repeat visits count as one browser.
 *
 * Not derived from anything about the visitor: no fingerprint, no IP, no
 * account. Clearing site data ends it, which is the intended escape hatch.
 * Private mode throws on storage, and a per-session id is the right fallback.
 */
function clientId(): string {
    const fresh = () =>
        `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
    try {
        const held = localStorage.getItem(CLIENT_ID_KEY);
        if (held) return held;
        const made = fresh();
        localStorage.setItem(CLIENT_ID_KEY, made);
        return made;
    } catch {
        return fresh();
    }
}

/**
 * Whether this visitor has asked, by any means, not to be counted.
 *
 * `effectiveDisabled` already folds together the local toggle and the
 * browser's DNT/GPC signal, so this defers to it rather than re-deriving the
 * rule and risking the two drifting apart.
 */
function optedOut(): boolean {
    try {
        return readAnalyticsPrivacyPreference().effectiveDisabled;
    } catch {
        // A preference we cannot read is not consent.
        return true;
    }
}

/**
 * One canonical path per view.
 *
 * The skin routes on the hash, and it sets that hash from the URL path on
 * mount — so a single arrival produces "/" and then "/#/", which look like two
 * different pages and were counted as two. Reading the hash when there is one,
 * and trimming the trailing slash, collapses them to the same "/". Query
 * strings are dropped here as well as server-side: a shared link can carry
 * things a page-view report has no business holding.
 */
function normalise(raw: string): string {
    const noQuery = raw.split("?")[0].split("#")[0];
    return noQuery.replace(/\/+$/, "") || "/";
}

function currentPath(): string {
    const hash = window.location.hash.replace(/^#/, "");
    return normalise(hash.startsWith("/") ? hash : window.location.pathname);
}

/**
 * A GA4 session id, rolled after 30 minutes of inactivity.
 *
 * Without one, and without engagement_time_msec below, GA4 accepts the event
 * and shows it in Realtime but never counts it towards users, sessions or
 * engagement — so every standard report stays empty while the data appears to
 * be arriving. It is the most expensive silent failure in Measurement
 * Protocol, because everything looks like it is working.
 */
function sessionId(): string {
    const now = Date.now();
    const fresh = () => String(Math.floor(now / 1000));
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (raw) {
            const [id, last] = raw.split(":");
            if (id && Number(last) && now - Number(last) < SESSION_IDLE_MS) {
                sessionStorage.setItem(SESSION_KEY, `${id}:${now}`);
                return id;
            }
        }
        const made = fresh();
        sessionStorage.setItem(SESSION_KEY, `${made}:${now}`);
        return made;
    } catch {
        return fresh();
    }
}

/** When this page-view began, so engagement time is a real number. */
let viewStartedAt = Date.now();

/** The last path sent, so a re-render does not count twice. */
let lastPath = "";

export function sendPageview(path?: string): void {
    if (typeof window === "undefined") return;
    if (optedOut()) return;

    const clean = path ? normalise(path) : currentPath();
    if (clean === lastPath) return;
    lastPath = clean;

    const now = Date.now();
    const engaged = Math.min(Math.max(now - viewStartedAt, 100), 3_600_000);
    viewStartedAt = now;

    const body = JSON.stringify({
        path: clean,
        title: document.title.slice(0, 160) || null,
        referrer: document.referrer || null,
        client_id: clientId(),
        session_id: sessionId(),
        engagement_time_msec: engaged,
    });

    try {
        // sendBeacon survives the page being closed mid-navigation, which is
        // exactly when the last pageview of a visit would otherwise be lost.
        if (navigator.sendBeacon) {
            navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
            return;
        }
        void fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
        }).catch(() => {});
    } catch {
        // Analytics must never be the reason a page misbehaves.
    }
}

/**
 * Count the first view and every hash navigation after it.
 *
 * Returns a teardown so a test — or a second mount — cannot leave a listener
 * behind.
 */
export function startPageviewTracking(): () => void {
    if (typeof window === "undefined") return () => {};
    const onNav = () => sendPageview();
    sendPageview();
    window.addEventListener("hashchange", onNav);
    window.addEventListener("popstate", onNav);
    return () => {
        window.removeEventListener("hashchange", onNav);
        window.removeEventListener("popstate", onNav);
    };
}

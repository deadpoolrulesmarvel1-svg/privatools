/**
 * PrivaTools service worker.
 *
 * Strategy:
 *   1. App shell (HTML + CSS + JS hashed bundles) — stale-while-revalidate.
 *      Cached at install for "/" and "/index.html"; everything else slips
 *      into the shell cache lazily as the user navigates so the next visit
 *      paints instantly even on flaky networks.
 *   2. Static assets (icons, og image, fonts) — stale-while-revalidate.
 *   3. Tool routes — the last 10 visited /tool/* and /tools/* HTML responses
 *      are kept in a separate LRU cache so users can revisit recent tools
 *      offline. /index.html is served for unknown routes (SPA fallback).
 *   4. /api/* — bypassed completely. User files and tool outputs are
 *      privacy-sensitive and must never be cached.
 *   5. Cross-origin (googletagmanager) — pass-through. Self-hosted font
 *      files are cached as same-origin static assets.
 *
 * Versioning: bumping CACHE_VERSION wipes old caches in `activate`.
 */

const CACHE_VERSION = "v1.5.1";
const SHELL_CACHE   = `privatools-shell-${CACHE_VERSION}`;
const ASSET_CACHE   = `privatools-assets-${CACHE_VERSION}`;
const ROUTE_CACHE   = `privatools-routes-${CACHE_VERSION}`;
const FONT_CACHE    = `privatools-fonts-${CACHE_VERSION}`;
const ROUTE_LIMIT   = 10;

// Files we always want available offline — the SPA shell.
const PRECACHE = ["/", "/index.html", "/manifest.json"];

/* ───────────────────────── install ───────────────────────── */
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)),
    );
    self.skipWaiting();
});

/* ───────────────────────── activate ───────────────────────── */
self.addEventListener("activate", (event) => {
    const ALLOW = new Set([SHELL_CACHE, ASSET_CACHE, ROUTE_CACHE, FONT_CACHE]);
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => !ALLOW.has(k)).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

/* ───────────────────── helpers ───────────────────────────── */
const isApi = (url) => url.pathname.startsWith("/api/");
const isAsset = (url) =>
    url.origin === self.location.origin &&
    /\.(?:js|mjs|css|png|jpg|jpeg|gif|svg|ico|webp|avif|wasm|json|xml|txt|webmanifest)$/i.test(url.pathname);
const isToolRoute = (url) =>
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/tool/") || url.pathname.startsWith("/tools/"));
const isFontRequest = (url) =>
    url.origin === self.location.origin && /\.(?:woff2?|ttf|otf|eot)(?:\?|$)/i.test(url.pathname);

/** Stale-while-revalidate: return cache if present, fetch in the background, replace. */
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                // Clone before consuming because the response body is a stream.
                cache.put(request, response.clone()).catch(() => {});
            }
            return response;
        })
        .catch(() => cached);
    return cached || network;
}

/** LRU trim — keep only the most recent N entries in a cache. */
async function trimCache(cacheName, max) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    // Caches preserve insertion order; oldest entries are at the front.
    await Promise.all(keys.slice(0, keys.length - max).map((req) => cache.delete(req)));
}

/** Navigation handler — SPA fallback to /index.html when offline. */
async function handleNavigation(request) {
    try {
        const fresh = await fetch(request);
        // Cache successful navigation in the route LRU cache (tool routes only).
        if (fresh && fresh.ok) {
            const url = new URL(request.url);
            if (isToolRoute(url)) {
                const cache = await caches.open(ROUTE_CACHE);
                cache.put(request, fresh.clone()).catch(() => {});
                trimCache(ROUTE_CACHE, ROUTE_LIMIT).catch(() => {});
            }
        }
        return fresh;
    } catch {
        // Offline — try the exact request first, then fall through to /index.html.
        const cached = await caches.match(request);
        if (cached) return cached;
        const shell = await caches.match("/index.html");
        if (shell) return shell;
        return new Response(
            "<h1>You are offline</h1><p>Reconnect to load this tool.</p>",
            { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 },
        );
    }
}

/* ───────────────────────── fetch ────────────────────────── */
self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Never cache the user's files / tool outputs — privacy boundary.
    if (isApi(url)) return;

    // Navigation requests — SPA shell fallback + tool-route LRU.
    if (request.mode === "navigate") {
        event.respondWith(handleNavigation(request));
        return;
    }

    // Cross-origin analytics/model/CDN requests pass through.
    if (url.origin !== self.location.origin) {
        return;
    }

    if (isFontRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
        return;
    }

    // Hashed JS/CSS/asset chunks — stale-while-revalidate. Vite content-hashes
    // filenames so cache hits are always for an immutable artifact; SWR keeps
    // the latest copy warm for the next deploy.
    if (isAsset(url)) {
        event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
        return;
    }

    // Anything else same-origin — try cache then network.
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

/* ─────────── Allow the page to ask the SW to activate immediately ─────────── */
self.addEventListener("message", (event) => {
    if (event.data === "SKIP_WAITING") self.skipWaiting();
});

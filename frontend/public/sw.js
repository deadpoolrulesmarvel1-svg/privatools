/* PrivaTools: cache application code, never user files or account responses. */
const CACHE_VERSION = "v2.0.0";
const SHELL_CACHE = `privatools-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `privatools-assets-${CACHE_VERSION}`;
const APP_CACHE_PREFIX = /^privatools-(?:shell|assets|routes|fonts)-/;
const STATIC_LIMIT = 250;
const PRECACHE = [
    "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png",
    "/experience/air-mist.png", "/experience/air-graphite.png",
];

const isSensitivePath = (url) => /^\/(?:api|account|auth|sign-in|sign-up|signin|signup|logout|download|downloads|upload|uploads|files|outputs|jobs)(?:\/|$)/i.test(url.pathname);
const isStaticAsset = (url) => url.origin === self.location.origin && !url.search && (
    /^\/assets\/[\w./-]+\.(?:js|mjs|css|wasm|woff2?|png|jpe?g|svg|webp|avif)$/i.test(url.pathname)
    || /^\/(?:fonts|icons)\/[\w./-]+\.(?:woff2?|ttf|otf|png|svg|ico)$/i.test(url.pathname)
    || /^\/brand\/privatools-[\w-]+\.(?:png|svg)$/i.test(url.pathname)
    // Large model runtime files are cached only after a local tool requests
    // them. Weights use their separate integrity-checked model cache.
    || /^\/models\/ort-wasm-simd-threaded\.(?:mjs|wasm)$/.test(url.pathname)
    || PRECACHE.includes(url.pathname)
);
const cacheable = (response) => response?.ok && response.type !== "opaque"
    && !/(?:no-store|private)/i.test(response.headers.get("cache-control") || "")
    && !response.headers.has("content-disposition");

/** Parse only same-origin static references. Dynamic imports remain on demand. */
function dependencies(source, base, type) {
    const references = type === "html"
        ? Array.from(source.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi), (m) => m[1])
        : type === "js"
            ? Array.from(source.matchAll(/(?:\b(?:import|export)\s*[^;"'()]*?\bfrom\s*|\bimport\s*)["']([^"']+)["']/g), (m) => m[1])
            : Array.from(source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g), (m) => m[1]);
    return references.map((path) => { try { return new URL(path, base); } catch { return null; } })
        .filter((url) => url && isStaticAsset(url));
}

async function precacheShell() {
    const shell = await caches.open(SHELL_CACHE);
    const assets = await caches.open(ASSET_CACHE);
    const response = await fetch(new Request("/index.html", { cache: "reload", credentials: "omit" }));
    if (!cacheable(response)) throw new Error("The application shell could not be cached.");
    const html = await response.clone().text();
    const queue = [...dependencies(html, `${self.location.origin}/index.html`, "html"),
        ...PRECACHE.map((path) => new URL(path, self.location.origin))];
    const seen = new Set();
    while (queue.length) {
        const url = queue.shift();
        if (seen.has(url.href)) continue;
        seen.add(url.href);
        const resource = await fetch(new Request(url.href, { cache: "reload", credentials: "omit" }));
        if (!cacheable(resource)) throw new Error(`An application asset could not be cached: ${url.pathname}`);
        await assets.put(url.href, resource.clone());
        const type = /\.(?:m?js)$/.test(url.pathname) ? "js" : /\.css$/.test(url.pathname) ? "css" : null;
        if (type) queue.push(...dependencies(await resource.text(), url.href, type));
    }
    // Publish the shell only after its static import graph is available.
    await shell.put("/index.html", response);
}

self.addEventListener("install", (event) => {
    event.waitUntil(precacheShell());
    // A replacement waits. It must never reload an in-progress file task.
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        // Keep preceding v2 static code for existing tabs. Legacy v1 allowed
        // arbitrary GET responses, so those caches are always removed.
        const previousAssets = keys.filter((key) => key.startsWith("privatools-assets-v2.") && key !== ASSET_CACHE).at(-1);
        const keep = new Set([SHELL_CACHE, ASSET_CACHE, previousAssets]);
        await Promise.all(keys.filter((key) => APP_CACHE_PREFIX.test(key) && !keep.has(key)).map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

async function cachedAsset(request, event) {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (cacheable(response)) {
            event.waitUntil((async () => {
                await cache.put(request, response.clone());
                const keys = await cache.keys();
                // Preserve precached entry dependencies by evicting newest runtime
                // additions when the cap is reached, not oldest shell files.
                if (keys.length > STATIC_LIMIT) await Promise.all(keys.slice(STATIC_LIMIT).map((key) => cache.delete(key)));
            })());
        }
        return response;
    } catch {
        // An open older tab may request an older hashed chunk after an update.
        const old = await caches.match(request);
        if (old) return old;
        return Response.error();
    }
}

// Browser tools whose server route grants WebAssembly and nothing more they
// need offline: Background Remover's model and Voice Noise Remover's RNNoise.
const OFFLINE_WASM_ROUTES = new Set(["/tools/remove-background", "/tools/remove-background-noise"]);

async function publicNavigation(request) {
    try { return await fetch(request); }
    catch {
        const shell = await (await caches.open(SHELL_CACHE)).match("/index.html");
        // The cached root document is more restrictive than the real model
        // route. Preserve its HTML/nonce and every other directive, adding
        // only the WASM capability already granted to this exact server route.
        // No script eval, remote script host, provider egress or URL caching.
        if (shell && OFFLINE_WASM_ROUTES.has(new URL(request.url).pathname.replace(/\/+$/, ""))) {
            const headers = new Headers(shell.headers);
            const current = headers.get("Content-Security-Policy");
            if (current) {
                const policy = current.replace(/(^|;)\s*script-src\s+([^;]*)/i, (directive, separator, sources) =>
                    sources.includes("'wasm-unsafe-eval'") || sources.includes("'none'") ? directive
                        : `${separator} script-src ${sources.trim()} 'wasm-unsafe-eval'`);
                if (policy !== current) {
                    headers.set("Content-Security-Policy", policy);
                    return new Response(shell.body, { status: shell.status, statusText: shell.statusText, headers });
                }
            }
        }
        return shell || new Response("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>PrivaTools is offline</title><h1>Reconnect to open PrivaTools</h1><p>Once the app is ready, previously opened browser tools can work offline. Server tools require a connection.</p></html>", {
            status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
    }
}

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    // Strict allowlist: arbitrary same-origin GETs are deliberately untouched.
    if (request.method !== "GET" || url.origin !== self.location.origin
        || request.headers.has("authorization") || request.cache === "no-store"
        || request.headers.has("range") || isSensitivePath(url)) return;
    if (request.mode === "navigate") {
        event.respondWith(publicNavigation(request));
    } else if (isStaticAsset(url)) {
        event.respondWith(cachedAsset(request, event));
    }
});

self.addEventListener("message", (event) => {
    if (event.data === "SKIP_WAITING") self.skipWaiting();
});

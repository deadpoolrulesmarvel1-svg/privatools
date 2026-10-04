import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
const origin = "https://privatools.test";
const source = readFileSync(`${process.cwd()}/public/sw.js`, "utf8");
const key = (r: string | Request) => new URL(typeof r === "string" ? r : r.url, origin).href;
class MemoryCache {
    entries = new Map<string, Response>();
    async put(r: string | Request, response: Response) { this.entries.set(key(r), response.clone()); }
    async match(r: string | Request) { return this.entries.get(key(r))?.clone(); }
    async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
    async delete(r: string | Request) { return this.entries.delete(key(r)); }
}
function harness() {
    const buckets = new Map<string, MemoryCache>();
    const caches = {
        open: async (name: string) => { if (!buckets.has(name)) buckets.set(name, new MemoryCache()); return buckets.get(name)!; },
        keys: async () => [...buckets.keys()], delete: async (name: string) => buckets.delete(name),
        match: async (r: string | Request) => { for (const cache of buckets.values()) { const found = await cache.match(r); if (found) return found; } },
    };
    const fixtures: Record<string, string> = {
        "/index.html": '<script src="/assets/index-a.js"></script><link href="/assets/index-a.css">',
        "/assets/index-a.js": 'import {x} from "./react-a.js";import "./layout-a.js";const lazy=()=>import("./lazy-a.js");',
        "/assets/react-a.js": "export const x = 1;", "/assets/layout-a.js": 'export {x} from "./react-a.js";',
        "/assets/index-a.css": '@font-face{src:url("/fonts/body.woff2")}', "/fonts/body.woff2": "font",
        "/experience/air-mist.png": "light artwork", "/experience/air-graphite.png": "dark artwork",
        "/manifest.json": "{}", "/icons/icon-192.png": "icon", "/icons/icon-512.png": "icon", "/icons/icon-maskable-512.png": "icon",
    };
    const fetch = vi.fn(async (r: Request) => { const path = new URL(r.url).pathname; return new Response(fixtures[path] || "missing", { status: path in fixtures ? 200 : 404 }); });
    const events: Record<string, (event: unknown) => void> = {};
    const skipWaiting = vi.fn(), claim = vi.fn();
    class BrowserRequest extends Request { constructor(input: string | URL | Request, init?: RequestInit) { super(typeof input === "string" ? new URL(input, origin) : input, init); } }
    vm.runInNewContext(source, { Request: BrowserRequest, Response, Headers, URL, Set, Map, caches, fetch,
        self: { location: { origin }, clients: { claim }, skipWaiting, addEventListener: (name: string, fn: (e: unknown) => void) => { events[name] = fn; } },
    });
    async function dispatch(name: string, extra = {}) {
        let response: Promise<Response> | undefined;
        const pending: Promise<unknown>[] = [];
        events[name]({ waitUntil: (p: Promise<unknown>) => pending.push(p), respondWith: (p: Promise<Response>) => { response = p; }, ...extra });
        const result = await response; await Promise.all(pending); return result;
    }
    const request = (path: string, init: RequestInit = {}, navigation = false) => {
        const req = new Request(new URL(path, origin), init);
        if (navigation) Object.defineProperty(req, "mode", { value: "navigate" });
        return req;
    };
    return { caches, fixtures, fetch, dispatch, request, skipWaiting, claim };
}

describe("service worker privacy and offline lifecycle", () => {
    it("prepares the shell import graph without activating an update or preloading lazy tools", async () => {
        const h = harness(); await h.dispatch("install");
        expect(h.skipWaiting).not.toHaveBeenCalled();
        const urls = h.fetch.mock.calls.map(([r]) => new URL(r.url).pathname);
        expect(urls).toEqual(expect.arrayContaining(["/index.html", "/assets/index-a.js", "/assets/react-a.js", "/assets/layout-a.js", "/assets/index-a.css", "/fonts/body.woff2", "/experience/air-mist.png", "/experience/air-graphite.png"]));
        expect(urls).not.toContain("/assets/lazy-a.js");
        expect(await (await h.caches.open("privatools-shell-v2.0.0")).match("/index.html")).toBeTruthy();
    });
    it("does not publish an incomplete shell when an essential dependency fails", async () => {
        const h = harness(); delete h.fixtures["/assets/react-a.js"];
        await expect(h.dispatch("install")).rejects.toThrow("could not be cached");
        expect(await (await h.caches.open("privatools-shell-v2.0.0")).match("/index.html")).toBeUndefined();
    });
    it("keeps the linked brand icons available offline while excluding private or unrecognized brand requests", async () => {
        const h = harness();
        const brandFiles = ["privatools-icon-96.png", "privatools-favicon.svg", "privatools-icon-180.png"];
        for (const name of brandFiles) {
            h.fixtures["/index.html"] += `<link rel="icon" href="/brand/${name}">`;
            h.fixtures[`/brand/${name}`] = `public icon ${name}`;
        }
        await h.dispatch("install");
        h.fetch.mockRejectedValue(new Error("offline"));
        for (const name of brandFiles) {
            const response = await h.dispatch("fetch", { request: h.request(`/brand/${name}`) });
            expect(await response?.text()).toBe(`public icon ${name}`);
        }
        for (const path of ["/brand/private.json", "/brand/private.js", "/brand/privatools-icon-96.png?token=secret"])
            expect(await h.dispatch("fetch", { request: h.request(path) })).toBeUndefined();
        expect(await h.dispatch("fetch", { request: h.request("/brand/privatools-icon-96.png", { headers: { Authorization: "Bearer secret" } }) })).toBeUndefined();
    });
    it("bypasses private endpoints, arbitrary GETs, private headers and authenticated navigations", async () => {
        const h = harness();
        for (const path of ["/api", "/api/account", "/account", "/account/settings", "/files/report.pdf", "/downloads/result.json", "/upload", "/jobs/123", "/auth/callback", "/profile.json", "/private-user.json", "/assets/file.js?token=secret", "https://other.test/assets/index.js"])
            expect(await h.dispatch("fetch", { request: h.request(path) })).toBeUndefined();
        expect(await h.dispatch("fetch", { request: h.request("/account/sign-in", {}, true) })).toBeUndefined();
        for (const init of [{ headers: { Authorization: "Bearer value" } }, { headers: { Range: "bytes=0-99" } }, { cache: "no-store" as const }, { method: "POST" }])
            expect(await h.dispatch("fetch", { request: h.request("/assets/index-a.js", init) })).toBeUndefined();
        expect(h.fetch).not.toHaveBeenCalled();
    });
    it("caches the two public background-model runtime files only on demand", async () => {
        const h = harness();
        const paths = ["/models/ort-wasm-simd-threaded.mjs", "/models/ort-wasm-simd-threaded.wasm"];
        for (const path of paths) h.fixtures[path] = `public runtime ${path}`;
        await h.dispatch("install");
        expect(h.fetch.mock.calls.some(([request]) => new URL(request.url).pathname.startsWith("/models/"))).toBe(false);
        for (const path of paths) {
            expect(await (await h.dispatch("fetch", { request: h.request(path) }))?.text()).toBe(`public runtime ${path}`);
        }
        h.fetch.mockRejectedValue(new Error("offline"));
        for (const path of paths) {
            expect(await (await h.dispatch("fetch", { request: h.request(path) }))?.text()).toBe(`public runtime ${path}`);
        }
        for (const path of ["/models/u2netp.onnx", "/models/other-model.wasm", "/models/private.json", "/models/ort-wasm-simd-threaded.wasm?token=secret"]) {
            expect(await h.dispatch("fetch", { request: h.request(path) })).toBeUndefined();
        }
        for (const init of [{ headers: { Authorization: "Bearer secret" } }, { cache: "no-store" as const }, { headers: { Range: "bytes=0-99" } }]) {
            expect(await h.dispatch("fetch", { request: h.request(paths[0], init) })).toBeUndefined();
        }
    });
    it("serves the canonical shell offline without caching navigation URLs", async () => {
        const h = harness(); await h.dispatch("install"); h.fetch.mockRejectedValue(new Error("offline"));
        const response = await h.dispatch("fetch", { request: h.request("/tools/json-xml-formatter?text=private", {}, true) });
        expect(await response?.text()).toContain("/assets/index-a.js");
        expect((await (await h.caches.open("privatools-shell-v2.0.0")).keys()).map((r) => new URL(r.url).pathname)).toEqual(["/index.html"]);
    });
    it("preserves the cached nonce and restrictions while allowing WASM only on the verified background route", async () => {
        const h = harness();
        const html = '<script nonce="cached-nonce" src="/assets/index-a.js"></script>';
        const policy = "default-src 'self'; script-src 'self' 'nonce-cached-nonce'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'";
        const shell = await h.caches.open("privatools-shell-v2.0.0");
        await shell.put("/index.html", new Response(html, { headers: { "Content-Security-Policy": policy, "Content-Type": "text/html" } }));
        h.fetch.mockRejectedValue(new Error("offline"));
        for (const path of ["/tools/remove-background", "/tools/remove-background/?text=private", "/tools/remove-background-noise"]) {
            const response = await h.dispatch("fetch", { request: h.request(path, {}, true) });
            expect(await response?.text()).toBe(html);
            const actual = response!.headers.get("Content-Security-Policy")!;
            expect(actual).toContain("script-src 'self' 'nonce-cached-nonce' 'wasm-unsafe-eval'");
            expect(actual.replace(" 'wasm-unsafe-eval'", "")).toBe(policy);
            expect(actual).not.toContain("'unsafe-eval'"); expect(actual).not.toContain("blob:");
        }
        for (const path of ["/", "/tools", "/tools/remove-background-other", "/tool/remove-background", "/tool/merge-pdf"]) {
            const response = await h.dispatch("fetch", { request: h.request(path, {}, true) });
            expect(response!.headers.get("Content-Security-Policy")).toBe(policy);
        }
        expect((await shell.match("/index.html"))!.headers.get("Content-Security-Policy")).toBe(policy);
        expect((await shell.keys()).map(request => new URL(request.url).pathname)).toEqual(["/index.html"]);
        const backend = readFileSync(`${process.cwd()}/../backend/app/main.py`, "utf8");
        const serverPaths = backend.match(/_WASM_EVAL_PATHS = \{([\s\S]*?)\n\}/)?.[1];
        expect(serverPaths).toContain('"/tools/remove-background"');
        expect(serverPaths).toContain('"/tools/remove-background-noise"');
    });
    it("caches static code while respecting private, no-store and download response headers", async () => {
        const h = harness();
        for (const headers of [{ "Cache-Control": "private, max-age=60" }, { "Cache-Control": "no-store" }, { "Content-Disposition": "attachment; filename=report.js" }]) {
            h.fetch.mockResolvedValueOnce(new Response("private", { headers }));
            await h.dispatch("fetch", { request: h.request("/assets/private.js") });
            expect(await (await h.caches.open("privatools-assets-v2.0.0")).match("/assets/private.js")).toBeUndefined();
        }
        h.fetch.mockResolvedValueOnce(new Response("static code"));
        await h.dispatch("fetch", { request: h.request("/assets/good.js") }); h.fetch.mockRejectedValue(new Error("offline"));
        expect(await (await h.dispatch("fetch", { request: h.request("/assets/good.js") }))?.text()).toBe("static code");
    });
    it("cleans only app caches, retains prior code and activates only on an explicit message", async () => {
        const h = harness();
        for (const name of ["user-vault", "privatools-shell-old", "privatools-assets-old", "privatools-assets-v2.previous", "privatools-routes-old", "privatools-assets-v2.0.0"]) await h.caches.open(name);
        await h.dispatch("activate");
        expect(await h.caches.keys()).toEqual(["user-vault", "privatools-assets-v2.previous", "privatools-assets-v2.0.0"]);
        expect(h.claim).toHaveBeenCalledOnce(); expect(h.skipWaiting).not.toHaveBeenCalled();
        await h.dispatch("message", { data: "SKIP_WAITING" }); expect(h.skipWaiting).toHaveBeenCalledOnce();
    });
});

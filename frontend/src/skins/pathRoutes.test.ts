/**
 * Guard the path→hash bridge that makes the ported designs answer to real URLs.
 *
 * Aurora, Carbon and Structured route on `location.hash`. Everything that
 * addresses them from outside — the nav, the sitemap, Google, a shared link —
 * uses a path. Without the bridge their routers fall through to the default
 * route and every tool URL renders the homepage.
 *
 * The route list is read out of App.tsx rather than restated here, so a route
 * added to the router and forgotten in `pathRoutes.ts` fails this test instead
 * of shipping as a page that silently renders the homepage.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PATH_ROUTE_PREFIXES, hashForPath } from "./pathRoutes";

/** Every `<Route path="...">` App.tsx declares, minus the catch-all and root. */
function declaredRoutes(): string[] {
    const src = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8");
    const found = [...src.matchAll(/<Route\s+path="([^"]*)"/g)].map((m) => m[1]);
    expect(found.length).toBeGreaterThan(10); // the regex still matches something
    return found.filter((p) => p.startsWith("/") && p !== "/");
}

describe("pathRoutes", () => {
    it("covers every route App.tsx declares", () => {
        const uncovered = declaredRoutes().filter(
            (route) =>
                !PATH_ROUTE_PREFIXES.some(
                    (prefix) => route === prefix || route.startsWith(prefix + "/"),
                ),
        );
        expect(uncovered).toEqual([]);
    });

    it("tries longer prefixes first, so /tools never matches as /tool", () => {
        const lengths = PATH_ROUTE_PREFIXES.map((p) => p.length);
        expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    });

    it("sends both catalogue halves to the single #/tool/ route", () => {
        // The designs have one tool route; the site has two paths into it.
        expect(hashForPath("/tool/merge-pdf")).toBe("#/tool/merge-pdf");
        expect(hashForPath("/tools/image-compressor")).toBe("#/tool/image-compressor");
    });

    it("keeps /tools itself as the listing, not a tool named nothing", () => {
        expect(hashForPath("/tools")).toBe("#/tools");
    });

    it("passes non-tool routes through unchanged", () => {
        expect(hashForPath("/blog/some-post")).toBe("#/blog/some-post");
        expect(hashForPath("/account/keys")).toBe("#/account/keys");
        expect(hashForPath("/privacy")).toBe("#/privacy");
    });

    it("claims nothing it does not own", () => {
        // "" means leave the URL alone — a design that hijacked unknown paths
        // would break anything else served from this origin.
        expect(hashForPath("/not-a-route")).toBe("");
        expect(hashForPath("/toolshed")).toBe(""); // a prefix match, not a route
        expect(hashForPath("")).toBe("");
    });
});

describe("withPathRoutes history handling", () => {
    // Comments only, stripped — the file explains at length why it does NOT
    // assign to location.hash, and that prose matched the guard.
    const src = readFileSync(resolve(__dirname, "./withPathRoutes.tsx"), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

    it("never assigns to location.hash, which would trap the back button", () => {
        // `location.hash = x` PUSHES a history entry, making the tool page its
        // own predecessor: back clears the hash, the mixin restores it, and the
        // user cannot leave. Caught in review by walking back from
        // /tool/merge-pdf in Carbon and landing on /tool/merge-pdf.
        expect(src).not.toMatch(/location\.hash\s*=[^=]/);
        expect(src).toContain("history.replaceState");
    });

    it("dispatches hashchange itself, since replaceState does not", () => {
        // The whole bridge rests on the design hearing about the new hash.
        expect(src).toMatch(/dispatchEvent/);
        expect(src).toMatch(/["']hashchange["']/);
    });
});

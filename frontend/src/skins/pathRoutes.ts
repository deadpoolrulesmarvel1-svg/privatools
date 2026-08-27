/**
 * The path prefixes a ported design must answer to.
 *
 * These are the URLs the outside world uses to reach a tool: the house nav
 * links to them, the sitemap advertises them, Google indexes them, and a shared
 * link is one of them. A hash-routed design has to translate them — see
 * `withPathRoutes`.
 *
 * Kept next to the skins rather than inside one, because two designs need it
 * and a third may. `pathRoutes.test.ts` checks it against App.tsx's own route
 * declarations, so a route added to the router and forgotten here shows up as a
 * failing test rather than as a tool page that silently renders the homepage.
 */

/** Route prefixes that carry a parameter — `/tool/merge-pdf`, `/blog/some-post`. */
export const PARAM_ROUTE_PREFIXES: readonly string[] = [
    "/tool",
    "/tools",
    "/blog",
    "/compare",
];

/** Routes that stand alone. */
export const EXACT_ROUTES: readonly string[] = [
    "/about",
    "/privacy",
    "/security",
    "/terms",
    "/pipeline",
    "/batch",
    "/status",
    "/support",
    "/account",
    "/my-stuff",
];

/**
 * Everything a path may start with, longest first.
 *
 * Longest-first matters: `/tools` must be tested before `/tool`, or
 * `/tools/qr-generator` matches the `/tool` prefix and the design is handed
 * `s/qr-generator` as a slug.
 */
export const PATH_ROUTE_PREFIXES: readonly string[] = [
    ...PARAM_ROUTE_PREFIXES,
    ...EXACT_ROUTES,
].slice().sort((a, b) => b.length - a.length);

/**
 * The hash a hash-routed design should show for a given site path.
 *
 * Returns "" when the path belongs to no route this design owns, which the
 * caller reads as "leave the URL alone".
 *
 * Not a straight copy of the path. The site splits its catalogue in two —
 * `/tool/<slug>` for PDF tools, `/tools/<slug>` for everything else — while the
 * ported designs route *every* tool at `#/tool/<slug>`. Copying the path
 * verbatim sends `/tools/image-compressor` to the all-tools listing instead of
 * the tool, which looks like the very bug this is here to fix.
 *
 * Pure, and separate from the mixin that calls it, so it can be tested without
 * mounting a design.
 */
export function hashForPath(path: string): string {
    const nonPdfTool = path.match(/^\/tools\/(.+)$/);
    if (nonPdfTool) return "#/tool/" + nonPdfTool[1];

    for (const prefix of PATH_ROUTE_PREFIXES) {
        if (path === prefix || path.indexOf(prefix + "/") === 0) {
            return "#" + path;
        }
    }
    return "";
}

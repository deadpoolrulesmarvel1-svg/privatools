/* eslint-disable */
// @ts-nocheck
/**
 * Structured Privacy OS — extension.
 *
 * Structured routes on `location.pathname`, so navigation goes through
 * history.pushState and the mixins' popstate listener brings the component back
 * round. Its route table treats "/" as a prefix pattern, so an unmatched path
 * resolves to `home` rather than 404 — both flags have to be suppressed.
 *
 * Its own vault is simulated; the real one replaces it at the same route.
 */
import Base from "../structured/SkinApp";
import { withAccounts } from "../withAccounts";
import { withVault } from "../withVault";
import { withRealCatalogue } from "../withRealCatalogue";
import { STRUCTURED_CATALOGUE } from "../catalogue";

// This design reads `window.PRIVATOOLS_CATALOGUE` and falls back to its own
// sample records when it is absent — its documented seam for supplying the real
// catalogue. Assigned at module scope so it is in place before the component
// constructs and reads it.
if (typeof window !== "undefined") {
    (window as unknown as { PRIVATOOLS_CATALOGUE: unknown }).PRIVATOOLS_CATALOGUE = STRUCTURED_CATALOGUE;
}

const PALETTE = {
    accent: "var(--em)", accentSoft: "var(--emSoft)", line: "var(--line)",
    text: "var(--ink)", dim: "var(--ink2)", faint: "var(--ink3)",
};

const navItem = ({ label, icon, onClick, active }) => ({
    label, icon, go: onClick,
    cur: active ? "page" : undefined,
    fw: active ? "600" : "400",
    fg: active ? "var(--ink)" : "var(--ink2)",
    bg: active ? "var(--emSoft)" : "transparent",
    bd: active ? "var(--emLine)" : "transparent",
    ic: active ? "var(--em)" : "var(--ink3)",
});

const at = (path, extraFlags = []) => ({
    navigate: () => {
        history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
    },
    isActive: () => typeof location !== "undefined" && location.pathname === path,
    suppressFlags: ["is404", "isHome", ...extraFlags],
    navKey: "navMain",
    navItem,
    palette: PALETTE,
});

/**
 * This design's route table lists `['/', 'home']` first and treats any pattern
 * ending in "/" as a prefix — so `/tools`, `/blog`, everything, matches `home`
 * before its own entry is reached. Its prototype never noticed: navigation was
 * in-app clicks that set state directly, never a URL.
 *
 * Exact matches are tried before prefixes, which is what the table clearly
 * intends and what makes its URLs work when typed or shared.
 */
function withFixedRouting(Base) {
    return class WithFixedRouting extends Base {
        parsePath(raw) {
            let path = String(raw || "/").split("?")[0];
            if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
            if (!path) path = "/";

            const table = this.routeTable();
            for (const [pattern, route] of table) {
                if (!pattern.endsWith("/") && path === pattern) return { route, param: null };
            }
            for (const [pattern, route] of table) {
                if (pattern.endsWith("/") && pattern !== "/" &&
                    path.indexOf(pattern) === 0 && path.length > pattern.length) {
                    return { route, param: path.slice(pattern.length) };
                }
            }
            return { route: "404", param: path };
        }
    };
}

export default withVault(
    withAccounts(withRealCatalogue(withFixedRouting(Base)), at("/account")),
    at("/my-stuff/vault", ["isVault", "isStuff"]),
);

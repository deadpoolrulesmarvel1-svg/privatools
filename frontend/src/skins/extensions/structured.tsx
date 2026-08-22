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

export default withVault(
    withAccounts(Base, at("/account")),
    at("/my-stuff/vault", ["isVault", "isStuff"]),
);

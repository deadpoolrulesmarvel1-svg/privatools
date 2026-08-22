/* eslint-disable */
// @ts-nocheck
/**
 * Structured Privacy OS — extension.
 *
 * Structured routes on `location.pathname` rather than the hash, so navigation
 * goes through history.pushState and the mixin's popstate listener brings the
 * component back round.
 */
import Base from "../structured/SkinApp";
import { withAccounts } from "../withAccounts";

const ROUTE = "/account";

export default withAccounts(Base, {
    navigate: () => {
        history.pushState({}, "", ROUTE);
        window.dispatchEvent(new PopStateEvent("popstate"));
    },
    isActive: () => typeof location !== "undefined" && location.pathname === ROUTE,
    // "/" is a prefix pattern in this design's route table, so an unknown
    // path lands on `home` rather than 404.
    suppressFlags: ["is404", "isHome"],
    navKey: "navMain",
    navItem: ({ label, icon, onClick, active }) => ({
        label, icon, go: onClick,
        cur: active ? "page" : undefined,
        fw: active ? "600" : "400",
        fg: active ? "var(--ink)" : "var(--ink2)",
        bg: active ? "var(--emSoft)" : "transparent",
        bd: active ? "var(--emLine)" : "transparent",
        ic: active ? "var(--em)" : "var(--ink3)",
    }),
    palette: {
        accent: "var(--em)", accentSoft: "var(--emSoft)", line: "var(--line)",
        text: "var(--ink)", dim: "var(--ink2)", faint: "var(--ink3)",
    },
});

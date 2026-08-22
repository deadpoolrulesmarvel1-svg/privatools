/* eslint-disable */
// @ts-nocheck
/**
 * Carbon Glass — extension.
 *
 * Carbon's rail is grouped rather than flat, so entries join an existing group;
 * appending would leave them floating below the last section with no heading.
 *
 * Its own vault is a simulation over plain localStorage and says so on its face.
 * The real one replaces it at the same route — `isVault` is suppressed so the
 * simulated surface does not render underneath.
 */
import Base from "../carbon/SkinApp";
import { withAccounts } from "../withAccounts";
import { withVault } from "../withVault";
import { withRealCatalogue } from "../withRealCatalogue";
import { withRealTools } from "../withRealTools";
import { mergeNavItem } from "../navInject";

const PALETTE = {
    accent: "var(--pt-aqua,#4FE1DE)", accentSoft: "var(--pt-aquaBg,rgba(79,225,222,.12))",
    line: "var(--pt-line,rgba(255,255,255,.085))",
    text: "var(--pt-txt,#E8F1F2)", dim: "var(--pt-txt2,#9FB3B8)", faint: "var(--pt-txt3,#6B8085)",
};

const navItem = ({ label, icon, onClick, active }) => ({
    name: label, icon, go: onClick,
    cur: active ? "page" : undefined,
    fw: active ? "700" : "500",
    col: active ? "var(--pt-txt,#E8F1F2)" : "var(--pt-txt2,#9FB3B8)",
    bg: active ? "var(--pt-aquaBg,rgba(79,225,222,.12))" : "transparent",
    bd: active ? "var(--pt-edge,rgba(79,225,222,.32))" : "transparent",
    just: "flex-start",
    ic: active ? "var(--pt-aqua,#4FE1DE)" : "var(--pt-txt3,#6B8085)",
});

/** Carbon labels a group with `label`, and the rail reads show/rule flags. */
const injectNav = (v, item) => {
    const groups = (v.navGroups ?? []).map((g) => ({ ...g }));
    const space = groups.find((g) => /your space/i.test(g.label ?? ""));
    if (space) {
        space.items = mergeNavItem(space.items ?? [], item);
        return { navGroups: groups };
    }
    return { navGroups: [...groups, { label: "Account", show: true, rule: false, items: [item] }] };
};

const at = (hash, suppressFlags) => ({
    navigate: () => { location.hash = hash; },
    isActive: () => typeof location !== "undefined" && location.hash === hash,
    injectNav, navItem, palette: PALETTE,
    ...(suppressFlags ? { suppressFlags } : {}),
});

const REAL_TOOLS = {
    // Carbon keeps the active slug in `state.tool` and routes at #/tool/<slug>.
    slugOf: (state) => (state.route === "tool" ? state.tool : ""),
    suppressFlags: ["isTool"],
    icon: "build",
    go: (route) => { location.hash = "#/" + route; },
    goTool: (slug) => { location.hash = "#/tool/" + slug; },
    chips: (tool) => [
        { label: tool.clientOnly ? "Runs in your browser" : "Server required",
          icon: tool.clientOnly ? "devices" : "cloud",
          fg: tool.clientOnly ? "var(--pt-aqua,#4FE1DE)" : "var(--pt-amber,#F0B45E)",
          bg: tool.clientOnly ? "var(--pt-aquaBg,rgba(79,225,222,.12))" : "var(--pt-amberBg,rgba(240,180,94,.13))" },
        { label: "500 MB per file", icon: "straighten", fg: "var(--pt-txt2,#9FB3B8)", bg: "transparent" },
        { label: "No retention", icon: "delete_forever", fg: "var(--pt-txt2,#9FB3B8)", bg: "transparent" },
        { label: "Free, no account", icon: "toll", fg: "var(--pt-txt2,#9FB3B8)", bg: "transparent" },
    ],
};

export default withRealTools(withVault(
    withAccounts(withRealCatalogue(Base), at("#/account")),
    at("#/vault", ["is404", "isVault"]),
), REAL_TOOLS);

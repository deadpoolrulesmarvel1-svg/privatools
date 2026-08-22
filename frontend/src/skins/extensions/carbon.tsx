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
        space.items = [...(space.items ?? []), item];
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

export default withVault(
    withAccounts(withRealCatalogue(Base), at("#/account")),
    at("#/vault", ["is404", "isVault"]),
);

/* eslint-disable */
// @ts-nocheck
/**
 * Carbon Glass — extension.
 *
 * Carbon's rail is grouped rather than flat, so the account entry joins an
 * existing group instead of being appended to a list — appending would leave it
 * floating below the last section with no heading.
 */
import Base from "../carbon/SkinApp";
import { withAccounts } from "../withAccounts";

const ROUTE = "#/account";

export default withAccounts(Base, {
    navigate: () => { location.hash = ROUTE; },
    isActive: () => typeof location !== "undefined" && location.hash === ROUTE,
    navItem: ({ label, icon, onClick, active }) => ({
        name: label, icon, go: onClick,
        cur: active ? "page" : undefined,
        fw: active ? "700" : "500",
        col: active ? "var(--pt-txt,#E8F1F2)" : "var(--pt-txt2,#9FB3B8)",
        bg: active ? "var(--pt-aquaBg,rgba(79,225,222,.12))" : "transparent",
        bd: active ? "var(--pt-edge,rgba(79,225,222,.32))" : "transparent",
        just: "flex-start",
        ic: active ? "var(--pt-aqua,#4FE1DE)" : "var(--pt-txt3,#6B8085)",
    }),
    injectNav: (v, item) => {
        const groups = (v.navGroups ?? []).map((g) => ({ ...g }));
        // Carbon labels a group with `label`, not `title`, and each group also
        // carries `show`/`rule` flags the rail reads — so a hand-made group has
        // to set them or it renders without its heading.
        const space = groups.find((g) => /your space/i.test(g.label ?? ""));
        if (space) {
            space.items = [...(space.items ?? []), item];
            return { navGroups: groups };
        }
        return { navGroups: [...groups, { label: "Account", show: true, rule: false, items: [item] }] };
    },
    palette: {
        accent: "var(--pt-aqua,#4FE1DE)", accentSoft: "var(--pt-aquaBg,rgba(79,225,222,.12))",
        line: "var(--pt-line,rgba(255,255,255,.085))",
        text: "var(--pt-txt,#E8F1F2)", dim: "var(--pt-txt2,#9FB3B8)", faint: "var(--pt-txt3,#6B8085)",
    },
});

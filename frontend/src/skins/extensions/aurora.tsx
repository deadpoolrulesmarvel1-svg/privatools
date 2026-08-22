/* eslint-disable */
// @ts-nocheck
/**
 * Obsidian Aurora — extension.
 *
 * Everything about the accounts flow lives in withAccounts(); this supplies only
 * what is genuinely Aurora's: where its nav items go, the shape they take, and
 * the variables it paints with. The markup is the sibling `aurora.html`, spliced
 * into the generated component at build time.
 */
import Base from "../aurora/SkinApp";
import { withAccounts } from "../withAccounts";

const ROUTE = "#/account";

export default withAccounts(Base, {
    navigate: () => { location.hash = ROUTE; },
    isActive: () => typeof location !== "undefined" && location.hash === ROUTE,
    navKey: "navSys",
    navItem: ({ label, icon, onClick, active }) => ({
        label, icon, onClick,
        bg: active ? "var(--emsoft)" : "transparent",
        fg: active ? "var(--text)" : "var(--text2)",
        bd: active ? "var(--line2)" : "transparent",
        badgeD: "none", badge: "",
    }),
    palette: {
        accent: "var(--em)", accentSoft: "var(--emsoft)", line: "var(--line)",
        text: "var(--text)", dim: "var(--text2)", faint: "var(--text3)",
    },
});

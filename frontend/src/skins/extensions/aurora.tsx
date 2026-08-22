/* eslint-disable */
// @ts-nocheck
/**
 * Obsidian Aurora — extension.
 *
 * The flows live in the mixins; this supplies only what is Aurora's own — where
 * nav items go, the shape they take, and the variables to paint with. The
 * markup is the sibling `aurora.html`, spliced into the generated component at
 * build time.
 */
import Base from "../aurora/SkinApp";
import { withAccounts } from "../withAccounts";
import { withVault } from "../withVault";
import { withRealCatalogue } from "../withRealCatalogue";
import { AURORA_CATALOGUE, CATALOGUE_COUNTS } from "../catalogue";

const PALETTE = {
    accent: "var(--em)", accentSoft: "var(--emsoft)", line: "var(--line)",
    text: "var(--text)", dim: "var(--text2)", faint: "var(--text3)",
};

const navItem = ({ label, icon, onClick, active }) => ({
    label, icon, onClick,
    bg: active ? "var(--emsoft)" : "transparent",
    fg: active ? "var(--text)" : "var(--text2)",
    bd: active ? "var(--line2)" : "transparent",
    badgeD: "none", badge: "",
});

const at = (hash) => ({
    navigate: () => { location.hash = hash; },
    isActive: () => typeof location !== "undefined" && location.hash === hash,
    navKey: "navSys",
    navItem,
    palette: PALETTE,
});

export default withVault(
    withAccounts(
        withRealCatalogue(Base, {
            records: AURORA_CATALOGUE,
            meta: {
                label: "PrivaTools registry",
                registryLoaded: true,
                verifiedTotal: CATALOGUE_COUNTS.total,
                verifiedPdf: CATALOGUE_COUNTS.pdf,
                verifiedNonPdf: CATALOGUE_COUNTS.nonPdf,
            },
        }),
        at("#/account"),
    ),
    at("#/vault"),
);

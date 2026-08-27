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
import type React from "react";
import Base from "../aurora/SkinApp";
import { withAccounts } from "../withAccounts";
import { withVault } from "../withVault";
import { withRealCatalogue } from "../withRealCatalogue";
import { withRealTools } from "../withRealTools";
import { withPathRoutes } from "../withPathRoutes";
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

const REAL_TOOLS = {
    // Aurora routes tools at #/tool/<slug>; its own `isTool` block is the
    // simulated one and stands down.
    slugOf: (state) => (state.route === "tool" ? state.param : ""),
    suppressFlags: ["isTool"],
    icon: "build",
    go: (route) => { location.hash = "#/" + route; },
    goTool: (slug) => { location.hash = "#/tool/" + slug; },
    chips: (tool) => [
        { label: tool.clientOnly ? "Runs in your browser" : "Server required",
          icon: tool.clientOnly ? "devices" : "cloud",
          fg: tool.clientOnly ? "var(--em)" : "var(--am)",
          bg: tool.clientOnly ? "var(--emsoft)" : "var(--amsoft)" },
        { label: "500 MB per file", icon: "straighten", fg: "var(--text2)", bg: "transparent" },
        { label: "No retention", icon: "delete_forever", fg: "var(--text2)", bg: "transparent" },
        { label: "Free, no account", icon: "payments", fg: "var(--text2)", bg: "transparent" },
    ],
};

/**
 * The mixin chain is written in plain JS under `@ts-nocheck`, so `Base` is
 * untyped and the class it returns comes out as a bare object type rather than
 * a React component. Naming the type here is what the consumer needs — the
 * value really is a component; only the annotation was lost on the way out.
 */
const Skin: React.ComponentType = withRealTools(withVault(
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
), REAL_TOOLS);

/*
 * Outermost on purpose: it must see the fully-composed component, and its only
 * job is to translate an incoming path URL into the hash this design routes on.
 * Without it every /tool/<slug> URL renders the homepage — see withPathRoutes.
 */
export default withPathRoutes(Skin);

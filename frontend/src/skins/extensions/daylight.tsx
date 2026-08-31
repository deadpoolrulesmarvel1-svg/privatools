/* eslint-disable */
// @ts-nocheck
/**
 * Daylight — extension.
 *
 * Daylight's base is hand-written (src/skins/daylight/SkinApp.tsx), not
 * generated, so unlike the other three there is no markup to splice — the base
 * already renders every surface. What the mixins add here is the *behavior*
 * behind three of them:
 *
 *   withAccounts   `this.state.acct` + the whole account flow (recovery codes,
 *                  the Clerk email-code branch, keys, rotation)
 *   withVault      `this.state.vlt` + the real AES-GCM vault
 *   withRealTools  `renderVals().realToolUI` — the same 112 real tool
 *                  components the house design mounts
 *   withPathRoutes path → hash bridging, outermost, same as Aurora/Carbon
 *
 * The base's markup consumes that state directly; nothing is duplicated.
 */
import type React from "react";
import Base from "../daylight/SkinApp";
import { withAccounts } from "../withAccounts";
import { withVault } from "../withVault";
import { withRealTools } from "../withRealTools";
import { withPathRoutes } from "../withPathRoutes";

const noopNav = () => ({
    // Daylight's nav is its own markup; the mixins' nav injection lands in the
    // base's `dlNav` absorber, which nothing renders.
    navigate: () => {},
    isActive: () => false,
    navKey: "dlNav",
    navItem: (x) => x,
    palette: {},
});

const REAL_TOOLS = {
    slugOf: (state) => (state.view === "tool" ? state.slug : ""),
    suppressFlags: [],
    icon: "build",
    go: (route) => { location.hash = "#/" + route; },
    goTool: (slug) => { location.hash = "#/tool/" + slug; },
    // The base draws its own chips from the registry's clientOnly flag; the
    // mixin's chip bindings are simply unused.
    chips: () => [],
};

const Skin: React.ComponentType = withRealTools(
    withVault(
        withAccounts(Base, { ...noopNav(), route: "#/account" }),
        { ...noopNav(), route: "#/my-stuff/vault" },
    ),
    REAL_TOOLS,
);

export default withPathRoutes(Skin);

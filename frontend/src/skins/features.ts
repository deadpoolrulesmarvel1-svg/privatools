/**
 * The feature manifest.
 *
 * Everything the site must offer, in one list. `skin-parity.test.ts` fails
 * the build if the active design misses an entry without recording it as
 * PENDING — the guard that kept four parallel skins honest, kept because it
 * is just as good at catching a surface lost in a redesign.
 *
 * Adding a feature to the product means adding it here once. `surface` says
 * where it already lives:
 *
 *   "native"    the design's own markup already has this route
 *   "extension" behavior supplied by the mixins (src/skins/extensions/)
 *
 */

export interface Feature {
    id: string;
    /** Shown in navigation. */
    label: string;
    /** Route path, relative to the site root. */
    path: string;
    /** Why it must exist in every theme. Read by the parity test's failure message. */
    why: string;
}

/** Surfaces every theme must expose. */
export const FEATURES: Feature[] = [
    // ── the product itself ────────────────────────────────────────────────
    { id: "home", label: "Home", path: "/", why: "entry point" },
    { id: "tools", label: "All tools", path: "/tools", why: "the 219-tool catalogue" },
    { id: "tool", label: "Tool page", path: "/tool/:slug", why: "where nearly all traffic lands" },
    { id: "pipeline", label: "Pipeline", path: "/pipeline", why: "chain tools in sequence" },
    { id: "batch", label: "Batch", path: "/batch", why: "one tool over many files" },

    // ── the user's own space ──────────────────────────────────────────────
    { id: "my-stuff", label: "My Stuff", path: "/my-stuff", why: "local activity, defaults, assets" },
    { id: "vault", label: "Vault", path: "/my-stuff/vault", why: "real AES-GCM password vault (localStore/crypto)" },

    // BYOK, translate and saved signatures were listed here as missing
    // surfaces. They are not: each lives inside a tool — ByokPanel inside the
    // AI tools, translate as the `translate-pdf` tool, signatures inside
    // ESignUI — and every theme reaches all of them through the catalogue. The
    // "tool" entry above already covers them, so requiring separate routes
    // would have meant building three redundant pages per theme.
    //
    // A standalone place to manage saved AI keys across tools would be a real
    // addition, but it does not exist in ANY theme today, including the house
    // design. That is a product gap, not a parity gap, and belongs in the
    // roadmap rather than here.

    // ── accounts and the developer API ────────────────────────────────────
    { id: "account", label: "Account", path: "/account", why: "sign in / sign up" },
    { id: "api-keys", label: "API keys", path: "/account/keys", why: "issue and revoke developer keys" },

    // ── trust and information ─────────────────────────────────────────────
    { id: "compare", label: "Compare", path: "/compare", why: "competitor comparisons" },
    { id: "blog", label: "Blog", path: "/blog", why: "articles" },
    { id: "about", label: "About", path: "/about", why: "what this is" },
    { id: "privacy", label: "Privacy", path: "/privacy", why: "policy — legally required" },
    { id: "security", label: "Security", path: "/security", why: "security policy" },
    { id: "terms", label: "Terms", path: "/terms", why: "terms of service" },
    { id: "status", label: "Status", path: "/status", why: "service health" },
    { id: "support", label: "Support", path: "/support", why: "how to get help" },
];

export const FEATURE_IDS = FEATURES.map((f) => f.id);

/**
 * What each skin already provides natively, from its own imported design.
 * Anything not listed has to come from that skin's extension file.
 *
 * Kept explicit rather than derived: a parser that guessed from the routing
 * table would fail quietly in exactly the case the parity test exists to
 * catch.
 */
export const NATIVE_SURFACES: Record<string, string[]> = {
    daylight: [
        // Hand-written, so every surface is native except the three whose
        // behavior comes from the mixins in its extension file.
        "home", "tools", "tool", "pipeline", "batch", "my-stuff",
        "compare", "blog", "about", "privacy", "security", "terms",
        "status", "support",
    ],
};

/** Features a given skin has to supply through its extension file. */
export function missingFrom(skin: string): Feature[] {
    const native = new Set(NATIVE_SURFACES[skin] ?? []);
    return FEATURES.filter((f) => !native.has(f.id));
}

/**
 * Features a skin supplies through its extension file (src/skins/extensions/).
 * Filled in as each is built; `PENDING` below is what is still outstanding.
 */
export const EXTENSION_SURFACES: Record<string, string[]> = {
    daylight: ["account", "api-keys", "vault"],
};

/**
 * Known gaps, deliberately visible.
 *
 * The requirement is that no theme offers less than another, and the parity
 * test enforces it — but the work lands incrementally, so this records what is
 * still missing rather than letting a silent hole open. Every entry here is a
 * promise not yet kept; the list must only ever shrink, and the test fails if
 * something goes missing that is NOT listed here.
 */
export const PENDING: Record<string, string[]> = {
    daylight: [],
};

/** Everything a skin can reach today. */
export function coveredBy(skin: string): Set<string> {
    return new Set([...(NATIVE_SURFACES[skin] ?? []), ...(EXTENSION_SURFACES[skin] ?? [])]);
}

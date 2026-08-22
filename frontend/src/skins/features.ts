/**
 * The feature manifest.
 *
 * One list, four consumers. Every skin must reach every entry here — the
 * standing requirement is that no theme offers less than another — and
 * `skin-parity.test.ts` fails the build if one doesn't.
 *
 * Adding a feature to the product means adding it here once, not four times.
 * `surface` says where it already lives:
 *
 *   "native"    the theme's own imported design already has this route
 *   "extension" added by us through the generator seam (src/skins/extensions/)
 *
 * Native surfaces still have to be *wired* to real data — the ported designs
 * ship their own sample catalogues — but they exist and are reachable.
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

    // ── built features the imported designs had no surface for ────────────
    { id: "byok", label: "AI keys", path: "/ai-keys", why: "bring-your-own-key AI, already built in lib/byok" },
    { id: "translate", label: "Translate", path: "/translate", why: "on-device translation, already built" },
    { id: "signatures", label: "Signatures", path: "/signatures", why: "saved signatures, already built" },

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
 * Kept explicit rather than derived: the three ported apps each express routing
 * differently (Aurora and Carbon by hash, Structured by path), and a parser
 * that guessed would fail quietly in exactly the case the parity test exists
 * to catch.
 */
export const NATIVE_SURFACES: Record<string, string[]> = {
    signature: [
        "home", "tools", "tool", "pipeline", "batch", "my-stuff",
        "compare", "blog", "about", "privacy", "security", "terms",
    ],
    aurora: [
        "home", "tools", "tool", "pipeline", "batch", "my-stuff",
        "compare", "blog", "privacy", "support", "status",
    ],
    carbon: [
        "home", "tools", "tool", "pipeline", "batch", "my-stuff", "vault",
        "compare", "blog", "about", "privacy", "security", "terms",
        "status", "support",
    ],
    structured: [
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
    signature: [],
    aurora: ["account", "api-keys"],
    carbon: [],
    structured: [],
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
    signature: ["vault", "byok", "translate", "signatures", "account", "api-keys", "status", "support"],
    aurora: ["vault", "byok", "translate", "signatures", "about", "security", "terms"],
    carbon: ["byok", "translate", "signatures", "account", "api-keys"],
    structured: ["vault", "byok", "translate", "signatures", "account", "api-keys"],
};

/** Everything a skin can reach today. */
export function coveredBy(skin: string): Set<string> {
    return new Set([...(NATIVE_SURFACES[skin] ?? []), ...(EXTENSION_SURFACES[skin] ?? [])]);
}

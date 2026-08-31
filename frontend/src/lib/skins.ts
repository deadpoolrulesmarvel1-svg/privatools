/**
 * Skin registry.
 *
 * A "skin" is a complete visual theme: palette (light + dark), type pairing,
 * radius, and a layout shell. It is orthogonal to light/dark mode — the two
 * are independent axes, applied as `data-skin` and `.dark` on <html>.
 *
 * Palettes live in scripts/skin-palettes.mjs and compile to
 * src/styles/skins.css. This file carries only what the UI needs at runtime.
 *
 * `signature` is the house design and owns the bare `:root` block, so it needs
 * no `data-skin` attribute and stays the fallback if a stored value goes bad.
 */

export const SKIN_IDS = ["signature", "daylight", "aurora", "carbon", "structured"] as const;
export type SkinId = (typeof SKIN_IDS)[number];

export interface SkinMeta {
    id: SkinId;
    /** Shown in the switcher. */
    name: string;
    /** One line, sentence case — what this theme is like to use. */
    blurb: string;
    /** Two swatches for the switcher chip: [primary, accent] as CSS colours. */
    swatch: [string, string];
    /**
     * Whether this skin uses the app's own shell, or is a complete ported
     * design that owns the whole screen (src/skins/<id>/SkinApp.tsx).
     */
    surface: "app" | "ported";
}

export const SKINS: Record<SkinId, SkinMeta> = {
    signature: {
        id: "signature",
        name: "Signature",
        blurb: "The house design — teal and amber on white, two-tier navigation.",
        swatch: ["#00A896", "#FFA800"],
        surface: "app",
    },
    daylight: {
        id: "daylight",
        name: "Daylight",
        blurb: "Emerald on clean paper — the drop-anywhere hero, colored tool families.",
        swatch: ["#0E8A5F", "#C4574E"],
        surface: "ported",
    },
    aurora: {
        id: "aurora",
        name: "Obsidian Aurora",
        blurb: "Deep obsidian with an emerald aurora. Labelled rail, large display type.",
        swatch: ["#22D899", "#F2B138"],
        surface: "ported",
    },
    carbon: {
        id: "carbon",
        name: "Carbon Glass",
        blurb: "Frosted glass panels over carbon, aqua edge-lighting, sectioned rail.",
        swatch: ["#4FE1DE", "#F0B45E"],
        surface: "ported",
    },
    structured: {
        id: "structured",
        name: "Structured Privacy OS",
        blurb: "Dense, flat and utilitarian. Category rail, tabular rows, no ornament.",
        swatch: ["#20D497", "#F2B44C"],
        surface: "ported",
    },
};

export const SKIN_LIST: SkinMeta[] = SKIN_IDS.map((id) => SKINS[id]);

export const DEFAULT_SKIN: SkinId = "signature";
export const SKIN_STORAGE_KEY = "privatools_skin";

export function isSkinId(v: unknown): v is SkinId {
    return typeof v === "string" && (SKIN_IDS as readonly string[]).includes(v);
}

/**
 * Apply a skin to the document. Kept as a bare function (no React) so the
 * pre-hydration script in index.html can use the same rule: `signature` owns
 * `:root`, so it clears the attribute rather than setting one.
 */
export function applySkin(skin: SkinId) {
    const root = document.documentElement;
    if (skin === DEFAULT_SKIN) root.removeAttribute("data-skin");
    else root.setAttribute("data-skin", skin);
}

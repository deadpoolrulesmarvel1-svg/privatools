/**
 * Skin registry — one entry.
 *
 * PrivaTools shipped four selectable designs while Daylight was being built
 * alongside them; once it was approved as *the* design, the rest were removed
 * rather than left as a switcher nobody needed. The registry survives them so
 * the palette pipeline (scripts/skin-palettes.mjs → src/styles/skins.css) and
 * the theme machinery keep a single source of truth for what a "skin" defines:
 * palette (light + dark), type pairing, radius, and the shell that owns the
 * screen.
 *
 * The default skin owns the bare `:root` block in skins.css and therefore
 * carries no `data-skin` attribute. Light/dark is the independent axis,
 * applied as `data-theme` on <html>.
 */

export const SKIN_IDS = ["daylight"] as const;
export type SkinId = (typeof SKIN_IDS)[number];

export interface SkinMeta {
    id: SkinId;
    name: string;
    /** One line, sentence case — what this theme is like to use. */
    blurb: string;
    /** Two swatches: [primary, accent] as CSS colours. */
    swatch: [string, string];
    /**
     * Whether this skin uses the app's own shell, or is a complete design that
     * owns the whole screen (src/skins/<id>/SkinApp.tsx).
     */
    surface: "app" | "ported";
}

export const SKINS: Record<SkinId, SkinMeta> = {
    daylight: {
        id: "daylight",
        name: "Daylight",
        blurb: "Emerald on clean paper — the drop-anywhere hero, colored tool families.",
        swatch: ["#0E8A5F", "#C4574E"],
        surface: "ported",
    },
};

export const SKIN_LIST: SkinMeta[] = SKIN_IDS.map((id) => SKINS[id]);

export const DEFAULT_SKIN: SkinId = "daylight";
export const SKIN_STORAGE_KEY = "privatools_skin";

export function isSkinId(v: unknown): v is SkinId {
    return typeof v === "string" && (SKIN_IDS as readonly string[]).includes(v);
}

/**
 * Apply a skin to the document. The default skin owns `:root`, so it clears
 * the attribute rather than setting one. Kept as a bare function (no React)
 * so it matches the rule index.html's pre-paint script follows.
 */
export function applySkin(skin: SkinId) {
    const root = document.documentElement;
    if (skin === DEFAULT_SKIN) root.removeAttribute("data-skin");
    else root.setAttribute("data-skin", skin);
}

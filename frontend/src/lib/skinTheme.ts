/**
 * Light/dark preference for Daylight.
 *
 * Two copies of the resolution rule exist on purpose: index.html has to
 * resolve the same thing before first paint (an inline pre-paint script cannot
 * import), or a visitor who chose light watches the dark palette flash on
 * every load. `skinTheme.test.ts` holds the two together.
 *
 * Daylight paints from `data-theme` on <html>: its component CSS keys dark
 * styles on `[data-theme="dark"]` with a `prefers-color-scheme` fallback for
 * the moment before anything has set the attribute, and the generated token
 * palette in skins.css follows the same axis.
 */

import type { SkinId } from "./skins";

export type ThemeChoice = "system" | "light" | "dark";

/** Where the preference is kept. */
const KEYS: Record<SkinId, { key: string }> = {
    daylight: { key: "privatools.daylight.theme" },
};

function systemPrefers(): "light" | "dark" {
    return typeof window !== "undefined"
        && window.matchMedia?.("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
}

export function readThemeChoice(skin: SkinId): ThemeChoice {
    try {
        const spec = KEYS[skin];
        if (!spec) return "system";
        const v = localStorage.getItem(spec.key);
        return v === "light" || v === "dark" || v === "system" ? v : "system";
    } catch {
        return "system";
    }
}

/** Resolve `system` against the OS; the DOM only understands light or dark. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
    return choice === "system" ? systemPrefers() : choice;
}

/**
 * Persist the choice and paint it.
 *
 * Both halves matter for different reasons: the write is what survives a
 * reload (and what index.html reads before first paint), the attribute is
 * what makes the click do something now.
 */
export function setThemeChoice(skin: SkinId, choice: ThemeChoice): void {
    try {
        const spec = KEYS[skin];
        if (spec) localStorage.setItem(spec.key, choice);
    } catch {
        /* private mode: the paint below still works for this session */
    }
    document.documentElement.setAttribute("data-theme", resolveTheme(choice));
}

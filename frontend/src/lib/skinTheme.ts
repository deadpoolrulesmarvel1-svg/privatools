/**
 * Light/dark preference, across four designs that each store it differently.
 *
 * The three imported designs arrived with their own persistence — Aurora under
 * `pt-theme`, Carbon under `pt.theme`, Structured inside its own JSON blob —
 * and changing that would mean editing generated files that get regenerated.
 * So the keys stay theirs and this knows the mapping.
 *
 * It is the second copy of that mapping: index.html has to resolve the same
 * thing before first paint, or a visitor who chose light watches the dark
 * palette flash on every load, and an inline pre-paint script cannot import.
 * `skinTheme.test.ts` holds the two together.
 *
 * Two of the designs — Carbon and Structured — shipped with no theme control
 * at all. They support light mode perfectly well; there was simply no way for
 * anyone to reach it.
 */

import type { SkinId } from "./skins";

export type ThemeChoice = "system" | "light" | "dark";

/** Where each design keeps the preference. */
const KEYS: Record<SkinId, { kind: "plain" | "json"; key: string }> = {
    signature: { kind: "plain", key: "privatools_theme" },
    aurora: { kind: "plain", key: "pt-theme" },
    carbon: { kind: "plain", key: "pt.theme" },
    structured: { kind: "json", key: "privatools.local.v1" },
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
        if (spec.kind === "plain") {
            const v = localStorage.getItem(spec.key);
            return v === "light" || v === "dark" || v === "system" ? v : "system";
        }
        const raw = localStorage.getItem(spec.key);
        const v = raw ? (JSON.parse(raw) || {}).theme : null;
        return v === "light" || v === "dark" || v === "system" ? v : "system";
    } catch {
        return "system";
    }
}

/** Resolve `system` against the OS; the designs only understand light or dark. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
    return choice === "system" ? systemPrefers() : choice;
}

/**
 * Persist the choice and paint it.
 *
 * Both halves matter and for different reasons: the write is what survives a
 * reload (and what index.html reads before first paint), the paint is what
 * makes the click do something now. The designs apply `data-theme` themselves
 * in componentDidMount, which is far too late to be the only mechanism.
 */
export function setThemeChoice(skin: SkinId, choice: ThemeChoice): void {
    const resolved = resolveTheme(choice);

    try {
        const spec = KEYS[skin];
        if (spec?.kind === "plain") {
            localStorage.setItem(spec.key, choice);
        } else if (spec) {
            const raw = localStorage.getItem(spec.key);
            const blob = raw ? JSON.parse(raw) || {} : {};
            blob.theme = choice;
            localStorage.setItem(spec.key, JSON.stringify(blob));
        }
    } catch {
        /* private mode: the paint below still works for this session */
    }

    const root = document.documentElement;
    if (skin === "signature") {
        // The house design runs on a class, not the attribute.
        root.classList.toggle("dark", resolved === "dark");
        root.classList.toggle("light", resolved === "light");
    } else {
        root.setAttribute("data-theme", resolved);
    }
}

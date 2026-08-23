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
 * Drive the design's own theme control, if it has one in the DOM.
 *
 * Setting `data-theme` and the storage key is enough to survive a reload — the
 * pre-paint script in index.html reads them — but not enough to repaint now.
 * Aurora's palette is token-driven and follows the attribute immediately;
 * Carbon and Structured hold the theme in their own component state and paint
 * from that, so the attribute alone changes nothing on screen and the click
 * looks like it did nothing.
 *
 * Their own controls are still in the DOM at every width — they are hidden
 * inside a collapsed sidebar, not unmounted — so driving them keeps the
 * design's state and ours in agreement, which is the part that reloading
 * cannot do without throwing away whatever the user was in the middle of.
 *
 * Returns whether it found one; the caller has already written the preference
 * either way.
 */
function driveNativeControl(choice: ThemeChoice): boolean {
    const wanted = { system: ["system", "auto"], light: ["light"], dark: ["dark"] }[choice];

    // Carbon exposes a <select>.
    for (const select of Array.from(document.querySelectorAll("select"))) {
        const options = Array.from(select.options).map((o) => o.value.toLowerCase());
        if (!wanted.some((w) => options.includes(w))) continue;
        // Only a theme select — one carrying every theme value, not merely one.
        if (!["light", "dark"].every((v) => options.includes(v))) continue;
        const value = wanted.find((w) => options.includes(w));
        if (!value || select.value === value) return true;
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }

    // Aurora ("Light theme") and Structured ("Light") use buttons.
    const labelFor = (el: Element) =>
        (el.getAttribute("aria-label") || el.textContent || "").trim().toLowerCase();
    for (const button of Array.from(document.querySelectorAll("button"))) {
        const label = labelFor(button);
        const isThemeButton = wanted.some(
            (w) => label === w || label === `${w} theme` || label === `use ${w} theme`,
        );
        if (!isThemeButton) continue;
        // Never the dock's own row — that is what called this.
        if (button.closest('[role="group"][aria-label="Light or dark"]')) continue;
        (button as HTMLButtonElement).click();
        return true;
    }

    return false;
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
        return;
    }

    root.setAttribute("data-theme", resolved);
    // Aurora repaints from the attribute; Carbon and Structured do not, so ask
    // their own controls. Without this the preference is stored, the page does
    // not change, and the only way to see it is a reload nobody knows to do.
    driveNativeControl(choice);
}

import { useState, useEffect, useCallback } from "react";

export type Theme = "dark" | "light";

/**
 * Three dark grounds, live-switchable, so the choice can be made by looking
 * rather than from a screenshot. They differ only in the ground and its
 * elevation steps — the colour system on top is identical, which is the whole
 * point of the comparison.
 */
export type DarkVariant = "midnight" | "carbon" | "ink";

export const DARK_VARIANTS: { id: DarkVariant; label: string; hint: string }[] = [
    { id: "midnight", label: "Midnight", hint: "True black — highest contrast, colours punch hardest" },
    { id: "carbon", label: "Carbon", hint: "Neutral charcoal — no hue at all, pure elevation" },
    { id: "ink", label: "Ink", hint: "Deep navy — tinted, but nowhere near purple" },
];

const STORAGE_KEY = "privatools_theme";
const VARIANT_KEY = "privatools_dark_variant";

function getInitialTheme(): Theme {
    try {
        const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
        if (stored === "light" || stored === "dark") return stored;
    } catch { /* private mode */ }
    return "light";
}

function getInitialVariant(): DarkVariant {
    try {
        const v = localStorage.getItem(VARIANT_KEY) as DarkVariant | null;
        if (v === "midnight" || v === "carbon" || v === "ink") return v;
    } catch { /* private mode */ }
    return "carbon";
}

function apply(theme: Theme, variant: DarkVariant) {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    // Always stamped, so switching variant while in light mode still takes
    // effect the moment dark is turned on.
    root.setAttribute("data-dark", variant);
}

export function useTheme() {
    const [theme, setThemeState] = useState<Theme>(getInitialTheme);
    const [darkVariant, setVariantState] = useState<DarkVariant>(getInitialVariant);

    useEffect(() => { apply(theme, darkVariant); }, [theme, darkVariant]);

    const setTheme = useCallback((t: Theme) => {
        setThemeState(t);
        try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
    }, []);

    const setDarkVariant = useCallback((v: DarkVariant) => {
        setVariantState(v);
        try { localStorage.setItem(VARIANT_KEY, v); } catch { /* private mode */ }
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme(theme === "dark" ? "light" : "dark");
    }, [theme, setTheme]);

    return { theme, setTheme, toggleTheme, darkVariant, setDarkVariant };
}

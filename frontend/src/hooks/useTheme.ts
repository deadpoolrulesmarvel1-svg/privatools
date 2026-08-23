import { useState, useEffect, useCallback } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "privatools_theme";

function getInitialTheme(): Theme {
    try {
        const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
        if (stored === "light" || stored === "dark") return stored;
    } catch { /* private mode */ }
    return "light";
}

function applyTheme(theme: Theme) {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
}

export function useTheme() {
    const [theme, setThemeState] = useState<Theme>(getInitialTheme);

    useEffect(() => { applyTheme(theme); }, [theme]);

    const setTheme = useCallback((t: Theme) => {
        setThemeState(t);
        try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme(theme === "dark" ? "light" : "dark");
    }, [theme, setTheme]);

    return { theme, setTheme, toggleTheme };
}

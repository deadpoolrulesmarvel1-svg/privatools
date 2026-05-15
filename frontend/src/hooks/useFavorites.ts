import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const STORAGE_KEY = "privatools_favorites";

function loadFavorites(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

export function useFavorites() {
    const [favorites, setFavorites] = useState<string[]>(loadFavorites);

    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) setFavorites(loadFavorites());
        };
        window.addEventListener("storage", handler);
        return () => window.removeEventListener("storage", handler);
    }, []);

    const toggle = useCallback((slug: string) => {
        setFavorites(prev => {
            const wasFav = prev.includes(slug);
            const next = wasFav ? prev.filter(s => s !== slug) : [...prev, slug];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            // Quiet feedback so users know the click registered
            try {
                if (wasFav) toast(`Removed from favorites`, { duration: 1500 });
                else        toast(`Added to favorites`,    { duration: 1500 });
            } catch { /* sonner may not be mounted in tests */ }
            return next;
        });
    }, []);

    const isFavorite = useCallback((slug: string) => favorites.includes(slug), [favorites]);

    return { favorites, toggle, isFavorite };
}

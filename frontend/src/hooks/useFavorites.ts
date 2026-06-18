import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const STORAGE_KEY = "privatools_favorites";
const FAVORITES_CHANGED_EVENT = "privatools:favorites-changed";
/** Hard cap on the number of favorites. Sidebar only ever displays the first
 *  8, but we allow a larger pool so users can curate without losing entries. */
export const MAX_FAVORITES = 20;

function loadFavorites(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        // De-dupe and trim — guards against legacy storage formats and the
        // (rare) case where two tabs raced and wrote dupes.
        return [...new Set(parsed.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, MAX_FAVORITES);
    } catch { return []; }
}

function saveFavorites(list: string[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_FAVORITES)));
        queueMicrotask(() => window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT)));
    } catch { /* quota full */ }
}

export function useFavorites() {
    const [favorites, setFavorites] = useState<string[]>(loadFavorites);

    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) setFavorites(loadFavorites());
        };
        const sameTabHandler = () => setFavorites(loadFavorites());
        window.addEventListener("storage", handler);
        window.addEventListener(FAVORITES_CHANGED_EVENT, sameTabHandler);
        return () => {
            window.removeEventListener("storage", handler);
            window.removeEventListener(FAVORITES_CHANGED_EVENT, sameTabHandler);
        };
    }, []);

    const toggle = useCallback((slug: string) => {
        setFavorites(prev => {
            const wasFav = prev.includes(slug);
            let next: string[];
            if (wasFav) {
                next = prev.filter(s => s !== slug);
            } else {
                if (prev.length >= MAX_FAVORITES) {
                    try { toast.warning(`You can pin up to ${MAX_FAVORITES} tools — unpin one first`, { duration: 2000 }); } catch { /* */ }
                    return prev;
                }
                next = [...prev, slug];
            }
            saveFavorites(next);
            try {
                if (wasFav) toast(`Removed from favorites`, { duration: 1500 });
                else        toast(`Added to favorites`,    { duration: 1500 });
            } catch { /* sonner may not be mounted in tests */ }
            return next;
        });
    }, []);

    const isFavorite = useCallback((slug: string) => favorites.includes(slug), [favorites]);

    /**
     * Move a favorite from one position to another. Used by drag-and-drop
     * reordering in the sidebar. Both indices are clamped to valid range;
     * out-of-range or no-op calls are silently ignored.
     */
    const reorder = useCallback((fromIndex: number, toIndex: number) => {
        setFavorites(prev => {
            if (fromIndex === toIndex) return prev;
            if (fromIndex < 0 || fromIndex >= prev.length) return prev;
            if (toIndex < 0 || toIndex >= prev.length) return prev;
            const next = prev.slice();
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            saveFavorites(next);
            return next;
        });
    }, []);

    /** Move a favorite to the top (== position 0). Convenience for keyboard. */
    const pinToTop = useCallback((slug: string) => {
        setFavorites(prev => {
            const idx = prev.indexOf(slug);
            if (idx <= 0) return prev;
            const next = [slug, ...prev.filter(s => s !== slug)];
            saveFavorites(next);
            return next;
        });
    }, []);

    return { favorites, toggle, isFavorite, reorder, pinToTop, count: favorites.length, max: MAX_FAVORITES };
}

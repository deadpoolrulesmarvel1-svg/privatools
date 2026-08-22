import { useCallback, useSyncExternalStore } from "react";
import { applySkin, DEFAULT_SKIN, isSkinId, SKIN_STORAGE_KEY, type SkinId } from "@/lib/skins";

/**
 * Shared skin state.
 *
 * Deliberately a module-level store rather than useState-per-hook: the shell,
 * the header switcher and the settings page all read the skin, and independent
 * useState copies would leave stale shells behind after a switch.
 * `useSyncExternalStore` gives every caller the same value with no provider.
 */

function read(): SkinId {
    try {
        const stored = localStorage.getItem(SKIN_STORAGE_KEY);
        if (isSkinId(stored)) return stored;
    } catch { /* private mode */ }
    return DEFAULT_SKIN;
}

let current: SkinId = typeof document === "undefined" ? DEFAULT_SKIN : read();
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function getSnapshot(): SkinId {
    return current;
}

export function setSkin(skin: SkinId) {
    if (skin === current) return;
    current = skin;
    try { localStorage.setItem(SKIN_STORAGE_KEY, skin); } catch { /* private mode */ }
    applySkin(skin);
    listeners.forEach((fn) => fn());
}

export function useSkin() {
    const skin = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SKIN);
    return { skin, setSkin: useCallback(setSkin, []) };
}

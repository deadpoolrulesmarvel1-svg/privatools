/**
 * Prefetch helpers — kick off the chunk fetch before the user clicks.
 *
 * Why a hook + a plain function:
 *   - `usePrefetch(loader)` returns event handlers (onMouseEnter / onFocus /
 *     onTouchStart) so links and buttons can opt in with one prop spread.
 *   - `prefetchRoute(loader)` is a fire-and-forget helper for non-event
 *     situations (e.g. warming up the top-3 tool chunks on the home page
 *     during requestIdleCallback).
 *
 * Both call the same dynamic import the route splitter uses, so the result
 * lands in Vite's chunk cache and the subsequent <Suspense> resolution is
 * a microtask instead of a network round-trip.
 *
 * We dedupe each `loader` with a WeakSet so re-hovers don't re-trigger
 * fetches that are already in flight or completed.
 */
import { useCallback, useRef } from "react";

const triggered = new WeakSet<() => Promise<unknown>>();

export function prefetchRoute(loader: () => Promise<unknown>): void {
    if (triggered.has(loader)) return;
    triggered.add(loader);
    // Catch + swallow — a prefetch failure should never throw out into the
    // app. The subsequent real navigation will surface any real error.
    loader().catch(() => {
        // Allow re-attempt on next hover by un-tracking on failure.
        triggered.delete(loader);
    });
}

/** Returns event handlers that prefetch on hover/focus/touch. */
export function usePrefetch<T>(loader: () => Promise<T>) {
    // Stable reference so callers don't re-render on every event firing.
    const loaderRef = useRef(loader);
    loaderRef.current = loader;

    const prefetch = useCallback(() => {
        prefetchRoute(loaderRef.current as () => Promise<unknown>);
    }, []);

    return {
        onMouseEnter: prefetch,
        onFocus: prefetch,
        onTouchStart: prefetch,
    } as const;
}

/* ──────────────────────── route loaders ────────────────────────────
 * Centralised so the home page can warm them and components can share
 * the same module identity (and thus the same dedup entry). */

export const loadToolPage         = () => import("@/pages/ToolPage");
export const loadNonPdfToolPage   = () => import("@/pages/NonPdfToolPage");
export const loadCommandPalette   = () => import("@/components/CommandPalette");

// The top-3 tools by traffic — preloaded during idle time from the home
// page so the first navigation is instant. Update this list if analytics
// surface a different set of "next likely" tools.
export const loadCompressUI = () => import("@/components/tool-ui/CompressUI");
export const loadMergeUI    = () => import("@/components/tool-ui/MergeUI");
export const loadSplitUI    = () => import("@/components/tool-ui/SplitUI");

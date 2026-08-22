import { useCallback, useEffect, useRef } from "react";

/**
 * Reveals an element the first time it scrolls into view.
 *
 * Uses a callback ref rather than useRef + useEffect([]). That matters for any
 * section whose content arrives asynchronously: a mount effect runs while
 * ref.current is still null, never re-runs, and the element stays at opacity 0
 * forever. The tool-page FAQ hit exactly that — it renders nothing until its
 * copy is fetched, so by the time the section existed the observer had already
 * given up. A callback ref fires whenever the node actually attaches.
 *
 * IntersectionObserver rather than a scroll listener, so nothing runs on the
 * main thread while scrolling, and it disconnects after firing so a revealed
 * section never animates twice.
 *
 * Under prefers-reduced-motion — or with no IntersectionObserver — it reveals
 * immediately. Content must never depend on an animation to become visible.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
    const observerRef = useRef<IntersectionObserver | null>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => () => {
        observerRef.current?.disconnect();
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    }, []);

    return useCallback((node: T | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
        if (!node) return;

        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduced || typeof IntersectionObserver === "undefined") {
            node.classList.add("is-visible");
            return;
        }

        // Safety net. An animation must never be the reason content is
        // invisible: if the observer has not fired within a second — a browser
        // quirk, an unusual viewport, an element that never quite crosses the
        // threshold — reveal anyway. A late fade is a cosmetic loss; a section
        // stuck at opacity 0 is a broken page.
        const failsafe = window.setTimeout(() => {
            node.classList.add("is-visible");
            observer.disconnect();
        }, 1000);

        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        window.clearTimeout(failsafe);
                        observer.disconnect();
                    }
                }
            },
            // Fire a little before the element is fully on screen so it has
            // settled by the time the reader reaches it.
            { rootMargin: "0px 0px -10% 0px", threshold: 0.01 },
        );
        observer.observe(node);
        observerRef.current = observer;
        timerRef.current = failsafe;
    }, []);
}

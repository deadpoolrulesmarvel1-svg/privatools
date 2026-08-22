import { useEffect, useRef } from "react";

/**
 * Reveals an element the first time it scrolls into view.
 *
 * IntersectionObserver rather than a scroll listener: no work happens on the
 * main thread while scrolling, and the observer disconnects after firing so a
 * revealed section never animates twice.
 *
 * Respects prefers-reduced-motion by revealing immediately, and falls back to
 * the same on browsers without IntersectionObserver — the content must never
 * depend on the animation to become visible.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
    const ref = useRef<T | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduced || typeof IntersectionObserver === "undefined") {
            el.classList.add("is-visible");
            return;
        }

        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        observer.disconnect();
                    }
                }
            },
            // Fire slightly before the element is fully on screen so it has
            // settled by the time the reader reaches it.
            { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return ref;
}

import { useEffect, useRef, useState } from "react";

/**
 * Counts a number up when it first scrolls into view.
 *
 * Driven by requestAnimationFrame against a real timestamp rather than a fixed
 * per-frame increment, so the duration is the same on a 60Hz and a 120Hz
 * display. Eased with the same out-quint curve the rest of the motion system
 * uses, so it decelerates instead of stopping dead.
 *
 * Returns the live value plus a ref to attach. Under prefers-reduced-motion it
 * skips straight to the target — a number that never arrives is worse than one
 * that never moved.
 */
export function useCountUp(target: number, durationMs = 1100) {
    const [value, setValue] = useState(0);
    const ref = useRef<HTMLElement | null>(null);
    const done = useRef(false);

    useEffect(() => {
        const el = ref.current;
        if (!el || done.current) return;

        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduced || typeof IntersectionObserver === "undefined") {
            setValue(target);
            done.current = true;
            return;
        }

        let raf = 0;
        const observer = new IntersectionObserver(entries => {
            if (!entries.some(e => e.isIntersecting) || done.current) return;
            done.current = true;
            observer.disconnect();

            const start = performance.now();
            const tick = (now: number) => {
                const t = Math.min(1, (now - start) / durationMs);
                const eased = 1 - Math.pow(1 - t, 5);   // out-quint
                setValue(Math.round(target * eased));
                if (t < 1) raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
        }, { threshold: 0.4 });

        observer.observe(el);
        return () => { observer.disconnect(); cancelAnimationFrame(raf); };
    }, [target, durationMs]);

    return { value, ref };
}

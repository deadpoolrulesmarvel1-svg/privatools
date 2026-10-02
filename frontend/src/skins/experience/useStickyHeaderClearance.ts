import { useEffect, type RefObject } from "react";

/**
 * Keep whatever takes focus, or is scrolled to, clear of the sticky header
 * (WCAG 2.4.11). The root's scroll padding (experience.css) reads
 * --pt-header-clearance, set here from where the stuck header actually ends:
 * its height changes with the breakpoint, the style, the second navigation
 * row and browser zoom, so a fixed number would be wrong somewhere.
 */
export function useStickyHeaderClearance(header: RefObject<HTMLElement>) {
    useEffect(() => {
        const element = header.current;
        if (!element) return;
        const root = document.documentElement;
        const update = () => {
            const style = getComputedStyle(element);
            const stuck = style.position === "sticky" || style.position === "fixed";
            const clearance = stuck ? (parseFloat(style.top) || 0) + element.offsetHeight : 0;
            root.style.setProperty("--pt-header-clearance", `${Math.ceil(clearance)}px`);
        };
        update();
        const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
        resize?.observe(element);
        // Air and Play place the header differently at the same size.
        const restyle = new MutationObserver(update);
        restyle.observe(root, { attributes: true, attributeFilter: ["data-experience"] });
        window.addEventListener("resize", update);
        return () => {
            resize?.disconnect();
            restyle.disconnect();
            window.removeEventListener("resize", update);
            root.style.removeProperty("--pt-header-clearance");
        };
    }, [header]);
}

import { useEffect, type RefObject } from "react";

/**
 * Keep whatever takes focus, or is scrolled to, clear of a tool's sticky
 * action bar (WCAG 2.4.11), as useStickyHeaderClearance does for the header.
 * The root's bottom scroll padding (experience.css) reads
 * --pt-action-clearance, set here from the bar's real height while it can
 * stick: its height changes with the breakpoint, the style, a wrapped status
 * line and browser zoom. Beside the canvas, where the bar does not span the
 * screen, it still sticks at the bottom of its column, so it counts there too.
 */
export function useActionBarClearance(bar: RefObject<HTMLElement>, active: boolean) {
    useEffect(() => {
        const element = bar.current;
        if (!element || !active) return;
        const root = document.documentElement;
        const update = () => {
            const style = getComputedStyle(element);
            const sticks = style.position === "sticky" || style.position === "fixed";
            const clearance = sticks ? (parseFloat(style.bottom) || 0) + element.offsetHeight : 0;
            root.style.setProperty("--pt-action-clearance", `${Math.ceil(clearance)}px`);
        };
        update();
        const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
        resize?.observe(element);
        // Air and Play lay the bar out differently at the same size.
        const restyle = new MutationObserver(update);
        restyle.observe(root, { attributes: true, attributeFilter: ["data-experience"] });
        window.addEventListener("resize", update);
        return () => {
            resize?.disconnect();
            restyle.disconnect();
            window.removeEventListener("resize", update);
            root.style.removeProperty("--pt-action-clearance");
        };
    }, [bar, active]);
}

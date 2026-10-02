import { useEffect, type RefObject } from "react";

/** How far above the bottom of the screen toasts reach (offset and one toast). */
const TOAST_REACH = 96;

/**
 * Keep whatever takes focus, or is scrolled to, clear of a tool's sticky
 * action bar (WCAG 2.4.11), as useStickyHeaderClearance does for the header,
 * and keep toasts off it. The root's bottom scroll padding (experience.css)
 * and the toasts (tool-studio.css) read --pt-action-clearance: the room from
 * the bar's top edge to the bottom of the screen while the bar sits low on
 * it, docked (Air's strip, Play's dock 12px above the edge) or resting just
 * above where toasts land. Its height changes with the breakpoint, the
 * style, a wrapped status line and browser zoom. A bar in the flow on a short
 * screen, one mid-screen at the foot of a short settings column, and one that
 * has left with its tool as the visitor scrolls on to the guide count nothing.
 */
export function useActionBarClearance(bar: RefObject<HTMLElement>, active: boolean) {
    useEffect(() => {
        const element = bar.current;
        if (!element || !active) return;
        const root = document.documentElement;
        let frame = 0;
        const update = () => {
            frame = 0;
            const position = getComputedStyle(element).position;
            const box = element.getBoundingClientRect();
            const sticky = position === "sticky" || position === "fixed";
            const low = box.top < window.innerHeight && box.bottom > window.innerHeight - TOAST_REACH;
            root.style.setProperty("--pt-action-clearance", `${sticky && low ? Math.ceil(window.innerHeight - box.top) : 0}px`);
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
        update();
        const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
        resize?.observe(element);
        // Air and Play lay the bar out differently at the same size.
        const restyle = new MutationObserver(schedule);
        restyle.observe(root, { attributes: true, attributeFilter: ["data-experience"] });
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, { passive: true });
        // The bar rises into place as it becomes ready; measure it again where it lands.
        element.addEventListener("animationend", schedule);
        return () => {
            cancelAnimationFrame(frame);
            resize?.disconnect();
            restyle.disconnect();
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule);
            element.removeEventListener("animationend", schedule);
            root.style.removeProperty("--pt-action-clearance");
        };
    }, [bar, active]);
}

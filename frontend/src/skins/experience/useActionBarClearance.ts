import { useEffect, type RefObject } from "react";

/**
 * Keep whatever takes focus, or is scrolled to, clear of a tool's sticky
 * action bar (WCAG 2.4.11), as useStickyHeaderClearance does for the header.
 * The root's bottom scroll padding (experience.css) and the toasts
 * (tool-studio.css) read --pt-action-clearance, set here from the bar's real
 * height while it actually docks at the bottom of the screen: its height
 * changes with the breakpoint, the style, a wrapped status line and browser
 * zoom. A bar that stays in the flow (inside a settings column, or on a short
 * screen) needs no room, and neither does one whose tool has scrolled out of
 * view: it leaves with the tool.
 */
export function useActionBarClearance(bar: RefObject<HTMLElement>, active: boolean) {
    useEffect(() => {
        const element = bar.current;
        if (!element || !active) return;
        const root = document.documentElement;
        const tool = element.closest<HTMLElement>(".tool-studio, .ms-workspace, .merge-layout") ?? element.parentElement;
        let toolInView = true;
        const update = () => {
            const style = getComputedStyle(element);
            const docks = toolInView && (style.position === "sticky" || style.position === "fixed");
            const clearance = docks ? (parseFloat(style.bottom) || 0) + element.offsetHeight : 0;
            root.style.setProperty("--pt-action-clearance", `${Math.ceil(clearance)}px`);
        };
        update();
        const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
        resize?.observe(element);
        const view = typeof IntersectionObserver === "undefined" || !tool ? null : new IntersectionObserver(entries => {
            toolInView = entries[entries.length - 1].isIntersecting;
            update();
        });
        if (tool) view?.observe(tool);
        // Air and Play lay the bar out differently at the same size.
        const restyle = new MutationObserver(update);
        restyle.observe(root, { attributes: true, attributeFilter: ["data-experience"] });
        window.addEventListener("resize", update);
        return () => {
            resize?.disconnect();
            view?.disconnect();
            restyle.disconnect();
            window.removeEventListener("resize", update);
            root.style.removeProperty("--pt-action-clearance");
        };
    }, [bar, active]);
}

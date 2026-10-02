import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useActionBarClearance } from "./useActionBarClearance";

function Bar({ bottom, position = "sticky", active = true }: { bottom: string; position?: string; active?: boolean }) {
    const bar = useRef<HTMLDivElement>(null);
    useActionBarClearance(bar, active);
    return <div className="tool-studio"><div ref={bar} style={{ position: position as "sticky", bottom }}>Compress PDF</div></div>;
}

function setHeight(element: Element, height: number) {
    Object.defineProperty(element, "offsetHeight", { configurable: true, get: () => height });
}

const clearance = () => document.documentElement.style.getPropertyValue("--pt-action-clearance");

const nativeOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", nativeOffsetHeight);
});

/** An IntersectionObserver the test drives: report(true) puts the tool on screen, report(false) scrolls it away. */
function watchTool() {
    const observed: Element[] = [];
    let callback: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal("IntersectionObserver", class {
        constructor(next: IntersectionObserverCallback) { callback = next; }
        observe(target: Element) { observed.push(target); }
        unobserve() { /* not used */ }
        disconnect() { /* not used */ }
    });
    return {
        observed,
        report: (isIntersecting: boolean) => act(() => { callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver); }),
    };
}

const css = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("sticky action bar clearance", () => {
    it("follows the bar's real height and offset, through resizes, and is removed with the bar", () => {
        setHeight(HTMLElement.prototype, 68);
        const { container, rerender, unmount } = render(<Bar bottom="0px" />);
        // Air's strip along the bottom edge of a phone.
        expect(clearance()).toBe("68px");
        setHeight(container.querySelector(".tool-studio > div")!, 74);
        rerender(<Bar bottom="12px" />);
        act(() => { window.dispatchEvent(new Event("resize")); });
        // Play's floating dock, 12px above the edge.
        expect(clearance()).toBe("86px");
        unmount();
        expect(clearance()).toBe("");
    });

    it("clears nothing while the bar cannot stick, or has nothing to run", () => {
        setHeight(HTMLElement.prototype, 68);
        const { unmount } = render(<Bar bottom="0px" position="static" />);
        expect(clearance()).toBe("0px");
        unmount();
        render(<Bar bottom="0px" active={false} />);
        expect(clearance()).toBe("");
    });

    it("clears nothing once the tool has scrolled out of view, as the bar has left with it", () => {
        setHeight(HTMLElement.prototype, 68);
        const tool = watchTool();
        render(<Bar bottom="0px" />);
        expect(tool.observed.map(element => element.className)).toEqual(["tool-studio"]);
        expect(clearance()).toBe("68px");
        tool.report(false);
        expect(clearance()).toBe("0px");
        tool.report(true);
        expect(clearance()).toBe("68px");
    });

    it("drives the root's bottom scroll padding, so focus lands above the bar", () => {
        expect(css("src/skins/experience/experience.css")).toMatch(/html\[data-experience\]\s*\{scroll-padding-bottom:calc\(var\(--pt-action-clearance, 0px\) \+ 12px\);\}/);
    });

    it("docks only on a screen taller than 420px, and never inside the media studio's sticky settings column", () => {
        // 300–400% zoom and a phone held sideways: header and docked bar left the tool no room (WCAG 2.4.11).
        const studio = css("src/skins/experience/tool-studio.css");
        expect(studio).toContain("@media(min-height:421px){.ts-action-bar[data-ready=true]{position:sticky;bottom:0;z-index:4}}");
        expect(studio).not.toMatch(/(^|\})\.ts-action-bar\[data-ready=true\]\{position:sticky/m);
        const media = css("src/components/tool-ui/media/media-studio.css");
        expect(media).toContain("@media(min-width:761px){html[data-experience='air'] .ms-with-action>.ms-side .ts-action-bar{position:static}}");
        expect(media).toContain("@media(min-width:761px) and (max-width:1000px){html[data-experience='play'] .ms-with-action>.ms-side .ts-action-bar{position:static}}");
        expect(media).toContain("@media(max-height:420px){.ms-side{position:static}}");
        // A video preview keeps a usable size however little room is left.
        expect(media.match(/max-height:min\((430|390)px,max\(120px,calc\(100svh/g)).toHaveLength(2);
    });
});

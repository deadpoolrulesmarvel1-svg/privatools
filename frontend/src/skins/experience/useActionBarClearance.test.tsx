import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActionBarClearance } from "./useActionBarClearance";

function Bar({ bottom, position = "sticky", active = true }: { bottom: string; position?: string; active?: boolean }) {
    const bar = useRef<HTMLDivElement>(null);
    useActionBarClearance(bar, active);
    return <div className="tool-studio"><div ref={bar} style={{ position: position as "sticky", bottom }}>Compress PDF</div></div>;
}

const clearance = () => document.documentElement.style.getPropertyValue("--pt-action-clearance");
const css = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Where the bar is on screen (jsdom lays nothing out): its top and bottom edges. */
const place = { top: 0, bottom: 0 };
const at = (top: number, height: number) => { place.top = top; place.bottom = top + height; };
/** Frames run when the test says, as a browser runs them after a scroll or resize. */
let frames: FrameRequestCallback[] = [];
const nextFrame = () => act(() => { const due = frames; frames = []; due.forEach(run => run(0)); });
const scrolled = () => { window.dispatchEvent(new Event("scroll")); nextFrame(); };

beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 0, y: place.top, top: place.top, left: 0, right: 390, bottom: place.bottom, width: 390, height: place.bottom - place.top, toJSON: () => ({}) } as DOMRect));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("sticky action bar clearance", () => {
    it("is the room a docked bar takes at the bottom of the screen, through resizes, and is removed with the bar", () => {
        // Air's strip along the bottom edge of a phone.
        at(window.innerHeight - 68, 68);
        const { rerender, unmount } = render(<Bar bottom="0px" />);
        expect(clearance()).toBe("68px");
        // Play's floating dock, 12px above the edge.
        at(window.innerHeight - 12 - 74, 74);
        rerender(<Bar bottom="12px" />);
        window.dispatchEvent(new Event("resize"));
        nextFrame();
        expect(clearance()).toBe("86px");
        unmount();
        expect(clearance()).toBe("");
    });

    it("measures the bar again where its entrance animation leaves it", () => {
        // Mid-rise: the bar still sits 18px lower than where it lands.
        at(window.innerHeight - 12 - 104 + 18, 104);
        const { container } = render(<Bar bottom="12px" />);
        expect(clearance()).toBe("98px");
        at(window.innerHeight - 12 - 104, 104);
        act(() => { container.querySelector(".tool-studio > div")!.dispatchEvent(new Event("animationend", { bubbles: true })); });
        nextFrame();
        expect(clearance()).toBe("116px");
    });

    it("clears nothing while the bar cannot stick, or has nothing to run", () => {
        at(window.innerHeight - 68, 68);
        const { unmount } = render(<Bar bottom="0px" position="static" />);
        expect(clearance()).toBe("0px");
        unmount();
        render(<Bar bottom="0px" active={false} />);
        expect(clearance()).toBe("");
    });

    it("counts the bar only while it sits low on the screen, where toasts land", () => {
        // Mid-screen at the foot of a settings column shorter than the screen: toasts stay at the bottom.
        at(window.innerHeight - 250, 96);
        render(<Bar bottom="0px" />);
        expect(clearance()).toBe("0px");
        // Resting in the flow just above the bottom, before it docks: toasts rise above it.
        at(window.innerHeight - 120, 77);
        scrolled();
        expect(clearance()).toBe("120px");
        // Docked.
        at(window.innerHeight - 68, 68);
        scrolled();
        expect(clearance()).toBe("68px");
        // Scrolled on to the guide, the bar has left with the tool.
        at(-200, 68);
        scrolled();
        expect(clearance()).toBe("0px");
    });

    it("drives the root's bottom scroll padding, so focus lands above the bar", () => {
        expect(css("src/skins/experience/experience.css")).toMatch(/html\[data-experience\]\s*\{scroll-padding-bottom:calc\(var\(--pt-action-clearance, 0px\) \+ 12px\);\}/);
    });

    it("docks only on a screen taller than 420px, where it leaves the tool room", () => {
        // 300–400% zoom and a phone held sideways: header and docked bar left the tool no room (WCAG 2.4.11).
        const studio = css("src/skins/experience/tool-studio.css");
        expect(studio).toContain("@media(min-height:421px){.ts-action-bar[data-ready=true]{position:sticky;bottom:0;z-index:4}}");
        expect(studio).not.toMatch(/(^|\})\.ts-action-bar\[data-ready=true\]\{position:sticky/m);
        const media = css("src/components/tool-ui/media/media-studio.css");
        expect(media).toContain("@media(max-height:420px){.ms-side{position:static}}");
        // A video preview keeps a usable size however little room is left.
        expect(media.match(/max-height:min\((430|390)px,max\(120px,calc\(100svh/g)).toHaveLength(2);
    });
});

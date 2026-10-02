import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useActionBarClearance } from "./useActionBarClearance";

function Bar({ bottom, position = "sticky", active = true }: { bottom: string; position?: string; active?: boolean }) {
    const bar = useRef<HTMLDivElement>(null);
    useActionBarClearance(bar, active);
    return <div ref={bar} style={{ position: position as "sticky", bottom }}>Compress PDF</div>;
}

function setHeight(element: Element, height: number) {
    Object.defineProperty(element, "offsetHeight", { configurable: true, get: () => height });
}

const clearance = () => document.documentElement.style.getPropertyValue("--pt-action-clearance");

const nativeOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
afterEach(() => {
    cleanup();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", nativeOffsetHeight);
});

describe("sticky action bar clearance", () => {
    it("follows the bar's real height and offset, through resizes, and is removed with the bar", () => {
        setHeight(HTMLElement.prototype, 68);
        const { container, rerender, unmount } = render(<Bar bottom="0px" />);
        // Air's strip along the bottom edge of a phone.
        expect(clearance()).toBe("68px");
        setHeight(container.firstElementChild!, 74);
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

    it("drives the root's bottom scroll padding, so focus lands above the bar", () => {
        const css = readFileSync(join(process.cwd(), "src/skins/experience/experience.css"), "utf8");
        expect(css).toMatch(/html\[data-experience\]\s*\{scroll-padding-bottom:calc\(var\(--pt-action-clearance, 0px\) \+ 12px\);\}/);
    });
});

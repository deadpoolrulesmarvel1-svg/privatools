import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStickyHeaderClearance } from "./useStickyHeaderClearance";

function Header({ top }: { top: string }) {
    const header = useRef<HTMLElement>(null);
    useStickyHeaderClearance(header);
    return <header ref={header} style={{ position: "sticky", top }}>Header</header>;
}

function setHeight(element: Element, height: number) {
    Object.defineProperty(element, "offsetHeight", { configurable: true, get: () => height });
}

const clearance = () => document.documentElement.style.getPropertyValue("--pt-header-clearance");

const nativeOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
afterEach(() => {
    cleanup();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", nativeOffsetHeight);
});

describe("sticky header clearance", () => {
    it("follows where the stuck header ends, through resizes, and is removed with the shell", () => {
        setHeight(HTMLElement.prototype, 74);
        const { container, rerender, unmount } = render(<Header top="12px" />);
        // Play's floating bar: 12px from the top, 74px tall.
        expect(clearance()).toBe("86px");
        const header = container.querySelector("header")!;
        setHeight(header, 109);
        rerender(<Header top="8px" />);
        act(() => { window.dispatchEvent(new Event("resize")); });
        // The phone header: two rows, 8px from the top.
        expect(clearance()).toBe("117px");
        unmount();
        expect(clearance()).toBe("");
    });

    it("drives the root scroll padding, so focus lands below the header", () => {
        const css = readFileSync(join(process.cwd(), "src/skins/experience/experience.css"), "utf8");
        expect(css).toMatch(/html\[data-experience\]\s*\{scroll-padding-top:calc\(var\(--pt-header-clearance, 0px\) \+ 12px\);\}/);
    });
});

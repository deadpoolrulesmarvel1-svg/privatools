/**
 * The dock's theme control has to do two different jobs at once.
 *
 * Writing the preference is what survives a reload — index.html reads it before
 * first paint. Repainting *now* is a separate problem, because only Aurora's
 * palette follows `data-theme`; Carbon and Structured hold the theme in their
 * own component state, so the attribute alone leaves the screen unchanged and
 * the click looks like it did nothing. That shipped, and needed a reload nobody
 * would know to perform.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readThemeChoice, resolveTheme, setThemeChoice } from "./skinTheme";

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.className = "";
    document.body.innerHTML = "";
});

describe("persistence, per design", () => {
    it("writes each design to the key that design actually reads", () => {
        setThemeChoice("aurora", "light");
        setThemeChoice("carbon", "dark");
        expect(localStorage.getItem("pt-theme")).toBe("light");
        expect(localStorage.getItem("pt.theme")).toBe("dark");
    });

    it("keeps Structured's choice inside its own JSON blob, without clobbering it", () => {
        localStorage.setItem("privatools.local.v1", JSON.stringify({ vault: "keep me" }));
        setThemeChoice("structured", "light");
        const blob = JSON.parse(localStorage.getItem("privatools.local.v1")!);
        expect(blob.theme).toBe("light");
        expect(blob.vault).toBe("keep me");
    });

    it("reads back what it wrote", () => {
        setThemeChoice("carbon", "light");
        expect(readThemeChoice("carbon")).toBe("light");
    });

    it("falls back to system for an unset or corrupt value", () => {
        expect(readThemeChoice("aurora")).toBe("system");
        localStorage.setItem("pt-theme", "chartreuse");
        expect(readThemeChoice("aurora")).toBe("system");
    });
});

describe("repainting now", () => {
    it("drives a design's <select>, so its own state agrees with ours", () => {
        // Carbon's control. Without this the attribute changes, the select does
        // not, and the design keeps painting from the state behind it.
        document.body.innerHTML = `
            <select id="theme">
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
            </select>`;
        const select = document.querySelector("select")!;
        select.value = "dark";
        const onChange = vi.fn();
        select.addEventListener("change", onChange);

        setThemeChoice("carbon", "light");

        expect(select.value).toBe("light");
        expect(onChange).toHaveBeenCalled();
    });

    it("clicks a design's own button when that is the control it has", () => {
        document.body.innerHTML = `<button aria-label="Light theme">Light theme</button>`;
        const btn = document.querySelector("button")!;
        const onClick = vi.fn();
        btn.addEventListener("click", onClick);

        setThemeChoice("aurora", "light");

        expect(onClick).toHaveBeenCalled();
    });

    it("never clicks the dock's own row, which is what called it", () => {
        document.body.innerHTML = `
            <div role="group" aria-label="Light or dark">
                <button>Light</button>
            </div>`;
        const onClick = vi.fn();
        document.querySelector("button")!.addEventListener("click", onClick);

        setThemeChoice("structured", "light");

        expect(onClick, "driving our own button would recurse").not.toHaveBeenCalled();
    });

    it("leaves a select alone unless it carries every theme value", () => {
        // A coffee-strength picker happens to have a "light" option. Matching
        // one value is not enough to conclude it is the theme control.
        document.body.innerHTML = `
            <select>
                <option value="beans">Beans</option>
                <option value="light">Light roast</option>
            </select>`;
        const select = document.querySelector("select")!;
        select.value = "beans";

        setThemeChoice("carbon", "light");

        expect(select.value, "an unrelated select must not be driven").toBe("beans");
        expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("still sets the attribute when a design has no control of its own", () => {
        setThemeChoice("carbon", "dark");
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("uses a class rather than the attribute for the house design", () => {
        setThemeChoice("signature", "dark");
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    });
});

describe("system resolution", () => {
    it("resolves system against the OS, since the designs only know light or dark", () => {
        vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
        expect(resolveTheme("system")).toBe("light");
        expect(resolveTheme("dark")).toBe("dark");
    });
});

/**
 * The theme control does two different jobs at once: writing the preference is
 * what survives a reload — index.html reads the same key before first paint —
 * and setting `data-theme` is what makes the click do something now. This
 * holds the module and index.html's inline pre-paint script to the same rule.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readThemeChoice, resolveTheme, setThemeChoice } from "./skinTheme";

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
});

describe("persistence", () => {
    it("writes the key the pre-paint script actually reads", () => {
        setThemeChoice("daylight", "light");
        expect(localStorage.getItem("privatools.daylight.theme")).toBe("light");
    });

    it("reads back what it wrote", () => {
        setThemeChoice("daylight", "dark");
        expect(readThemeChoice("daylight")).toBe("dark");
    });

    it("falls back to system for an unset or corrupt value", () => {
        expect(readThemeChoice("daylight")).toBe("system");
        localStorage.setItem("privatools.daylight.theme", "chartreuse");
        expect(readThemeChoice("daylight")).toBe("system");
    });
});

describe("painting now", () => {
    it("stamps the resolved choice on <html>", () => {
        setThemeChoice("daylight", "dark");
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("stamps midnight as its own attribute value", () => {
        setThemeChoice("daylight", "midnight");
        expect(localStorage.getItem("privatools.daylight.theme")).toBe("midnight");
        expect(document.documentElement.getAttribute("data-theme")).toBe("midnight");
        expect(readThemeChoice("daylight")).toBe("midnight");
    });

    it("resolves system against the OS before stamping", () => {
        vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
        setThemeChoice("daylight", "system");
        expect(localStorage.getItem("privatools.daylight.theme")).toBe("system");
        expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
});

describe("system resolution", () => {
    it("resolves system against the OS, since the DOM only knows light or dark", () => {
        vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
        expect(resolveTheme("system")).toBe("light");
        expect(resolveTheme("dark")).toBe("dark");
    });
});

describe("the second copy in index.html", () => {
    // An inline pre-paint script cannot import this module, so index.html
    // carries its own copy of the storage key and the resolution rule. If they
    // drift, a visitor's stored choice flashes the wrong palette on every load.
    const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

    it("reads the same storage key", () => {
        expect(html).toContain("privatools.daylight.theme");
    });

    it("stamps the same attribute, resolving system against the OS", () => {
        expect(html).toContain("setAttribute('data-theme'");
        expect(html).toContain("prefers-color-scheme: light");
    });

    it("lets a stored midnight through the pre-paint", () => {
        expect(html).toContain("'midnight'");
    });
});

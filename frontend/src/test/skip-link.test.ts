/**
 * The skip link is the first Tab stop on every page and lives in index.html,
 * which Tailwind never scans: its old `focus:not-sr-only` utilities were never
 * generated, so production showed a 1×1 clipped link on focus (audit B P1-1).
 * It is now styled by the inline stylesheet in index.html; this renders that
 * stylesheet and checks the link is hidden until focused and shown on focus.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

function mountIndex() {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Scripts never run from a parsed document; styles and markup are what matter here.
    document.head.innerHTML = doc.head.innerHTML;
    document.body.innerHTML = doc.body.innerHTML;
    return document.getElementById("prepaint-skip") as HTMLAnchorElement;
}

afterEach(() => { document.head.innerHTML = ""; document.body.innerHTML = ""; });

describe("skip link", () => {
    it("is the first focusable element and targets the main content", () => {
        const link = mountIndex();
        expect(link.tagName).toBe("A");
        expect(link.textContent).toBe("Skip to main content");
        expect(document.body.querySelector("a[href], button, input, [tabindex]")).toBe(link);
        // No utility classes that depend on Tailwind scanning this file.
        expect(link.className).toBe("");
    });

    it("stays out of sight until focused", () => {
        const link = mountIndex();
        const style = getComputedStyle(link);
        expect(style.position).toBe("absolute");
        expect(style.width).toBe("1px");
        expect(style.height).toBe("1px");
        expect(style.overflow).toBe("hidden");
    });

    it("shows as a solid tab over the header on focus, in every style", () => {
        const link = mountIndex();
        for (const experience of ["air", "play"]) {
            for (const theme of ["light", "dark"]) {
                document.documentElement.setAttribute("data-experience", experience);
                document.documentElement.setAttribute("data-theme", theme);
                link.focus();
                expect(document.activeElement).toBe(link);
                const style = getComputedStyle(link);
                expect(style.position, `${experience} ${theme}`).toBe("fixed");
                expect(style.width).toBe("auto");
                expect(style.height).toBe("auto");
                expect(style.overflow).toBe("visible");
                expect(style.clip).toBe("auto");
                expect(style.zIndex).toBe("1000");
                link.blur();
            }
        }
    });

    it("reads at 4.5:1 or better in all four palettes: page colour on the action colour", () => {
        const focusRule = /#prepaint-skip:focus\s*\{([^}]*)\}/.exec(html)?.[1] ?? "";
        expect(focusRule).toMatch(/background:\s*var\(--prepaint-accent\)/);
        expect(focusRule).toMatch(/color:\s*var\(--prepaint-bg\)/);
        const palettes = [...html.matchAll(/--prepaint-bg:(#[0-9a-f]{6});\s*--prepaint-ink:#[0-9a-f]{6};\s*--prepaint-accent:(#[0-9a-f]{6})/gi)];
        // Four palettes, plus the no-script dark fallback.
        expect(palettes.length).toBeGreaterThanOrEqual(4);
        for (const [, bg, accent] of palettes) expect(contrast(bg, accent), `${bg} on ${accent}`).toBeGreaterThanOrEqual(4.5);
    });
});

function luminance(hex: string) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

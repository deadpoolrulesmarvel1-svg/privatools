/**
 * Contrast of the colour pairs this system promises, read from the token
 * sources in all four palettes (Morning Mist, Graphite, Blush, Charcoal).
 * A pair that drops below WCAG AA here fails before anyone ships it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const experienceCss = read("src/skins/experience/experience.css");
const tokensCss = read("src/skins/experience/tokens.css");

function variables(block: string): Record<string, string> {
    return Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}
function block(css: string, selector: string): Record<string, string> {
    const start = css.indexOf(`${selector} {`) >= 0 ? css.indexOf(`${selector} {`) : css.indexOf(`${selector}{`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return variables(css.slice(start, css.indexOf("}", start)));
}

// The experience palettes cascade: Air light is the base, Play overrides it, dark overrides light.
const base = block(experienceCss, "html[data-experience]");
const airDark = block(experienceCss, "html[data-experience='air'][data-theme='dark']");
const play = block(experienceCss, "html[data-experience='play']");
const playDark = block(experienceCss, "html[data-experience='play'][data-theme='dark']");
const PALETTES = {
    "Air light": { pt: base, ui: block(tokensCss, 'html[data-experience="air"][data-theme="light"]') },
    "Air dark": { pt: { ...base, ...airDark }, ui: block(tokensCss, 'html[data-experience="air"][data-theme="dark"]') },
    "Play light": { pt: { ...base, ...play }, ui: block(tokensCss, 'html[data-experience="play"][data-theme="light"]') },
    "Play dark": { pt: { ...base, ...play, ...playDark }, ui: block(tokensCss, 'html[data-experience="play"][data-theme="dark"]') },
};

type Rgb = [number, number, number];
function hex(value: string): Rgb {
    const h = value.replace("#", "");
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}
function hsl(triplet: string): Rgb {
    const [h, s, l] = triplet.replace(/%/g, "").split(/\s+/).map(Number);
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
}
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
    return fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]) as Rgb;
}
function luminance([r, g, b]: Rgb) {
    const lin = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: Rgb, b: Rgb) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe.each(Object.entries(PALETTES))("%s", (_name, { pt, ui }) => {
    const p = (name: string) => hex(pt[name]);
    const u = (name: string) => hsl(ui[name]);

    it.each(["pdf", "image", "code", "media"])("pairs the %s paper with an ink and a muted ink that both read at 4.5:1", paper => {
        expect(contrast(p(`pt-${paper}-ink`), p(`pt-${paper}`))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p(`pt-${paper}-muted`), p(`pt-${paper}`))).toBeGreaterThanOrEqual(4.5);
    });

    it("draws field edges at 3:1 on the page, a card and a panel", () => {
        for (const surface of ["pt-bg", "pt-surface", "pt-panel"]) {
            expect(contrast(p("pt-field-line"), p(surface)), surface).toBeGreaterThanOrEqual(3);
        }
        for (const surface of ["background", "card"]) expect(contrast(u("input"), u(surface)), surface).toBeGreaterThanOrEqual(3);
    });

    it("keeps warning text at 4.5:1 on cards, the page and its own tint", () => {
        for (const surface of ["card", "background", "warning-soft"]) {
            expect(contrast(u("warning"), u(surface)), surface).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("gives placeholders and secondary text 4.5:1 on the page, cards and dialogs", () => {
        for (const surface of ["background", "card", "popover"]) {
            expect(contrast(u("muted-foreground"), u(surface)), surface).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("keeps every Smart Redact category chip at 4.5:1", () => {
        const card = u("card");
        const chips: [string, Rgb, Rgb][] = [
            ["people", u("destructive"), over(u("destructive"), card, 0.1)],
            ["locations", u("accent"), over(u("accent"), card, 0.1)],
            ["credit cards", u("copper"), u("copper-soft")],
            ["SSNs", u("warning"), u("warning-soft")],
            ["other", p("pt-muted"), p("pt-panel")],
        ];
        for (const [name, fg, bg] of chips) expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5);
    });
});

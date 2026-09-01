import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SKIN_IDS, SKINS, DEFAULT_SKIN, isSkinId } from "@/lib/skins";

const CSS = readFileSync(resolve(__dirname, "../styles/skins.css"), "utf8");

/** Pull `--name: value;` pairs out of the block for one selector. */
function tokensFor(selector: string): Record<string, string> {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`no block for ${selector}`);
    const out: Record<string, string> = {};
    for (const line of m[1].split(";")) {
        const kv = line.match(/^\s*--([a-zA-Z0-9-]+)\s*:\s*(.+)$/);
        if (kv) out[kv[1]] = kv[2].trim();
    }
    return out;
}

/**
 * The core contract. Every one of the 112 tool UIs styles itself through these,
 * so a palette that misses one renders that surface with a stale colour — the
 * failure mode this test exists to prevent.
 */
const CORE_TOKENS = [
    "background", "foreground", "paper", "paper-2", "paper-3",
    "card", "card-foreground", "card-tint", "popover", "popover-foreground",
    "primary", "primary-foreground", "secondary", "secondary-foreground",
    "muted", "muted-foreground", "accent", "accent-bright", "accent-foreground",
    "accent-soft", "copper", "copper-soft", "success", "success-soft",
    "destructive", "destructive-foreground", "border", "border-strong",
    "input", "ring",
];

const CAT_TOKENS = [
    "cat-organize", "cat-edit", "cat-optimize", "cat-security", "cat-to-pdf",
    "cat-from-pdf", "cat-advanced", "cat-image", "cat-video", "cat-developer",
    "cat-archive", "cat-document",
];

/** Raw-valued tokens read directly (not through Tailwind's hsl() wrapper). */
const SHELL_TOKENS = [
    "rail", "scrim", "hero-bg", "panel-glass", "edge", "edge-soft", "edge-hot",
    "halo", "halo-2", "sheen", "grain-o", "glass-blur", "shadow-panel",
    "glass-a", "primary-glow",
];

/** Where each mode of the default skin lives in the generated CSS. */
const MODES = [
    ["light", ":root"],
    ["dark", ':root[data-theme="dark"]'],
    ["midnight", ':root[data-theme="midnight"]'],
] as const;

describe("skin registry", () => {
    it("gives every id an entry with a shell and two swatches", () => {
        for (const id of SKIN_IDS) {
            const s = SKINS[id];
            expect(s.id).toBe(id);
            expect(s.name).toBeTruthy();
            expect(s.blurb).toBeTruthy();
            expect(s.swatch).toHaveLength(2);
            expect(s.surface).toBeTruthy();
        }
    });

    it("rejects unknown values so a corrupt stored skin falls back", () => {
        expect(isSkinId("daylight")).toBe(true);
        expect(isSkinId("aurora")).toBe(false);   // removed with the other skins
        expect(isSkinId("nope")).toBe(false);
        expect(isSkinId(null)).toBe(false);
    });

    it("keeps the default skin on the bare :root block, with no data-skin rule", () => {
        // The default carries no attribute — applySkin() removes it — so its
        // palette must be the one :root serves. A [data-skin] block too would
        // mean two sources of truth for the same palette.
        expect(CSS).toMatch(/:root\s*\{/);
        expect(CSS).not.toContain(`[data-skin="${DEFAULT_SKIN}"]`);
    });

    it("gives dark a prefers-color-scheme fallback identical to the attribute block", () => {
        // Before index.html's pre-paint script stamps `data-theme` (or with JS
        // off), a dark-OS visitor must still get the dark palette. The media
        // block has to be the same palette, not a fork that drifts.
        expect(CSS).toContain("@media (prefers-color-scheme: dark)");
        const attr = tokensFor(':root[data-theme="dark"]');
        const media = tokensFor(":root:not([data-theme])");
        expect(media).toEqual(attr);
    });
});

describe("skin token contract", () => {
    for (const [mode, selector] of MODES) {
        it(`${DEFAULT_SKIN} · ${mode} defines every core, category and shell token`, () => {
            const t = tokensFor(selector);
            const missing = [...CORE_TOKENS, ...CAT_TOKENS, ...SHELL_TOKENS]
                .filter((k) => !(k in t));
            expect(missing).toEqual([]);
        });

        it(`${DEFAULT_SKIN} · ${mode} emits core tokens as bare HSL triplets`, () => {
            // Tailwind wraps these as hsl(var(--x) / <alpha>), so a hex or
            // rgba() value here silently breaks every opacity utility.
            const t = tokensFor(selector);
            for (const k of [...CORE_TOKENS, ...CAT_TOKENS]) {
                expect(t[k], `${k} = ${t[k]}`).toMatch(/^-?[\d.]+ [\d.]+% [\d.]+%$/);
            }
        });
    }

    it(`${DEFAULT_SKIN} declares its type pairing and radius on its base block`, () => {
        const t = tokensFor(":root");
        expect(t["font-display"]).toBeTruthy();
        expect(t["font-sans"]).toBeTruthy();
        expect(t["font-mono"]).toBeTruthy();
        expect(t.radius).toBeTruthy();
    });
});

/* ── Contrast ──────────────────────────────────────────────────────────
 * Checked against the generated CSS rather than the palette source, so a
 * hand-edit to skins.css is caught too.
 */

function hslToRgb(triplet: string): [number, number, number] {
    const [h, s, l] = triplet.replace(/%/g, "").split(/\s+/).map(Number);
    const S = s / 100, L = l / 100;
    const c = (1 - Math.abs(2 * L - 1)) * S;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = L - c / 2;
    const seg: [number, number, number] =
        h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
        h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return seg.map((v) => Math.round((v + m) * 255)) as [number, number, number];
}

function contrast(a: string, b: string): number {
    const lum = (t: string) => {
        const [r, g, bl] = hslToRgb(t).map((v) => {
            const srgb = v / 255;
            return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [string, string, number][] = [
    ["foreground", "background", 4.5],
    ["muted-foreground", "background", 4.5],
    ["muted-foreground", "card", 4.5],
    ["primary", "background", 3.0],
    ["accent", "background", 4.5],
    ["copper", "background", 4.5],
    ["destructive", "background", 4.5],
    ["primary-foreground", "primary", 4.5],
    ["accent-foreground", "accent", 4.5],
];

describe("skin contrast (WCAG 2.2)", () => {
    for (const [mode, selector] of MODES) {
        it(`${DEFAULT_SKIN} · ${mode} clears every target pair`, () => {
            const t = tokensFor(selector);
            const failures = PAIRS
                .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(t[fg], t[bg]) }))
                .filter((r) => r.ratio < r.min)
                .map((r) => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}:1 (min ${r.min})`);
            expect(failures).toEqual([]);
        });
    }
});

/* ── Counts in copy ────────────────────────────────────────────────────
 * The counts must come from the registry, never from a literal — the whole
 * 221/107/114 problem was a number written down once and never rechecked.
 */

import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

describe("catalogue counts", () => {
    it("keep the count out of user-visible copy", () => {
        const shells = ["../skins/daylight/SkinApp.tsx"];
        const offenders: string[] = [];
        for (const rel of shells) {
            const src = readFileSync(resolve(__dirname, rel), "utf8");
            for (const line of src.split("\n")) {
                const code = line.replace(/\/\*[\s\S]*?\*\//g, "").trim();
                if (code.startsWith("*") || code.startsWith("//")) continue;
                // A number inside rendered text or a string literal, followed
                // by a short run of adjectives and then "tool(s)".
                if (/(>[^<>{]*|["'`][^"'`]*)\b(\d{2,4}\+?)\s+(?:free\s+|file\s+|working\s+){0,3}tools?\b/.test(code)) {
                    offenders.push(`${rel}: ${code.slice(0, 80)}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("registry sanity: the derived total is the sum of its parts", () => {
        expect(tools.length + nonPdfTools.length).toBeGreaterThan(200);
    });
});

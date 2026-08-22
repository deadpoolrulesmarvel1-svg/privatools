import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SKIN_IDS, SKINS, DEFAULT_SKIN, isSkinId } from "@/lib/skins";

const CSS = readFileSync(resolve(__dirname, "../styles/skins.css"), "utf8");
const INDEX_CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");

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
 * so a skin that misses one renders that surface with the previous skin's
 * colour — the failure mode this test exists to prevent.
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

/** Raw-valued tokens the shells read directly. */
const SHELL_TOKENS = [
    "rail", "scrim", "hero-bg", "panel-glass", "edge", "edge-soft", "edge-hot",
    "halo", "halo-2", "sheen", "grain-o", "glass-blur", "shadow-panel",
    "glass-a", "primary-glow",
];

const IMPORTED = SKIN_IDS.filter((id) => id !== DEFAULT_SKIN);

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
        expect(isSkinId("aurora")).toBe(true);
        expect(isSkinId("nope")).toBe(false);
        expect(isSkinId(null)).toBe(false);
    });

    it("keeps the default skin on the bare :root block, with no data-skin rule", () => {
        // `signature` owns :root in index.css; giving it a [data-skin] block too
        // would mean two sources of truth for the same palette.
        expect(INDEX_CSS).toMatch(/:root\s*\{/);
        expect(CSS).not.toContain(`[data-skin="${DEFAULT_SKIN}"]`);
    });
});

describe("skin token contract", () => {
    for (const id of IMPORTED) {
        for (const [mode, selector] of [
            ["dark", `[data-skin="${id}"]`],
            ["light", `[data-skin="${id}"][data-theme="light"]`],
        ] as const) {
            it(`${id} · ${mode} defines every core, category and shell token`, () => {
                const t = tokensFor(selector);
                const missing = [...CORE_TOKENS, ...CAT_TOKENS, ...SHELL_TOKENS]
                    .filter((k) => !(k in t));
                expect(missing).toEqual([]);
            });

            it(`${id} · ${mode} emits core tokens as bare HSL triplets`, () => {
                // Tailwind wraps these as hsl(var(--x) / <alpha>), so a hex or
                // rgba() value here silently breaks every opacity utility.
                const t = tokensFor(selector);
                for (const k of [...CORE_TOKENS, ...CAT_TOKENS]) {
                    expect(t[k], `${k} = ${t[k]}`).toMatch(/^-?[\d.]+ [\d.]+% [\d.]+%$/);
                }
            });
        }

        it(`${id} declares its own type pairing and radius on its base block`, () => {
            const t = tokensFor(`[data-skin="${id}"]`);
            expect(t["font-display"]).toBeTruthy();
            expect(t["font-sans"]).toBeTruthy();
            expect(t["font-mono"]).toBeTruthy();
            expect(t.radius).toBeTruthy();
        });
    }
});

/* ── Contrast ──────────────────────────────────────────────────────────
 * Checked against the generated CSS rather than the palette source, so a
 * hand-edit to skins.css is caught too. The imported designs shipped four
 * light-mode pairs below AA; this is the gate that keeps them fixed.
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
    for (const id of IMPORTED) {
        for (const [mode, selector] of [
            ["dark", `[data-skin="${id}"]`],
            ["light", `[data-skin="${id}"][data-theme="light"]`],
        ] as const) {
            it(`${id} · ${mode} clears every target pair`, () => {
                const t = tokensFor(selector);
                const failures = PAIRS
                    .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(t[fg], t[bg]) }))
                    .filter((r) => r.ratio < r.min)
                    .map((r) => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}:1 (min ${r.min})`);
                expect(failures).toEqual([]);
            });
        }
    }
});

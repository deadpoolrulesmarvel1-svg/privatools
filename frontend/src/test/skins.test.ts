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

/* The default skin owns `:root` / `.dark` in index.css rather than a
 * [data-skin] block, so the loop above never saw it — and it shipped a
 * primary at 2.96:1 behind white button labels on every page. Same pairs,
 * same bar, read from the stylesheet the app actually loads.
 */
function indexTokensFor(selector: string): Record<string, string> {
    // `:root` and `.dark` sit inside `@layer base { … }`, so match the
    // selector's own braces by counting rather than with `[^}]*`.
    const at = INDEX_CSS.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`no ${selector} block in index.css`);
    const open = INDEX_CSS.indexOf("{", at);
    let depth = 0, close = open;
    for (let i = open; i < INDEX_CSS.length; i++) {
        if (INDEX_CSS[i] === "{") depth++;
        else if (INDEX_CSS[i] === "}" && --depth === 0) { close = i; break; }
    }
    const out: Record<string, string> = {};
    // Strip comments before splitting: index.css annotates tokens inline, and
    // a `;` inside one of those comments would otherwise cut a declaration in
    // half and silently drop the token that follows it.
    const body = INDEX_CSS.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const line of body.split(";")) {
        const kv = line.match(/^\s*--([a-zA-Z0-9-]+)\s*:\s*(.+)$/);
        if (kv) out[kv[1]] = kv[2].trim();
    }
    return out;
}

describe("signature contrast (WCAG 2.2)", () => {
    for (const [mode, selector] of [["light", ":root"], ["dark", ".dark"]] as const) {
        it(`signature · ${mode} clears every target pair`, () => {
            const base = indexTokensFor(":root");
            // `.dark` only redefines what changes; the rest inherits from :root.
            const t = mode === "dark" ? { ...base, ...indexTokensFor(".dark") } : base;
            const failures = PAIRS
                .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(t[fg], t[bg]) }))
                .filter((r) => r.ratio < r.min)
                .map((r) => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}:1 (min ${r.min})`);
            expect(failures).toEqual([]);
        });
    }

    it("keeps white button labels legible on the primary fill", () => {
        // The specific regression: --primary was 175 100% 33% (#00A896), which
        // put .btn-accent's white label at 2.96:1 on every call to action.
        const t = indexTokensFor(":root");
        expect(contrast(t["primary-foreground"], t["primary"])).toBeGreaterThanOrEqual(4.5);
    });
});

/* ── Catalogue adapters ────────────────────────────────────────────────
 * The ported designs render from these instead of their own sample data.
 * The counts must come from the registry, never from a literal — the whole
 * 221/107/114 problem was a number written down once and never rechecked.
 */

import { AURORA_CATALOGUE, CARBON_REGISTRY, STRUCTURED_CATALOGUE, CATALOGUE_COUNTS } from "@/skins/catalogue";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

describe("catalogue adapters", () => {
    it("carry every tool in the registry, in every shape", () => {
        const expected = tools.length + nonPdfTools.length;
        expect(AURORA_CATALOGUE).toHaveLength(expected);
        expect(CARBON_REGISTRY.records).toHaveLength(expected);
        expect(STRUCTURED_CATALOGUE.records).toHaveLength(expected);
    });

    it("derive their counts from the registry rather than a literal", () => {
        expect(CATALOGUE_COUNTS.pdf).toBe(tools.length);
        expect(CATALOGUE_COUNTS.nonPdf).toBe(nonPdfTools.length);
        expect(CATALOGUE_COUNTS.total).toBe(tools.length + nonPdfTools.length);
        expect(CARBON_REGISTRY.planned.total).toBe(CATALOGUE_COUNTS.total);
        expect(STRUCTURED_CATALOGUE.meta.declaredTotal).toBe(CATALOGUE_COUNTS.total);
    });

    it("keep the count out of user-visible copy in the shells", () => {
        // The skins read their counts from the registry; the house shell has to
        // as well, or the two disagree the first time a tool is added. This
        // caught a literal "Search 219 tools" in SiteHeader that every other
        // surface was already deriving.
        const shells = ["../components/SiteHeader.tsx", "../components/SiteFooter.tsx",
                        "../components/shells/StandardShell.tsx",
                        // The generated skins sat outside this guard, which is
                        // exactly where the literals were: "Search 200+ tools" in
                        // Aurora and Carbon, and a category rail in Structured
                        // claiming 107 PDF tools, 12 archive tools against a real 2,
                        // and 22 document tools against a real 2. A guard that stops
                        // short of the generated output is aimed at the wrong file.
                        "../skins/aurora/SkinApp.tsx",
                        "../skins/carbon/SkinApp.tsx",
                        "../skins/structured/SkinApp.tsx"];
        const offenders: string[] = [];
        for (const rel of shells) {
            const src = readFileSync(resolve(__dirname, rel), "utf8");
            for (const line of src.split("\n")) {
                // Comments explain the history and may name the numbers.
                const code = line.replace(/\/\*[\s\S]*?\*\//g, "").trim();
                if (code.startsWith("*") || code.startsWith("//")) continue;
                // A three-digit number inside rendered text or a string literal.
                // `200+` is not three digits followed by a space, so the original
                // pattern walked straight past it while it sat in two heroes.
                if (/(>[^<>{]*|["'`][^"'`]*)\b(\d{2,3}\+|2[0-9]{2}|1[0-9]{2})\s+(free\s+)?tools?\b/.test(code)) {
                    offenders.push(`${rel}: ${code.slice(0, 80)}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("keep the designs' demo affordances switched off", () => {
        // Aurora ships a "Demo: first visit" toggle and four buttons that fake
        // an error — unsupported file, over 500 MB, password needed, server
        // unavailable. Carbon has the same idea under showStateJumps. They
        // exist so a designer can preview those states; left on, a visitor can
        // click "Demo: over 500 MB" and be shown a failure that never happened.
        //
        // Both designs carry their own switch, so this asserts the switch is
        // thrown rather than that the markup is gone.
        const knobs: Record<string, string> = {
            aurora: "showDemoControls",
            carbon: "showStateJumps",
        };
        for (const [skin, knob] of Object.entries(knobs)) {
            const src = readFileSync(resolve(__dirname, `../skins/${skin}/SkinApp.tsx`), "utf8");
            if (!src.includes(knob)) continue;
            const m = src.match(new RegExp(`"${knob}":\\s*(true|false)`));
            expect(m?.[1], `${skin}: ${knob} default`).toBe("false");
        }
    });

    it("never reintroduce the invented 221 / 107 / 114 figures", () => {
        const counts = [
            CATALOGUE_COUNTS.total, CATALOGUE_COUNTS.pdf, CATALOGUE_COUNTS.nonPdf,
            CARBON_REGISTRY.planned.total, CARBON_REGISTRY.planned.pdf, CARBON_REGISTRY.planned.nonPdf,
            STRUCTURED_CATALOGUE.meta.declaredTotal, STRUCTURED_CATALOGUE.meta.declaredPdf,
            STRUCTURED_CATALOGUE.meta.declaredNonPdf,
        ];
        expect(counts).not.toContain(221);
        expect(counts).not.toContain(107);
        expect(counts).not.toContain(114);
    });

    it("give every record a family the design can actually render", () => {
        // An unknown family is not ignored by these designs — they look up icons
        // and colours by that exact string and throw on a miss.
        const AURORA = new Set(["PDF", "Images", "Video", "Audio", "Archives", "Documents", "Security", "Automate"]);
        const CARBON = new Set(["PDF", "Images", "Video", "Audio", "Archives", "Documents & Data", "Security & Privacy", "Automate"]);
        const STRUCTURED = new Set(["PDF", "Images", "Video", "Audio", "Archives", "Documents & Data"]);

        expect(AURORA_CATALOGUE.filter(r => !AURORA.has(r.fam)).map(r => r.fam)).toEqual([]);
        expect(CARBON_REGISTRY.records.filter(r => !CARBON.has(r.family)).map(r => r.family)).toEqual([]);
        expect(STRUCTURED_CATALOGUE.records.filter(r => !STRUCTURED.has(r.family)).map(r => r.family)).toEqual([]);
    });

    it("states a processing mode for every record, taken from clientOnly", () => {
        for (const r of AURORA_CATALOGUE) expect(["local", "server"]).toContain(r.runs);
        for (const r of CARBON_REGISTRY.records) expect(["local", "server"]).toContain(r.mode);
        for (const r of STRUCTURED_CATALOGUE.records) expect(["local", "server"]).toContain(r.mode);
    });
});

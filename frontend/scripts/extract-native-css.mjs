/**
 * Extracts each imported design's OWN stylesheet and rescopes it under that
 * skin, so ported markup can keep its inline styles verbatim.
 *
 *   node scripts/extract-native-css.mjs
 *
 * Why this exists: the designs put ~220 KB of pixel detail in inline `style`
 * attributes that reference their own variables (--bg0, --em, --rail-w, --h1).
 * Remapping those to our token names by hand would be a rewrite, and a rewrite
 * is exactly what stops the result matching. Instead we keep their variables
 * and scope them, so `style="padding:var(--px)"` means the same thing here as
 * it does in the prototype.
 *
 * Two axis inversions matter:
 *   - Their :root is DARK and [data-theme="light"] is the override.
 *     Ours is the other way round (light default, .dark override), so their
 *     :root lands on `[data-skin=x].dark` and their light block on `[data-skin=x]`.
 *   - Their media queries redeclare :root; those rescope the same way.
 *
 * Keyframes are namespaced per skin — several (rise, pop, flow, ring) collide
 * with animations the app already defines.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/styles/skin-native.css");

const DESIGNS_DIR = resolve(HERE, "../../design-sources");

const SOURCES = ["aurora", "structured", "carbon"].map((id) => ({
  id,
  file: `${DESIGNS_DIR}/${id}.dc.html`,
}));


/**
 * Scope a selector under a skin.
 *
 * Pseudo-ELEMENTS cannot appear inside :is() — `:is(::selection)` and
 * `:is(::-webkit-scrollbar)` are invalid, and a browser drops the whole rule.
 * That is not a cosmetic loss: Carbon styles the document scrollbar to 10px,
 * and without it the page falls back to overlay scrollbars and every route
 * measures 10px wider than the original.
 *
 * So the pseudo-element is split off, :is() wraps only the real selector, and
 * a rule with no base (a bare `::selection`) is emitted twice — once for the
 * root element itself, once for its descendants.
 */
function scope(skin, selector, body) {
  return selector
    .split(",")
    .map((one) => {
      const s = one.trim();
      const at = s.indexOf("::");
      if (at === -1) return `${skin} :is(${s}){${body}}`;
      const base = s.slice(0, at).trim();
      const pseudo = s.slice(at);
      if (!base) return `${skin}${pseudo},${skin} *${pseudo}{${body}}`;
      return `${skin} :is(${base})${pseudo}{${body}}`;
    })
    .join("\n");
}

/** Split a stylesheet into top-level chunks, respecting nested braces. */
function topLevelRules(css) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") { if (depth === 0) start = start; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1; }
    }
  }
  return out.filter(Boolean);
}

const selectorOf = (rule) => rule.slice(0, rule.indexOf("{")).trim();
const bodyOf = (rule) => rule.slice(rule.indexOf("{") + 1, rule.lastIndexOf("}"));

/** The design's light-mode root, however it chose to spell it. */
function isLightRoot(sel) {
  return /^(?::root|html)?\[data-theme=["']?light["']?\]$/.test(sel.trim());
}

function convert(id, css) {
  const SKIN = `[data-skin="${id}"]`;
  // Aurora and Structured set data-theme on <html> themselves, so their own
  // toggle keeps working. Mapping this onto the app's .dark class instead
  // would break the design's theme control, which is part of the design.
  const LIGHT = `${SKIN}[data-theme="light"]`;
  const lines = [];
  const keyframeNames = [];

  for (const rule of topLevelRules(css)) {
    const sel = selectorOf(rule);

    // @keyframes — namespace so they cannot collide with the app's own.
    const kf = sel.match(/^@keyframes\s+([\w-]+)$/);
    if (kf) {
      keyframeNames.push(kf[1]);
      lines.push(`@keyframes ${id}-${kf[1]}{${bodyOf(rule)}}`);
      continue;
    }

    if (sel.startsWith("@media")) {
      const inner = topLevelRules(bodyOf(rule)).map((r) => {
        const s = selectorOf(r);
        // A media query redeclaring :root is this design's responsive layout
        // system — it must apply to both modes, so it scopes to the skin root.
        if (s === ":root") return `${SKIN}{${bodyOf(r)}}`;
        if (isLightRoot(s)) return `${LIGHT}{${bodyOf(r)}}`;
        return scope(SKIN, s, bodyOf(r));
      });
      lines.push(`${sel}{\n  ${inner.join("\n  ")}\n}`);
      continue;
    }

    // Axis inversion. Their :root carries BOTH the dark palette and the
    // layout system (--rail-w, --px, --h1, grid templates), so it cannot go on
    // `.dark` alone or light mode loses every layout token. It lands on the
    // skin root, and their light block overrides only the colours on top.
    if (sel === ":root") { lines.push(`${SKIN}{${bodyOf(rule)}}`); continue; }
    // Structured writes its light block as `:root[data-theme="light"]` where
    // Aurora writes the bare attribute. Only the bare form was recognised, so
    // Structured's fell through to the descendant scoper and came out as
    // `[data-skin=x] :is(:root[data-theme="light"])` — :root can never be a
    // descendant of itself, so that rule matched nothing and the skin had no
    // working light mode at all.
    if (isLightRoot(sel)) { lines.push(`${LIGHT}{${bodyOf(rule)}}`); continue; }

    // Base rules are kept, scoped. Dropping them was wrong: the designs are
    // authored against browser defaults, and this app's own base (15px/1.55 on
    // body, tracking on h1-h6) silently retyped every ported page — every rail
    // row came out 2px taller and the error accumulated down the document.
    if (/^(\*|html|body|html\s*,\s*body)$/.test(sel)) {
      if (sel === "*") { lines.push(`${SKIN} *{${bodyOf(rule)}}`); continue; }
      lines.push(`${SKIN} :is(${sel.replace(/html/g, "body")}){${bodyOf(rule)}}`);
      continue;
    }

    lines.push(scope(SKIN, sel, bodyOf(rule)));
  }

  // Roll this app's base typography back to the UA stylesheet inside the skin,
  // so the design's own rules land on the defaults they were authored against.
  // `revert` is exact here where a hand-picked value would be a guess.
  lines.unshift(
    // `revert` alone is not enough: Tailwind's preflight sets line-height on
    // html, so reverting body just inherits 1.5 from there. The designs assume
    // the initial values, so those two are stated outright.
    `${SKIN}{line-height:normal;font-size:16px}`,
    `${SKIN} body{font:revert;font-size:16px;line-height:normal;letter-spacing:normal;` +
    `font-feature-settings:normal;background-image:none}`,
    `${SKIN} :is(h1,h2,h3,h4,h5,h6){font:revert;letter-spacing:revert;line-height:revert;margin:revert}`,
    `${SKIN} :is(p,ul,ol,figure,blockquote){margin:revert}`,
    // Tailwind's preflight gives form controls `font-size: 100%`; the designs
    // are authored against the UA default (13.33px on a button) and only
    // override the family. `font: revert` restores the UA shorthand, then the
    // family is re-inherited exactly as the design's own rule does.
    `${SKIN} :is(button,input,select,textarea,optgroup){font:revert;font-family:inherit}`,
  );

  // Contrast corrections land on whatever block carries the light palette.
  // Each design scopes that block differently — Aurora emits a bare
  // `[data-theme="light"]`, Structured a `:root[data-theme="light"]` that falls
  // through to the generic scoper — so match on the selector text rather than
  // trying to catch every branch above.
  const corrections = [];
  const skinRoot = `[data-skin="${id}"]{`;
  for (let i = 0; i < lines.length; i++) {
    const isLight = /data-theme=("|\\")?light/.test(lines[i]);
    // After the axis inversion the design's dark palette is the bare skin
    // root; anything carrying data-theme=light is the light override.
    const isDark = !isLight && lines[i].startsWith(skinRoot) && lines[i].includes("--");
    if (!isLight && !isDark) continue;
    const { body, applied } = isLight
      ? correctPalette(id, lines[i], LIGHT_CONTRAST_FIXES, LIGHT_TOKEN_ADDITIONS)
      : correctPalette(id, lines[i], DARK_CONTRAST_FIXES, null);
    if (applied.length) {
      lines[i] = body;
      corrections.push(...applied.map((a) => `${isLight ? "light" : "dark"} ${a}`));
    }
  }
  if (corrections.length) {
    console.log(`  ${id}: contrast corrections -> ${corrections.join(", ")}`);
  }

  return { css: lines.join("\n"), keyframeNames };
}

/**
 * Hue-preserving contrast corrections for the designs' own light palettes.
 *
 * `skin-palettes.mjs` fixes the *shared* tokens (--primary, --muted-foreground
 * and the rest). But each imported design also ships its own token set — Aurora
 * paints from --text3/--em/--tl, Structured from --ink3/--em/--teal — and its
 * native CSS uses those everywhere. Those never went through a contrast pass,
 * so light mode shipped secondary text between 2.97:1 and 4.31:1 against the
 * surfaces the same palette defines.
 *
 * Each replacement keeps the original hue and saturation and lowers only
 * lightness, until the colour clears 4.5:1 against the *darkest* surface that
 * design paints text on — so it holds on every panel, not just on white. The
 * measured before/after is recorded next to each entry.
 *
 * Dark mode needs none of these; it was already clear.
 */
/**
 * Tokens added to the light block only.
 *
 * `--em-ink` is the label colour on the accent fill. The designs hard-code a
 * near-black there, which works against the dark palette's bright mint but not
 * against the darkened light-mode --em. Defining it only here means dark mode
 * still falls through to the design's own literal, byte for byte.
 */
const LIGHT_TOKEN_ADDITIONS = {
  aurora:     { "--em-ink": "#FFFFFF" },   // 5.22:1 on #0A7C54
  structured: { "--em-ink": "#FFFFFF" },   // 5.16:1 on #0A7C59
};

/**
 * The same treatment for a dark palette. Only Structured needs one: its
 * --ink3 ran 3.59:1 against the lightest panel it is painted on. Aurora's and
 * Carbon's dark palettes were measured and already clear.
 */
const DARK_CONTRAST_FIXES = {
  aurora: {
    // worst surface --pnl3 #132B34; measured on --pnl #0A1720 where it is used
    "--vi": ["#7568F4", "#796CF4"],     // 4.36:1 -> 4.55:1
  },
  structured: {
    // worst surface --panel3 #0E3138; lightened rather than darkened, since
    // dark-mode text gains contrast by moving away from the ground.
    "--ink3": ["#6B8786", "#7E9998"],   // 3.59:1 -> 4.55:1
  },
};

const LIGHT_CONTRAST_FIXES = {
  aurora: {
    // worst surface --pnl3 #E9F1ED
    "--text3": ["#617A76", "#5A716D"],   // 4.01:1 -> 4.55:1
    "--em":    ["#0B8C5F", "#0A7C54"],   // 3.71:1 -> 4.55:1
    "--tl":    ["#0C807C", "#0B7975"],   // 4.16:1 -> 4.55:1
  },
  structured: {
    // worst surface --panel3 #EAF2EE
    "--ink3":  ["#7A908D", "#5E716E"],   // 2.97:1 -> 4.55:1
    "--em":    ["#0B8F66", "#0A7C59"],   // 3.59:1 -> 4.55:1
    "--teal":  ["#0C8279", "#0B7A72"],   // 4.11:1 -> 4.55:1
  },
};

/** Applies one correction table to a single declaration body. */
function correctPalette(id, body, table, additions) {
  const fixes = table[id];
  if (!fixes && !(additions && additions[id])) return { body, applied: [] };
  const applied = [];
  let out = body;
  for (const [token, [from, to]] of Object.entries(fixes || {})) {
    const re = new RegExp(`(${token}\\s*:\\s*)${from}\\b`, "i");
    if (!re.test(out)) continue;
    out = out.replace(re, `$1${to}`);
    applied.push(`${token} ${from}->${to}`);
  }
  for (const [token, value] of Object.entries((additions && additions[id]) || {})) {
    if (out.includes(token + ":")) continue;
    out = out.replace(/\}\s*$/, `${token}:${value};}`);
    applied.push(`+${token} ${value}`);
  }
  return { body: out, applied };
}

const parts = [
  "/* AUTO-GENERATED by scripts/extract-native-css.mjs — do not edit by hand.",
  " *",
  " * Each imported design's own stylesheet, rescoped to its skin so that ported",
  " * markup keeps its inline styles verbatim. Their :root (dark) becomes",
  " * [data-skin=x].dark and their [data-theme=light] becomes [data-skin=x],",
  " * because this app defaults to light and overrides with .dark.",
  " */",
  "",
];

const renames = {};
for (const { id, file } of SOURCES) {
  const html = readFileSync(file, "utf8");
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) { console.warn(`${id}: no <style> block`); continue; }
  const { css, keyframeNames } = convert(id, m[1]);
  renames[id] = keyframeNames;
  parts.push(`/* ══ ${id} ══════════════════════════════════════════════════ */`);
  parts.push(css, "");
  console.log(`${id}: ${css.length.toLocaleString()} chars, ${keyframeNames.length} keyframes namespaced`);
}

writeFileSync(OUT, parts.join("\n") + "\n", "utf8");
writeFileSync(
  resolve(HERE, "../src/styles/skin-keyframes.json"),
  JSON.stringify(renames, null, 2) + "\n",
  "utf8",
);
console.log(`\nWrote ${OUT}`);

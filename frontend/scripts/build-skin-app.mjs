/**
 * Ports an imported Claude Design project into a React component, verbatim.
 *
 *   node scripts/build-skin-app.mjs [aurora|carbon|structured]
 *
 * The `.dc` format turns out to be a near-exact match for a React class
 * component: `DCLogic` is a thin base whose setState(updater, cb), lifecycle
 * hooks and props/state fields behave identically to React.Component. So the
 * logic transfers unchanged and only two things are generated around it — the
 * markup, converted by dc-to-jsx.mjs, and a render() that exposes renderVals()
 * as `v`.
 *
 * Porting rather than re-authoring is the whole point: every pixel value in
 * these designs lives in an inline style attribute, and a hand-rewrite is
 * exactly where that fidelity would be lost.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGNS = resolve(HERE, "../../design-sources");

const SKINS = {
  aurora:     { label: "Obsidian Aurora" },
  carbon:     { label: "Carbon Glass" },
  structured: { label: "Structured Privacy OS" },
};


/**
 * Replaces a design's built-in sample catalogue with the real registry.
 *
 * Each design hardcodes its own records at module scope, so a subclass cannot
 * reach them — the swap has to happen here, in the generated source. The spans
 * are found by scanning balanced brackets rather than by regex: these literals
 * run to tens of thousands of characters and contain every bracket character
 * inside strings.
 *
 * Structured is absent on purpose. It already reads
 * `window.PRIVATOOLS_CATALOGUE` and falls back to its samples, so its extension
 * assigns that global instead — the design's own documented seam.
 */
const REGISTRY_SWAPS = {
  aurora: { start: "catalogue = (() => {", open: "{", replacement: "catalogue = AURORA_CATALOGUE;" },
  carbon: { start: "const REGISTRY = {", open: "{", replacement: "const REGISTRY = CARBON_REGISTRY;" },
};

function swapRegistry(id, logic) {
  const swap = REGISTRY_SWAPS[id];
  if (!swap) return { logic, swapped: false };

  const from = logic.indexOf(swap.start);
  if (from === -1) throw new Error(`${id}: catalogue anchor not found (${swap.start})`);

  // Walk from the first bracket to its match, skipping string contents.
  let i = logic.indexOf(swap.open, from);
  let depth = 0, quote = "";
  for (; i < logic.length; i++) {
    const ch = logic[i], prev = logic[i - 1];
    if (quote) { if (ch === quote && prev !== "\\") quote = ""; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  // Consume the statement tail. Aurora's is an IIFE, so after the closing brace
  // come the call parens `)()` before the semicolon; Carbon's is a plain object
  // literal and ends at `;`.
  let end = i + 1;
  while (end < logic.length && /[()\s;]/.test(logic[end])) end++;

  return {
    logic: logic.slice(0, from) + swap.replacement + logic.slice(end),
    swapped: true,
  };
}


/**
 * Copy that stops being true once the real registry is supplied.
 *
 * The designs describe their own data honestly — "representative", "prototype
 * catalogue", an owner-declared 221 they could not verify. With the real
 * 219-tool registry loaded those sentences are no longer accurate, and leaving
 * them would be its own kind of misstatement. Anything asserting a *count*
 * stays derived from the registry at runtime; only the descriptions change.
 */
const COPY_REWRITES = [
  [/representative records shown/g, "tools shown"],
  [/representative prototype catalogue/g, "PrivaTools registry"],
  [/built-in representative fallback dataset/g, "PrivaTools registry"],
  [/an owner-declared 107 PDF tools/g, "the PDF tools in the registry"],
  [/the real 221-entry catalogue \(107 PDF, 114 non-PDF\)/g, "the real catalogue"],
  [/Representative records are marked unverified\./g, "Modes come from the registry."],
  // Carbon describes its own sample data at length. With the registry supplied
  // these read as false modesty rather than honesty.
  [/prototype records loaded — not the launch catalogue/g, "tools in the catalogue"],
  [/prototype records indexed/g, "tools indexed"],
  [/prototype records are loaded and every count/g, "tools are loaded and every count"],
  [/\bprototype records\b/g, "tools"],
  [/Prototype catalogue · /g, "Catalogue · "],
  [/records actually supplied \(/g, "tools in the registry ("],
  [/The planned catalogue is /g, "The catalogue holds "],
  // This one directly contradicted the rendered Mode column once real modes
  // arrived: it claimed every record reads "Unverified" while the table showed
  // Server. `clientOnly` in the registry is the source, so say that.
  [/Processing mode is a privacy claim, so every record reads “Unverified” until real implementation metadata is supplied — no record is labelled Local, Fallback or Server to fill the interface\./g,
   "Processing mode is a privacy claim, so it comes from the registry rather than being assigned to fill the interface: tools that run in your browser read Local, the rest read Server."],
];

function rewriteCopy(logic) {
  let out = logic, changed = 0;
  for (const [pattern, replacement] of COPY_REWRITES) {
    const next = out.replace(pattern, replacement);
    if (next !== out) changed++;
    out = next;
  }
  return { logic: out, changed };
}


/**
 * Makes the designs' inline record lookups total.
 *
 * Alongside their lookup *methods*, the designs also do
 * `TOOLS.filter(x => x.slug === sl)[0]` inline and read fields straight off the
 * result. With their own sample data every slug resolved; against the real
 * registry a stale one yields undefined and the next property read takes the
 * app down. A subclass cannot reach these — they are module-level — so the
 * fallback is added here.
 */
function makeLookupsTotal(logic) {
  const FALLBACK =
    " || { slug: sl, name: sl, desc: '', description: '', family: 'PDF', fam: 'PDF', " +
    "subfamily: '', tasks: [], runs: 'server', mode: 'server', icon: 'help' }";
  let count = 0;
  const out = logic.replace(
    /((?:TOOLS|RIVALS|POSTS)\.filter\(function\s*\(\w+\)\s*\{\s*return\s+\w+\.slug\s*===\s*\w+;\s*\}\)\[0\])/g,
    (match) => { count++; return `(${match}${FALLBACK})`; },
  );
  return { logic: out, count };
}

/**
 * Lets a saved theme preference outrank the design's own default prop.
 *
 * `Component.defaultProps` carries a `theme` from the .dc.html props schema —
 * a preview default, meaningful only when the visitor has never chosen. The
 * design's init reads it first:
 *
 *     if (p.theme) this.applyTheme(p.theme, true);
 *     else if (saved) this.applyTheme(saved, true);
 *
 * Since the prop always has a value, the `saved` branch is dead, and
 * `applyTheme` then writes the prop back over the stored choice. A visitor who
 * switched to light got dark again on every reload, permanently. Swapping the
 * order restores the intended precedence: the person's own choice, then the
 * design's default, then the hard-coded fallback.
 */
function honourSavedTheme(logic) {
  let count = 0;
  const out = logic.replace(
    /if \(p\.theme\) (this\.applyTheme\(p\.theme, true\);)\s*\n(\s*)else if \(saved\) (this\.applyTheme\(saved, true\);)/g,
    (_m, applyProp, indent, applySaved) => {
      count++;
      return `if (saved) ${applySaved}\n${indent}else if (p.theme) ${applyProp}`;
    },
  );

  // Structured has the same bug in a different shape. componentDidMount runs
  // `this.load()`, whose restore path calls applyTheme with the stored value —
  // and then unconditionally re-applies the default on the next line:
  //
  //     this.applyTheme(this.state.theme || this.props.initialTheme || 'dark');
  //
  // setState has not flushed yet, so `this.state.theme` is still the initial
  // 'dark', which clobbers the restore *and* gets persisted back over the
  // person's choice. Guarding on the attribute defers to whoever already set
  // it — the restore, or index.html's pre-paint script — and still applies the
  // default when nothing has.
  const out2 = out.replace(
    /(\n(\s*))this\.applyTheme\(this\.state\.theme \|\| this\.props\.initialTheme \|\| 'dark'\);/,
    (_m, lead) => {
      count++;
      return `${lead}if (!document.documentElement.getAttribute('data-theme')) this.applyTheme(this.state.theme || this.props.initialTheme || 'dark');`;
    },
  );
  // Structured applies the theme but never writes it down. Its store is saved
  // by a 140ms tick that diffs a signature of the state, and the theme change
  // never reached that path — a person could pick Light, watch it apply, and
  // find it gone on the next load. Persist on the spot instead, from the
  // setState callback so `save()` reads the new value rather than the old one.
  const out3 = out2.replace(
    /(applyTheme\(t\) \{[\s\S]{0,400}?)this\.setState\(\{ theme: t \}\);/,
    (_m, head) => {
      count++;
      return `${head}var self = this;\n    this.setState({ theme: t }, function () { self.save(); });`;
    },
  );
  return { logic: out3, count };
}

/**
 * Lets the label on the accent button follow the theme.
 *
 * Both designs hard-code a near-black label on their accent fill —
 * `background:var(--em);color:#03120C`. That was right in the dark palette,
 * where --em is a bright mint. Once --em is darkened enough for its *other*
 * role (body text on a light surface, which needs 4.5:1), the dark label lands
 * at 3.67:1 on its own button. No single green satisfies both roles — text on
 * a light ground wants dark, a dark label on a fill wants light — so the label
 * is what has to move.
 *
 * `--em-ink` is defined only in the light block (see extract-native-css.mjs);
 * dark mode falls through to the literal the design already shipped, so the
 * original stays byte-identical there.
 */
const ACCENT_INK = {
  // Aurora uses two near-identical near-blacks; the extension markup spliced in
  // above reaches for the second one, so both have to be covered.
  aurora: ["#03120C", "#04120C"],
  structured: ["#04231A"],
};

/**
 * The same substitution for colours the logic computes rather than the markup
 * declaring. Aurora picks the run-button foreground and its switch knobs with
 * ternaries — `running ? 'var(--text2)' : '#03120C'` — so the literal never
 * appears next to a `color:` for the markup pass to find. Every one of these
 * is the ink that sits on the accent fill, which is the role --em-ink names.
 */
function adaptAccentInkLogic(id, logic) {
  const literals = ACCENT_INK[id];
  if (!literals) return { logic, count: 0 };
  let count = 0;
  let out = logic;
  for (const literal of literals) {
    out = out.replace(new RegExp(`'${literal}'`, "gi"), () => {
      count++;
      return `'var(--em-ink,${literal})'`;
    });
  }
  return { logic: out, count };
}


/**
 * Literal strings in the designs' markup that became wrong once real behaviour
 * arrived, turned into bindings so the app can decide the wording.
 *
 * Same reasoning as COPY_REWRITES, one layer down: these live in the JSX, not
 * the logic, and hand-editing SkinApp.tsx does not survive a regeneration.
 *
 * - "Recovery code" is now sometimes an emailed verification code, because
 *   Clerk verifies at sign-up and the input is reused rather than duplicated.
 * - "At least 10 characters" is whatever the backing store enforces; Clerk's
 *   floor is higher, and a form that promises less gets refused server-side.
 */
const LABEL_BINDINGS = [
  // Anchored to <label> on purpose. A bare />Recovery code/ also matches the
  // heading of the panel that *displays* a freshly issued code, which is a
  // different string with a different meaning. It happens to render correctly
  // either way today — Clerk never issues one, so that panel never opens — but
  // that is a coincidence, and coincidences stop being true.
  [/(<label[^>]*>)Recovery code\b/g, "$1{v.acctCodeLabel}"],
  [/At least 10 characters\. Length is what makes a password strong\./g,
   "{v.acctPasswordHint}"],
];

function bindLabels(jsx) {
  let out = jsx, changed = 0;
  for (const [pattern, replacement] of LABEL_BINDINGS) {
    const next = out.replace(pattern, replacement);
    if (next !== out) changed++;
    out = next;
  }
  return { jsx: out, changed };
}

function adaptAccentInk(id, jsx) {
  const literals = ACCENT_INK[id];
  if (!literals) return { jsx, count: 0 };
  let count = 0;
  let out = jsx;
  for (const literal of literals) {
    // `background:` as well as `color:` — the showcase's switch knob is the
    // same ink, drawn as a dot on the accent track rather than as a label.
    out = out.replace(new RegExp(`(color|background):${literal}\\b`, "gi"), (_m, prop) => {
      count++;
      return `${prop}:var(--em-ink,${literal})`;
    });
  }
  return { jsx: out, count };
}

/**
 * Hue-preserving contrast corrections for a design that keeps its palette in
 * JavaScript rather than CSS.
 *
 * Carbon carries `{ dark: {...}, light: {...} }` in the logic, so neither
 * skin-palettes.mjs (shared tokens) nor extract-native-css.mjs (the designs'
 * own CSS) ever saw it, and its light palette shipped secondary text at
 * 3.21:1 and a white button label at 3.37:1 on the aqua fill. Its dark
 * palette was already clear and is left untouched.
 *
 * Corrections are keyed by token so the two roles can move apart: `aqua` is a
 * fill measured against its white label, while `linkH` is text measured
 * against the darkest surface — both started at #0F9C97 and land on different
 * values. Each target is 4.5:1 against the worst case it actually faces.
 */
const PALETTE_FIXES = {
  carbon: {
    // measured against the darkest light surface, bg3 #E9EFEE
    txt3:    ["#77878C", "#606E72"],   // 3.21:1 -> 4.55:1
    aquaTxt: ["#0B7C79", "#0B7875"],   // 4.32:1 -> 4.55:1
    teal:    ["#0F8A80", "#0D7970"],   // 3.63:1 -> 4.55:1
    ok:      ["#0F8A80", "#0D7970"],   // 3.63:1 -> 4.55:1
    amber:   ["#9A6510", "#94610F"],   // 4.25:1 -> 4.55:1
    link:    ["#0B7C79", "#0B7875"],   // 4.32:1 -> 4.56:1
    linkH:   ["#0F9C97", "#0C7874"],   // 3.21:1 -> 4.55:1  (hover text)
    // measured against its own white label, not against a surface
    aqua:    ["#0F9C97", "#0D8480"],   // 3.37:1 -> 4.54:1
  },
};

/** Rewrites the light palette only; the dark block reuses none of these hexes. */
function correctSkinPalette(id, logic) {
  const fixes = PALETTE_FIXES[id];
  if (!fixes) return { logic, applied: [] };
  const open = logic.indexOf("light: {");
  if (open === -1) return { logic, applied: [] };
  const close = logic.indexOf("\n  }", open);
  if (close === -1) return { logic, applied: [] };

  let block = logic.slice(open, close);
  const applied = [];
  for (const [key, [from, to]] of Object.entries(fixes)) {
    const re = new RegExp(`(\\b${key}\\s*:\\s*')${from}(')`, "i");
    if (!re.test(block)) continue;
    block = block.replace(re, `$1${to}$2`);
    applied.push(`${key} ${from}->${to}`);
  }
  return { logic: logic.slice(0, open) + block + logic.slice(close), applied };
}

const INTERACTIONS_CSS = resolve(HERE, "../src/styles/skin-interactions.css");

/**
 * Rewrites one skin's section of the shared interaction stylesheet, leaving
 * the other skins' sections alone — the build runs one skin at a time, and
 * regenerating Aurora must not blank Carbon's hover rules.
 */
function writeInteractionSection(id, css) {
  const head = "/* AUTO-GENERATED by scripts/build-skin-app.mjs — do not edit by hand.\n" +
    " *\n" +
    " * The imported designs declare their interaction states as attributes\n" +
    " * (style-hover, style-active, style-focus) which their own runtime applies.\n" +
    " * React drops unknown attributes, so those states were silently lost in the\n" +
    " * port. The converter turns each one into a generated class and the rule\n" +
    " * below, scoped to its skin.\n" +
    " */\n";
  const begin = (x) => `/* >>> ${x} */`;
  const end = (x) => `/* <<< ${x} */`;
  let existing = "";
  try { existing = readFileSync(INTERACTIONS_CSS, "utf8"); } catch { existing = head; }
  if (!existing.startsWith("/* AUTO-GENERATED")) existing = head + existing;
  const section = `${begin(id)}\n${css}\n${end(id)}`;
  const re = new RegExp(`${begin(id).replace(/[*/]/g, "\\$&")}[\\s\\S]*?${end(id).replace(/[*/]/g, "\\$&")}`);
  const next = re.test(existing) ? existing.replace(re, section) : `${existing.trimEnd()}\n\n${section}\n`;
  writeFileSync(INTERACTIONS_CSS, next.endsWith("\n") ? next : next + "\n");
}

/** Design-preview knobs whose defaults paint over a token the theme owns. */
const THEME_OVERRIDING_PROPS = { structured: ["accent"] };

function build(id) {
  const { label } = SKINS[id];
  const file = `${DESIGNS}/${id}.dc.html`;
  const src = readFileSync(file, "utf8");

  // ── logic ──────────────────────────────────────────────────────────────
  const scripts = [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let logic = scripts.reduce((a, b) => (b.length > a.length ? b : a), "");
  if (!/class Component/.test(logic)) throw new Error(`${id}: no Component class found`);
  logic = logic.replace(/class\s+Component\s+extends\s+(DCLogic|StreamableLogic)/,
                        "class Component extends React.Component");

  const swap = swapRegistry(id, logic);
  logic = swap.logic;
  if (swap.swapped) console.log(`  registry: sample catalogue replaced with the real one`);

  const copy = rewriteCopy(logic);
  logic = copy.logic;
  if (copy.changed) console.log(`  copy: ${copy.changed} sample-data phrase(s) corrected`);

  const lookups = makeLookupsTotal(logic);
  logic = lookups.logic;
  if (lookups.count) console.log(`  lookups: ${lookups.count} inline record lookup(s) made total`);

  const themePref = honourSavedTheme(logic);
  logic = themePref.logic;
  if (themePref.count) console.log(`  theme: saved preference now outranks the design's default prop`);

  const inkLogic = adaptAccentInkLogic(id, logic);
  logic = inkLogic.logic;
  if (inkLogic.count) console.log(`  accent ink: ${inkLogic.count} computed colour(s) now follow the theme`);

  const palette = correctSkinPalette(id, logic);
  logic = palette.logic;
  if (palette.applied.length) console.log(`  palette: light contrast -> ${palette.applied.join(", ")}`);

  // ── markup ─────────────────────────────────────────────────────────────
  // The <helmet> block opens before </style> and closes after it, so slicing
  // on </style> alone leaves an orphan closing tag that JSX rejects.
  let body = src.split("</style>")[1];
  const helmetEnd = body.indexOf("</helmet>");
  if (helmetEnd !== -1) body = body.slice(helmetEnd + "</helmet>".length);
  const end = body.indexOf('<script type="text/x-dc"');
  let markup = end === -1 ? body : body.slice(0, end);

  // ── extension seam ──────────────────────────────────────────────────────
  // Features this app has that the imported design never had a surface for —
  // accounts, API keys, BYOK, translate, signatures. They cannot be hand-edited
  // into the generated component: the next regeneration would erase them. So
  // they live in src/skins/extensions/<id>.html, written in the design's own
  // dialect, and are spliced in here among the design's own route blocks.
  //
  // The matching src/skins/extensions/<id>.tsx subclasses the generated
  // component and supplies the bindings this markup reads.
  const extensionFile = resolve(HERE, `../src/skins/extensions/${id}.html`);
  if (existsSync(extensionFile)) {
    const extra = readFileSync(extensionFile, "utf8");
    // Insert after the design's last route block rather than at the end of
    // <main>: Structured closes with a <footer>, and appending there would put
    // our routes below it.
    const mainClose = markup.lastIndexOf("</main>");
    const lastRoute = markup.lastIndexOf("</sc-if>", mainClose === -1 ? undefined : mainClose);
    const at = lastRoute === -1 ? (mainClose === -1 ? markup.length : mainClose) : lastRoute + "</sc-if>".length;
    markup = markup.slice(0, at) + "\n" + extra + "\n" + markup.slice(at);
    console.log(`  extensions: spliced ${extra.length.toLocaleString()} chars`);
  }
  // <x-dc> (and <body>/<html>) wrap the whole document and open above this
  // slice, so their closing tags arrive orphaned. JSX has no tolerance for
  // those; HTML parsers simply ignore them.
  markup = markup.replace(/<\/(x-dc|helmet|body|html)\s*>/g, "");
  writeFileSync(`/tmp/skinport-${id}.html`, markup, "utf8");
  // Each design marks icon elements its own way. Rather than hardcode three
  // spellings, read the design's own stylesheet for whatever selector it binds
  // to a Material Symbols face, and match on that plus the inline form.
  const styleBlock = (src.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
  const iconClasses = [...styleBlock.matchAll(/\.([\w-]+)\s*\{[^}]*?font-family\s*:\s*["']?Material Symbols/gi)]
    .map((m) => m[1]);
  const iconRe = ["material[\\s-]symbols", ...iconClasses.map((c) => `class="[^"]*\\b${c}\\b`)].join("|");
  console.log(`  icon marker: /${iconRe}/i`);

  let jsx = execFileSync("node", [resolve(HERE, "dc-to-jsx-file.mjs"), `/tmp/skinport-${id}.html`, iconRe, id], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });

  // The designs' hover/active/focus attributes come back as real CSS rules.
  let interactionCss = "";
  const cssAt = jsx.indexOf("\n/*__DC_INTERACTION_CSS__*/\n");
  if (cssAt !== -1) {
    interactionCss = jsx.slice(cssAt + "\n/*__DC_INTERACTION_CSS__*/\n".length).trim();
    jsx = jsx.slice(0, cssAt);
  }
  if (interactionCss) {
    const rules = interactionCss.split("\n").length;
    writeInteractionSection(id, interactionCss);
    console.log(`  interactions: ${rules} hover/active/focus rule(s) recovered as CSS`);
  }

  const ink = adaptAccentInk(id, jsx);
  jsx = ink.jsx;
  if (ink.count) console.log(`  accent ink: ${ink.count} button label(s) now follow the theme`);

  const labels = bindLabels(jsx);
  jsx = labels.jsx;
  if (labels.changed) console.log(`  labels: ${labels.changed} hardcoded label(s) bound to app state`);

  // Each design declares its props with defaults in the runtime's data-props
  // blob. Those defaults are part of the design (opening route, motion level,
  // service state), so they are carried across as React defaultProps.
  const propsRaw = (src.match(/data-props="([^"]*)"/) || [, "{}"])[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  let defaults = {};
  try {
    const schema = JSON.parse(propsRaw);
    for (const [k, v] of Object.entries(schema)) {
      if (k.startsWith("$")) continue;
      if (v && typeof v === "object" && "default" in v) defaults[k] = v.default;
    }
  } catch { defaults = {}; }

  // Props that paint over a themed token must not carry a default. Structured's
  // schema defaults `accent` to #20D497 — its dark-mode mint — and syncProps
  // writes it to an inline `--em` on <html> on every render. That inline value
  // outranks both palettes, so light mode rendered its accent in the dark
  // theme's colour at 1.83:1. Blanked here rather than removed, so a caller
  // that genuinely wants a custom accent still gets one.
  for (const knob of THEME_OVERRIDING_PROPS[id] || []) {
    if (defaults[knob] === undefined) continue;
    console.log(`  props: cleared ${knob}="${defaults[knob]}" — it overrode the themed token`);
    defaults[knob] = "";
  }
  console.log(`  props: ${JSON.stringify(defaults)}`);

  const out = `/* AUTO-GENERATED by scripts/build-skin-app.mjs — do not edit by hand.
 *
 * ${label}, ported from its Claude Design project.
 *
 * The logic below is the design's own component class, unchanged except for
 * its base (DCLogic -> React.Component, which have the same setState and
 * lifecycle contract). The markup is its own markup with its own inline
 * styles, mechanically converted to JSX. Both are kept verbatim so the result
 * matches the source design rather than approximating it.
 *
 * Regenerate:  node scripts/build-skin-app.mjs ${id}
 */
/* eslint-disable */
// @ts-nocheck
import React from "react";
import { css } from "@/lib/skin/css";
import { skinIcon } from "@/lib/skin/icons";
import { AURORA_CATALOGUE, CARBON_REGISTRY } from "@/skins/catalogue";

/** Icon lookup by Material Symbols name, resolved to this skin's font. */
const ICON = new Proxy({}, { get: (_t, name) => skinIcon("${id}", String(name)) });

${logic.trim()}

/** Bridges the design's renderVals() contract to React's render(). */
Component.prototype.render = function render() {
  const v = Object.assign({}, this.props, this.renderVals());
  return (
    <>
${jsx.split("\n").map((l) => (l.trim() ? "      " + l : l)).join("\n")}
    </>
  );
};

/** The design's own prop defaults, from its data-props schema. */
Component.defaultProps = ${JSON.stringify(defaults, null, 2)};

export default Component;
`;

  const dest = resolve(HERE, `../src/skins/${id}`);
  mkdirSync(dest, { recursive: true });
  writeFileSync(resolve(dest, "SkinApp.tsx"), out, "utf8");
  console.log(`${id}: logic ${logic.length.toLocaleString()} + jsx ${jsx.length.toLocaleString()} -> src/skins/${id}/SkinApp.tsx`);
}

const only = process.argv[2];
for (const id of Object.keys(SKINS)) if (!only || only === id) build(id);

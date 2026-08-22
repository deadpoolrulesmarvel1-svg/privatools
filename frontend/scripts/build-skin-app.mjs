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

  const jsx = execFileSync("node", [resolve(HERE, "dc-to-jsx-file.mjs"), `/tmp/skinport-${id}.html`, iconRe], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });

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

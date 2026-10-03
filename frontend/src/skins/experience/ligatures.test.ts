import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postcss, { type Declaration, type Node } from "postcss";
import { afterEach, describe, expect, it } from "vitest";

/*
 * Manrope, Air's text face, draws "--", "->" and "<-" as a single dash or
 * arrow through its standard ligatures (OpenType `liga`, read from
 * public/fonts/skins/manrope-400-ed60e9e8.*.woff2 with fontTools), so a guide
 * answer's "<!-- page 3 -->" read "<!– page 3 –>" and SQL Formatter's "--
 * line comments" lost a hyphen. Its contextual alternates (`calt`) only raise
 * punctuation between capitals and stay on. Play's Outfit has no such
 * ligature. jsdom draws no text, so these tests read every stylesheet and
 * work out which declaration reaches an element; the browser check compares
 * the pixels.
 *
 * The `font` shorthand resets font-variant-ligatures to normal, so it counts
 * as turning the ligatures back on: shorthands that outranked Air's rule gave
 * the line under every tool's name, the search box's key hint and the intake
 * title their ligatures back. The winner is chosen as the browser chooses it:
 * by specificity, then by order within a stylesheet. Tailwind puts the rules
 * of index.css's @layer blocks first in the built stylesheet, so they lose
 * ties. Other stylesheets that tie with different values fail the test,
 * because the order the bundle loads them in is nothing to rely on.
 */
const SRC = resolve(__dirname, "../..");
const sheets = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter(file => file.endsWith(".css"))
  .map(file => ({ file, root: postcss.parse(readFileSync(join(SRC, file), "utf8")) }));

type Specificity = [number, number, number];

interface Setting {
  file: string;
  selector: string;
  specificity: Specificity;
  layered: boolean;
  order: number;
  value: string;
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** A selector list split at its top-level commas. */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "\\") { i++; continue; }
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) { parts.push(list.slice(start, i)); start = i + 1; }
  }
  return [...parts, list.slice(start)].map(part => part.trim()).filter(Boolean);
}

/** The index of the bracket that closes the one at `open`. */
function closing(text: string, open: number): number {
  let depth = 0, quote = "";
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { i++; continue; }
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") { depth--; if (depth === 0) return i; }
  }
  throw new Error(`unbalanced: ${text}`);
}

const IDENT = /^(?:[-\w\u00a0-\uffff]|\\.)+/;
const LEGACY_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/**
 * Selectors Level 4 specificity of one selector: :where() adds nothing, and
 * :is(), :not() and :has() add their most specific argument. It agrees with
 * @bramus/specificity on every selector in these stylesheets.
 */
function specificity(selector: string): Specificity {
  const total: Specificity = [0, 0, 0];
  const add = (s: Specificity) => s.forEach((n, i) => { total[i] += n; });
  const highest = (list: string) => splitList(list).map(specificity).reduce<Specificity>((a, b) => (compare(a, b) >= 0 ? a : b), [0, 0, 0]);
  let rest = selector.trim();
  while (rest) {
    const ch = rest[0];
    let match: RegExpMatchArray | null;
    if (/[\s>+~*]/.test(ch)) { rest = rest.slice(1); continue; }
    if (ch === "#" && (match = rest.slice(1).match(IDENT))) { total[0]++; rest = rest.slice(1 + match[0].length); continue; }
    if (ch === "." && (match = rest.slice(1).match(IDENT))) { total[1]++; rest = rest.slice(1 + match[0].length); continue; }
    if (ch === "[") { total[1]++; rest = rest.slice(closing(rest, 0) + 1); continue; }
    if (ch === ":") {
      const element = rest[1] === ":";
      match = rest.slice(element ? 2 : 1).match(IDENT);
      if (!match) throw new Error(`cannot read ${selector}`);
      const name = match[0].toLowerCase();
      rest = rest.slice((element ? 2 : 1) + match[0].length);
      let argument = "";
      if (rest[0] === "(") { const end = closing(rest, 0); argument = rest.slice(1, end); rest = rest.slice(end + 1); }
      if (element || LEGACY_ELEMENTS.has(name)) total[2]++;
      else if (name === "where") continue;
      else if (["is", "not", "has", "matches", "-webkit-any", "-moz-any"].includes(name)) add(highest(argument));
      else if (/^nth-(last-)?child$/.test(name) && /\sof\s/i.test(argument)) { total[1]++; add(highest(argument.split(/\sof\s/i)[1])); }
      else total[1]++;
      continue;
    }
    if ((match = rest.match(IDENT))) { total[2]++; rest = rest.slice(match[0].length); continue; }
    throw new Error(`cannot read ${selector}`);
  }
  return total;
}

/** What a declaration does to font-variant-ligatures, if anything. */
function ligatureValue(decl: Declaration): string | undefined {
  const value = decl.value.trim().toLowerCase();
  if (decl.prop === "font-variant-ligatures") return value === "unset" ? "inherit" : value === "initial" ? "normal" : value;
  // The shorthand resets every font property it does not name.
  if (decl.prop === "font") return value === "inherit" || value === "unset" ? "inherit" : "normal";
  return undefined;
}

function insideLayer(node: Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule" && (parent as postcss.AtRule).name === "layer") return true;
  }
  return false;
}

/**
 * Whether a later declaration in the same block sets the ligatures again, so
 * that this one never decides them: a `font` shorthand followed by
 * `font-variant-ligatures: none` leaves them off.
 */
function overriddenInItsBlock(decl: Declaration): boolean {
  const block = decl.parent?.nodes ?? [];
  return block.slice(block.indexOf(decl) + 1).some(node =>
    node.type === "decl" && ligatureValue(node) !== undefined && (node.important || !decl.important));
}

const settings: Setting[] = sheets.flatMap(({ file, root }) => {
  const found: Setting[] = [];
  root.walkDecls(decl => {
    const value = ligatureValue(decl);
    const rule = decl.parent;
    if (value === undefined || rule?.type !== "rule" || overriddenInItsBlock(decl)) return;
    for (const selector of (rule as postcss.Rule).selectors) {
      found.push({ file, selector, specificity: specificity(selector), layered: insideLayer(rule), order: decl.source?.start?.offset ?? 0, value });
    }
  });
  return found;
});

function matches(element: Element, selector: string): boolean {
  try { return element.matches(selector); } catch { return false; }
}

/** The declaration that reaches `element`, or undefined if none does. */
function winner(element: Element): Setting | undefined {
  const candidates = settings.filter(setting => matches(element, setting.selector));
  if (!candidates.length) return undefined;
  const rank = (setting: Setting) => [...setting.specificity, setting.layered ? 0 : 1];
  const top = candidates.reduce((a, b) => (compare(rank(a), rank(b)) >= 0 ? a : b));
  const lastInEachFile = new Map<string, Setting>();
  for (const setting of candidates.filter(candidate => compare(rank(candidate), rank(top)) === 0)) {
    const seen = lastInEachFile.get(setting.file);
    if (!seen || setting.order > seen.order) lastInEachFile.set(setting.file, setting);
  }
  const tied = [...lastInEachFile.values()];
  if (new Set(tied.map(setting => setting.value)).size > 1) {
    throw new Error(`<${element.tagName.toLowerCase()}> depends on the order stylesheets load: ${tied.map(s => `${s.file} ${s.selector}`).join(" vs ")}`);
  }
  return tied[0];
}

const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

/** The font-variant-ligatures `element` ends up with. */
function ligatures(element: Element): string {
  const setting = winner(element);
  if (setting && setting.value !== "inherit") return setting.value;
  // The browser's own stylesheet gives form fields a font, which resets them.
  if (!setting && FORM_FIELDS.has(element.tagName)) return "normal";
  return element.parentElement ? ligatures(element.parentElement) : "normal";
}

function mount(experience: "air" | "play"): void {
  document.documentElement.setAttribute("data-experience", experience);
  document.body.innerHTML = `<div class="dl-root consumer-app">
    <header><button class="pt-search-trigger">Search tools <kbd>Ctrl K</kbd></button></header>
    <main class="pt-main">
      <p class="tw-promise">Count tokens -- before you paste</p>
      <section class="ts-intake"><h2 class="ts-intake-title">Drop a file -> or two</h2></section>
      <section class="ts-options"><h3>Options -- page size</h3></section>
      <section class="ts-result"><h2>Done -- here it is</h2></section>
      <div class="pt-lab-output"><span>a -- b</span></div>
      <section class="ts-guide"><p>Use &lt;!-- page 3 --&gt; to mark a page.</p></section>
      <input value="a -- b"><textarea>-- a line comment</textarea><select><option>-&gt;</option></select><button>&lt;- back</button>
      <div class="ts-text-output"><textarea>-- output</textarea></div>
      <code>a -- b</code><kbd>--</kbd><samp>-&gt;</samp><pre>-- SQL</pre>
      <div class="pt-api-example"><pre>curl --data</pre></div>
    </main></div>`;
}

const TEXT = ["html", ".tw-promise", ".ts-intake-title", ".ts-options h3", ".ts-result h2", ".pt-lab-output span", ".ts-guide p"];
const FIELDS = ["input", "textarea", "select", "button", ".ts-text-output textarea"];
const CODE = ["code", "kbd", "samp", "pre", ".pt-search-trigger kbd", ".pt-api-example pre"];

afterEach(() => {
  document.documentElement.removeAttribute("data-experience");
  document.body.innerHTML = "";
});

describe("ligatures that change what a reader sees", () => {
  it("are off for Air's text, whatever font shorthand an element has", () => {
    mount("air");
    for (const selector of TEXT) expect(ligatures(document.querySelector(selector)!), selector).toBe("no-common-ligatures");
  });

  it("are off in Air's form fields, which take their font from the browser, not the page", () => {
    mount("air");
    for (const selector of FIELDS) expect(ligatures(document.querySelector(selector)!), selector).toBe("no-common-ligatures");
  });

  it("stay on in Play, whose Outfit joins only fi, fl and the like", () => {
    mount("play");
    for (const selector of [...TEXT, ...FIELDS]) expect(ligatures(document.querySelector(selector)!), selector).toBe("normal");
  });

  it("are all off in code, on every page", () => {
    for (const experience of ["air", "play"] as const) {
      mount(experience);
      for (const selector of CODE) expect(ligatures(document.querySelector(selector)!), `${experience} ${selector}`).toBe("none");
    }
  });

  it("are not turned back on by a font shorthand anywhere: none outranks the rules that turn them off", () => {
    const off = settings.filter(s => s.file.endsWith("experience.css") && /:where\((body \*|code,kbd,samp,pre)\)/.test(s.selector));
    expect(off.map(s => s.value).sort()).toEqual(["no-common-ligatures", "none"]);
    const floor = off.map(s => s.specificity).reduce((a, b) => (compare(a, b) <= 0 ? a : b));
    const outranking = settings
      .filter(s => s.value !== "inherit" && !s.value.startsWith("no-common-ligatures") && s.value !== "none")
      .filter(s => compare(s.specificity, floor) >= 0)
      .map(s => `${s.file}: ${s.selector} (${s.specificity.join(",")})`);
    expect(outranking, "write these as longhands (font-size, font-family...), which leave the ligatures alone").toEqual([]);
  });
});

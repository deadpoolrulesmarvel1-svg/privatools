/**
 * Converts a slice of a Claude Design `.dc.html` document into JSX.
 *
 *   node scripts/dc-to-jsx.mjs <design> <start-marker> [end-marker]
 *
 * The `.dc` dialect is small and regular, which is why porting mechanically
 * beats re-authoring: every pixel value lives in an inline `style` attribute,
 * and a hand-rewrite is precisely where fidelity is lost.
 *
 *   {{ expr }}                     ->  {expr}
 *   style="a:b;c:{{ x }}"          ->  style={css(`a:b;c:${x}`)}
 *   onClick="{{ fn }}"             ->  onClick={fn}
 *   class="x"                      ->  className="x"
 *   <sc-for list="{{ xs }}" as="n">->  {xs.map((n, i) => ( ... ))}
 *   style-focus="..."              ->  dropped (needs a real CSS rule)
 *
 * Output still needs its data wired by hand — the prototypes bind to their own
 * sample records, and this app has the real registry.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const DESIGNS = resolve(HERE, "../../design-sources");

const FILES = {
  aurora: `${DESIGNS}/aurora.dc.html`,
  structured: `${DESIGNS}/structured.dc.html`,
  carbon: `${DESIGNS}/carbon.dc.html`,
};

/**
 * Default icon-element matcher. Each design marks its icon spans differently —
 * Aurora with an inline font-family, Carbon with .material-symbols-rounded,
 * Structured with a bare .ms — and build-skin-app.mjs derives the right one per
 * design from that design's own stylesheet.
 */
const DEFAULT_ICON_RE = /material[\s-]symbols/i;

const VOID = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);

/**
 * Bindings resolve against the object renderVals() returns, which the port
 * exposes as `v`. Loop variables introduced by <sc-for as="n"> are real locals
 * and must be left alone, so scoping is tracked as a stack.
 */
const loopVars = [];
function scopeExpr(expr) {
  const e = expr.trim();
  return e.replace(/^([A-Za-z_$][\w$]*)/, (id) => (loopVars.includes(id) ? id : `v.${id}`));
}

/** `a:b;c:{{ x }}` -> a template literal body: "a:b;c:${v.x}" */
function interp(value) {
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => "${" + scopeExpr(e) + "}");
}
const hasBinding = (v) => /\{\{/.test(v);

function attrToJsx(name, value) {
  if (name === "style-focus" || name.startsWith("hint-")) return null;
  if (name === "class") name = "className";
  if (name === "for") name = "htmlFor";
  if (/^on[A-Z]/.test(name) || /^on[a-z]+$/.test(name)) {
    const ev = "on" + name.slice(2, 3).toUpperCase() + name.slice(3);
    const m = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    return `${ev}={${m ? scopeExpr(m[1]) : `() => {}`}}`;
  }
  if (name === "style") {
    return hasBinding(value)
      ? "style={css(`" + interp(value) + "`)}"
      : "style={css(" + JSON.stringify(value) + ")}";
  }
  const m = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (m) return `${name}={${scopeExpr(m[1])}}`;
  if (hasBinding(value)) return `${name}={\`${interp(value)}\`}`;
  return `${name}=${JSON.stringify(value)}`;
}

function parseAttrs(raw) {
  const out = [];
  const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)(?=[\s/>])/g;
  let m;
  while ((m = re.exec(raw))) {
    if (m[1] !== undefined) {
      const a = attrToJsx(m[1], m[2]);
      if (a) out.push(a);
    } else if (m[3]) {
      out.push(`${m[3]}={true}`);
    }
  }
  return out;
}

export function convert(html, iconRe = DEFAULT_ICON_RE) {
  const tok = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*"|\s+[\w:-]+)*)\s*(\/?)>/g;
  let out = "", last = 0, m;
  const stack = [];
  const indent = () => "  ".repeat(stack.length);
  // The designs render icons as Material Symbols ligature text ("shield").
  // Shipping that means shipping the whole icon font, so the text content of
  // an icon span is rewritten to a codepoint lookup instead.
  let iconDepth = -1;
  const inIcon = () => iconDepth >= 0 && stack.length > iconDepth;

  const text = (s) => {
    if (inIcon()) {
      const t = s.trim();
      if (!t) return "";
      const b = t.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
      return b ? `{ICON[${scopeExpr(b[1])}]}` : `{ICON.${t}}`;
    }
    if (!s.trim()) return s.includes("\n") ? "\n" : "";
    return s
      .replace(/\{/g, "&#123;").replace(/\}/g, "&#125;")           // literal braces
      .replace(/&#123;&#123;\s*([^&]+?)\s*&#125;&#125;/g, (_, e) => `{${scopeExpr(e)}}`); // restore bindings
  };

  while ((m = tok.exec(html))) {
    out += text(html.slice(last, m.index));
    last = tok.lastIndex;
    if (m[0].startsWith("<!--")) continue;

    if (m[1]) {                                   // closing tag
      if (m[1] === "sc-for") { stack.pop(); loopVars.pop(); out += `\n${indent()}))}`; continue; }
      if (m[1] === "sc-if")  { stack.pop(); out += `\n${indent()}</>)}`; continue; }
      stack.pop();
      if (iconDepth >= 0 && stack.length <= iconDepth) iconDepth = -1;
      out += `</${m[1]}>`;
      continue;
    }

    const tag = m[2], attrs = m[3] || "", selfClose = m[4] === "/";

    if (tag === "sc-if") {
      const v = attrs.match(/value\s*=\s*"\{\{\s*([^}]+?)\s*\}\}"/);
      out += `\n${indent()}{Boolean(${v ? scopeExpr(v[1]) : "false"}) && (<>\n`;
      stack.push("sc-if");
      out += indent();
      continue;
    }

    if (tag === "sc-for") {
      const list = attrs.match(/list\s*=\s*"\{\{\s*([^}]+?)\s*\}\}"/);
      const as = attrs.match(/as\s*=\s*"([^"]+)"/);
      const v = as ? as[1] : "item";
      out += `\n${indent()}{(${list ? scopeExpr(list[1]) : "[]"} ?? []).map((${v}, ${v}I) => (\n`;
      loopVars.push(v);
      stack.push("sc-for");
      out += indent();
      continue;
    }

    const jsxAttrs = parseAttrs(attrs);
    const attrStr = jsxAttrs.length ? " " + jsxAttrs.join(" ") : "";

    if (selfClose || VOID.has(tag)) { out += `<${tag}${attrStr} />`; continue; }
    // Aurora names the face inline (font-family:'Material Symbols Rounded');
    // Carbon and Structured use a class (material-symbols-rounded /
    // -outlined). Both spellings have to count, or the icon name renders as
    // literal text — "home", "account_tree" — right there in the nav.
    if (iconDepth < 0 && iconRe.test(attrs)) iconDepth = stack.length;
    stack.push(tag);
    out += `<${tag}${attrStr}>`;
  }
  out += text(html.slice(last));
  return out;
}

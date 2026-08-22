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

export /**
 * HTML/SVG attribute names React expects in camelCase.
 *
 * Only `class` and `for` were mapped, so every hyphenated SVG presentation
 * attribute reached React as an unknown prop and was dropped — the ported
 * icons rendered at the UA default stroke instead of the design's, and
 * `readonly` inputs were quietly editable. `data-*` and `aria-*` are correct
 * hyphenated and must not be touched.
 */
const ATTR_MAP = {
  class: "className", for: "htmlFor",
  readonly: "readOnly", maxlength: "maxLength", minlength: "minLength",
  tabindex: "tabIndex", autocomplete: "autoComplete", autofocus: "autoFocus",
  spellcheck: "spellCheck", contenteditable: "contentEditable",
  colspan: "colSpan", rowspan: "rowSpan", srcset: "srcSet",
  crossorigin: "crossOrigin", novalidate: "noValidate", enctype: "encType",
  inputmode: "inputMode", datetime: "dateTime", usemap: "useMap",
  "accept-charset": "acceptCharset", "http-equiv": "httpEquiv",
  // SVG presentation attributes
  "stroke-width": "strokeWidth", "stroke-linejoin": "strokeLinejoin",
  "stroke-linecap": "strokeLinecap", "stroke-miterlimit": "strokeMiterlimit",
  "stroke-dasharray": "strokeDasharray", "stroke-dashoffset": "strokeDashoffset",
  "stroke-opacity": "strokeOpacity", "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity", "clip-rule": "clipRule", "clip-path": "clipPath",
  "stop-color": "stopColor", "stop-opacity": "stopOpacity",
  "text-anchor": "textAnchor", "dominant-baseline": "dominantBaseline",
  "vector-effect": "vectorEffect", "shape-rendering": "shapeRendering",
  "paint-order": "paintOrder", "mix-blend-mode": "mixBlendMode",
  "font-size": "fontSize", "font-family": "fontFamily",
  "font-weight": "fontWeight", "letter-spacing": "letterSpacing",
};

/**
 * The designs express interaction states as attributes — `style-hover`,
 * `style-active`, `style-focus` — which their own runtime applies. React has
 * no such concept, so these were reaching the DOM as unknown props and being
 * dropped: 59 elements across the three ports had no hover or press feedback
 * at all, and the focus styles were discarded outright.
 *
 * None of the values carry bindings and no element that has one also has a
 * `class`, so each becomes a generated class plus a real CSS rule.
 */
const INTERACTION = {
  "style-hover": ":hover",
  "style-active": ":active",
  "style-focus": ":focus-visible",
};
let interactionRules = [];
let interactionSeq = 0;

/**
 * The collected rules, scoped to one skin. Call after convert().
 *
 * Every declaration is marked !important. The designs carry their base styles
 * in a `style` attribute, and an inline declaration outranks any stylesheet
 * rule no matter how specific — without this the hover rules parse, match, and
 * lose to the element's own inline border/background.
 */
export function interactionCss(prefix) {
  const important = (css) => css
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (/!important$/.test(d) ? d : `${d} !important`))
    .join(";");
  return interactionRules
    .map(({ cls, pseudo, css }) => `[data-skin="${prefix}"] .${cls}${pseudo}{${important(css)}}`)
    .join("\n");
}

function attrToJsx(name, value) {
  if (name.startsWith("hint-")) return null;
  if (Object.prototype.hasOwnProperty.call(ATTR_MAP, name)) name = ATTR_MAP[name];
  else if (name.includes("-") && !/^(data|aria)-/.test(name)) {
    // Surface anything hyphenated that is not a namespaced attribute, rather
    // than letting React drop it silently the way stroke-width was dropped.
    console.warn(`  unmapped hyphenated attribute: ${name}`);
  }
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
  const interactions = [];
  const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)(?=[\s/>])/g;
  let m;
  while ((m = re.exec(raw))) {
    if (m[1] !== undefined) {
      if (INTERACTION[m[1]]) { interactions.push([INTERACTION[m[1]], m[2]]); continue; }
      const a = attrToJsx(m[1], m[2]);
      if (a) out.push(a);
    } else if (m[3]) {
      out.push(`${m[3]}={true}`);
    }
  }
  if (interactions.length) {
    const cls = `dc-i${++interactionSeq}`;
    for (const [pseudo, css] of interactions) interactionRules.push({ cls, pseudo, css });
    out.push(`className=${JSON.stringify(cls)}`);
  }
  return out;
}

export function convert(html, iconRe = DEFAULT_ICON_RE) {
  interactionRules = [];
  interactionSeq = 0;
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

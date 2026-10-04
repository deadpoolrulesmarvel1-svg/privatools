/**
 * LaTeX to Word equations (OMML), for Markdown to Word.
 *
 * Temml turns the LaTeX into MathML; this module maps that MathML onto
 * Office Math for a defined subset: fractions and binomials, sub- and
 * superscripts, square and n-th roots, letters, symbols and operators, big
 * operators with their limits (sums, products, integrals, unions), accents,
 * over- and underlines, braces with labels, stretchy delimiters, matrices,
 * cases, aligned and gathered lines, text, colour, boxes and cancels, and
 * spacing. Anything outside it raises `Unsupported`, and the caller keeps the
 * LaTeX as text instead: a missing equation is better than a wrong one.
 *
 * The OMML is built as a small tree and written out at the end, so runs can
 * carry an alignment mark wherever they land.
 */

export class Unsupported extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "Unsupported";
    }
}

// ── MathML, as Temml writes it ────────────────────────────────────────────────

export interface MathNode {
    name: string;
    attrs: Record<string, string>;
    children: (MathNode | string)[];
}

const XML_ENTITY = /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeXml(text: string): string {
    return text.replace(XML_ENTITY, (_whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
        if (name) return NAMED[name];
        const code = hex ? parseInt(hex, 16) : parseInt(dec!, 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

/**
 * A strict reader for the well-formed XML Temml writes: elements with quoted
 * attributes, text and the five XML entities. Anything else throws, and the
 * equation stays LaTeX.
 */
export function parseMathML(xml: string): MathNode {
    const root: MathNode = { name: "#root", attrs: {}, children: [] };
    const stack: MathNode[] = [root];
    const tag = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*="[^"<]*")*)\s*(\/?)>/y;
    let at = 0;
    while (at < xml.length) {
        const lt = xml.indexOf("<", at);
        const textEnd = lt < 0 ? xml.length : lt;
        if (textEnd > at) {
            const text = xml.slice(at, textEnd);
            if (text.includes(">")) throw new Error("Malformed MathML");
            stack[stack.length - 1].children.push(decodeXml(text));
        }
        if (lt < 0) break;
        tag.lastIndex = lt;
        const match = tag.exec(xml);
        if (!match) throw new Error("Malformed MathML");
        at = tag.lastIndex;
        const [, closing, name, attrText, selfClosing] = match;
        if (closing) {
            const open = stack.pop();
            if (!open || open.name !== name || stack.length === 0) throw new Error("Malformed MathML");
            continue;
        }
        const attrs: Record<string, string> = {};
        for (const attr of attrText.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"<]*)"/g)) attrs[attr[1]] = decodeXml(attr[2]);
        const node: MathNode = { name, attrs, children: [] };
        stack[stack.length - 1].children.push(node);
        if (!selfClosing) stack.push(node);
    }
    if (stack.length !== 1) throw new Error("Malformed MathML");
    const math = root.children.find((child): child is MathNode => typeof child !== "string");
    if (!math || math.name !== "math") throw new Error("Not MathML");
    return math;
}

function elements(node: MathNode): MathNode[] {
    return node.children.filter((child): child is MathNode => typeof child !== "string");
}

function textOf(node: MathNode | string): string {
    if (typeof node === "string") return node;
    return node.children.map(textOf).join("");
}

function classes(node: MathNode): string[] {
    return (node.attrs.class ?? "").split(/\s+/).filter(Boolean);
}

// ── OMML, as a tree ───────────────────────────────────────────────────────────

interface Run {
    kind: "run";
    text: string;
    /** Plain (upright) letters. */
    plain?: boolean;
    /** Ordinary text inside an equation (\text). */
    normal?: boolean;
    /** An alignment point in an equation array. */
    align?: boolean;
    color?: string;
}

interface Element {
    kind: "element";
    name: string;
    attrs?: Record<string, string>;
    children: OmmlNode[];
}

export type OmmlNode = Run | Element;

const el = (name: string, children: OmmlNode[] = [], attrs?: Record<string, string>): Element => ({ kind: "element", name, attrs, children });
const val = (name: string, value: string): Element => el(name, [], { "m:val": value });
const arg = (name: string, children: OmmlNode[]) => el(name, children.length ? children : [blank()]);
/** A zero-width space: an argument Word would otherwise show as an empty placeholder box. */
const blank = (): Run => ({ kind: "run", text: "\u{200b}" });

function escapeXml(text: string): string {
    // eslint-disable-next-line no-control-regex -- characters XML 1.0 can't hold
    return text.replace(/[\u{0}-\u{8}\u{b}\u{c}\u{e}-\u{1f}\u{fffe}\u{ffff}\u{d800}-\u{dfff}]/gu, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function serializeOmml(nodes: OmmlNode[]): string {
    let out = "";
    for (const node of nodes) {
        if (node.kind === "run") {
            const props = [node.normal ? "<m:nor/>" : node.plain ? "<m:sty m:val=\"p\"/>" : "", node.align ? "<m:aln/>" : ""].join("");
            const font = node.normal ? "" : "<w:rFonts w:ascii=\"Cambria Math\" w:hAnsi=\"Cambria Math\"/>";
            const color = node.color ? `<w:color w:val="${node.color}"/>` : "";
            out += `<m:r>${props ? `<m:rPr>${props}</m:rPr>` : ""}${font || color ? `<w:rPr>${font}${color}</w:rPr>` : ""}<m:t xml:space="preserve">${escapeXml(node.text)}</m:t></m:r>`;
            continue;
        }
        const attrs = node.attrs ? Object.entries(node.attrs).map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join("") : "";
        out += node.children.length ? `<${node.name}${attrs}>${serializeOmml(node.children)}</${node.name}>` : `<${node.name}${attrs}/>`;
    }
    return out;
}

// ── Characters ────────────────────────────────────────────────────────────────

/** Big operators, which take limits and an operand (m:nary). */
const NARY = new Set([..."∑∏∐∫∬∭⨌∮∯∰∱∲∳⋀⋁⋂⋃⨀⨁⨂⨄⨆⨅⨉"]);
const INTEGRALS = new Set([..."∫∬∭⨌∮∯∰∱∲∳"]);
/** Where a big operator's operand ends: a relation, a sign between terms, punctuation. */
const STOPS = new Set([..."=≠<>≤≥≦≧≪≫≈≃≅≡≢∼∝≺≻⪯⪰⊂⊃⊆⊇∈∉∋→←↔⇒⇐⇔⟹⟸⟺↦⟶⟵+−-±∓,;:≔"]);
/** Accent characters as Temml writes them, and the combining mark Word's accent object takes. */
const ACCENTS: Record<string, string> = {
    "ˆ": "\u{302}", "^": "\u{302}", "ˇ": "\u{30c}", "˜": "\u{303}", "~": "\u{303}", "‾": "\u{305}", "¯": "\u{305}",
    "˙": "\u{307}", ".": "\u{307}", "¨": "\u{308}", "…": "\u{20db}", "´": "\u{301}", "`": "\u{300}", "˘": "\u{306}",
    "˚": "\u{30a}", "→": "\u{20d7}", "←": "\u{20d6}", "↔": "\u{20e1}", "\u{20d7}": "\u{20d7}",
};
/** Characters an equation never shows: function application, invisible times, separator and plus. */
const INVISIBLE = /[\u{2061}-\u{2064}]/gu;
const ARROWS = new Set([..."→←↔⇒⇐⇔⟶⟵⟷⟹⟸⟺↦⇀↽⇌"]);
const BRACES_OVER = new Set([..."⏞⏜⎴"]);
const BRACES_UNDER = new Set([..."⏟⏝⎵"]);
const LINES = new Set([..."‾¯_\u{332}"]);

function codePoints(text: string): number {
    return [...text].length;
}

// ── The mapping ───────────────────────────────────────────────────────────────

interface Context {
    color?: string;
}

function colorOf(node: MathNode, context: Context): Context {
    const style = node.attrs.style ?? "";
    const match = /(?:^|;)\s*color:\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\s*(?:;|$)/.exec(style) ?? (node.attrs.mathcolor ? /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(node.attrs.mathcolor) : null);
    if (!match) return context;
    const hex = match[1].length === 3 ? match[1].split("").map(c => c + c).join("") : match[1];
    return { ...context, color: hex.toUpperCase() };
}

function isEmpty(node: MathNode | string): boolean {
    if (typeof node === "string") return !node.replace(INVISIBLE, "").length;
    if (node.name === "mspace") return parseEm(node.attrs.width) <= 0;
    if (node.name === "mphantom") return false;
    return node.children.every(isEmpty);
}

/** An n-ary operator: a big operator character, alone in its mo. */
function naryChar(node: MathNode | undefined): string | null {
    if (!node) return null;
    if (node.name === "mrow" || node.name === "mstyle" || node.name === "mpadded") {
        const inner = elements(node).filter(child => !isEmpty(child));
        return inner.length === 1 ? naryChar(inner[0]) : null;
    }
    if (node.name !== "mo" || elements(node).length) return null;
    const text = textOf(node).trim();
    return NARY.has(text) ? text : null;
}

/** The fences of an mrow written with \left … \right, a matrix or a binomial, or null for plain brackets. */
function fencesOf(node: MathNode): { open: string; close: string; inner: MathNode[] } | null {
    if (node.name !== "mrow") return null;
    const kids = elements(node);
    if (kids.length < 2) return null;
    const first = kids[0];
    const last = kids[kids.length - 1];
    const isFence = (mo: MathNode, form: string) => mo.name === "mo" && mo.attrs.fence === "true" && (!mo.attrs.form || mo.attrs.form === form)
        && mo.attrs.stretchy !== "false" && !mo.attrs.minsize && !mo.attrs.maxsize && !elements(mo).length;
    if (!isFence(first, "prefix") || !isFence(last, "postfix")) return null;
    return { open: textOf(first).trim(), close: textOf(last).trim(), inner: kids.slice(1, -1) };
}

/** Plain brackets Temml groups in an mrow: they stay one item, so a big operator's operand never ends inside them. */
function isBracketGroup(node: MathNode): boolean {
    const kids = elements(node);
    const first = kids[0];
    const last = kids[kids.length - 1];
    return kids.length >= 2 && first.name === "mo" && first.attrs.fence === "true" && first.attrs.form === "prefix"
        && last.name === "mo" && last.attrs.fence === "true" && last.attrs.form === "postfix";
}

/** Wrappers that only group or style what they hold, whose children join the sequence around them. */
function isTransparent(node: MathNode): boolean {
    if (node.name === "mstyle" || node.name === "mpadded" || node.name === "semantics") return !colorOf(node, {}).color;
    if (node.name !== "mrow") return false;
    if (fencesOf(node) || isBracketGroup(node) || /border\s*:/.test(node.attrs.style ?? "") || colorOf(node, {}).color) return false;
    return true;
}

function parseEm(width: string | undefined): number {
    const match = /^(-?[0-9]*\.?[0-9]+)\s*(em|ex|pt|px|mm|cm|in|mu)?$/.exec((width ?? "").trim());
    if (!match) return 0;
    const value = parseFloat(match[1]);
    switch (match[2]) {
        case "ex": return value * 0.45;
        case "pt": return value / 10;
        case "px": return value / 13.3;
        case "mm": return value / 3.53;
        case "cm": return value / 0.353;
        case "in": return value * 7.2;
        case "mu": return value / 18;
        default: return value;
    }
}

/** A space of about this many ems, from the Unicode spaces Cambria Math draws. */
function spaceFor(em: number): string {
    if (em <= 0.05) return "";
    if (em < 0.2) return "\u{2009}";
    if (em < 0.26) return "\u{205f}";
    if (em < 0.42) return "\u{2004}";
    if (em < 0.75) return "\u{2002}";
    return "\u{2003}".repeat(Math.min(8, Math.max(1, Math.round(em))));
}

class Mapper {
    /** The children of a group, as a run of OMML: wrappers opened, big operators given their operand. */
    sequence(nodes: (MathNode | string)[], context: Context): OmmlNode[] {
        return this.items(this.flatten(nodes, context));
    }

    private items(items: { node: MathNode; context: Context }[]): OmmlNode[] {
        const out: OmmlNode[] = [];
        for (let i = 0; i < items.length; i++) {
            const { node, context } = items[i];
            const nary = this.naryParts(node);
            if (nary) {
                // The operand runs to the next relation, sign or punctuation at this level; a big operator inside it gets its own.
                let end = i + 1;
                while (end < items.length && !this.isStop(items[end].node)) end++;
                out.push(...this.nary(nary, this.items(items.slice(i + 1, end)), context));
                i = end - 1;
                continue;
            }
            out.push(...this.convert(node, context));
        }
        return out;
    }

    private flatten(nodes: (MathNode | string)[], context: Context): { node: MathNode; context: Context }[] {
        const out: { node: MathNode; context: Context }[] = [];
        for (const node of nodes) {
            if (typeof node === "string") {
                if (node.trim()) throw new Unsupported("it has text where Word expects math");
                continue;
            }
            if (node.name === "annotation" || node.name === "annotation-xml") continue;
            if (node.name === "semantics") { out.push(...this.flatten(elements(node).slice(0, 1), context)); continue; }
            if (isTransparent(node)) { out.push(...this.flatten(node.children, colorOf(node, context))); continue; }
            out.push({ node, context });
        }
        return out;
    }

    private isStop(node: MathNode): boolean {
        if (node.name === "mo") return STOPS.has(textOf(node).trim());
        if (node.name === "mspace") return parseEm(node.attrs.width) >= 0.9;
        return false;
    }

    /** A big operator and its limits, when this node is one. */
    private naryParts(node: MathNode): { char: string; sub: MathNode | null; sup: MathNode | null; over: boolean } | null {
        const kids = elements(node);
        switch (node.name) {
            case "mo": { const char = naryChar(node); return char ? { char, sub: null, sup: null, over: false } : null; }
            case "msub": case "munder": { const char = naryChar(kids[0]); return char && kids.length === 2 ? { char, sub: kids[1], sup: null, over: node.name === "munder" } : null; }
            case "msup": case "mover": { const char = naryChar(kids[0]); return char && kids.length === 2 ? { char, sub: null, sup: kids[1], over: node.name === "mover" } : null; }
            case "msubsup": case "munderover": { const char = naryChar(kids[0]); return char && kids.length === 3 ? { char, sub: kids[1], sup: kids[2], over: node.name === "munderover" } : null; }
            default: return null;
        }
    }

    private nary(parts: { char: string; sub: MathNode | null; sup: MathNode | null; over: boolean }, operand: OmmlNode[], context: Context): OmmlNode[] {
        const sub = parts.sub ? this.argument(parts.sub, context) : [];
        const sup = parts.sup ? this.argument(parts.sup, context) : [];
        const operator: Run = { kind: "run", text: parts.char, color: context.color };
        if (!operand.length) {
            // Nothing follows it: draw the operator with its limits, rather than with an empty box beside it.
            if (!sub.length && !sup.length) return [operator];
            if (parts.over) {
                let base: OmmlNode = operator;
                if (sub.length) base = el("m:limLow", [arg("m:e", [base]), arg("m:lim", sub)]);
                if (sup.length) base = el("m:limUpp", [arg("m:e", [base]), arg("m:lim", sup)]);
                return [base];
            }
            if (sub.length && sup.length) return [el("m:sSubSup", [arg("m:e", [operator]), arg("m:sub", sub), arg("m:sup", sup)])];
            return [el(sub.length ? "m:sSub" : "m:sSup", [arg("m:e", [operator]), arg(sub.length ? "m:sub" : "m:sup", sub.length ? sub : sup)])];
        }
        const props: OmmlNode[] = [];
        if (parts.char !== "∫") props.push(val("m:chr", parts.char));
        props.push(val("m:limLoc", parts.over || (!INTEGRALS.has(parts.char) && !parts.sub && !parts.sup) ? "undOvr" : "subSup"));
        if (!sub.length) props.push(val("m:subHide", "1"));
        if (!sup.length) props.push(val("m:supHide", "1"));
        return [el("m:nary", [el("m:naryPr", props), el("m:sub", sub), el("m:sup", sup), arg("m:e", operand)])];
    }

    /** One argument of a structure: a fraction's numerator, a script, a root's body. */
    private argument(node: MathNode, context: Context): OmmlNode[] {
        return this.sequence([node], context);
    }

    private runs(node: MathNode, context: Context): OmmlNode[] {
        const text = textOf(node).replace(INVISIBLE, "");
        if (!text) return [];
        const run: Run = { kind: "run", text, color: context.color };
        if (node.name === "mtext" || node.name === "ms") run.normal = true;
        else if (node.name === "mi") run.plain = node.attrs.mathvariant === "normal" || codePoints(text) > 1;
        else if (node.name === "mo") run.plain = /[A-Za-z]/.test(text);
        return [run];
    }

    /** One element, as OMML. */
    convert(node: MathNode, parentContext: Context): OmmlNode[] {
        const context = colorOf(node, parentContext);
        const kids = elements(node);
        switch (node.name) {
            case "math": case "mrow": case "mstyle": case "mpadded": case "semantics": {
                const fences = fencesOf(node);
                if (fences) return this.delimiter(fences, context);
                const inner = this.sequence(node.children, context);
                if (/border\s*:/.test(node.attrs.style ?? "")) return [el("m:borderBox", [arg("m:e", inner)])];
                return inner;
            }
            case "mi": case "mn": case "mtext": case "ms":
                return this.runs(node, context);
            case "mo":
                if (kids.length) return this.sequence(node.children, context);
                return this.runs(node, context);
            case "mspace": {
                const space = spaceFor(parseEm(node.attrs.width));
                return space ? [{ kind: "run", text: space }] : [];
            }
            case "mphantom":
                // Invisible content only reserves space; leaving it out never changes what the equation says.
                return [];
            case "mfrac": {
                this.arity(node, 2);
                const thickness = (node.attrs.linethickness ?? "").trim();
                const noBar = /^0(?:\.0*)?(?:px|pt|em)?$/.test(thickness);
                const props = noBar ? [el("m:fPr", [val("m:type", "noBar")])] : [];
                return [el("m:f", [...props, arg("m:num", this.argument(kids[0], context)), arg("m:den", this.argument(kids[1], context))])];
            }
            case "msqrt":
                return [el("m:rad", [el("m:radPr", [val("m:degHide", "1")]), el("m:deg"), arg("m:e", this.sequence(node.children, context))])];
            case "mroot":
                this.arity(node, 2);
                return [el("m:rad", [arg("m:deg", this.argument(kids[1], context)), arg("m:e", this.argument(kids[0], context))])];
            case "msub": case "msup": case "msubsup":
                return this.scripts(node, context);
            case "munder": case "mover": case "munderover":
                return this.limits(node, context);
            case "mtable":
                return this.table(node, context);
            case "menclose":
                return this.enclose(node, context);
            case "mmultiscripts":
                throw new Unsupported("prescripts aren’t supported");
            case "merror":
                throw new Unsupported("it isn’t valid LaTeX");
            default:
                throw new Unsupported("it uses a layout that can’t become a Word equation");
        }
    }

    /**
     * Structures take a fixed number of arguments. Temml sometimes puts an
     * operator name's invisible function application and thin space between
     * the base and its script (\underset{x}{\operatorname{argmin}}); those are
     * dropped, and anything else extra is not mapped.
     */
    private arity(node: MathNode, count: number): MathNode[] {
        let kids = elements(node);
        if (kids.length > count) {
            const extra = kids.slice(1, kids.length - (count - 1));
            if (extra.every(child => child.name === "mspace" || isEmpty(child))) kids = [kids[0], ...kids.slice(kids.length - (count - 1))];
        }
        if (kids.length !== count) throw new Unsupported("it uses a layout that can’t become a Word equation");
        node.children = kids;
        return kids;
    }

    private scripts(node: MathNode, context: Context): OmmlNode[] {
        const kids = this.arity(node, node.name === "msubsup" ? 3 : 2);
        const nary = this.naryParts(node);
        if (nary) return this.nary(nary, [], context);
        const base = this.argument(kids[0], context);
        const e = arg("m:e", base);
        if (node.name === "msub") return [el("m:sSub", [e, arg("m:sub", this.argument(kids[1], context))])];
        if (node.name === "msup") return [el("m:sSup", [e, arg("m:sup", this.argument(kids[1], context))])];
        return [el("m:sSubSup", [e, arg("m:sub", this.argument(kids[1], context)), arg("m:sup", this.argument(kids[2], context))])];
    }

    private limits(node: MathNode, context: Context): OmmlNode[] {
        const kids = this.arity(node, node.name === "munderover" ? 3 : 2);
        const nary = this.naryParts(node);
        if (nary) return this.nary(nary, [], context);
        const [baseNode, first, second] = kids;
        const scriptChar = (script: MathNode) => script.name === "mo" && !elements(script).length ? textOf(script).trim() : null;
        if (node.name === "mover") {
            const char = scriptChar(first);
            // \xrightarrow{label}: a stretchy arrow with a label over it.
            if (baseNode.name === "mo" && ARROWS.has(textOf(baseNode).trim()) && baseNode.attrs.stretchy === "true") {
                return [el("m:groupChr", [el("m:groupChrPr", [val("m:chr", textOf(baseNode).trim()), val("m:vertJc", "bot")]), arg("m:e", this.labelOf(first, context))])];
            }
            if (char !== null && BRACES_OVER.has(char)) return [el("m:groupChr", [el("m:groupChrPr", [val("m:chr", char), val("m:pos", "top"), val("m:vertJc", "bot")]), arg("m:e", this.argument(baseNode, context))])];
            if (char !== null && ACCENTS[char] && (first.attrs.stretchy !== undefined || first.attrs.accent === "true" || classes(first).some(c => /acc|vec|tml-hat|tml-tilde/.test(c)) || ARROWS.has(char))) {
                return [el("m:acc", [el("m:accPr", [val("m:chr", ACCENTS[char])]), arg("m:e", this.argument(baseNode, context))])];
            }
            // A strut Temml sets over a label to give it a width: only the label counts.
            if (first.name === "mspace") return this.argument(baseNode, context);
            return [el("m:limUpp", [arg("m:e", this.argument(baseNode, context)), arg("m:lim", this.argument(first, context))])];
        }
        if (node.name === "munder") {
            const char = scriptChar(first);
            if (char !== null && BRACES_UNDER.has(char)) return [el("m:groupChr", [el("m:groupChrPr", [val("m:chr", char)]), arg("m:e", this.argument(baseNode, context))])];
            if (char !== null && LINES.has(char)) return [el("m:bar", [arg("m:e", this.argument(baseNode, context))])];
            if (char !== null && ARROWS.has(char) && first.attrs.stretchy === "true") return [el("m:groupChr", [el("m:groupChrPr", [val("m:chr", char), val("m:pos", "bot")]), arg("m:e", this.argument(baseNode, context))])];
            return [el("m:limLow", [arg("m:e", this.argument(baseNode, context)), arg("m:lim", this.argument(first, context))])];
        }
        const lower: OmmlNode = el("m:limLow", [arg("m:e", this.argument(baseNode, context)), arg("m:lim", this.argument(first, context))]);
        return [el("m:limUpp", [arg("m:e", [lower]), arg("m:lim", this.argument(second, context))])];
    }

    /** A label over an arrow, without the struts Temml pads it with. */
    private labelOf(node: MathNode, context: Context): OmmlNode[] {
        if (node.name === "mover" && elements(node)[1]?.name === "mspace") return this.argument(elements(node)[0], context);
        return this.argument(node, context);
    }

    private delimiter(fences: { open: string; close: string; inner: MathNode[] }, context: Context): OmmlNode[] {
        // \middle| splits the contents into parts, each its own m:e.
        const parts: MathNode[][] = [[]];
        let separator = "";
        for (const child of fences.inner) {
            if (child.name === "mo" && child.attrs.stretchy === "true" && child.attrs.form === "infix" && !elements(child).length) {
                const char = textOf(child).trim();
                if (separator && separator !== char) throw new Unsupported("it mixes two \\middle delimiters");
                separator = char;
                parts.push([]);
                continue;
            }
            parts[parts.length - 1].push(child);
        }
        const props: OmmlNode[] = [];
        if (fences.open !== "(") props.push(val("m:begChr", fences.open));
        if (separator) props.push(val("m:sepChr", separator));
        if (fences.close !== ")") props.push(val("m:endChr", fences.close));
        const es = parts.map(part => el("m:e", this.sequence(part, context)));
        return [el("m:d", [...(props.length ? [el("m:dPr", props)] : []), ...es])];
    }

    private enclose(node: MathNode, context: Context): OmmlNode[] {
        const notation = (node.attrs.notation ?? "").trim().split(/\s+/).sort().join(" ");
        const content = this.sequence(node.children.filter(child => typeof child === "string" || !isEmpty(child)), context);
        switch (notation) {
            case "top": return [el("m:bar", [el("m:barPr", [val("m:pos", "top")]), arg("m:e", content)])];
            case "bottom": return [el("m:bar", [arg("m:e", content)])];
            case "box": case "roundedbox": return [el("m:borderBox", [arg("m:e", content)])];
            case "updiagonalstrike": case "downdiagonalstrike": case "downdiagonalstrike updiagonalstrike": case "horizontalstrike": case "verticalstrike": {
                const props = [val("m:hideTop", "1"), val("m:hideBot", "1"), val("m:hideLeft", "1"), val("m:hideRight", "1")];
                if (notation === "horizontalstrike") props.push(val("m:strikeH", "1"));
                if (notation === "verticalstrike") props.push(val("m:strikeV", "1"));
                if (notation.includes("updiagonalstrike")) props.push(val("m:strikeBLTR", "1"));
                if (notation.includes("downdiagonalstrike")) props.push(val("m:strikeTLBR", "1"));
                return [el("m:borderBox", [el("m:borderBoxPr", props), arg("m:e", content)])];
            }
            default:
                throw new Unsupported("this kind of enclosure isn’t supported");
        }
    }

    /** Matrices, arrays and cases as m:m; aligned and gathered lines as an equation array. */
    private table(node: MathNode, context: Context): OmmlNode[] {
        const numbered = /width:\s*100%/.test(node.attrs.style ?? "");
        const rows = elements(node).map(row => {
            if (row.name !== "mtr") throw new Unsupported("it uses a layout that can’t become a Word equation");
            let cells = elements(row);
            if (cells.some(cell => cell.name !== "mtd")) throw new Unsupported("it uses a layout that can’t become a Word equation");
            let tag: string | null = null;
            if (numbered) {
                // \tag and numbered environments: a spacer cell on each side, the right one holding the number.
                const spacer = (cell: MathNode | undefined) => !!cell && /width:\s*50%/.test(cell.attrs.style ?? "");
                if (spacer(cells[cells.length - 1])) {
                    const last = cells[cells.length - 1];
                    const tagText = elements(last).some(child => classes(child).includes("tml-tag")) ? textOf(last).trim() : "";
                    tag = tagText || null;
                    cells = cells.slice(0, -1);
                }
                if (spacer(cells[0]) && isEmpty(cells[0])) cells = cells.slice(1);
            }
            return { cells, tag };
        });
        const tagRun = (tag: string | null): OmmlNode[] => tag ? [{ kind: "run", text: `\u{2003}${tag}`, normal: true }] : [];
        if (numbered && rows.length === 1 && rows[0].cells.length === 1) {
            return [...this.sequence(rows[0].cells[0].children, context), ...tagRun(rows[0].tag)];
        }
        const aligned = numbered || classes(node).includes("tml-jot");
        if (aligned) {
            return [el("m:eqArr", rows.map(({ cells, tag }) => {
                const content: OmmlNode[] = [];
                cells.forEach((cell, index) => {
                    const part = this.sequence(cell.children, context);
                    if (index > 0 && index % 2 === 0) content.push({ kind: "run", text: "\u{2003}" });
                    if (index % 2 === 1) markAlignment(part);
                    content.push(...part);
                });
                return arg("m:e", [...content, ...tagRun(tag)]);
            }))];
        }
        const width = Math.max(1, ...rows.map(row => row.cells.length));
        const justify = (index: number) => {
            const cell = rows.find(row => row.cells[index])?.cells[index];
            const names = cell ? classes(cell) : [];
            return names.includes("tml-left") ? "left" : names.includes("tml-right") ? "right" : "center";
        };
        const columns: OmmlNode[] = [];
        for (let index = 0; index < width; index++) {
            columns.push(el("m:mc", [el("m:mcPr", [val("m:count", "1"), val("m:mcJc", justify(index))])]));
        }
        const props = el("m:mPr", [val("m:plcHide", "1"), el("m:mcs", columns)]);
        const matrixRows = rows.map(({ cells }) => {
            const es: OmmlNode[] = [];
            for (let index = 0; index < width; index++) es.push(el("m:e", cells[index] ? this.sequence(cells[index].children, context) : []));
            return el("m:mr", es);
        });
        return [el("m:m", [props, ...matrixRows])];
    }
}

/** Put an alignment point at the start of a cell, on its first run or on a run of its own. */
function markAlignment(part: OmmlNode[]) {
    const first = part[0];
    if (first && first.kind === "run") first.align = true;
    else part.unshift({ kind: "run", text: "\u{200b}", align: true });
}

/** MathML from Temml, as the children of an m:oMath. Throws Unsupported for what the subset can't hold. */
export function mathmlToOmml(math: MathNode): string {
    const nodes = new Mapper().convert(math, {});
    if (!nodes.length) throw new Unsupported("it is empty");
    return serializeOmml(nodes);
}

// ── From LaTeX ────────────────────────────────────────────────────────────────

export interface TemmlLike {
    renderToString(tex: string, options?: Record<string, unknown>): string;
}

export type MathResult = { ok: true; omml: string } | { ok: false; reason: string };

/** Longer LaTeX than this is not an equation anyone wrote by hand; it stays text. */
export const MAX_TEX_LENGTH = 20000;

/**
 * Display math with a line break outside any environment, as AI answers
 * write it ($$ a \\ b $$), is set as gathered lines, or aligned ones when it
 * also has &.
 */
export function prepareTex(tex: string, display: boolean): string {
    const text = tex.trim();
    if (!display) return text;
    let depth = 0;
    let environments = 0;
    let breaks = false;
    let ampersands = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\\") {
            const next = text[i + 1];
            if (next === "\\" && depth === 0 && environments === 0) breaks = true;
            if (text.startsWith("begin{", i + 1)) environments++;
            else if (text.startsWith("end{", i + 1)) environments = Math.max(0, environments - 1);
            i++;
            continue;
        }
        if (c === "{") depth++;
        else if (c === "}") depth = Math.max(0, depth - 1);
        else if (c === "&" && depth === 0 && environments === 0) ampersands = true;
    }
    if (!breaks) return text;
    return ampersands ? `\\begin{aligned}${text}\\end{aligned}` : `\\begin{gathered}${text}\\end{gathered}`;
}

function describeParseError(message: string): string {
    const command = /(?:Unsupported function name|Undefined control sequence):\s*(\\[A-Za-z]+|\\.)/.exec(message);
    if (command) return `${command[1]} isn’t supported`;
    const environment = /(?:No such environment|Unknown environment)[^A-Za-z]*([A-Za-z*]+)/i.exec(message);
    if (environment) return `the ${environment[1]} environment isn’t supported`;
    if (/Too many expansions/.test(message)) return "its macros expand too many times";
    return "it isn’t LaTeX that can be read";
}

/** LaTeX to the children of an m:oMath, or the reason it stays text. */
export function latexToOmml(temml: TemmlLike, tex: string, display: boolean): MathResult {
    if (!tex.trim()) return { ok: false, reason: "it is empty" };
    if (tex.length > MAX_TEX_LENGTH) return { ok: false, reason: "it is too long to convert" };
    try {
        const mathml = temml.renderToString(prepareTex(tex, display), {
            displayMode: display, throwOnError: true, trust: false, strict: false, annotate: false, maxExpand: 1000, maxSize: [100, 100],
        });
        return { ok: true, omml: mathmlToOmml(parseMathML(mathml)) };
    } catch (error) {
        if (error instanceof Unsupported) return { ok: false, reason: error.message };
        if (error instanceof RangeError) return { ok: false, reason: "it is nested too deeply" };
        if (error && typeof error === "object" && (error as { name?: unknown }).name === "ParseError") return { ok: false, reason: describeParseError(String((error as { message?: unknown }).message ?? "")) };
        return { ok: false, reason: "it couldn’t be read" };
    }
}

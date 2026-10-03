/**
 * Markdown to a document tree, for Markdown to Word.
 *
 * The site's other Markdown helper (components/tool-ui/markdown-render.ts)
 * reads one line at a time and writes HTML: it has no nesting, tables, task
 * lists or math, which are what an AI answer is made of. This parser follows
 * CommonMark's two phases instead: block structure first (block quotes and
 * list items as containers that hold other blocks, with lazy continuation
 * lines), then inline content (code spans, emphasis by the delimiter-run
 * rules, links, images, autolinks, entities). On top of CommonMark it reads
 * GitHub's tables, task lists, ~~strikethrough~~ and bare web addresses, and
 * LaTeX math in $…$, $$…$$, \(…\) and \[…\].
 *
 * conformance.test.ts holds it to CommonMark 0.31.2 and GFM 0.29 on 320
 * cases. Where it differs from them, it does so on purpose:
 *
 * - Strikethrough takes two tildes, ~~like this~~: a single ~ stays as typed,
 *   so "~5 minutes" reads as written. (GFM strikes ~this~ too.)
 * - Math, which neither has. $…$ follows Pandoc: no space just inside either
 *   dollar and no digit after the closing one, so "$5 and $10" stays prices.
 *   $$…$$ and \(…\) are math inside a line. $$ or \[ starting a line opens
 *   display math, which may interrupt a paragraph; with text after the opener
 *   only when a later line closes it before a blank line, and one never
 *   closed is read as the text it was. So a line "\[x\]" is an equation, not
 *   CommonMark's escaped "[x]".
 * - Table rows: a pipe inside a code span or inline math never splits the
 *   cell, escaped or not. In a code span \| shows as |, as on GitHub; in math
 *   it stays \|, which LaTeX reads as a double bar. (GFM splits at every
 *   unescaped pipe, and shows \| as | everywhere.)
 * - Raw HTML isn't kept. Formatting tags (<b>, <sup>, <kbd> and the like)
 *   become formatting, <br> a line break and <img> an image; other tags are
 *   left out with their text, comments are dropped, and an HTML block's lines
 *   are read as Markdown.
 * - Named character references are HTML 4's set, with &apos; and &check;.
 *   HTML5's other names (&HilbertSpace;) stay as typed.
 * - Bare addresses. A web address is also linked inside brackets that don't
 *   make a link, and never takes a ] it didn't open. It needs a domain with a
 *   period, so http://localhost:3000 stays text, as GFM's text says and
 *   cmark-gfm doesn't. An e-mail address needs a top-level domain of two
 *   letters or more; mailto: and xmpp: prefixes aren't read.
 * - Footnotes stay as typed: [^1] and its "[^1]: note" line both stay text,
 *   where CommonMark would read the line as a link definition and drop it.
 * - Limits for hostile input: quotes and lists nested deeper than 48, link
 *   brackets deeper than 64 and emphasis deeper than 64 are read as text.
 *
 * Nothing here fetches anything: links and images are only recorded.
 */

export type Align = "left" | "center" | "right" | null;

export type InlineFormat = "underline" | "superscript" | "subscript" | "highlight" | "code";

export type Inline =
    | { type: "text"; value: string }
    | { type: "strong"; children: Inline[] }
    | { type: "emphasis"; children: Inline[] }
    | { type: "strike"; children: Inline[] }
    | { type: "format"; format: InlineFormat; children: Inline[] }
    | { type: "code"; value: string }
    | { type: "link"; href: string; title: string; children: Inline[] }
    | { type: "image"; src: string; alt: string; title: string; line: number }
    | { type: "math"; tex: string; display: boolean; source: string; line: number }
    | { type: "break" }
    | { type: "softbreak" };

export interface ListItem {
    /** A task list item's box: true when ticked, false when empty, null for an ordinary item. */
    checked: boolean | null;
    children: Block[];
}

export type Block =
    | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[]; line: number }
    | { type: "paragraph"; children: Inline[]; line: number }
    | { type: "thematicBreak"; line: number }
    | { type: "code"; lang: string; value: string; line: number }
    | { type: "math"; tex: string; source: string; line: number }
    | { type: "blockquote"; children: Block[]; line: number }
    | { type: "list"; ordered: boolean; start: number; delimiter: "." | ")" | null; tight: boolean; items: ListItem[]; line: number }
    | { type: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][]; line: number };

export interface MarkdownDocument {
    children: Block[];
}

/** Block quotes and lists nested deeper than this are read as text: deep nesting is never meant, and it costs stack. */
const MAX_NESTING = 48;
/** Link and image brackets nested deeper than this are read as text. */
const MAX_BRACKETS = 64;
/** Emphasis and formatting nested deeper than this stays as the characters typed. */
const MAX_INLINE_DEPTH = 64;
/** CommonMark's limit on a link label: at most 999 characters between the brackets. */
const MAX_LABEL = 999;

// ── Characters ────────────────────────────────────────────────────────────────

const ASCII_PUNCTUATION = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;
const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
const UNICODE_WHITESPACE = /^[\s\u{a0}\u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}]$/u;
const REPLACEMENT = "\u{fffd}";

function isWhitespaceChar(c: string): boolean {
    return c === "\n" || UNICODE_WHITESPACE.test(c);
}

function isPunctuationChar(c: string): boolean {
    return UNICODE_PUNCTUATION.test(c);
}

/**
 * Where `text` ends once the characters in `chars` are taken off the end of
 * its first `end` characters. A pattern such as / +$/ does this in time
 * that grows with the square of a long run inside the text.
 */
function endWithout(text: string, chars: string, end: number): number {
    while (end > 0 && chars.includes(text[end - 1])) end--;
    return end;
}

/** An ATX heading's text, without its closing #s, which need a space or tab before them unless they are all there is. */
function atxHeadingText(text: string): string {
    let end = endWithout(text, " \t", text.length);
    const hashes = endWithout(text, "#", end);
    if (hashes < end && (hashes === 0 || text[hashes - 1] === " " || text[hashes - 1] === "\t")) end = hashes;
    return text.slice(0, end).trim();
}

/**
 * Expand tabs to the next multiple of four columns, as CommonMark measures
 * indentation. Only structure is read from the expanded line: content is
 * taken from the line as typed, so tabs in code and text stay tabs.
 */
function expandTabs(line: string): string {
    if (!line.includes("\t")) return line;
    let out = "";
    for (const c of line) {
        if (c === "\t") out += " ".repeat(4 - (out.length % 4));
        else out += c;
    }
    return out;
}

// ── Entities ──────────────────────────────────────────────────────────────────

/**
 * Named character references: HTML 4's whole set (Latin-1, Greek, symbols and
 * punctuation), with &apos; and &check;, at their HTML5 values. HTML5's other
 * names, some two thousand and mostly mathematical (&HilbertSpace;), stay as
 * typed: their table would add about a third to the converter's size.
 */
const NAMED_ENTITIES = new Map<string, string>();
/** Latin-1's names, for U+00A0 to U+00FF in order. */
const LATIN1_ENTITIES =
    "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute " +
    "micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring " +
    "AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml " +
    "times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil " +
    "egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash " +
    "ugrave uacute ucirc uuml yacute thorn yuml";
/** The other names, each followed by its code point in hexadecimal. */
const OTHER_ENTITIES =
    "quot 22 amp 26 apos 27 lt 3c gt 3e OElig 152 oelig 153 Scaron 160 scaron 161 Yuml 178 fnof 192 circ 2c6 tilde " +
    "2dc Alpha 391 Beta 392 Gamma 393 Delta 394 Epsilon 395 Zeta 396 Eta 397 Theta 398 Iota 399 Kappa 39a Lambda " +
    "39b Mu 39c Nu 39d Xi 39e Omicron 39f Pi 3a0 Rho 3a1 Sigma 3a3 Tau 3a4 Upsilon 3a5 Phi 3a6 Chi 3a7 Psi 3a8 " +
    "Omega 3a9 alpha 3b1 beta 3b2 gamma 3b3 delta 3b4 epsilon 3b5 zeta 3b6 eta 3b7 theta 3b8 iota 3b9 kappa 3ba " +
    "lambda 3bb mu 3bc nu 3bd xi 3be omicron 3bf pi 3c0 rho 3c1 sigmaf 3c2 sigma 3c3 tau 3c4 upsilon 3c5 phi 3c6 " +
    "chi 3c7 psi 3c8 omega 3c9 thetasym 3d1 upsih 3d2 piv 3d6 ensp 2002 emsp 2003 thinsp 2009 zwnj 200c zwj 200d " +
    "lrm 200e rlm 200f ndash 2013 mdash 2014 lsquo 2018 rsquo 2019 sbquo 201a ldquo 201c rdquo 201d bdquo 201e " +
    "dagger 2020 Dagger 2021 bull 2022 hellip 2026 permil 2030 prime 2032 Prime 2033 lsaquo 2039 rsaquo 203a oline " +
    "203e frasl 2044 euro 20ac image 2111 weierp 2118 real 211c trade 2122 alefsym 2135 larr 2190 uarr 2191 rarr " +
    "2192 darr 2193 harr 2194 crarr 21b5 lArr 21d0 uArr 21d1 rArr 21d2 dArr 21d3 hArr 21d4 forall 2200 part 2202 " +
    "exist 2203 empty 2205 nabla 2207 isin 2208 notin 2209 ni 220b prod 220f sum 2211 minus 2212 lowast 2217 radic " +
    "221a prop 221d infin 221e ang 2220 and 2227 or 2228 cap 2229 cup 222a int 222b there4 2234 sim 223c cong 2245 " +
    "asymp 2248 ne 2260 equiv 2261 le 2264 ge 2265 sub 2282 sup 2283 nsub 2284 sube 2286 supe 2287 oplus 2295 " +
    "otimes 2297 perp 22a5 sdot 22c5 lceil 2308 rceil 2309 lfloor 230a rfloor 230b loz 25ca spades 2660 clubs 2663 " +
    "hearts 2665 diams 2666 check 2713 lang 27e8 rang 27e9";
LATIN1_ENTITIES.split(" ").forEach((name, index) => NAMED_ENTITIES.set(name, String.fromCodePoint(0xa0 + index)));
const otherEntities = OTHER_ENTITIES.split(" ");
for (let i = 0; i + 1 < otherEntities.length; i += 2) NAMED_ENTITIES.set(otherEntities[i], String.fromCodePoint(parseInt(otherEntities[i + 1], 16)));

const ENTITY = /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/y;

function decodeEntity(match: RegExpExecArray): string | null {
    if (match[1] || match[2]) {
        const code = match[1] ? parseInt(match[1], 16) : parseInt(match[2], 10);
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return REPLACEMENT;
        return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES.get(match[3]) ?? null;
}

/** Backslash escapes and entities, as CommonMark resolves them in link destinations, titles and info strings. */
function unescapeString(text: string): string {
    return text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, escaped: string | undefined) => {
        if (escaped) return escaped;
        ENTITY.lastIndex = 0;
        const match = ENTITY.exec(whole);
        return (match && decodeEntity(match)) ?? whole;
    });
}

function normalizeLabel(label: string): string {
    return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}

// ── Block structure ───────────────────────────────────────────────────────────

type Kind = "document" | "blockquote" | "list" | "item" | "paragraph" | "heading" | "thematicBreak" | "fenced" | "indented" | "math" | "table" | "comment";

interface ListData {
    ordered: boolean;
    bulletChar: string;
    delimiter: "." | ")" | null;
    start: number;
    markerOffset: number;
    padding: number;
}

interface RawBlock {
    kind: Kind;
    parent: RawBlock | null;
    children: RawBlock[];
    open: boolean;
    startLine: number;
    endLine: number;
    /** Containers this deep inside block quotes and lists. */
    depth: number;
    /** A leaf block's lines, and the source line each came from. */
    lines: string[];
    lineNumbers: number[];
    level?: number;
    content?: string;
    fenceChar?: string;
    fenceLength?: number;
    fenceOffset?: number;
    info?: string;
    /** Math: the closing delimiter, whether it came, and the lines as typed, to read as a paragraph when it never did. */
    mathCloser?: "$$" | "\\]";
    mathClosed?: boolean;
    rawLines?: string[];
    listData?: ListData;
    tight?: boolean;
    align?: Align[];
    headerRow?: string;
}

const THEMATIC_BREAK = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const ATX_HEADING = /^#{1,6}(?:[ \t]+|$)/;
const CODE_FENCE = /^`{3,}(?!.*`)|^~{3,}/;
const CLOSING_CODE_FENCE = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const BULLET_MARKER = /^[*+-]/;
const ORDERED_MARKER = /^(\d{1,9})([.)])/;
const MAYBE_SPECIAL = /^[#`~*+_=<>0-9\-|:$\\]/;
const TABLE_DELIMITER_CELL = /^:?-+:?$/;
const REFERENCE_LABEL = /\[((?:[^\\[\]]|\\[\s\S]){0,999})\]:/y;
const REFERENCE_DESTINATION = /<(?:[^<>\n\\]|\\.)*>|[^\s<]\S*/y;
const REFERENCE_TITLE = /"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\((?:[^()\\]|\\[\s\S])*\)/y;

interface LinkReference { destination: string; title: string }

/** Past spaces and tabs, and past one line ending and the spaces and tabs after it when `newline` allows. */
function skipBlank(text: string, at: number, newline: boolean): number {
    while (text[at] === " " || text[at] === "\t") at++;
    if (newline && text[at] === "\n") {
        at++;
        while (text[at] === " " || text[at] === "\t") at++;
    }
    return at;
}

/** Where the next line starts, when only spaces and tabs are left on this one; -1 otherwise. */
function nextLineAfter(text: string, at: number): number {
    at = skipBlank(text, at, false);
    if (at >= text.length) return text.length;
    return text[at] === "\n" ? at + 1 : -1;
}

/**
 * One link reference definition from `at`, [label]: destination "title", as
 * CommonMark reads it: the destination and the title may each start on the
 * next line, and the label and the title may run over several. A title that
 * doesn't end its line is left as text when the destination ended its own.
 * Returns where the next line starts, or -1 when there is no definition.
 */
function readReference(text: string, at: number, refs: Map<string, LinkReference>): number {
    const label = matchAt(REFERENCE_LABEL, text, at);
    // [^1]: is a footnote, which stays as typed rather than vanish as a definition.
    if (!label || !label[1].trim() || label[1].startsWith("^")) return -1;
    let position = skipBlank(text, at + label[0].length, true);
    const destination = matchAt(REFERENCE_DESTINATION, text, position);
    if (!destination) return -1;
    position += destination[0].length;
    let end = nextLineAfter(text, position);
    let title = "";
    const titleStart = skipBlank(text, position, true);
    const titled = titleStart > position ? matchAt(REFERENCE_TITLE, text, titleStart) : null;
    if (titled) {
        const afterTitle = nextLineAfter(text, titleStart + titled[0].length);
        if (afterTitle >= 0) {
            end = afterTitle;
            title = titled[0].slice(1, -1);
        }
    }
    if (end < 0) return -1;
    const key = normalizeLabel(label[1]);
    const href = destination[0].startsWith("<") ? destination[0].slice(1, -1) : destination[0];
    if (!refs.has(key)) refs.set(key, { destination: unescapeString(href), title: unescapeString(title) });
    return end;
}

/** The link reference definitions a paragraph starts with, read into `refs`; returns how many of its lines they take. */
function readReferences(lines: string[], refs: Map<string, LinkReference>): number {
    if (!lines.length || !lines[0].startsWith("[")) return 0;
    const text = lines.join("\n");
    let at = 0;
    while (at < text.length && text[at] === "[") {
        const end = readReference(text, at, refs);
        if (end < 0) break;
        at = end;
    }
    if (at >= text.length) return lines.length;
    let taken = 0;
    for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) taken++;
    return taken;
}

class BlockParser {
    private readonly doc: RawBlock;
    private tip: RawBlock | null;
    private oldTip: RawBlock;
    private lastMatchedContainer: RawBlock;
    private allClosed = true;
    /** A leaf that a start opened on this line and that took the rest of it (a fence's info string, a table's delimiter row). */
    private openedLeaf: RawBlock | null = null;
    /** The line with its tabs expanded, which every column and offset below measures. */
    private line = "";
    /** The line as typed, and whether it holds a tab (when it doesn't, it is the same as `line`). */
    private typedLine = "";
    private hasTabs = false;
    private lineNumber = 0;
    private offset = 0;
    private nextNonspace = 0;
    private indent = 0;
    private indented = false;
    private blank = false;
    readonly refs = new Map<string, LinkReference>();

    constructor() {
        this.doc = this.block("document", null);
        this.tip = this.doc;
        this.oldTip = this.doc;
        this.lastMatchedContainer = this.doc;
    }

    private block(kind: Kind, parent: RawBlock | null): RawBlock {
        const depth = parent ? parent.depth + (kind === "blockquote" || kind === "list" ? 1 : 0) : 0;
        return { kind, parent, children: [], open: true, startLine: this.lineNumber, endLine: this.lineNumber, depth, lines: [], lineNumbers: [] };
    }

    parse(source: string): RawBlock {
        const lines = source.split("\n");
        if (lines.length && lines[lines.length - 1] === "") lines.pop();
        this.lines = lines;
        for (const line of lines) this.incorporateLine(line);
        while (this.tip) this.finalize(this.tip, this.lineNumber);
        return this.doc;
    }

    private lines: string[] = [];
    private closers = new Map<string, Int32Array>();

    /**
     * Whether a line after this one, before the next blank line, ends with
     * `closer`. For each closer, every line's answer is worked out once, from
     * the end, so asking costs nothing however many openers there are.
     */
    private closesAhead(closer: string): boolean {
        let ahead = this.closers.get(closer);
        if (!ahead) {
            const lines = this.lines;
            ahead = new Int32Array(lines.length).fill(-1);
            for (let i = lines.length - 2; i >= 0; i--) {
                const next = lines[i + 1];
                // A line of nothing but quote markers is blank too: it ends display math in a quote.
                if (/^[\s>]*$/.test(next)) continue;
                ahead[i] = next.trimEnd().endsWith(closer) ? i + 1 : ahead[i + 1];
            }
            this.closers.set(closer, ahead);
        }
        return ahead[this.lineNumber - 1] >= 0;
    }

    private get current(): RawBlock { return this.tip!; }

    /** The last run of spaces measured on this line: every container re-asks from inside it, so it is measured once. */
    private spaces = { from: -1, to: -1 };

    private findNextNonspace() {
        let i = this.offset;
        if (i >= this.spaces.from && i <= this.spaces.to) i = this.spaces.to;
        else this.spaces.from = i;
        while (i < this.line.length && this.line[i] === " ") i++;
        this.spaces.to = i;
        this.nextNonspace = i;
        this.indent = i - this.offset;
        this.indented = this.indent >= 4;
        this.blank = i >= this.line.length;
    }

    private advanceNextNonspace() { this.offset = this.nextNonspace; }

    private advanceOffset(count: number) { this.offset = Math.min(this.line.length, this.offset + count); }

    /**
     * The line as typed from a column of the expanded line on. Tabs after it
     * stay tabs; a tab the column falls inside leaves the columns it still
     * spans as spaces, as in CommonMark (a list item's code indented by tabs).
     */
    private contentFrom(column: number): string {
        if (!this.hasTabs) return this.line.slice(column);
        const typed = this.typedLine;
        let at = 0;
        for (let i = 0; i < typed.length; i++) {
            if (at >= column) return typed.slice(i);
            if (typed[i] === "\t") {
                const next = at + 4 - (at % 4);
                if (next > column) return " ".repeat(next - column) + typed.slice(i + 1);
                at = next;
            } else {
                at++;
            }
        }
        return "";
    }

    private incorporateLine(line: string) {
        let allMatched = true;
        let container = this.doc;
        this.oldTip = this.current;
        this.offset = 0;
        this.lineNumber++;
        this.openedLeaf = null;
        this.spaces = { from: -1, to: -1 };
        this.typedLine = line.replace(/\0/g, REPLACEMENT);
        this.hasTabs = this.typedLine.includes("\t");
        this.line = this.hasTabs ? expandTabs(this.typedLine) : this.typedLine;

        // 1. Which open blocks does this line continue?
        let last: RawBlock | undefined;
        while ((last = container.children[container.children.length - 1]) && last.open) {
            container = last;
            this.findNextNonspace();
            const result = this.continueBlock(container);
            if (result === 2) return;
            if (result === 1) { allMatched = false; container = container.parent!; break; }
        }
        this.allClosed = container === this.oldTip;
        this.lastMatchedContainer = container;

        // 2. New block starts, nested in the last matched container.
        let matchedLeaf = container.kind !== "paragraph" && container.kind !== "table" && acceptsLines(container.kind);
        while (!matchedLeaf) {
            this.findNextNonspace();
            if (!this.indented && !MAYBE_SPECIAL.test(this.line.slice(this.nextNonspace))) { this.advanceNextNonspace(); break; }
            const started = this.tryStarts(container);
            if (started === 0) { this.advanceNextNonspace(); break; }
            container = this.current;
            if (started === 2) matchedLeaf = true;
        }

        // 3. What remains is text: a lazy continuation of a paragraph, a line of a leaf, or a new paragraph.
        if (!this.allClosed && !this.blank && this.current.kind === "paragraph") {
            this.addLine();
            return;
        }
        this.closeUnmatchedBlocks();
        if (container.kind === "math" && this.blank && container.open) {
            // A blank line inside $$ … $$ means it was never closed: read it as text.
            this.finalize(container, this.lineNumber - 1);
            return;
        }
        if (acceptsLines(container.kind) && container.open) {
            if (container === this.openedLeaf) return;
            this.addLine();
            if (container.kind === "comment" && this.line.includes("-->")) this.finalize(container, this.lineNumber);
            else if (container.kind === "math") this.checkMathEnd(container);
        } else if (this.offset < this.line.length && !this.blank) {
            this.addChild("paragraph");
            this.advanceNextNonspace();
            this.addLine();
        }
    }

    /** 0: matched, 1: not matched, 2: matched and the line is used up. */
    private continueBlock(block: RawBlock): 0 | 1 | 2 {
        switch (block.kind) {
            case "document": case "list": return 0;
            case "blockquote":
                if (!this.indented && this.line[this.nextNonspace] === ">") {
                    this.advanceNextNonspace();
                    this.advanceOffset(1);
                    if (this.line[this.offset] === " ") this.advanceOffset(1);
                    // A quote's lines are all its own, even one of only ">": that is no blank line between list items.
                    block.endLine = this.lineNumber;
                    return 0;
                }
                return 1;
            case "item": {
                const data = block.listData!;
                if (this.blank) {
                    if (!block.children.length) return 1;
                    this.advanceNextNonspace();
                    return 0;
                }
                if (this.indent >= data.markerOffset + data.padding) {
                    this.advanceOffset(data.markerOffset + data.padding);
                    return 0;
                }
                return 1;
            }
            case "fenced": {
                const rest = this.line.slice(this.nextNonspace);
                const match = this.indent <= 3 && rest[0] === block.fenceChar ? CLOSING_CODE_FENCE.exec(rest) : null;
                if (match && match[0].length >= block.fenceLength!) {
                    this.finalize(block, this.lineNumber);
                    return 2;
                }
                let skip = block.fenceOffset!;
                while (skip > 0 && this.line[this.offset] === " ") { this.advanceOffset(1); skip--; }
                return 0;
            }
            case "indented":
                if (this.indent >= 4) { this.advanceOffset(4); return 0; }
                if (this.blank) { this.advanceNextNonspace(); return 0; }
                return 1;
            case "math": case "comment": return 0;
            case "paragraph": case "table": return this.blank ? 1 : 0;
            default: return 1;
        }
    }

    /** 0: nothing started, 1: a container started, 2: a leaf started. */
    private tryStarts(container: RawBlock): 0 | 1 | 2 {
        const rest = this.line.slice(this.nextNonspace);
        const tooDeep = container.depth >= MAX_NESTING;
        if (!this.indented) {
            // Block quote.
            if (rest[0] === ">" && !tooDeep) {
                this.advanceNextNonspace();
                this.advanceOffset(1);
                if (this.line[this.offset] === " ") this.advanceOffset(1);
                this.closeUnmatchedBlocks();
                this.addChild("blockquote");
                return 1;
            }
            // ATX heading.
            const atx = ATX_HEADING.exec(rest);
            if (atx) {
                this.closeUnmatchedBlocks();
                const heading = this.addChild("heading");
                heading.level = atx[0].trim().length;
                heading.content = atxHeadingText(this.contentFrom(this.nextNonspace + atx[0].length));
                heading.lineNumbers = [this.lineNumber];
                this.offset = this.line.length;
                this.finalize(heading, this.lineNumber);
                return 2;
            }
            // Fenced code.
            const fence = CODE_FENCE.exec(rest);
            if (fence) {
                this.closeUnmatchedBlocks();
                const code = this.addChild("fenced");
                code.fenceChar = fence[0][0];
                code.fenceLength = fence[0].length;
                code.fenceOffset = this.indent;
                code.info = unescapeString(rest.slice(fence[0].length).trim());
                this.openedLeaf = code;
                this.offset = this.line.length;
                return 2;
            }
            // Display math, $$ … $$ or \[ … \], which may interrupt a paragraph as fenced code does.
            if (rest.startsWith("$$") || rest.startsWith("\\[")) {
                const closer = rest.startsWith("$$") ? "$$" : "\\]";
                const typed = this.contentFrom(this.nextNonspace);
                const after = typed.slice(2);
                const trimmed = after.trimEnd();
                const inner = trimmed.endsWith(closer) ? trimmed.slice(0, -closer.length) : "";
                // On one line, only an equation: "$$a$$ and $$b$$" is a sentence with two equations in it.
                const oneLine = inner.trim() !== "" && !inner.includes(closer);
                // Over several lines: the opener alone, or followed by LaTeX that a later line closes.
                // Other text after it is a sentence about $$, which must not take the lines after it.
                const opens = !trimmed.includes(closer) && (!trimmed.trim() || this.closesAhead(closer));
                if (oneLine || opens) {
                    this.closeUnmatchedBlocks();
                    const math = this.addChild("math");
                    math.mathCloser = closer;
                    math.rawLines = [typed];
                    math.lineNumbers = [this.lineNumber];
                    this.offset = this.line.length;
                    if (oneLine) {
                        math.lines = [inner];
                        math.mathClosed = true;
                        this.finalize(math, this.lineNumber);
                    } else {
                        if (after.trim()) math.lines.push(after);
                        this.openedLeaf = math;
                    }
                    return 2;
                }
            }
            // An HTML comment, which says nothing in the document.
            if (rest.startsWith("<!--")) {
                this.closeUnmatchedBlocks();
                const comment = this.addChild("comment");
                this.offset = this.line.length;
                if (rest.includes("-->", 4)) this.finalize(comment, this.lineNumber);
                else this.openedLeaf = comment;
                return 2;
            }
            // Setext heading underline.
            if (container.kind === "paragraph" && SETEXT_UNDERLINE.test(rest)) {
                this.closeUnmatchedBlocks();
                this.extractReferences(container);
                if (container.lines.length) {
                    container.kind = "heading";
                    container.level = rest[0] === "=" ? 1 : 2;
                    container.content = container.lines.map(text => text.trim()).join("\n");
                    this.offset = this.line.length;
                    this.finalize(container, this.lineNumber);
                    return 2;
                }
            }
            // GitHub table: a delimiter row under the header row a paragraph ends with.
            if (container.kind === "paragraph" && rest.includes("|") && this.tryTable(container, rest)) return 2;
            // Thematic break.
            if (THEMATIC_BREAK.test(rest)) {
                this.closeUnmatchedBlocks();
                const hr = this.addChild("thematicBreak");
                this.offset = this.line.length;
                this.finalize(hr, this.lineNumber);
                return 2;
            }
        }
        // List item.
        if ((!this.indented || container.kind === "list") && !tooDeep) {
            const data = this.parseListMarker(container);
            if (data) {
                this.closeUnmatchedBlocks();
                if (this.current.kind !== "list" || !listsMatch(this.current.listData!, data)) {
                    const list = this.addChild("list");
                    list.listData = data;
                }
                const item = this.addChild("item");
                item.listData = data;
                return 1;
            }
        }
        // Indented code, which cannot interrupt a paragraph.
        if (this.indented && this.current.kind !== "paragraph" && !this.blank) {
            this.advanceOffset(4);
            this.closeUnmatchedBlocks();
            this.addChild("indented");
            return 2;
        }
        return 0;
    }

    private tryTable(paragraph: RawBlock, rest: string): boolean {
        const delimiterCells = splitTableRow(rest);
        if (!delimiterCells.length || !delimiterCells.every(cell => TABLE_DELIMITER_CELL.test(cell))) return false;
        const header = paragraph.lines[paragraph.lines.length - 1];
        if (header === undefined || splitTableRow(header).length !== delimiterCells.length) return false;
        this.closeUnmatchedBlocks();
        const headerLine = paragraph.lineNumbers[paragraph.lineNumbers.length - 1];
        paragraph.lines.pop();
        paragraph.lineNumbers.pop();
        if (paragraph.lines.length) {
            this.finalize(paragraph, headerLine - 1);
        } else {
            const siblings = paragraph.parent!.children;
            siblings.splice(siblings.indexOf(paragraph), 1);
            this.tip = paragraph.parent;
        }
        const table = this.addChild("table");
        table.startLine = headerLine;
        table.headerRow = header;
        table.align = delimiterCells.map(cell => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null);
        this.openedLeaf = table;
        this.offset = this.line.length;
        return true;
    }

    private parseListMarker(container: RawBlock): ListData | null {
        if (this.indent >= 4) return null;
        const rest = this.line.slice(this.nextNonspace);
        const data: ListData = { ordered: false, bulletChar: "", delimiter: null, start: 1, markerOffset: this.indent, padding: 0 };
        let marker: string;
        const bullet = BULLET_MARKER.exec(rest);
        const ordered = ORDERED_MARKER.exec(rest);
        if (bullet) {
            marker = bullet[0];
            data.bulletChar = marker;
        } else if (ordered && (container.kind !== "paragraph" || ordered[1] === "1")) {
            marker = ordered[0];
            data.ordered = true;
            data.start = parseInt(ordered[1], 10);
            data.delimiter = ordered[2] as "." | ")";
        } else {
            return null;
        }
        const next = this.line[this.nextNonspace + marker.length];
        if (next !== undefined && next !== " ") return null;
        // Interrupting a paragraph, an item needs content on its first line.
        if (container.kind === "paragraph" && !this.line.slice(this.nextNonspace + marker.length).trim()) return null;
        this.advanceNextNonspace();
        this.advanceOffset(marker.length);
        const spacesStart = this.offset;
        let spaces = 0;
        while (spaces < 5 && this.line[this.offset] === " ") { this.advanceOffset(1); spaces++; }
        const blankItem = this.offset >= this.line.length;
        if (spaces >= 5 || spaces < 1 || blankItem) {
            data.padding = marker.length + 1;
            this.offset = spacesStart;
            if (this.line[this.offset] === " ") this.advanceOffset(1);
        } else {
            data.padding = marker.length + spaces;
        }
        return data;
    }

    private addChild(kind: Kind): RawBlock {
        while (!canContain(this.current.kind, kind)) this.finalize(this.current, this.lineNumber - 1);
        const parent = this.current;
        const child = this.block(kind, parent);
        parent.children.push(child);
        this.tip = child;
        return child;
    }

    private addLine() {
        const tip = this.current;
        const content = this.contentFrom(this.offset);
        tip.lines.push(content);
        tip.lineNumbers.push(this.lineNumber);
        if (tip.kind === "math") tip.rawLines!.push(content);
        tip.endLine = this.lineNumber;
    }

    private checkMathEnd(math: RawBlock) {
        const last = math.lines[math.lines.length - 1].trimEnd();
        if (last.endsWith(math.mathCloser!)) {
            math.lines[math.lines.length - 1] = last.slice(0, -math.mathCloser!.length);
            math.mathClosed = true;
            this.finalize(math, this.lineNumber);
        }
    }

    private closeUnmatchedBlocks() {
        if (this.allClosed) return;
        while (this.oldTip !== this.lastMatchedContainer) {
            const parent = this.oldTip.parent!;
            this.finalize(this.oldTip, this.lineNumber - 1);
            this.oldTip = parent;
        }
        this.allClosed = true;
    }

    private finalize(block: RawBlock, lineNumber: number) {
        const parent = block.parent;
        if (!block.open) { this.tip = parent; return; }
        block.open = false;
        if (block.kind !== "blockquote" && block.kind !== "list" && block.kind !== "item" && block.kind !== "document") {
            block.endLine = Math.max(block.endLine, Math.min(lineNumber, this.lineNumber));
        }
        if (block.kind === "paragraph") {
            this.extractReferences(block);
            if (!block.lines.length && parent) parent.children.splice(parent.children.indexOf(block), 1);
        } else if (block.kind === "indented") {
            while (block.lines.length && !block.lines[block.lines.length - 1].trim()) { block.lines.pop(); block.lineNumbers.pop(); }
        } else if (block.kind === "math" && !block.mathClosed) {
            // Never closed: the lines were text all along.
            block.kind = "paragraph";
            block.lines = block.rawLines!.slice();
            while (block.lineNumbers.length < block.lines.length) block.lineNumbers.push(block.lineNumbers[block.lineNumbers.length - 1] ?? block.startLine);
            block.lineNumbers.length = block.lines.length;
        } else if (block.kind === "list") {
            block.tight = isTight(block);
        }
        this.tip = parent;
    }

    /** Link reference definitions at the start of a paragraph, taken out of it. */
    private extractReferences(paragraph: RawBlock) {
        const taken = readReferences(paragraph.lines, this.refs);
        if (!taken) return;
        paragraph.lines.splice(0, taken);
        paragraph.lineNumbers.splice(0, taken);
    }
}

function acceptsLines(kind: Kind): boolean {
    return kind === "paragraph" || kind === "fenced" || kind === "indented" || kind === "math" || kind === "table" || kind === "comment";
}

function canContain(parent: Kind, child: Kind): boolean {
    if (parent === "document" || parent === "blockquote" || parent === "item") return child !== "item";
    if (parent === "list") return child === "item";
    return false;
}

function listsMatch(a: ListData, b: ListData): boolean {
    return a.ordered === b.ordered && a.delimiter === b.delimiter && a.bulletChar === b.bulletChar;
}

/** The last source line a block holds content on. */
function contentEnd(block: RawBlock): number {
    let end = block.lineNumbers.length ? block.lineNumbers[block.lineNumbers.length - 1] : block.endLine;
    if (block.kind === "fenced" || block.kind === "math" || block.kind === "comment" || block.kind === "heading") end = Math.max(end, block.endLine);
    for (const child of block.children) end = Math.max(end, contentEnd(child));
    return Math.max(end, block.startLine);
}

/** A list is loose when its items, or two blocks directly inside an item, are separated by a blank line. */
function isTight(list: RawBlock): boolean {
    const items = list.children;
    for (let i = 0; i < items.length; i++) {
        const next = items[i + 1];
        if (next && next.startLine > contentEnd(items[i]) + 1) return false;
        const children = items[i].children;
        for (let j = 0; j + 1 < children.length; j++) {
            if (children[j + 1].startLine > contentEnd(children[j]) + 1) return false;
        }
    }
    return true;
}

// ── Table rows and inline math boundaries ─────────────────────────────────────

/** Where a run of backticks the same length as `run` starts, from `from`, or -1. */
function findClosingRun(text: string, from: number, length: number): number {
    let i = text.indexOf("`", from);
    while (i >= 0) {
        let end = i;
        while (text[end] === "`") end++;
        if (end - i === length) return i;
        i = text.indexOf("`", end);
    }
    return -1;
}

function backtickRun(text: string, at: number): number {
    let end = at;
    while (text[end] === "`") end++;
    return end - at;
}

/**
 * A table row's cells. A pipe separates cells unless it is escaped (\|), or
 * sits inside a code span or inline math, where `a | b` and $|x|$ mean
 * themselves.
 */
export function splitTableRow(row: string): string[] {
    const text = row.trim();
    if (!text) return [];
    const cells: string[] = [];
    let current = "";
    let i = text.startsWith("|") ? 1 : 0;
    let endedOnPipe = false;
    while (i < text.length) {
        const c = text[i];
        endedOnPipe = false;
        if (c === "\\" && text[i + 1] === "|") { current += "|"; i += 2; continue; }
        if (c === "\\") { current += text.slice(i, i + 2); i += 2; continue; }
        if (c === "`") {
            const length = backtickRun(text, i);
            const close = findClosingRun(text, i + length, length);
            const end = close >= 0 ? close + length : i + length;
            // GitHub (and remark-gfm) show \| inside a code span in a table cell as |.
            current += text.slice(i, end).replace(/\\\|/g, "|");
            i = end;
            continue;
        }
        if (c === "$") {
            const end = findInlineMathEnd(text, i);
            if (end > i) { current += text.slice(i, end); i = end; continue; }
        }
        if (c === "|") {
            cells.push(current.trim());
            current = "";
            i++;
            endedOnPipe = true;
            continue;
        }
        current += c;
        i++;
    }
    if (!endedOnPipe) cells.push(current.trim());
    return cells;
}

function isEscaped(text: string, at: number): boolean {
    let slashes = 0;
    for (let i = at - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
    return slashes % 2 === 1;
}

/**
 * The end (exclusive) of inline math that starts at `start` ($…$ or $$…$$),
 * or -1. The rules are Pandoc's: an opening $ is followed by a non-space, and
 * the closing $ follows a non-space and is not followed by a digit, so "$5
 * and $10" stays text.
 */
export function findInlineMathEnd(text: string, start: number): number {
    if (text[start] !== "$") return -1;
    if (text[start + 1] === "$") {
        let i = start + 2;
        while (i < text.length) {
            const at = text.indexOf("$$", i);
            if (at < 0) return -1;
            if (!isEscaped(text, at)) return text.slice(start + 2, at).trim() ? at + 2 : -1;
            i = at + 1;
        }
        return -1;
    }
    const first = text[start + 1];
    if (first === undefined || isWhitespaceChar(first)) return -1;
    let i = start + 1;
    while (i < text.length) {
        const at = text.indexOf("$", i);
        if (at < 0) return -1;
        if (isEscaped(text, at)) { i = at + 1; continue; }
        const before = text[at - 1];
        const after = text[at + 1];
        if (at === start + 1 || isWhitespaceChar(before) || (after !== undefined && after >= "0" && after <= "9")) return -1;
        return at + 1;
    }
    return -1;
}

// ── Inline content ────────────────────────────────────────────────────────────

type NodeType = "root" | "text" | "strong" | "emphasis" | "strike" | "code" | "link" | "image" | "math" | "break" | "softbreak" | "html" | "format";

class INode {
    parent: INode | null = null;
    prev: INode | null = null;
    next: INode | null = null;
    firstChild: INode | null = null;
    lastChild: INode | null = null;
    destination = "";
    title = "";
    display = false;
    source = "";
    line = 0;
    tag = "";
    closing = false;
    format: InlineFormat = "underline";
    /** How many wrappers deep its content goes: 0 for text. */
    depth = 0;

    constructor(public type: NodeType, public literal = "") {}

    appendChild(child: INode) {
        child.unlink();
        child.parent = this;
        if (child.depth + 1 > this.depth) this.depth = child.depth + 1;
        if (this.lastChild) {
            this.lastChild.next = child;
            child.prev = this.lastChild;
            this.lastChild = child;
        } else {
            this.firstChild = child;
            this.lastChild = child;
        }
    }

    insertAfter(sibling: INode) {
        sibling.unlink();
        sibling.parent = this.parent;
        sibling.prev = this;
        sibling.next = this.next;
        if (this.next) this.next.prev = sibling;
        else if (this.parent) this.parent.lastChild = sibling;
        this.next = sibling;
    }

    insertBefore(sibling: INode) {
        sibling.unlink();
        sibling.parent = this.parent;
        sibling.next = this;
        sibling.prev = this.prev;
        if (this.prev) this.prev.next = sibling;
        else if (this.parent) this.parent.firstChild = sibling;
        this.prev = sibling;
    }

    unlink() {
        if (this.prev) this.prev.next = this.next;
        else if (this.parent) this.parent.firstChild = this.next;
        if (this.next) this.next.prev = this.prev;
        else if (this.parent) this.parent.lastChild = this.prev;
        this.parent = null;
        this.prev = null;
        this.next = null;
    }

    childList(): INode[] {
        const out: INode[] = [];
        for (let child = this.firstChild; child; child = child.next) out.push(child);
        return out;
    }
}

interface Delimiter {
    char: string;
    count: number;
    original: number;
    node: INode;
    previous: Delimiter | null;
    next: Delimiter | null;
    canOpen: boolean;
    canClose: boolean;
}

interface Bracket {
    node: INode;
    previous: Bracket | null;
    previousDelimiter: Delimiter | null;
    /** Where the [ is. */
    index: number;
    image: boolean;
    active: boolean;
    bracketAfter: boolean;
    depth: number;
}

// Sticky patterns, matched where the parser stands without copying the rest of the text.
const MAIN_TEXT = /[^\n`[\]\\!<&*_~$:]+/y;
const LINK_DESTINATION_BRACES = /<(?:[^<>\n\\\0]|\\.)*>/y;
const LINK_TITLE = /"(?:\\[\s\S]|[^\\"\0])*"|'(?:\\[\s\S]|[^\\'\0])*'|\((?:\\[\s\S]|[^\\()\0])*\)/y;
const LINK_LABEL = /\[(?:[^\\[\]]|\\.){0,999}\]/y;
const AUTOLINK = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\0- ]*>/y;
const EMAIL_AUTOLINK = /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;
const HTML_OPEN_TAG = /<([A-Za-z][A-Za-z0-9-]*)((?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*)\s*(\/?)>/y;
const HTML_CLOSE_TAG = /<\/([A-Za-z][A-Za-z0-9-]*)\s*>/y;

/** Inline HTML that means formatting a Word document can carry. Any other tag is left out and its text kept. */
const HTML_FORMATS: Record<string, "strong" | "emphasis" | "strike" | InlineFormat> = {
    b: "strong", strong: "strong", i: "emphasis", em: "emphasis", s: "strike", strike: "strike", del: "strike",
    u: "underline", ins: "underline", sup: "superscript", sub: "subscript", mark: "highlight",
    code: "code", kbd: "code", samp: "code", tt: "code",
};

function matchAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
    pattern.lastIndex = at;
    return pattern.exec(text);
}

class InlineParser {
    private subject = "";
    private pos = 0;
    private delimiters: Delimiter | null = null;
    private brackets: Bracket | null = null;
    private lineOf: (offset: number) => number = () => 0;
    /**
     * Where a search for a closer once came up empty: no backtick run of a
     * given length, no \), -->, ?>, ]]> or > from there on. Later openers past
     * that point need not search again, which keeps text full of unclosed
     * openers linear instead of quadratic.
     */
    private noRunAfter = new Map<number, number>();
    private noCloserAfter = new Map<string, number>();

    constructor(private readonly refs: Map<string, LinkReference>) {}

    /** Where `closer` next appears from `from`, remembering when it doesn't. */
    private findCloser(closer: string, from: number): number {
        const none = this.noCloserAfter.get(closer);
        if (none !== undefined && from >= none) return -1;
        const at = this.subject.indexOf(closer, from);
        if (at < 0) this.noCloserAfter.set(closer, Math.min(none ?? Infinity, from));
        return at;
    }

    parse(text: string, lineOf: (offset: number) => number): Inline[] {
        this.subject = text.slice(0, endWithout(text, " \t", text.length));
        this.pos = 0;
        this.delimiters = null;
        this.brackets = null;
        this.lineOf = lineOf;
        this.noRunAfter = new Map();
        this.noCloserAfter = new Map();
        const root = new INode("root");
        while (this.pos < this.subject.length) {
            if (!this.parseInline(root)) {
                root.appendChild(new INode("text", this.subject[this.pos]));
                this.pos++;
            }
        }
        this.processEmphasis(null);
        pairHtml(root);
        mergeText(root);
        autolink(root);
        return toInlines(root);
    }

    private peek(offset = 0): string | undefined {
        return this.subject[this.pos + offset];
    }

    private parseInline(block: INode): boolean {
        const c = this.peek();
        switch (c) {
            case "\n": return this.parseNewline(block);
            case "\\": return this.parseBackslash(block);
            case "`": return this.parseBackticks(block);
            case "*": case "_": case "~": return this.handleDelimiters(block, c);
            case "[": return this.parseOpenBracket(block);
            case "!": return this.parseBang(block);
            case "]": return this.parseCloseBracket(block);
            case "<": return this.parseAngle(block);
            case "&": return this.parseEntity(block);
            case "$": return this.parseDollar(block);
            case ":": return this.parseColon(block);
            default: {
                const match = matchAt(MAIN_TEXT, this.subject, this.pos);
                if (!match) return false;
                const text = match[0];
                // A www. address is read where it starts, as http:// ones are at the colon.
                for (let at = this.brackets ? -1 : text.indexOf("www."); at >= 0; at = text.indexOf("www.", at + 4)) {
                    const start = this.pos + at;
                    if (!addressMayStart(this.subject, start)) continue;
                    const label = readWebAddress(this.subject, start);
                    if (!label) continue;
                    if (at > 0) block.appendChild(new INode("text", text.slice(0, at)));
                    this.appendAddress(block, label, `http://${label}`);
                    this.pos = start + label.length;
                    return true;
                }
                this.pos += text.length;
                block.appendChild(new INode("text", text));
                return true;
            }
        }
    }

    private parseNewline(block: INode): boolean {
        this.pos++;
        const last = block.lastChild;
        if (last && last.type === "text" && last.literal.endsWith(" ")) {
            const hard = last.literal.endsWith("  ");
            last.literal = last.literal.slice(0, endWithout(last.literal, " ", last.literal.length));
            block.appendChild(new INode(hard ? "break" : "softbreak"));
        } else {
            block.appendChild(new INode("softbreak"));
        }
        while (this.peek() === " ") this.pos++;
        return true;
    }

    private parseBackslash(block: INode): boolean {
        const next = this.peek(1);
        if (next === "\n") {
            this.pos += 2;
            block.appendChild(new INode("break"));
            while (this.peek() === " ") this.pos++;
            return true;
        }
        if (next === "(") {
            const close = this.findCloser("\\)", this.pos + 2);
            if (close > this.pos + 2 && this.subject.slice(this.pos + 2, close).trim()) {
                this.addMath(block, this.subject.slice(this.pos + 2, close), false, this.subject.slice(this.pos, close + 2));
                this.pos = close + 2;
                return true;
            }
        }
        if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
            this.pos += 2;
            block.appendChild(new INode("text", next));
            return true;
        }
        this.pos++;
        block.appendChild(new INode("text", "\\"));
        return true;
    }

    private addMath(block: INode, tex: string, display: boolean, source: string) {
        const node = new INode("math", tex.trim());
        node.display = display;
        node.source = source;
        node.line = this.lineOf(this.pos);
        block.appendChild(node);
    }

    /**
     * http:// and https:// addresses in running text become links here, as
     * cmark-gfm finds them (at the colon), so nothing inside one is read as
     * emphasis, math or an entity: …/__init__.py stays one address. Not inside
     * brackets, also as cmark-gfm: there an address would run on through
     * "](…)". The pass after reading still links one left in plain text.
     */
    private parseColon(block: INode): boolean {
        const last = block.lastChild;
        const scheme = last && last.type === "text" && !this.brackets ? /https?$/.exec(last.literal)?.[0] : undefined;
        if (scheme) {
            const start = this.pos - scheme.length;
            const label = addressMayStart(this.subject, start) ? readWebAddress(this.subject, start) : "";
            if (label) {
                last!.literal = last!.literal.slice(0, -scheme.length);
                this.appendAddress(block, label, label);
                this.pos = start + label.length;
                return true;
            }
        }
        this.pos++;
        block.appendChild(new INode("text", ":"));
        return true;
    }

    private appendAddress(block: INode, label: string, href: string) {
        const link = new INode("link");
        link.destination = href;
        link.appendChild(new INode("text", label));
        block.appendChild(link);
    }

    private parseDollar(block: INode): boolean {
        const end = findInlineMathEnd(this.subject, this.pos);
        if (end < 0) {
            const run = this.peek(1) === "$" ? "$$" : "$";
            this.pos += run.length;
            block.appendChild(new INode("text", run));
            return true;
        }
        const display = this.peek(1) === "$";
        const inner = this.subject.slice(this.pos + (display ? 2 : 1), end - (display ? 2 : 1));
        this.addMath(block, inner, display, this.subject.slice(this.pos, end));
        this.pos = end;
        return true;
    }

    private parseBackticks(block: INode): boolean {
        const length = backtickRun(this.subject, this.pos);
        const after = this.pos + length;
        const none = this.noRunAfter.get(length);
        const close = none !== undefined && after >= none ? -1 : findClosingRun(this.subject, after, length);
        if (close < 0) {
            this.noRunAfter.set(length, Math.min(none ?? Infinity, after));
            this.pos = after;
            block.appendChild(new INode("text", "`".repeat(length)));
            return true;
        }
        let contents = this.subject.slice(after, close).replace(/\n/g, " ");
        if (contents.length > 1 && /[^ ]/.test(contents) && contents.startsWith(" ") && contents.endsWith(" ")) contents = contents.slice(1, -1);
        block.appendChild(new INode("code", contents));
        this.pos = close + length;
        return true;
    }

    private handleDelimiters(block: INode, char: string): boolean {
        const start = this.pos;
        let count = 0;
        while (this.subject[start + count] === char) count++;
        const before = start === 0 ? "\n" : this.subject[start - 1];
        const after = this.subject[start + count] ?? "\n";
        const afterSpace = isWhitespaceChar(after);
        const afterPunct = isPunctuationChar(after);
        const beforeSpace = isWhitespaceChar(before);
        const beforePunct = isPunctuationChar(before);
        const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
        const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
        const canOpen = char === "_" ? left && (!right || beforePunct) : left;
        const canClose = char === "_" ? right && (!left || afterPunct) : right;
        this.pos += count;
        const node = new INode("text", char.repeat(count));
        block.appendChild(node);
        // Only ~~ strikes through; a single ~ and longer runs are text.
        if ((canOpen || canClose) && (char !== "~" || count === 2)) {
            const delimiter: Delimiter = { char, count, original: count, node, previous: this.delimiters, next: null, canOpen, canClose };
            if (this.delimiters) this.delimiters.next = delimiter;
            this.delimiters = delimiter;
        }
        return true;
    }

    private removeDelimiter(delimiter: Delimiter) {
        if (delimiter.previous) delimiter.previous.next = delimiter.next;
        if (delimiter.next) delimiter.next.previous = delimiter.previous;
        else this.delimiters = delimiter.previous;
    }

    /** CommonMark's "process emphasis", with GitHub's ~~ as a third delimiter. */
    private processEmphasis(bottom: Delimiter | null) {
        const openersBottom = new Map<string, Delimiter | null>();
        let closer = this.delimiters;
        while (closer && closer.previous !== bottom) closer = closer.previous;
        while (closer) {
            if (!closer.canClose) { closer = closer.next; continue; }
            const key = closer.char === "~" ? "~" : `${closer.char}${closer.canOpen ? 1 : 0}${closer.original % 3}`;
            const limit = openersBottom.has(key) ? openersBottom.get(key)! : bottom;
            let opener = closer.previous;
            let found = false;
            while (opener && opener !== bottom && opener !== limit) {
                const oddMatch = closer.char !== "~" && (closer.canOpen || opener.canClose) && closer.original % 3 !== 0 && (opener.original + closer.original) % 3 === 0;
                if (opener.char === closer.char && opener.canOpen && !oddMatch) { found = true; break; }
                opener = opener.previous;
            }
            // Emphasis nested past the limit stays as the characters typed, so nothing downstream recurses without end.
            if (found && opener) {
                let inner = 0;
                for (let node = opener.node.next; node && node !== closer.node; node = node.next) if (node.depth > inner) inner = node.depth;
                if (inner + 1 > MAX_INLINE_DEPTH) found = false;
            }
            if (!found || !opener) {
                openersBottom.set(key, closer.previous);
                const next = closer.next;
                if (!closer.canOpen) this.removeDelimiter(closer);
                closer = next;
                continue;
            }
            const use = closer.char === "~" ? 2 : closer.count >= 2 && opener.count >= 2 ? 2 : 1;
            const openerNode = opener.node;
            const closerNode = closer.node;
            opener.count -= use;
            closer.count -= use;
            openerNode.literal = openerNode.literal.slice(0, openerNode.literal.length - use);
            closerNode.literal = closerNode.literal.slice(0, closerNode.literal.length - use);
            const wrapper = new INode(closer.char === "~" ? "strike" : use === 1 ? "emphasis" : "strong");
            let node = openerNode.next;
            while (node && node !== closerNode) {
                const next = node.next;
                wrapper.appendChild(node);
                node = next;
            }
            openerNode.insertAfter(wrapper);
            // The delimiters between the two can no longer match.
            let between = closer.previous;
            while (between && between !== opener) {
                const previous = between.previous;
                this.removeDelimiter(between);
                between = previous;
            }
            if (opener.count === 0) { openerNode.unlink(); this.removeDelimiter(opener); }
            if (closer.count === 0) {
                closerNode.unlink();
                const next = closer.next;
                this.removeDelimiter(closer);
                closer = next;
            }
        }
        while (this.delimiters && this.delimiters !== bottom) this.removeDelimiter(this.delimiters);
    }

    private pushBracket(node: INode, index: number, image: boolean) {
        if (this.brackets) this.brackets.bracketAfter = true;
        const depth = (this.brackets?.depth ?? 0) + 1;
        this.brackets = { node, previous: this.brackets, previousDelimiter: this.delimiters, index, image, active: depth <= MAX_BRACKETS, bracketAfter: false, depth };
    }

    private parseOpenBracket(block: INode): boolean {
        const node = new INode("text", "[");
        block.appendChild(node);
        this.pushBracket(node, this.pos, false);
        this.pos++;
        return true;
    }

    private parseBang(block: INode): boolean {
        if (this.peek(1) === "[") {
            const node = new INode("text", "![");
            block.appendChild(node);
            this.pushBracket(node, this.pos + 1, true);
            this.pos += 2;
        } else {
            this.pos++;
            block.appendChild(new INode("text", "!"));
        }
        return true;
    }

    private parseCloseBracket(block: INode): boolean {
        this.pos++;
        const startPos = this.pos;
        const opener = this.brackets;
        if (!opener || !opener.active) {
            block.appendChild(new INode("text", "]"));
            if (opener) this.brackets = opener.previous;
            return true;
        }
        let destination: string | null = null;
        let title = "";
        let matched = false;
        // An inline link: (destination "title").
        if (this.peek() === "(") {
            this.pos++;
            this.skipSpaces();
            destination = this.parseLinkDestination();
            if (destination !== null) {
                const beforeTitle = this.pos;
                this.skipSpaces();
                if (this.pos > beforeTitle) {
                    const titleMatch = matchAt(LINK_TITLE, this.subject, this.pos);
                    if (titleMatch) {
                        title = unescapeString(titleMatch[0].slice(1, -1));
                        this.pos += titleMatch[0].length;
                        this.skipSpaces();
                    }
                }
                if (this.peek() === ")") { this.pos++; matched = true; }
            }
            if (!matched) this.pos = startPos;
        }
        // A reference link: [text][label], [text][] or [text].
        if (!matched) {
            const labelMatch = matchAt(LINK_LABEL, this.subject, this.pos);
            let label: string | null = null;
            if (labelMatch && labelMatch[0].length > 2) label = labelMatch[0].slice(1, -1);
            else if (!opener.bracketAfter && startPos - opener.index - 2 <= MAX_LABEL) label = this.subject.slice(opener.index + 1, startPos - 1);
            const ref = label !== null && label.trim() ? this.refs.get(normalizeLabel(label)) : undefined;
            if (ref) {
                destination = ref.destination;
                title = ref.title;
                matched = true;
                if (labelMatch) this.pos += labelMatch[0].length;
            }
        }
        if (!matched) {
            this.pos = startPos;
            this.brackets = opener.previous;
            block.appendChild(new INode("text", "]"));
            return true;
        }
        const link = new INode(opener.image ? "image" : "link");
        link.destination = destination ?? "";
        link.title = title;
        link.line = this.lineOf(opener.index);
        let node = opener.node.next;
        while (node) {
            const next = node.next;
            link.appendChild(node);
            node = next;
        }
        block.appendChild(link);
        this.processEmphasis(opener.previousDelimiter);
        this.brackets = opener.previous;
        opener.node.unlink();
        // No links inside links.
        if (!opener.image) for (let b = this.brackets; b; b = b.previous) if (!b.image) b.active = false;
        return true;
    }

    /** Spaces and tabs, with at most one line break among them. */
    private skipSpaces() {
        let newlines = 0;
        while (this.pos < this.subject.length) {
            const c = this.subject[this.pos];
            if (c === "\n") { if (++newlines > 1) break; }
            else if (c !== " " && c !== "\t") break;
            this.pos++;
        }
    }

    private parseLinkDestination(): string | null {
        const braces = matchAt(LINK_DESTINATION_BRACES, this.subject, this.pos);
        if (braces) {
            this.pos += braces[0].length;
            return unescapeString(braces[0].slice(1, -1));
        }
        if (this.peek() === "<") return null;
        let depth = 0;
        let i = this.pos;
        while (i < this.subject.length) {
            const c = this.subject[i];
            if (c === "\\" && i + 1 < this.subject.length && ASCII_PUNCTUATION.test(this.subject[i + 1])) { i += 2; continue; }
            if (c === "(") { depth++; i++; continue; }
            if (c === ")") { if (depth < 1) break; depth--; i++; continue; }
            if (c <= " ") break;
            i++;
        }
        if (depth !== 0) return null;
        if (i === this.pos && this.subject[i] !== ")") return null;
        const raw = this.subject.slice(this.pos, i);
        this.pos = i;
        return unescapeString(raw);
    }

    /** Where an HTML comment, processing instruction, CDATA section or declaration that starts here ends, or -1. They say nothing in the document. */
    private markupEnd(at: number): number {
        const text = this.subject;
        let end: number;
        if (text.startsWith("<!--", at)) {
            if (text.startsWith("<!-->", at)) return at + 5;
            if (text.startsWith("<!--->", at)) return at + 6;
            return (end = this.findCloser("-->", at + 4)) < 0 ? -1 : end + 3;
        }
        if (text.startsWith("<?", at)) return (end = this.findCloser("?>", at + 2)) < 0 ? -1 : end + 2;
        if (text.startsWith("<![CDATA[", at)) return (end = this.findCloser("]]>", at + 9)) < 0 ? -1 : end + 3;
        if (text.startsWith("<!", at) && /[A-Za-z]/.test(text[at + 2] ?? "")) return (end = this.findCloser(">", at + 2)) < 0 ? -1 : end + 1;
        return -1;
    }

    private parseAngle(block: INode): boolean {
        const at = this.pos;
        let match: RegExpExecArray | null;
        if ((match = matchAt(EMAIL_AUTOLINK, this.subject, at))) {
            const link = new INode("link");
            link.destination = `mailto:${match[1]}`;
            link.appendChild(new INode("text", match[1]));
            block.appendChild(link);
            this.pos += match[0].length;
            return true;
        }
        if ((match = matchAt(AUTOLINK, this.subject, at))) {
            const url = match[0].slice(1, -1);
            const link = new INode("link");
            link.destination = url;
            link.appendChild(new INode("text", url));
            block.appendChild(link);
            this.pos += match[0].length;
            return true;
        }
        const markup = this.markupEnd(at);
        if (markup > at) {
            this.pos = markup;
            return true;
        }
        if ((match = matchAt(HTML_CLOSE_TAG, this.subject, at))) {
            this.pos += match[0].length;
            const name = match[1].toLowerCase();
            if (HTML_FORMATS[name] || name === "a") {
                const node = new INode("html");
                node.tag = name;
                node.closing = true;
                block.appendChild(node);
            }
            return true;
        }
        if ((match = matchAt(HTML_OPEN_TAG, this.subject, at))) {
            this.pos += match[0].length;
            const name = match[1].toLowerCase();
            const attrs = parseAttributes(match[2]);
            if (name === "br") {
                block.appendChild(new INode("break"));
            } else if (name === "img") {
                const image = new INode("image");
                image.destination = attrs.src ?? "";
                image.title = attrs.title ?? "";
                image.line = this.lineOf(at);
                if (attrs.alt) image.appendChild(new INode("text", attrs.alt));
                block.appendChild(image);
            } else if ((HTML_FORMATS[name] || name === "a") && !match[3]) {
                const node = new INode("html");
                node.tag = name;
                node.destination = attrs.href ?? "";
                node.title = attrs.title ?? "";
                block.appendChild(node);
            }
            return true;
        }
        this.pos++;
        block.appendChild(new INode("text", "<"));
        return true;
    }

    private parseEntity(block: INode): boolean {
        const match = matchAt(ENTITY, this.subject, this.pos);
        const decoded = match && decodeEntity(match);
        if (match && decoded !== null) {
            this.pos += match[0].length;
            block.appendChild(new INode("text", decoded));
        } else {
            this.pos++;
            block.appendChild(new INode("text", "&"));
        }
        return true;
    }
}

function parseAttributes(text: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of text.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        attrs[match[1].toLowerCase()] = unescapeString(match[2] ?? match[3] ?? match[4] ?? "");
    }
    return attrs;
}

function insideLink(node: INode): boolean {
    for (let p: INode | null = node; p; p = p.parent) if (p.type === "link") return true;
    return false;
}

/** What a pair of formatting tags becomes: a link for <a href>, never inside another link, or the formatting the tag means. */
function htmlWrapper(opener: INode, parent: INode): INode | null {
    if (opener.tag === "a") {
        if (!opener.destination || insideLink(parent)) return null;
        const link = new INode("link");
        link.destination = opener.destination;
        link.title = opener.title;
        return link;
    }
    const kind = HTML_FORMATS[opener.tag];
    if (kind === "strong" || kind === "emphasis" || kind === "strike") return new INode(kind);
    const format = new INode("format");
    format.format = kind;
    return format;
}

/**
 * Pair the inline HTML tags that carry formatting, among siblings; an
 * unpaired or misnested tag is left out, and so is one nested past the limit.
 */
function pairHtml(parent: INode) {
    const open = new Map<string, INode[]>();
    const opened: INode[] = [];
    for (const node of parent.childList()) {
        if (node.firstChild) pairHtml(node);
        if (node.type !== "html") continue;
        if (!node.closing) {
            const stack = open.get(node.tag);
            if (stack) stack.push(node);
            else open.set(node.tag, [node]);
            opened.push(node);
            continue;
        }
        const opener = open.get(node.tag)?.pop();
        if (!opener || opener.parent !== node.parent) { node.unlink(); continue; }
        let inner = 0;
        for (let child = opener.next; child && child !== node; child = child.next) if (child.depth > inner) inner = child.depth;
        // Nested too deep, the tags are left out and their text kept.
        const wrapper = inner + 1 > MAX_INLINE_DEPTH ? null : htmlWrapper(opener, parent);
        if (wrapper) {
            let child = opener.next;
            while (child && child !== node) {
                const next = child.next;
                wrapper.appendChild(child);
                child = next;
            }
            node.insertBefore(wrapper);
        }
        opener.unlink();
        node.unlink();
    }
    // Paired tags are gone already; this takes out the ones that never closed.
    for (const left of opened) left.unlink();
}

function mergeText(parent: INode) {
    let node = parent.firstChild;
    while (node) {
        if (node.firstChild) mergeText(node);
        const next: INode | null = node.next;
        if (node.type === "text" && !node.literal) {
            node.unlink();
        } else if (node.type === "text" && next && next.type === "text") {
            node.literal += next.literal;
            next.unlink();
            continue;
        } else if (node.type === "html") {
            node.unlink();
        }
        node = next;
    }
}

// GitHub's extended autolinks: www., http:// and https:// addresses and e-mail addresses in running text.
/** Where a bare web address may start: http://, https:// or www. at the start or after a space, *, _, ~ or (. */
const ADDRESS_START = /(^|[\s*_~(])(?:https?:\/\/|www\.)/g;
/** A web address's scheme (none for www.) and domain, read where it stands. */
const ADDRESS_DOMAIN = /(?:https?:\/\/)?([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)/y;
const ADDRESS_PATH = /[^\s<]*/y;
const BARE_EMAIL = /(^|[^A-Za-z0-9.+_-])([A-Za-z0-9._+-]+@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)/g;

/** GitHub's extended autolinks start a line, or follow a space, *, _, ~ or (. */
function addressMayStart(text: string, at: number): boolean {
    const before = at > 0 ? text[at - 1] : "\n";
    return isWhitespaceChar(before) || "*_~(".includes(before);
}

/**
 * A valid domain, as cmark-gfm checks it: no underscore in its last two
 * segments. Like cmark-gfm, a domain of more than ten segments passes
 * anyway, which keeps rejecting candidates linear.
 */
function validDomain(domain: string): boolean {
    const last = domain.lastIndexOf(".");
    const second = last > 0 ? domain.lastIndexOf(".", last - 1) : -1;
    if (!domain.includes("_", second + 1)) return true;
    let periods = 0;
    for (let i = 0; i < domain.length && periods <= 10; i++) if (domain[i] === ".") periods++;
    return periods > 10;
}

/**
 * The web address that starts at `at` with http://, https:// or www., as
 * GitHub's extended autolinks read it, or "" when there is none. The domain
 * is checked before the rest is read, so a rejected candidate costs only its
 * domain, and an accepted one always keeps its whole domain.
 */
function readWebAddress(text: string, at: number): string {
    const domain = matchAt(ADDRESS_DOMAIN, text, at);
    if (!domain || !validDomain(domain[1])) return "";
    const pathEnd = at + domain[0].length + matchAt(ADDRESS_PATH, text, at + domain[0].length)![0].length;
    return trimAutolink(text.slice(at, pathEnd));
}

function isAsciiAlphanumeric(c: string): boolean {
    return (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

/**
 * Trailing punctuation is not part of an address, nor is a closing
 * parenthesis it never opened, nor an ending that looks like an entity
 * (&hl;), as cmark-gfm trims them. Unlike cmark-gfm, an unopened ] is trimmed
 * too, so "[see https://example.com]" links the address alone. Each
 * character is looked at a bounded number of times.
 */
function trimAutolink(url: string): string {
    let end = url.length;
    let closing = 0;
    let opening = 0;
    let closingSquare = 0;
    let openingSquare = 0;
    for (const c of url) {
        if (c === ")") closing++;
        else if (c === "(") opening++;
        else if (c === "]") closingSquare++;
        else if (c === "[") openingSquare++;
    }
    while (end > 0) {
        const c = url[end - 1];
        if ("?!.,:*_~'\"".includes(c)) { end--; continue; }
        if (c === ")" && closing > opening) { end--; closing--; continue; }
        if (c === "]" && closingSquare > openingSquare) { end--; closingSquare--; continue; }
        if (c === ";") {
            let i = end - 2;
            while (i >= 0 && isAsciiAlphanumeric(url[i])) i--;
            end = i >= 0 && i < end - 2 && url[i] === "&" ? i : end - 1;
            continue;
        }
        break;
    }
    return url.slice(0, end);
}

function autolink(parent: INode) {
    for (const node of parent.childList()) {
        if (node.type === "link" || node.type === "image" || node.type === "code" || node.type === "math") continue;
        if (node.firstChild) { autolink(node); continue; }
        if (node.type !== "text") continue;
        const text = node.literal;
        if (!/www\.|https?:\/\/|@/.test(text)) continue;
        const found: { start: number; end: number; href: string; label: string }[] = [];
        ADDRESS_START.lastIndex = 0;
        for (let match = ADDRESS_START.exec(text); match; match = ADDRESS_START.exec(text)) {
            const start = match.index + match[1].length;
            const label = readWebAddress(text, start);
            if (!label) continue;
            found.push({ start, end: start + label.length, href: label.startsWith("www.") ? `http://${label}` : label, label });
            ADDRESS_START.lastIndex = start + label.length;
        }
        // Addresses can only overlap web addresses (the e-mail matches don't overlap each other), and both come in text order.
        const urls = found.length;
        let u = 0;
        for (const match of text.matchAll(BARE_EMAIL)) {
            const label = match[2].slice(0, endWithout(match[2], "._-", match[2].length));
            const start = match.index! + match[1].length;
            while (u < urls && found[u].end <= start) u++;
            if (!/\.[A-Za-z]{2,}$/.test(label) || (u < urls && found[u].start < start + label.length)) continue;
            found.push({ start, end: start + label.length, href: `mailto:${label}`, label });
        }
        if (!found.length) continue;
        found.sort((a, b) => a.start - b.start);
        let at = 0;
        for (const link of found) {
            if (link.start < at) continue;
            if (link.start > at) node.insertBefore(new INode("text", text.slice(at, link.start)));
            const anchor = new INode("link");
            anchor.destination = link.href;
            anchor.appendChild(new INode("text", link.label));
            node.insertBefore(anchor);
            at = link.end;
        }
        if (at < text.length) node.insertBefore(new INode("text", text.slice(at)));
        node.unlink();
    }
}

function plainText(node: INode): string {
    let out = "";
    for (let child = node.firstChild; child; child = child.next) {
        if (child.type === "text" || child.type === "code") out += child.literal;
        else if (child.type === "math") out += child.source;
        else if (child.type === "softbreak" || child.type === "break") out += " ";
        else out += plainText(child);
    }
    return out;
}

function toInlines(parent: INode): Inline[] {
    const out: Inline[] = [];
    for (let node = parent.firstChild; node; node = node.next) {
        switch (node.type) {
            case "text": if (node.literal) out.push({ type: "text", value: node.literal }); break;
            case "code": out.push({ type: "code", value: node.literal }); break;
            case "break": out.push({ type: "break" }); break;
            case "softbreak": out.push({ type: "softbreak" }); break;
            case "strong": case "emphasis": case "strike": out.push({ type: node.type, children: toInlines(node) }); break;
            case "format": out.push({ type: "format", format: node.format, children: toInlines(node) }); break;
            case "link": out.push({ type: "link", href: node.destination, title: node.title, children: toInlines(node) }); break;
            case "image": out.push({ type: "image", src: node.destination, alt: plainText(node).trim(), title: node.title, line: node.line }); break;
            case "math": out.push({ type: "math", tex: node.literal, display: node.display, source: node.source, line: node.line }); break;
            default: break;
        }
    }
    return out;
}

// ── From the block tree to the document ───────────────────────────────────────

/** A task list item's box at the start of its first paragraph: [ ], [x] or [X], then a space. */
const TASK_MARKER = /^\[([ xX])\][ \t]+/;

class Builder {
    private readonly inline: InlineParser;

    constructor(refs: Map<string, LinkReference>) {
        this.inline = new InlineParser(refs);
    }

    /** Inline content of lines, each of which came from the given source line. */
    private inlines(lines: string[], lineNumbers: number[]): Inline[] {
        const starts: number[] = [];
        let offset = 0;
        for (const line of lines) { starts.push(offset); offset += line.length + 1; }
        return this.inline.parse(lines.join("\n"), at => {
            // The last line that starts at or before the offset.
            let low = 0;
            let high = starts.length - 1;
            while (low < high) {
                const middle = (low + high + 1) >> 1;
                if (starts[middle] <= at) low = middle;
                else high = middle - 1;
            }
            return lineNumbers[low] ?? lineNumbers[0] ?? 0;
        });
    }

    blocks(raw: RawBlock[]): Block[] {
        const out: Block[] = [];
        for (const block of raw) {
            const built = this.block(block);
            if (built) out.push(built);
        }
        return out;
    }

    private block(raw: RawBlock): Block | null {
        const line = raw.startLine;
        switch (raw.kind) {
            case "paragraph":
                return { type: "paragraph", children: this.inlines(raw.lines.map(text => text.replace(/^[ \t]+/, "")), raw.lineNumbers), line };
            case "heading": {
                const level = Math.min(6, Math.max(1, raw.level ?? 1)) as 1 | 2 | 3 | 4 | 5 | 6;
                const content = raw.content ?? "";
                return { type: "heading", level, children: this.inlines(content.split("\n"), raw.lineNumbers.length ? raw.lineNumbers : [line]), line };
            }
            case "thematicBreak":
                return { type: "thematicBreak", line };
            case "fenced":
                return { type: "code", lang: (raw.info ?? "").split(/\s+/)[0] ?? "", value: raw.lines.join("\n"), line };
            case "indented":
                return { type: "code", lang: "", value: raw.lines.join("\n"), line };
            case "math": {
                const tex = raw.lines.join("\n").trim();
                return tex ? { type: "math", tex, source: raw.rawLines!.join("\n").trim(), line } : null;
            }
            case "blockquote":
                return { type: "blockquote", children: this.blocks(raw.children), line };
            case "list": {
                const data = raw.listData!;
                const items = raw.children.map(item => this.listItem(item));
                return { type: "list", ordered: data.ordered, start: data.start, delimiter: data.delimiter, tight: raw.tight ?? true, items, line };
            }
            case "table": {
                const width = raw.align!.length;
                const cells = (row: string, rowLine: number) => {
                    const parts = splitTableRow(row).slice(0, width);
                    while (parts.length < width) parts.push("");
                    return parts.map(part => this.inlines([part], [rowLine]));
                };
                return { type: "table", align: raw.align!, head: cells(raw.headerRow ?? "", line), rows: raw.lines.map((row, index) => cells(row, raw.lineNumbers[index] ?? line)), line };
            }
            default:
                return null;
        }
    }

    private listItem(item: RawBlock): ListItem {
        let checked: boolean | null = null;
        const first = item.children[0];
        if (first && first.kind === "paragraph" && first.lines.length) {
            const lead = first.lines[0].replace(/^[ \t]+/, "");
            const marker = TASK_MARKER.exec(lead);
            if (marker && (lead.length > marker[0].length || first.lines.length > 1)) {
                checked = marker[1] !== " ";
                first.lines[0] = lead.slice(marker[0].length);
            }
        }
        return { checked, children: this.blocks(item.children) };
    }
}

/** Read Markdown into a document tree. Line numbers count from 1. */
export function parseMarkdown(source: string): MarkdownDocument {
    const text = source.replace(/^\u{feff}/u, "").replace(/\r\n?/g, "\n");
    const parser = new BlockParser();
    const root = parser.parse(text);
    return { children: new Builder(parser.refs).blocks(root.children) };
}

/** The text a run of inline content reads as, for bookmarks, titles and alt text. */
export function inlineText(inlines: Inline[]): string {
    let out = "";
    for (const node of inlines) {
        switch (node.type) {
            case "text": case "code": out += node.value; break;
            case "math": out += node.tex; break;
            case "image": out += node.alt; break;
            case "break": case "softbreak": out += " "; break;
            case "strong": case "emphasis": case "strike": case "format": case "link": out += inlineText(node.children); break;
        }
    }
    return out;
}

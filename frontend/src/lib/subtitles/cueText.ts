/**
 * A cue's text, taken apart for translation and put back together.
 *
 * A cue holds one or more speakers' lines ("- Are you coming?" / "- Yes."),
 * each a part. A part's words are what gets translated; everything around
 * them stays exactly as written: a position override such as {\an8}, the tags
 * that wrap the whole line (italics for a voice off screen, a VTT voice or
 * class span), a dialogue dash, a speaker's label, music notes. Formatting
 * inside the words (one italic word) is carried where the engine can carry
 * it, which only a language model told to keep <i>, <b> and <u> can, and is
 * otherwise left out and counted, so a file never ends up with a tag cut in
 * half.
 *
 * The same reading converts a cue's markup when a file is saved in the other
 * format: SRT keeps <i>, <b> and <u>; VTT keeps those and escapes its text;
 * what the other format can't show is left out and counted.
 */
import type { SubtitleFormat } from "./subtitleFile";
import { breakOffsets, wrapCaption, type CaptionLayout } from "./captions";

type Token =
    | { type: "text"; value: string }
    /** A tag: <i>, </i>, <c.yellow>, <v Bob>, <font color="red">, or a VTT timestamp. */
    | { type: "tag"; raw: string; name: string; closing: boolean }
    /** An SSA override carried in SRT text, such as {\an8}. */
    | { type: "override"; raw: string };

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*|\d[\d:.]*)((?:[.\s][^<>]*)?)>/y;
const OVERRIDE = /\{\\[^{}]*\}/y;

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let plain = "";
    const flush = () => { if (plain) tokens.push({ type: "text", value: plain }); plain = ""; };
    for (let i = 0; i < text.length;) {
        if (text[i] === "<") {
            TAG.lastIndex = i;
            const m = TAG.exec(text);
            if (m) {
                flush();
                const name = /^\d/.test(m[2]) ? "timestamp" : m[2].toLowerCase();
                tokens.push({ type: "tag", raw: m[0], name, closing: m[1] === "/" });
                i += m[0].length;
                continue;
            }
        } else if (text[i] === "{" && text[i + 1] === "\\") {
            OVERRIDE.lastIndex = i;
            const m = OVERRIDE.exec(text);
            if (m) {
                flush();
                tokens.push({ type: "override", raw: m[0] });
                i += m[0].length;
                continue;
            }
        }
        plain += text[i++];
    }
    flush();
    return tokens;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", lrm: "‎", rlm: "‏" };

/** Character references as characters: &amp; and the rest WebVTT names, and numeric ones. */
export function decodeEntities(text: string): string {
    return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, ref: string) => {
        if (ref[0] === "#") {
            const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[ref.toLowerCase()] ?? whole;
    });
}

/** WebVTT reads "&" and "<" as markup; ">" is escaped too so nothing can be taken for a tag. */
export function escapeVtt(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Direction marks and embeddings, which mean nothing to a translator and would steer its output. */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The three tags both formats show and a model can keep. */
const SIMPLE = new Set(["i", "b", "u"]);

/* ── Parts ───────────────────────────────────────────────────────────── */

export interface CuePart {
    /** What stands before the words, as written: overrides, opening tags, a dialogue dash, a speaker label, music notes. */
    before: string;
    /** The words as plain text: tags out, entities decoded, spaces collapsed. What an on-device model translates. */
    text: string;
    /** The words with the <i>, <b> and <u> spans inside them, for a model told to keep them. */
    markup: string;
    after: string;
    /** Formatting inside the words that `text` leaves out, and that `markup` leaves out. */
    plainDrops: number;
    markupDrops: number;
    /** A new speaker's turn: a dialogue dash, a voice span or a speaker's label starts it. */
    turn: boolean;
    /** The tags wrapping the words, such as "i": a voice off screen is set apart from speech on screen. */
    style: string;
    /** Has letters to translate; a part of only music notes or numbers is kept as it is. */
    translatable: boolean;
    /** The part as written, its lines joined by line breaks. */
    raw: string;
}

/** A dialogue dash: one dash before words, never a minus sign before a number or a dash doubled into a rule. */
const DASH = /^[-–—‐](?![-–—‐])(?=\s*[^\s\d])/;
/** A speaker's label in capitals, such as "JOHN: " or "MAN 2: ". */
const SPEAKER = /^[A-Z][A-Z0-9 .'’-]*[A-Z0-9]:\s+(?=\S)/;
const NOTES = /^[♪♫♬]+/;
const NO_SPACE_SCRIPT = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

/** What a line shows: its text without tags and overrides. */
function shown(line: string): string {
    return tokenize(line).filter(token => token.type === "text").map(token => (token as { value: string }).value).join("");
}
const shownStart = (line: string) => shown(line).trimStart();

function startsTurn(line: string): boolean {
    const first = tokenize(line).find(token => token.type !== "override" && !(token.type === "text" && !token.value.trim()));
    if (first?.type === "tag" && first.name === "v" && !first.closing) return true;
    const shown = shownStart(line);
    return DASH.test(shown) || SPEAKER.test(shown);
}

/** Two lines of one part become one: with a space, or without one between two words of a script written without spaces. */
function joinLines(a: string, b: string): string {
    const last = Array.from(shown(a).trimEnd()).pop() ?? "";
    const first = Array.from(shownStart(b))[0] ?? "";
    return a + (NO_SPACE_SCRIPT.test(last) && NO_SPACE_SCRIPT.test(first) ? "" : " ") + b;
}

/** A tag closed and opened again across a line break (</i> <i>) is one span. */
function mergeSpans(tokens: Token[]): Token[] {
    const out: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const space = tokens[i + 1];
        const next = space?.type === "text" && !space.value.trim() ? tokens[i + 2] : space;
        if (token.type === "tag" && token.closing && next?.type === "tag" && !next.closing && next.name === token.name && next.name !== "v") {
            if (next !== space) out.push(space);
            i += next === space ? 1 : 2;
            continue;
        }
        out.push(token);
    }
    return out;
}

const rawOf = (tokens: Token[]) => tokens.map(token => (token.type === "text" ? token.value : token.raw)).join("");

/** Split a part into what stands before the words, the words, and what stands after them. */
function frame(tokens: Token[]): { before: Token[]; core: Token[]; after: Token[]; turn: boolean } {
    const before: Token[] = [];
    let turn = false;
    let i = 0;
    let dashTaken = false;
    while (i < tokens.length) {
        const token = tokens[i];
        if (token.type !== "text") {
            if (token.type === "tag" && token.name === "v" && !token.closing) turn = true;
            before.push(token);
            i++;
            continue;
        }
        let rest = token.value;
        let lead = "";
        for (;;) {
            const space = /^\s+/.exec(rest)?.[0] ?? "";
            if (space) { lead += space; rest = rest.slice(space.length); continue; }
            const notes = NOTES.exec(rest)?.[0];
            if (notes) { lead += notes; rest = rest.slice(notes.length); continue; }
            if (!dashTaken) {
                const dash = DASH.exec(rest)?.[0];
                if (dash) { lead += dash; rest = rest.slice(dash.length); dashTaken = turn = true; continue; }
                const speaker = SPEAKER.exec(rest)?.[0];
                if (speaker) { lead += speaker; rest = rest.slice(speaker.length); dashTaken = turn = true; continue; }
            }
            break;
        }
        if (lead) before.push({ type: "text", value: lead });
        if (rest) {
            tokens = [...tokens.slice(0, i), { type: "text", value: rest }, ...tokens.slice(i + 1)];
            break;
        }
        i++;
    }
    const after: Token[] = [];
    let j = tokens.length;
    while (j > i) {
        const token = tokens[j - 1];
        if (token.type === "tag" && token.closing) { after.unshift(token); j--; continue; }
        if (token.type === "text") {
            const tail = /(?:\s|[♪♫♬])+$/.exec(token.value)?.[0] ?? "";
            if (tail.length === token.value.length) { after.unshift(token); j--; continue; }
            if (tail) {
                after.unshift({ type: "text", value: tail });
                tokens = [...tokens.slice(0, j - 1), { type: "text", value: token.value.slice(0, -tail.length) }, ...tokens.slice(j)];
            }
        }
        break;
    }
    const core = tokens.slice(i, j);
    // A wrapping tag whose partner is among the words wraps only some of them: it belongs with the words.
    // The innermost moves first, so the tags keep their order.
    for (let k = before.length - 1; k >= 0; k--) {
        const token = before[k];
        if (token.type === "tag" && !token.closing && core.some(other => other.type === "tag" && other.closing && other.name === token.name)) {
            core.unshift(token);
            before.splice(k, 1);
        }
    }
    for (;;) {
        const closer = after.findIndex(token => token.type === "tag" && token.closing
            && core.some(other => other.type === "tag" && !other.closing && other.name === token.name)
            && !before.some(other => other.type === "tag" && !other.closing && other.name === token.name));
        if (closer < 0) break;
        core.push(after[closer]);
        after.splice(closer, 1);
    }
    return { before, core, after, turn };
}

/** The words of a part's core: as plain text, and with only balanced <i>, <b> and <u> spans kept. */
function words(core: Token[]): { text: string; markup: string; plainDrops: number; markupDrops: number } {
    let text = "";
    let markup = "";
    let plainDrops = 0;
    let markupDrops = 0;
    let inRuby = 0;
    // Only spans that open and close in order are kept, all or none.
    const stack: string[] = [];
    let balanced = true;
    for (const token of core) {
        if (token.type !== "tag" || !SIMPLE.has(token.name)) continue;
        if (!token.closing) stack.push(token.name);
        else if (stack.pop() !== token.name) balanced = false;
    }
    if (stack.length) balanced = false;
    for (const token of core) {
        if (token.type === "text") {
            if (inRuby) continue;
            const value = decodeEntities(token.value).replace(BIDI_CONTROLS, "");
            text += value;
            markup += value;
            continue;
        }
        if (token.type === "override") { plainDrops++; markupDrops++; continue; }
        if (token.name === "rt") { inRuby += token.closing ? -1 : 1; inRuby = Math.max(0, inRuby); continue; }
        if (token.closing) {
            if (balanced && SIMPLE.has(token.name)) markup += `</${token.name}>`;
            continue;
        }
        plainDrops++;
        if (balanced && SIMPLE.has(token.name)) markup += `<${token.name}>`;
        else markupDrops++;
    }
    // Spaces just inside a span move outside it, so words and tags line up for wrapping.
    markup = markup.replace(/<(i|b|u)>(\s+)/g, "$2<$1>").replace(/(\s+)<\/(i|b|u)>/g, "</$2>$1");
    return { text: tidy(text), markup: tidy(markup).replace(/<(i|b|u)><\/\1>/g, ""), plainDrops, markupDrops };
}

/**
 * The parts of a cue: one, or one per speaker when its lines start with a
 * dialogue dash, a voice span or a speaker's label.
 */
export function cueParts(lines: readonly string[]): CuePart[] {
    const groups: string[][] = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        if (!groups.length || startsTurn(line)) groups.push([line]);
        else groups[groups.length - 1].push(line);
    }
    return groups.map(group => {
        const joined = group.reduce((all, line) => joinLines(all, line));
        const { before, core, after, turn } = frame(mergeSpans(tokenize(joined)));
        const found = words(core);
        const style = before.filter(token => token.type === "tag" && !token.closing && token.name !== "v").map(token => (token as { name: string }).name).sort().join("+");
        return {
            before: rawOf(before), after: rawOf(after), ...found, turn, style,
            translatable: /\p{L}/u.test(found.text),
            raw: group.join("\n"),
        };
    });
}

/* ── Putting a translated cue back ───────────────────────────────────── */

/** Visible characters of a stretch of markup. */
function visible(text: string): number {
    return Array.from(rawOf(tokenize(text).filter(token => token.type === "text"))).length;
}

/**
 * Line breaks at the given offsets of the words' visible text, put into the
 * markup at the same places: tags are not counted, and the space at a break
 * goes. Works the same for scripts written without spaces.
 */
function breakMarkup(markup: string, offsets: number[]): string {
    if (!offsets.length) return markup;
    const tokens = tokenize(markup);
    let seen = 0;
    let next = 0;
    let out = "";
    for (const token of tokens) {
        if (token.type !== "text") { out += token.raw; continue; }
        for (const ch of token.value) {
            if (next < offsets.length && seen === offsets[next]) {
                out = out.replace(/\s+$/, "") + "\n";
                next++;
                if (/\s/.test(ch)) { seen += ch.length; continue; }
            }
            if (!(out.endsWith("\n") && /\s/.test(ch))) out += ch;
            seen += ch.length;
        }
    }
    return out;
}

/** The words without their tags. Translations arrive as plain characters, so there is nothing to decode. */
const plainOf = (markup: string) => rawOf(tokenize(markup).filter(token => token.type === "text"));

export interface RenderedCue {
    /** The cue's text in the source file's markup. */
    text: string;
    /** It runs longer than the layout's lines, because the words would not fit otherwise. */
    long: boolean;
}

/**
 * A cue with its parts' words translated: each part's own marks around its
 * new words, and the words wrapped to the layout's lines. One speaker's words
 * are wrapped to at most two lines, as evenly as the words allow; a cue with
 * several speakers keeps one line for each. When the words can't fit, the
 * lines run long rather than the timing changing. `words[i]` is the part's
 * translation, plain or with <i>, <b> and <u>; null keeps the part as written.
 */
export function renderCue(parts: readonly CuePart[], translated: readonly (string | null)[], format: SubtitleFormat, layout: CaptionLayout): RenderedCue {
    const write = (markup: string) => format === "vtt"
        ? tokenize(markup).map(token => token.type === "text" ? escapeVtt(token.value) : token.raw).join("")
        : markup;
    let long = false;
    const lines = parts.map((part, i) => {
        const words = translated[i];
        if (words === null || words === undefined) return part.raw;
        const markup = tidy(words);
        if (parts.length > 1) {
            if (visible(part.before) + visible(markup) + visible(part.after) > layout.maxLineChars) long = true;
            return `${part.before}${write(markup)}${part.after}`;
        }
        const room = Math.max(10, layout.maxLineChars - visible(part.before) - visible(part.after));
        const plain = tidy(plainOf(markup));
        let wrapped = wrapCaption(plain, { ...layout, maxLineChars: room });
        if (!wrapped) {
            long = true;
            // Two lines broken nearest the middle: longer than the layout, never more lines.
            const breaks = breakOffsets(plain);
            const middle = plain.length / 2;
            const at = breaks.reduce<number | null>((best, offset) => best === null || Math.abs(offset - middle) < Math.abs(best - middle) ? offset : best, null);
            wrapped = at === null || layout.maxLines < 2 ? [plain] : [plain.slice(0, at).trim(), plain.slice(at).trim()];
        }
        const offsets: number[] = [];
        let at = 0;
        for (const line of wrapped.slice(0, -1)) {
            const found = plain.indexOf(line, at);
            if (found < 0) break;
            at = found + line.length;
            offsets.push(at);
        }
        return `${part.before}${write(breakMarkup(markup, offsets))}${part.after}`;
    });
    return { text: lines.join("\n"), long };
}

/* ── From one format's markup to the other's ─────────────────────────── */

/**
 * A cue's text in the other format's markup. Both keep <i>, <b> and <u>;
 * to VTT the text is escaped, and SRT's colours and position overrides are
 * left out; to SRT the escapes are undone, and VTT's voice, class, language
 * and ruby spans and its karaoke timestamps are left out (a ruby reading with
 * its tags). `dropped` counts the spans left out.
 */
export function convertCueMarkup(text: string, from: SubtitleFormat, to: SubtitleFormat): { text: string; dropped: number } {
    if (from === to) return { text, dropped: 0 };
    let dropped = 0;
    let inRuby = 0;
    let out = "";
    for (const token of tokenize(text)) {
        if (token.type === "override") { dropped++; continue; }
        if (token.type === "text") {
            if (inRuby) continue;
            const value = decodeEntities(token.value);
            out += to === "vtt" ? escapeVtt(value) : value;
            continue;
        }
        if (token.name === "rt") {
            if (!token.closing) dropped++;
            inRuby = Math.max(0, inRuby + (token.closing ? -1 : 1));
            continue;
        }
        if (SIMPLE.has(token.name)) { out += token.closing ? `</${token.name}>` : `<${token.name}>`; continue; }
        if (!token.closing) dropped++;
    }
    return { text: out, dropped };
}

/**
 * Translating a subtitle file cue by cue, with either engine, and putting the
 * result back without moving a cue or changing a timing.
 *
 * On this device (OPUS-MT): each passage (lib/subtitles/passages.ts) is
 * translated as one text, in pieces counted in the model's own tokens, and
 * the translation is shared out across the passage's cues. A passage whose
 * translation is far longer than its source is marked for checking: that is
 * how the model looks when it invents a sentence for a fragment.
 *
 * With the visitor's own AI key: the lines go in numbered batches of whole
 * passages, small enough for any model's output limit, and the reply has to
 * carry back the same numbers, one for one (lib/byok/tasks.ts). A batch whose
 * reply doesn't match, or that was cut off, is tried once more in two
 * halves; lines that fail again are marked as not translated and keep their
 * own text. Text is never moved from one cue to another to make a reply fit.
 */
import { joinWords, type TokenRun } from "@/lib/translate/chunk";
import type { CaptionLayout } from "./captions";
import { cueParts, renderCue, type CuePart } from "./cueText";
import { distribute, groupPassages, type PassagePart } from "./passages";
import { cuesOf, writeSubtitles, type Dropped, type SubtitleDocument, type SubtitleFormat } from "./subtitleFile";

export interface PlanItem {
    /** The cue it belongs to, by its place among the file's cues, and which of the cue's parts it is. */
    cue: number;
    part: number;
    /** The words, plain. */
    text: string;
    /** The words with the <i>, <b> and <u> spans they carry. */
    markup: string;
    /** Starts with a dialogue dash. */
    dash: boolean;
}

export interface TranslationPlan {
    /** Each cue's parts. */
    cues: CuePart[][];
    /** The parts with words to translate, in order. */
    items: PlanItem[];
    /** The items, by index, grouped into passages. */
    passages: number[][];
}

const HAS_DASH = /[-–—‐]/;

export function planTranslation(doc: SubtitleDocument): TranslationPlan {
    const cues = cuesOf(doc);
    const parts = cues.map(cue => cueParts(cue.lines));
    const items: PlanItem[] = [];
    const passageParts: PassagePart[] = [];
    parts.forEach((list, c) => list.forEach((part, p) => {
        if (!part.translatable) return;
        items.push({ cue: c, part: p, text: part.text, markup: part.markup, dash: part.turn && HAS_DASH.test(part.before) });
        passageParts.push({ text: part.text, turn: part.turn, style: part.style, cue: c, start: cues[c].start, end: cues[c].end });
    }));
    return { cues: parts, items, passages: groupPassages(passageParts) };
}

/**
 * The plan for some of its items only, such as the lines a run left marked,
 * each passage cut down to them. `map[k]` is the full plan's index of the
 * smaller plan's item k.
 */
export function subPlan(plan: TranslationPlan, indices: readonly number[]): { plan: TranslationPlan; map: number[] } {
    const keep = new Set(indices);
    const map = plan.items.map((_, index) => index).filter(index => keep.has(index));
    const position = new Map(map.map((original, k) => [original, k]));
    return {
        plan: {
            cues: plan.cues,
            items: map.map(index => plan.items[index]),
            passages: plan.passages.map(passage => passage.filter(index => keep.has(index)).map(index => position.get(index)!)).filter(passage => passage.length > 0),
        },
        map,
    };
}

export type ItemOutcome =
    | { status: "done"; text: string; repeated?: boolean; check?: boolean; dropped: number }
    | { status: "failed"; reason: string };

export interface RunResult {
    /** Each item's outcome, by index; undefined for the items a run that stopped early didn't reach. */
    outcomes: (ItemOutcome | undefined)[];
    /** What stopped the run early, when something did. */
    stoppedBy?: unknown;
    /** Why the lines marked as failed after a retry failed: what a run that translated nothing reports. */
    failedBy?: unknown;
}

export interface RunOptions {
    signal?: AbortSignal;
    /** Items done so far, of all of them. */
    onProgress?: (done: number, total: number) => void;
}

function stopIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("The translation was cancelled.", "AbortError");
}

const isAbort = (error: unknown) => (error as { name?: string })?.name === "AbortError" || (error as { kind?: string })?.kind === "Aborted";

/* ── On this device ──────────────────────────────────────────────────── */

/**
 * OPUS-MT, as lib/translate/opusMt.ts gives it: the model and its tokenizer
 * run in a worker, so a passage's runs (chunk.ts's tokenRuns, counted in the
 * model's own tokens) are asked for, like each translation.
 */
export interface DeviceEngine {
    runs(texts: readonly string[], maxTokens: number): Promise<TokenRun[]>;
    translate(text: string, maxNewTokens?: number): Promise<string>;
}

/** Kana and Chinese characters, each about a word or most of one, and Hangul syllables, each about half a word. */
const DENSE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const HANGUL = /[\uac00-\ud7af]/;
/** Length in Latin-letter terms, so a faithful Chinese-to-English translation isn't taken for an invented one. */
const weighed = (text: string) => Array.from(text).reduce((sum, ch) => sum + (DENSE.test(ch) ? 3 : HANGUL.test(ch) ? 2 : 1), 0);

/** Far longer than any faithful translation of the source: how a model looks when it invents text for a fragment. */
export function looksInvented(source: string, translation: string): boolean {
    return weighed(translation) > weighed(source) * 3 + 24;
}

export async function translateOnDevice(plan: TranslationPlan, engine: DeviceEngine, { signal, onProgress, maxTokens }: RunOptions & { maxTokens: number }): Promise<RunResult> {
    const outcomes: (ItemOutcome | undefined)[] = new Array(plan.items.length).fill(undefined);
    let done = 0;
    const dropped = (index: number) => plan.cues[plan.items[index].cue][plan.items[index].part].plainDrops;
    try {
        for (const passage of plan.passages) {
            stopIfAborted(signal);
            // The passage's items in runs that fit the model's input; an item over the limit alone goes on its own.
            const runs = await engine.runs(passage.map(index => plan.items[index].text), maxTokens);
            for (const { items, pieces } of runs) {
                stopIfAborted(signal);
                const run = items.map(k => passage[k]);
                const texts = run.map(index => plan.items[index].text);
                const source = texts.reduce(joinWords, "");
                // One piece, unless one part is longer than the model reads: then its pieces are translated in turn and joined.
                let translation = "";
                for (const piece of pieces) {
                    stopIfAborted(signal);
                    translation = joinWords(translation, await engine.translate(piece));
                }
                stopIfAborted(signal);
                if (!translation.trim()) {
                    for (const index of run) outcomes[index] = { status: "failed", reason: "The model gave no translation for this line." };
                } else {
                    const check = looksInvented(source, translation);
                    const shares = distribute(translation, texts);
                    run.forEach((index, k) => {
                        outcomes[index] = { status: "done", text: shares.pieces[k], repeated: shares.repeated[k], check, dropped: dropped(index) };
                    });
                }
                done += run.length;
                onProgress?.(done, plan.items.length);
            }
        }
    } catch (error) {
        if (isAbort(error)) throw error;
        return { outcomes, stoppedBy: error };
    }
    return { outcomes };
}

/* ── With the visitor's own AI key ───────────────────────────────────── */

/** Translations of the lines, one for one, or an error when the reply doesn't match them. */
export type LinesEngine = (lines: string[], signal?: AbortSignal) => Promise<string[]>;

/**
 * Lines per request. About 1,500 characters of source is at most a few
 * thousand tokens of translation even into scripts that take the most,
 * inside the 4,096 an OpenAI-shaped provider or Gemini writes by default.
 */
export const BATCH_LIMITS = { maxChars: 1500, maxLines: 40 } as const;

/** The lines a model is sent: a dialogue dash goes with its line, so the model knows a new speaker starts. */
export function lineFor(item: PlanItem): string {
    return `${item.dash ? "- " : ""}${item.markup}`;
}

/** Whole passages to a batch, up to the limits; a passage over them is a batch of its own. */
export function batchItems(plan: TranslationPlan, limits: { maxChars: number; maxLines: number } = BATCH_LIMITS): number[][] {
    const batches: number[][] = [];
    let current: number[] = [];
    let chars = 0;
    for (const passage of plan.passages) {
        const size = passage.reduce((sum, index) => sum + lineFor(plan.items[index]).length + 6, 0);
        if (current.length && (chars + size > limits.maxChars || current.length + passage.length > limits.maxLines)) {
            batches.push(current);
            current = [];
            chars = 0;
        }
        current.push(...passage);
        chars += size;
    }
    if (current.length) batches.push(current);
    return batches;
}

/** A batch in two, at the passage boundary nearest its middle, or between its lines when it is one passage. */
function halves(plan: TranslationPlan, batch: number[]): number[][] {
    if (batch.length < 2) return [batch];
    const middle = batch.length / 2;
    let cut = Math.round(middle);
    let best = Infinity;
    let position = 0;
    for (const passage of plan.passages) {
        const inBatch = passage.filter(index => batch.includes(index)).length;
        if (!inBatch) continue;
        position += inBatch;
        if (position > 0 && position < batch.length && Math.abs(position - middle) < best) { best = Math.abs(position - middle); cut = position; }
    }
    return [batch.slice(0, cut), batch.slice(cut)];
}

const SPAN = /<\/?(?:i|b|u)>/g;

/**
 * A model's line made ready for its cue: the dash it was sent with taken off
 * (the cue's own is put back), and the <i>, <b> and <u> spans kept only when
 * they are exactly the ones sent, in order; otherwise all are left out.
 */
function received(item: PlanItem, reply: string): { text: string; dropped: number } {
    let text = reply.trim();
    if (item.dash) text = text.replace(/^[-–—‐]\s*/, "");
    const sent = item.markup.match(SPAN) ?? [];
    const got = text.match(SPAN) ?? [];
    if (sent.join("") === got.join("")) return { text, dropped: 0 };
    return { text: text.replace(SPAN, "").replace(/\s+/g, " ").trim(), dropped: sent.filter(tag => !tag.startsWith("</")).length };
}

/** A reply that doesn't match could match when asked again with fewer lines; so could one cut off at its length. */
function worthRetrying(error: unknown): boolean {
    const e = error as { name?: string; kind?: string };
    if (e?.name === "NumberedReplyError") return true;
    return e?.name === "ByokError" && (e.kind === "TooLong" || e.kind === "Declined" || e.kind === "Unknown");
}

function failureReason(error: unknown): string {
    const e = error as { name?: string; userMessage?: string };
    if (e?.name === "NumberedReplyError") {
        return "The model’s reply didn’t keep these lines’ numbers, twice, so they were left as they were rather than risk words landing in the wrong cue.";
    }
    if (e?.name === "ByokError" && e.userMessage) return e.userMessage;
    return "The model couldn’t translate these lines.";
}

export async function translateWithModel(plan: TranslationPlan, translateLines: LinesEngine, { signal, onProgress, limits = BATCH_LIMITS }: RunOptions & { limits?: { maxChars: number; maxLines: number } } = {}): Promise<RunResult> {
    const outcomes: (ItemOutcome | undefined)[] = new Array(plan.items.length).fill(undefined);
    let done = 0;
    let failedBy: unknown;
    const attempt = async (batch: number[]) => {
        const replies = await translateLines(batch.map(index => lineFor(plan.items[index])), signal);
        if (replies.length !== batch.length) throw Object.assign(new Error("count"), { name: "NumberedReplyError" });
        replies.forEach((reply, k) => {
            const { text, dropped } = received(plan.items[batch[k]], reply);
            // A speaker's dash and nothing else is no translation: the cue keeps its own words.
            outcomes[batch[k]] = /\p{L}|\p{N}/u.test(text) ? { status: "done", text, dropped } : { status: "failed", reason: "The model returned this line empty." };
        });
    };
    for (const batch of batchItems(plan, limits)) {
        stopIfAborted(signal);
        try {
            await attempt(batch);
        } catch (error) {
            if (isAbort(error)) throw error;
            if (!worthRetrying(error)) return { outcomes, stoppedBy: error, failedBy };
            for (const half of halves(plan, batch)) {
                stopIfAborted(signal);
                try {
                    await attempt(half);
                } catch (again) {
                    if (isAbort(again)) throw again;
                    if (!worthRetrying(again)) return { outcomes, stoppedBy: again, failedBy };
                    for (const index of half) outcomes[index] = { status: "failed", reason: failureReason(again) };
                    failedBy = again;
                }
            }
        }
        done += batch.length;
        onProgress?.(done, plan.items.length);
    }
    return { outcomes, failedBy };
}

/* ── Back into cues ──────────────────────────────────────────────────── */

export interface TranslatedCue {
    /** The cue's text in the source file's markup: translated where it could be, otherwise as written. */
    text: string;
    /** The cue's text as written. */
    source: string;
    /** "kept": nothing in it to translate, such as music notes. "failed": some or all of it wasn't translated. */
    status: "translated" | "failed" | "kept";
    reason?: string;
    /** Runs past two lines of the layout's length. */
    long: boolean;
    /** Repeats the cue before it, because the translation had fewer words than its passage had cues. */
    repeated: boolean;
    /** Much longer than its source: worth reading against it. */
    check: boolean;
    /** Formatting spans inside the words that couldn't be carried. */
    dropped: number;
}

export const NOT_REACHED = "The translation stopped before it reached this line.";

export function assembleCues(doc: SubtitleDocument, plan: TranslationPlan, outcomes: readonly (ItemOutcome | undefined)[], layout: CaptionLayout): TranslatedCue[] {
    const byPart = new Map<string, ItemOutcome>();
    plan.items.forEach((item, index) => byPart.set(`${item.cue}:${item.part}`, outcomes[index] ?? { status: "failed", reason: NOT_REACHED }));
    return cuesOf(doc).map((cue, c) => {
        const source = cue.lines.join("\n");
        const parts = plan.cues[c];
        const results = parts.map((part, p) => (part.translatable ? byPart.get(`${c}:${p}`) ?? null : null));
        const base = { source, long: false, repeated: false, check: false, dropped: 0 };
        const tried = results.filter((result): result is ItemOutcome => result !== null);
        if (!tried.length) return { ...base, text: source, status: "kept" as const };
        const failures = tried.filter((result): result is Extract<ItemOutcome, { status: "failed" }> => result.status === "failed");
        if (failures.length === tried.length) return { ...base, text: source, status: "failed" as const, reason: failures[0].reason };
        const rendered = renderCue(parts, results.map(result => (result?.status === "done" ? result.text : null)), doc.format, layout);
        const succeeded = tried.filter((result): result is Extract<ItemOutcome, { status: "done" }> => result.status === "done");
        return {
            ...base,
            text: rendered.text,
            status: failures.length ? "failed" as const : "translated" as const,
            reason: failures[0]?.reason,
            long: rendered.long,
            repeated: succeeded.some(result => result.repeated),
            check: succeeded.some(result => result.check),
            dropped: succeeded.reduce((sum, result) => sum + result.dropped, 0),
        };
    });
}

/* ── The language a file is in ───────────────────────────────────────── */

/** The languages `guessLanguageFromScript` names: each has letters of its own, unlike Latin script's many. */
export const SCRIPT_LANGUAGES = ["ja", "ko", "zh", "th", "hi", "ar", "ru", "uk"] as const;

/**
 * The language a file's letters name, for the scripts that name one of the
 * on-device sources: kana Japanese, hangul Korean, Chinese characters alone
 * Chinese, and Thai, Devanagari, Arabic and Cyrillic (Ukrainian by its own
 * letters). Null for Latin script, which too many languages share to guess.
 */
export function guessLanguageFromScript(texts: readonly string[]): (typeof SCRIPT_LANGUAGES)[number] | null {
    const sample = texts.slice(0, 300).join(" ");
    const count = (pattern: RegExp) => sample.match(pattern)?.length ?? 0;
    const letters = count(/\p{L}/gu);
    if (!letters) return null;
    const share = (pattern: RegExp) => count(pattern) / letters;
    if (share(/[぀-ヿ]/g) > 0.1) return "ja";
    if (share(/[가-힯ᄀ-ᇿ]/g) > 0.3) return "ko";
    if (share(/[一-鿿㐀-䶿]/g) > 0.3) return "zh";
    if (share(/[฀-๿]/g) > 0.3) return "th";
    if (share(/[ऀ-ॿ]/g) > 0.3) return "hi";
    if (share(/[؀-ۿ]/g) > 0.3) return "ar";
    if (share(/[Ѐ-ӿ]/g) > 0.3) return /[іїєґІЇЄҐ]/.test(sample) ? "uk" : "ru";
    return null;
}

/* ── Saving ──────────────────────────────────────────────────────────── */

/** ISO 639-1 codes a file name may already end in, before ".srt" or ".vtt". */
const LANGUAGE_CODES = new Set((
    "af ar bg bn ca cs cy da de el en es et eu fa fi fr ga gl he hi hr hu hy id is it ja ka kk ko lt lv mk ms mt nb nl nn no "
    + "pl pt ro ru sk sl sq sr sv sw ta te th tl tr uk ur uz vi zh"
).split(" "));

/** "talk.srt" translated into Spanish is "talk.es.srt"; "talk.en.vtt" becomes "talk.es.vtt". */
export function translatedFileName(name: string, code: string, format: SubtitleFormat): string {
    let stem = name.replace(/\.(?:srt|vtt|txt)$/i, "") || "subtitles";
    const tag = /\.([a-z]{2})(?:[-_][A-Za-z]{2,4})?$/.exec(stem);
    if (tag && LANGUAGE_CODES.has(tag[1])) stem = stem.slice(0, tag.index) || "subtitles";
    return `${stem}.${code}.${format}`;
}

/** The file as `format`: unchanged cues as written, the rest as now shown. */
export function exportSubtitles(doc: SubtitleDocument, cues: readonly Pick<TranslatedCue, "text" | "source">[], format: SubtitleFormat, language?: string): { text: string; dropped: Dropped } {
    return writeSubtitles(doc, { format, language, texts: cues.map(cue => (cue.text === cue.source ? undefined : cue.text)) });
}

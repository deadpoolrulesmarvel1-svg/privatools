/**
 * Telling the words Whisper heard from what it writes when it hears none.
 *
 * Over music, noise or a long silence Whisper still writes something. On a
 * synthetic test clip with music between four sentences, Whisper Tiny, asked
 * again over the music, wrote "Thank you." four times, a lone ".", a second,
 * differently worded copy of a sentence it had already written, and "Oh, oh,
 * oh…" for five seconds; Base wrote "I'm sorry." and "Oh". On an 18-minute
 * synthetic talk, Tiny once wrote "the option to be" over and over for 27
 * seconds in place of seven sentences.
 *
 * openai-whisper catches such loops by how far a window's text compresses,
 * decoding again when its gzip ratio passes 2.4. compressionRatio is the
 * LZ77 stage of that measure, gzip's own first stage, in which repeats are
 * written as references back: it leaves speech about as long as it was (1.05
 * to 1.1 on the test talks) and shrinks a loop many times over.
 */
/** A window's text is a loop past this ratio, as in openai-whisper. */
export const LOOP_RATIO = 2.4;
/** Text shorter than this, in bytes, is too short to judge as a loop. */
const LOOP_MIN_BYTES = 24;
const WINDOW_BYTES = 4096;
const MAX_MATCH = 258;

/**
 * The text's UTF-8 length over the length of its LZ77 encoding, where a byte
 * written as itself costs one and a repeat of 3 to 258 bytes from up to 4 KB
 * back costs three.
 */
export function compressionRatio(text: string): number {
    const bytes = new TextEncoder().encode(text);
    const n = bytes.length;
    if (!n) return 1;
    let cost = 0;
    for (let i = 0; i < n;) {
        let best = 0;
        // Nearest first: in a loop the copy one period back is the longest, so the search ends at once.
        for (let j = i - 1; j >= Math.max(0, i - WINDOW_BYTES) && best < MAX_MATCH; j--) {
            let k = 0;
            while (k < MAX_MATCH && i + k < n && bytes[j + k] === bytes[i + k]) k++;
            if (k > best) best = k;
        }
        if (best >= 3) { cost += 3; i += best; } else { cost += 1; i += 1; }
    }
    return n / cost;
}

/** Whether text is one phrase written over and over. */
export function isLoop(text: string): boolean {
    return new TextEncoder().encode(text).length >= LOOP_MIN_BYTES && compressionRatio(text) > LOOP_RATIO;
}

/**
 * Whether text uses far too few different words for its length: under two in
 * five, over thirty words or more. Speech of that length uses well over half;
 * Whisper Tiny, kept from looping on the 18-minute test talk, wrote 85 words
 * of "the option to use a button" with 30 different ones.
 */
export function tooFewWords(text: string): boolean {
    const words = wordsOf(text).map(({ word }) => word);
    return words.length >= 30 && new Set(words).size / words.length < 0.4;
}

/** Whether text has a letter or a digit in it, not only punctuation. */
export function hasWords(text: string): boolean {
    return /[\p{L}\p{N}]/u.test(text);
}

type WordSegmenter = new (locale?: string, options?: { granularity: "word" }) => { segment(text: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }> };
const Segmenter = (Intl as unknown as { Segmenter?: WordSegmenter }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "word" }) : null;

/**
 * The words of a text, without case or punctuation, with where each starts.
 * Scripts without spaces give the words Intl.Segmenter finds.
 */
export function wordsOf(text: string): { word: string; index: number }[] {
    const words = segmenter
        ? [...segmenter.segment(text)].filter(part => part.isWordLike).map(part => ({ word: part.segment, index: part.index }))
        : [...text.matchAll(/\S+/g)].map(match => ({ word: match[0], index: match.index ?? 0 }));
    return words
        .map(({ word, index }) => ({ word: word.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ""), index }))
        .filter(({ word }) => word);
}

/**
 * What Whisper writes from the subtitles it learned from, not from the sound:
 * thanks, apologies, sign-offs and interjections, in the languages it writes
 * them in most. Compared whole, without case or punctuation.
 */
const STOCK_LINES = [
    "thank you", "thank you very much", "thank you so much", "thanks", "thank you for watching", "thanks for watching",
    "thanks for watching see you next time", "thank you for watching see you next time", "see you next time", "see you",
    "i'll see you next time", "bye", "bye bye", "goodbye", "please subscribe", "subscribe", "like and subscribe",
    "please like and subscribe", "i'm sorry", "sorry", "oh", "ah", "uh", "um", "hmm", "you", "so", "okay", "ok",
    "the end", "music", "applause", "laughter", "silence", "foreign",
    "merci", "merci beaucoup", "merci d'avoir regardé", "danke", "danke schön", "vielen dank", "gracias", "muchas gracias",
    "gracias por ver", "grazie", "grazie mille", "obrigado", "obrigada", "dank je", "bedankt", "bedankt voor het kijken",
    "спасибо", "спасибо за просмотр", "продолжение следует", "ご視聴ありがとうございました", "ありがとうございました", "ありがとう",
    "谢谢", "谢谢观看", "謝謝", "謝謝觀看", "감사합니다", "시청해주셔서 감사합니다", "شكرا", "شكرا لكم", "شكرا للمشاهدة", "धन्यवाद",
].map(line => wordsOf(line).map(({ word }) => word).join(" "));
const STOCK = new Set(STOCK_LINES);
/** Credits for subtitlers that Whisper writes as if they were spoken, found anywhere in a segment. */
const CREDITS = /amara\.org|untertitel|sous-titr|subtítulos|sottotitoli|legendas|ondertitel|субтитр|字幕/iu;

/** Whether a segment is one of the lines Whisper writes when it hears no speech. */
export function isStockLine(text: string): boolean {
    return STOCK.has(wordsOf(text).map(({ word }) => word).join(" ")) || CREDITS.test(text);
}

/** The length of the longest sequence of words two texts share in order. */
function sharedWords(a: string[], b: string[]): number {
    let previous = new Array<number>(b.length + 1).fill(0);
    for (const word of a) {
        const row = new Array<number>(b.length + 1).fill(0);
        for (let j = 0; j < b.length; j++) row[j + 1] = word === b[j] ? previous[j] + 1 : Math.max(previous[j + 1], row[j]);
        previous = row;
    }
    return previous[b.length];
}

/**
 * Whether `text` says again what `earlier` already says: most of its words,
 * three or more, appear in it in the same order, or, for one or two words,
 * the same words appear together.
 */
export function repeats(text: string, earlier: string): boolean {
    const words = wordsOf(text).map(({ word }) => word);
    const before = wordsOf(earlier).map(({ word }) => word);
    if (!words.length || !before.length) return false;
    if (words.length < 3) return ` ${before.join(" ")} `.includes(` ${words.join(" ")} `);
    return sharedWords(words, before) / words.length >= 0.6;
}

const IDEOGRAPH = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const HANGUL = /[\uac00-\ud7af]/u;
const KANA = /[\u3040-\u30ff\uff66-\uff9f]/u;

/**
 * How long text takes to say, in letters of an alphabet: a Chinese character
 * counts as two and a half, a Korean syllable as two and a kana as one and a
 * half, about the sound each carries.
 */
export function speechUnits(text: string): number {
    let units = 0;
    for (const character of text.replace(/\s+/g, " ").trim()) {
        units += IDEOGRAPH.test(character) ? 2.5 : HANGUL.test(character) ? 2 : KANA.test(character) ? 1.5 : 1;
    }
    return units;
}

/** Fewer characters a second than this, over two seconds or more, is less text than anyone speaks in that time. */
const SPARSE_RATE = 4;

/** Whether a segment holds far too little text for the time Whisper gave it. */
export function tooSparse(segment: { start: number; end: number; text: string }): boolean {
    const seconds = segment.end - segment.start;
    return seconds >= 2 && speechUnits(segment.text) / seconds < SPARSE_RATE;
}

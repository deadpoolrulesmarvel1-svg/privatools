import { describe, expect, it } from "vitest";
import { chunkByTokens, chunkForTranslation, joinWords, tokenRuns } from "./chunk";

/** Near enough to OPUS-MT's tokenizer for the scripts that matter here: a token a character in Chinese and Japanese, about one per four Latin letters. */
const tokens = (text: string) => Array.from(text).reduce((sum, ch) => sum + (/[぀-ヿ㐀-鿿]/.test(ch) ? 1 : 0.25), 0) + 1;

describe("chunking by the model's own tokens", () => {
    it("keeps a text that fits whole", () => {
        expect(chunkByTokens("  One sentence.   Two.  ", tokens, 200)).toEqual(["One sentence. Two."]);
    });

    it("cuts Chinese that 900 characters would have sent whole into pieces the model reads", () => {
        const text = "我们今天要讨论隐私为什么重要。".repeat(60);
        // 900 characters: the old character limit sent this as one piece, more than three times the 512 tokens OPUS-MT reads.
        expect(chunkForTranslation(text)).toHaveLength(1);
        const pieces = chunkByTokens(text, tokens, 200);
        expect(pieces.length).toBeGreaterThan(4);
        for (const piece of pieces) expect(tokens(piece)).toBeLessThanOrEqual(200);
        expect(pieces.join("")).toBe(text);
    });

    it("cuts a Japanese sentence with no stop in it between words", () => {
        const text = "私たちは今日プライバシーについて話します".repeat(20);
        const pieces = chunkByTokens(text, tokens, 120);
        for (const piece of pieces) expect(tokens(piece)).toBeLessThanOrEqual(120);
        expect(pieces.join("")).toBe(text);
    });

    it("keeps Latin sentences whole where they fit, joined by spaces", () => {
        const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
        const pieces = chunkByTokens(text, tokens, 40);
        for (const piece of pieces) expect(tokens(piece)).toBeLessThanOrEqual(40);
        expect(pieces.join(" ")).toBe(text);
        expect(pieces.every(piece => piece.endsWith("."))).toBe(true);
    });

    it("cuts a run with no word break by characters rather than send it over the limit", () => {
        const pieces = chunkByTokens("x".repeat(2000), text => text.length + 1, 100);
        for (const piece of pieces) expect(piece.length + 1).toBeLessThanOrEqual(100);
        expect(pieces.join("")).toBe("x".repeat(2000));
    });
});

describe("a passage's runs", () => {
    /** A token a word, and the end mark. */
    const words = (text: string) => text.split(/\s+/).filter(Boolean).length + 1;

    it("keeps a passage that fits as one run, sent as it is", () => {
        expect(tokenRuns(["When I was young,", "my father took me", "to see the sea."], words, 200)).toEqual([
            { items: [0, 1, 2], pieces: ["When I was young, my father took me to see the sea."] },
        ]);
    });

    it("starts a new run where the next text would take it past the limit", () => {
        const texts = ["one two three", "four five six", "seven eight nine", "ten"];
        // Each pair of texts is 7 tokens; the third would make 10.
        expect(tokenRuns(texts, words, 8)).toEqual([
            { items: [0, 1], pieces: ["one two three four five six"] },
            { items: [2, 3], pieces: ["seven eight nine ten"] },
        ]);
    });

    it("sends a text longer than the model reads alone, in the pieces chunkByTokens cuts it into", () => {
        const long = Array.from({ length: 12 }, (_, i) => `Sentence ${i} is here.`).join(" ");
        const runs = tokenRuns(["Before.", long, "After."], words, 20);
        expect(runs.map(run => run.items)).toEqual([[0], [1], [2]]);
        expect(runs[1].pieces).toEqual(chunkByTokens(long, words, 20));
        expect(runs[1].pieces.length).toBeGreaterThan(1);
    });

    it("joins Chinese without spaces", () => {
        expect(tokenRuns(["我们今天", "要讨论"], text => Array.from(text).length + 1, 200)).toEqual([{ items: [0, 1], pieces: ["我们今天要讨论"] }]);
    });
});

describe("joining two pieces of text", () => {
    it("puts a space between words of spaced scripts and none between Chinese, Japanese or Thai words", () => {
        expect(joinWords("Hello", "there")).toBe("Hello there");
        expect(joinWords("我们今天", "要讨论")).toBe("我们今天要讨论");
        expect(joinWords("今日は。", "明日は")).toBe("今日は。明日は");
        expect(joinWords("สวัสดี", "ครับ")).toBe("สวัสดีครับ");
        expect(joinWords("", "alone")).toBe("alone");
    });

    it("keeps the space between Korean words, which are written with spaces", () => {
        expect(joinWords("오늘은", "이야기하겠습니다")).toBe("오늘은 이야기하겠습니다");
    });
});

import { describe, expect, it } from "vitest";
import { compressionRatio, hasWords, isLoop, isStockLine, LOOP_RATIO, repeats, speechUnits, tooFewWords, tooSparse, wordsOf } from "./quality";

describe("telling a loop from speech", () => {
    // From the synthetic test talks, and the loop Whisper Tiny wrote in one of them.
    const speech = "Remember to turn off the lights when you leave. The museum has a famous painting of the ship. The doctor said to drink more water. The shop on the corner sells fresh flowers.";
    const loop = Array.from({ length: 40 }, () => "the option to be").join(" ");

    it("leaves speech about as long as it was, and shrinks a loop many times over", () => {
        expect(compressionRatio(speech)).toBeLessThan(1.3);
        expect(compressionRatio(loop)).toBeGreaterThan(10);
        expect(compressionRatio("Oh, oh, oh, oh, oh, oh, oh, oh, oh, oh, oh, oh, oh, oh,")).toBeGreaterThan(LOOP_RATIO);
        expect(compressionRatio("")).toBe(1);
    });

    it("calls text a loop past openai-whisper's 2.4, and nothing too short to judge", () => {
        expect(isLoop(loop)).toBe(true);
        // Speech that turns into a loop for most of the window, as in the test talk.
        expect(isLoop(`${speech} ${Array.from({ length: 30 }, () => "the option to be").join(" ")}`)).toBe(true);
        expect(isLoop(speech)).toBe(false);
        expect(isLoop("Thank you. Thank you.")).toBe(false);
        expect(isLoop("ありがとう".repeat(20))).toBe(true);
        expect(isLoop("今日は晴れです。明日は雨が降るでしょう。私たちは公園で遊びました。")).toBe(false);
    });

    it("knows text that no longer loops but uses far too few different words", () => {
        // What Whisper Tiny wrote for 27 s of the test talk when kept from looping.
        const nonsense = "The option to be the option to use the option is to use a button to use it to use your button to make sure that the button is not too long. The option is the option of the button to be used to use this button to have a button that is not very long. The option of using the button can be used as a button.";
        expect(isLoop(nonsense)).toBe(false);
        expect(tooFewWords(nonsense)).toBe(true);
        expect(tooFewWords(speech)).toBe(false);
        expect(tooFewWords("Yes, yes, yes.")).toBe(false);
    });

    it("is quick on a long loop", () => {
        const started = performance.now();
        expect(isLoop("oh ".repeat(3000))).toBe(true);
        expect(performance.now() - started).toBeLessThan(500);
    });
});

describe("what Whisper writes when it hears no speech", () => {
    it("knows punctuation alone has no words", () => {
        expect(hasWords(".")).toBe(false);
        expect(hasWords("…!?")).toBe(false);
        expect(hasWords("Oh.")).toBe(true);
        expect(hasWords("42")).toBe(true);
        expect(hasWords("。")).toBe(false);
        expect(hasWords("はい。")).toBe(true);
    });

    it("knows the stock lines, whole, in any case or punctuation", () => {
        for (const line of ["Thank you.", "thank you!", "Thanks for watching!", "I'm sorry.", "Oh", "you", "Merci.", "Danke schön.", "ご視聴ありがとうございました", "谢谢观看"]) {
            expect(isStockLine(line), line).toBe(true);
        }
        expect(isStockLine("Subtitles by the Amara.org community")).toBe(true);
        expect(isStockLine("Untertitel im Auftrag des ZDF, 2017")).toBe(true);
        // Speech that only starts like one.
        expect(isStockLine("Thank you all for coming tonight.")).toBe(false);
        expect(isStockLine("I'm sorry I'm late.")).toBe(false);
        expect(isStockLine("The quick brown fox jumps over the lazy dog.")).toBe(false);
    });

    it("knows a second, differently worded copy of a sentence already written", () => {
        // Whisper Tiny's two versions of the clip's fourth sentence.
        const earlier = "Welcome to the subtitle generator review. The quick round function is over the lazy dog.";
        expect(repeats("The quick round thanks for watching, so over the lazy dog.", earlier)).toBe(true);
        expect(repeats("Every sentence should appear once in the captions.", earlier)).toBe(false);
        // One or two words repeat only when the same words stand together.
        expect(repeats("lazy dog", earlier)).toBe(true);
        expect(repeats("dog lazy", earlier)).toBe(false);
        expect(repeats("Hello.", "")).toBe(false);
    });

    it("knows a segment holds far too little text for its time", () => {
        expect(tooSparse({ start: 35.89, end: 42.89, text: "Thank you." })).toBe(true);
        expect(tooSparse({ start: 5.22, end: 8.02, text: "This clip was made with a speech synthesizer." })).toBe(false);
        // Under two seconds nothing is judged: a short reply can sit alone.
        expect(tooSparse({ start: 1, end: 2.5, text: "No." })).toBe(false);
    });

    it("counts how long text takes to say, a Chinese character or a Korean syllable as more than a letter", () => {
        expect(speechUnits("Hello  world")).toBe(11);
        expect(speechUnits("你好")).toBe(5);
        expect(speechUnits("안녕")).toBe(4);
        expect(speechUnits("はい")).toBe(3);
    });

    it("compares words without case or punctuation, and in scripts without spaces", () => {
        expect(wordsOf("It's a TEST, isn't it?").map(({ word }) => word)).toEqual(["its", "a", "test", "isnt", "it"]);
        expect(wordsOf("今日は晴れです。").length).toBeGreaterThan(1);
    });
});

import { describe, expect, it } from "vitest";
import { compressionRatio, hasWords, isLongLoop, isLoop, isStockLine, LOOP_RATIO, mostlySame, sharesMost, speechUnits, tooFewWords, tooSparse, wordsOf } from "./quality";

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

    it("takes a chant or a phrase said again in one segment for speech, and only a long loop for a loop", () => {
        // Real lines from the re-review's synthetic talk, each one segment as Whisper Base wrote them.
        for (const line of [
            "Let's go, let's go, let's go, let's go.",
            "No, no, no, no, no, no.",
            "Thank you, thank you, thank you, thank you.",
            "Thank you. Thank you. Thank you. Thank you.",
            "Happy birthday to you, happy birthday to you.",
            "One more time, one more time, one more time.",
            "We will, we will rock you. We will, we will rock you.",
        ]) expect(isLongLoop(line), line).toBe(false);
        expect(isLongLoop(Array.from({ length: 12 }, () => "the option to be").join(" "))).toBe(true);
        // A window of real lines is no loop either.
        const window = ["Let's go, let's go, let's go, let's go.", "No, no, no, no, no.", "The train to the city leaves from platform 4.", "I'm sorry.",
            "Sorry, could you say that again?", "Bye bye.", "See you next time.", "We will meet again on Friday afternoon.", "Thank you.", "Thanks for watching!"].join(" ");
        expect(isLoop(window)).toBe(false);
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

    it("knows a second, differently worded copy of what the first pass wrote for the same stretch", () => {
        // Whisper Tiny's two versions of the music clip's fourth sentence.
        expect(sharesMost("The quick round thanks for watching, so over the lazy dog.", "is over the lazy dog.")).toBe(true);
        expect(sharesMost("The quick round thanks for watching, so over the lazy dog.", "The quick round function is over the lazy dog.")).toBe(true);
        expect(sharesMost("Every sentence should appear once in the captions.", "The quick round function is over the lazy dog.")).toBe(false);
        // Under four shared words is never the same speech.
        expect(sharesMost("lazy dog", "is over the lazy dog.")).toBe(false);
        expect(sharesMost("Yes.", "Yes.")).toBe(false);
        expect(sharesMost("Hello there, everyone.", "")).toBe(false);
    });

    it("doesn't take a new sentence for a repeat because it shares a few words in order", () => {
        // The re-review's sentences, each against the ordinary sentence it shares most with.
        for (const [text, earlier] of [
            ["This is the last sentence.", "This is the plan for the next two weeks."],
            ["We start with the first item.", "Let us start with the budget for next quarter."],
            ["The budget is due today.", "Let us start with the budget for next quarter."],
            ["Is this the plan?", "This is the plan for the next two weeks."],
            ["Let us start again.", "Let us start with the budget for next quarter."],
            ["Today.", "Thank you so much for coming today."],
            ["Next week.", "This is the plan for the next two weeks."],
        ]) expect(sharesMost(text, earlier), text).toBe(false);
        // The same thanks, heard twice over the same stretch, is the same speech.
        expect(sharesMost("Thank you for coming.", "Thank you so much for coming today.")).toBe(true);
    });

    it("knows two passes over the same sound wrote mostly the same words", () => {
        // Whisper Base's chant, then the same window heard again with repeats banned.
        expect(mostlySame("Let's go, let's go, let's go, let's go. No, no, no, no, no. The train to the city leaves from platform 4.",
            "Let's go, let's go. Let's Go. No, no, no. No, No. The train to the city leaves from platform 4.")).toBe(true);
        expect(mostlySame(Array.from({ length: 30 }, () => "the option to be").join(" "),
            "Coffee and tea are served in the hall. The river flows slowly past the old mill. Our neighbours have a friendly black cat.")).toBe(false);
        expect(mostlySame("", "Anything.")).toBe(false);
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

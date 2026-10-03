import { describe, expect, it } from "vitest";
import { buildCues, CAPTION_TIMING, layoutFor, wrapCaption, type CaptionLayout } from "./captions";

const TWO_LINES: CaptionLayout = { maxLineChars: 42, maxLines: 2 };
const ONE_LINE: CaptionLayout = { maxLineChars: 42, maxLines: 1 };
const chars = (line: string) => Array.from(line).length;
const words = (text: string) => text.split(/\s+/).filter(Boolean);

describe("wrapping a caption", () => {
    it("keeps a short caption on one line", () => {
        expect(wrapCaption("Welcome to the test.", TWO_LINES)).toEqual(["Welcome to the test."]);
    });

    it("breaks a long caption into two lines as even as the words allow", () => {
        const lines = wrapCaption("The quick brown fox jumps over the lazy dog near the river bank.", TWO_LINES)!;
        expect(lines).toHaveLength(2);
        expect(lines.join(" ")).toBe("The quick brown fox jumps over the lazy dog near the river bank.");
        for (const line of lines) expect(chars(line)).toBeLessThanOrEqual(42);
        expect(Math.abs(chars(lines[0]) - chars(lines[1]))).toBeLessThanOrEqual(8);
    });

    it("says when a caption cannot fit", () => {
        expect(wrapCaption("x".repeat(20) + " " + "y".repeat(30), ONE_LINE)).toBeNull();
        expect(wrapCaption(Array(30).fill("word").join(" "), TWO_LINES)).toBeNull();
    });

    it("gives a word longer than a line a line of its own rather than breaking it", () => {
        const url = "https://example.com/a/very/long/address/that/cannot/break";
        expect(wrapCaption(url, TWO_LINES)).toEqual([url]);
        expect(wrapCaption(`See ${url}`, TWO_LINES)).toEqual(["See", url]);
    });

    it("never starts a line with closing punctuation, even after a space", () => {
        const lines = wrapCaption("Bonjour tout le monde, comment allez-vous ? Très bien merci", TWO_LINES)!;
        for (const line of lines) expect(line).not.toMatch(/^[?!.,;:]/);
    });

    it("breaks Japanese between words, not inside them, on shorter lines", () => {
        const layout = layoutFor("ja", "two");
        expect(layout.maxLineChars).toBeLessThan(20);
        const text = "今日はとても良い天気ですね。明日も晴れるといいですね。";
        const lines = wrapCaption(text, layout)!;
        expect(lines.join("")).toBe(text);
        for (const line of lines) {
            expect(chars(line)).toBeLessThanOrEqual(layout.maxLineChars);
            expect(line).not.toMatch(/^[。、]/);
        }
    });
});

describe("layouts", () => {
    it("uses 42 characters for Latin scripts and fewer for Chinese and Japanese", () => {
        expect(layoutFor("en", "two")).toEqual({ maxLineChars: 42, maxLines: 2 });
        expect(layoutFor("fr", "one")).toEqual({ maxLineChars: 42, maxLines: 1 });
        expect(layoutFor("en", "short").maxLines).toBe(1);
        expect(layoutFor("en", "short").maxLineChars).toBeLessThan(42);
        expect(layoutFor("zh", "two").maxLineChars).toBe(16);
    });
});

describe("building cues from recognised speech", () => {
    it("keeps a short segment as one cue with its own timing", () => {
        expect(buildCues([{ start: 1.2, end: 3.4, text: " Hello there. " }], TWO_LINES)).toEqual([{ start: 1.2, end: 3.4, text: "Hello there." }]);
    });

    it("drops segments with no words", () => {
        expect(buildCues([{ start: 0, end: 1, text: "   " }, { start: 1, end: 2, text: "Hi." }], TWO_LINES)).toEqual([{ start: 1, end: 2, text: "Hi." }]);
    });

    it("splits a long segment into cues that each fit, keeping every word in order", () => {
        const text = "This is the first sentence of a long answer. It goes on for quite a while, because the speaker had a lot to say about the topic. And then it ends here.";
        const cues = buildCues([{ start: 10, end: 22, text }], TWO_LINES);
        expect(cues.length).toBeGreaterThan(1);
        expect(words(cues.map(cue => cue.text).join(" "))).toEqual(words(text));
        for (const cue of cues) {
            const lines = cue.text.split("\n");
            expect(lines.length).toBeLessThanOrEqual(2);
            for (const line of lines) expect(chars(line)).toBeLessThanOrEqual(42);
        }
        // The segment's time is shared out in order, with no gaps or overlaps between its cues.
        expect(cues[0].start).toBe(10);
        expect(cues[cues.length - 1].end).toBe(22);
        for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end, 3);
    });

    it("prefers to end a cue where a sentence ends", () => {
        const cues = buildCues([{ start: 0, end: 12, text: "We met at noon. Then we walked along the river for an hour and talked about the old days." }], TWO_LINES);
        expect(cues[0].text.replace(/\n/g, " ")).toBe("We met at noon.");
    });

    it("splits slightly too long text into two even cues, not one full cue and a stray word", () => {
        const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
        const cues = buildCues([{ start: 0, end: 6, text }], ONE_LINE);
        expect(cues).toHaveLength(3);
        const shortest = Math.min(...cues.map(cue => chars(cue.text)));
        expect(shortest).toBeGreaterThan(15);
    });

    it("shares a segment's time in proportion to the text in each cue", () => {
        const cues = buildCues([{ start: 0, end: 10, text: "a".repeat(40) + " " + "b".repeat(40) }], ONE_LINE);
        expect(cues).toHaveLength(2);
        expect(cues[0].end).toBeCloseTo(5, 1);
    });

    it(`never keeps a cue on screen longer than ${CAPTION_TIMING.maxSeconds} seconds`, () => {
        const short = buildCues([{ start: 5, end: 25, text: "Okay." }], TWO_LINES);
        expect(short).toEqual([{ start: 5, end: 5 + CAPTION_TIMING.maxSeconds, text: "Okay." }]);
        const long = buildCues([{ start: 0, end: 30, text: "We waited a very long time for the train to arrive at the station that morning." }], TWO_LINES);
        for (const cue of long) expect(cue.end - cue.start).toBeLessThanOrEqual(CAPTION_TIMING.maxSeconds + 1e-9);
        expect(words(long.map(cue => cue.text).join(" ")).length).toBe(16);
    });

    it("keeps a very short cue up long enough to read, without running into the next", () => {
        const cues = buildCues([
            { start: 1, end: 1.2, text: "Yes." },
            { start: 1.5, end: 3, text: "No." },
            { start: 10, end: 10.1, text: "Maybe." },
        ], TWO_LINES);
        expect(cues[0]).toEqual({ start: 1, end: 1.5, text: "Yes." });
        expect(cues[2].end).toBeCloseTo(10 + CAPTION_TIMING.minSeconds, 6);
    });

    it("does not run past the end of the audio", () => {
        const cues = buildCues([{ start: 9.9, end: 10, text: "End." }], TWO_LINES, 10.2);
        expect(cues[0].end).toBe(10.2);
    });

    it("orders cues and removes overlaps", () => {
        const cues = buildCues([
            { start: 4, end: 6, text: "Second." },
            { start: 1, end: 4.5, text: "First." },
        ], TWO_LINES);
        expect(cues.map(cue => cue.text)).toEqual(["First.", "Second."]);
        expect(cues[0].end).toBeLessThanOrEqual(cues[1].start);
    });

    it("keeps the words of a cue that ends up with no time of its own", () => {
        const cues = buildCues([
            { start: 2, end: 2, text: "Hm." },
            { start: 2, end: 4, text: "Right." },
        ], TWO_LINES);
        expect(words(cues.map(cue => cue.text).join(" "))).toEqual(["Hm.", "Right."]);
        for (const cue of cues) expect(cue.end).toBeGreaterThan(cue.start);
    });

    it("shares the time until the next cue between cues that start at the same moment", () => {
        // Whisper's segments timed past a window all end up at its end.
        const cues = buildCues([
            { start: 10, end: 10, text: "One." },
            { start: 10, end: 10, text: "Two." },
            { start: 10, end: 10, text: "Three." },
            { start: 12, end: 14, text: "Next." },
        ], TWO_LINES);
        expect(cues.map(cue => cue.text)).toEqual(["One.", "Two.", "Three.", "Next."]);
        for (let i = 0; i < cues.length; i++) {
            expect(cues[i].end).toBeGreaterThan(cues[i].start);
            if (i) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end);
        }
        expect(cues[2].end).toBeLessThanOrEqual(12);
    });

    it("never overlaps cues at the very end of the audio, and keeps them inside it", () => {
        const cues = buildCues([
            { start: 4, end: 4.5, text: "Before." },
            { start: 5, end: 5, text: "Last." },
            { start: 5, end: 5, text: "Very last." },
        ], TWO_LINES, 5);
        for (let i = 0; i < cues.length; i++) {
            expect(cues[i].end).toBeGreaterThan(cues[i].start);
            expect(cues[i].end).toBeLessThanOrEqual(5);
            if (i) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end);
        }
        expect(cues.map(cue => cue.text)).toEqual(["Before.", "Last.", "Very last."]);
    });

    it("gives cues with no time at the very end of the audio the time back to the cue before", () => {
        // A sentence ending at 4 s, then two segments Whisper timed past the end of a 5 s file.
        const cues = buildCues([
            { start: 2, end: 4, text: "A sentence first." },
            { start: 5, end: 5, text: "Last words here." },
            { start: 5, end: 5, text: "And these." },
        ], TWO_LINES, 5);
        expect(cues.map(cue => cue.text)).toEqual(["A sentence first.", "Last words here.", "And these."]);
        expect(cues[1].start).toBeGreaterThanOrEqual(cues[0].end);
        expect(cues[1].start).toBeLessThan(4.3);
        for (const cue of cues.slice(1)) expect(cue.end - cue.start).toBeGreaterThan(0.3);
        expect(cues[2].end).toBe(5);
    });

    it("ends a cue at a Devanagari danda, and never starts a line with an Arabic question mark", () => {
        const hindi = buildCues([{ start: 0, end: 9, text: "नमस्ते दोस्तों। आज हम उपशीर्षक जनरेटर का प्रयोग करके छोटे वीडियो के लिए कैप्शन बनाएंगे।" }], TWO_LINES);
        expect(hindi[0].text).toBe("नमस्ते दोस्तों।");
        const urdu = buildCues([{ start: 0, end: 9, text: "آج ہم سب یہاں جمع ہیں۔ یہ ویڈیو آپ کو سب ٹائٹل بنانے کا آسان طریقہ قدم بہ قدم دکھاتی ہے۔" }], TWO_LINES);
        expect(urdu[0].text).toBe("آج ہم سب یہاں جمع ہیں۔");
        for (const lines of [wrapCaption("هل يمكنك أن تسمعني الآن بوضوح من فضلك يا صديقي العزيز ؟ نعم", TWO_LINES)!]) {
            for (const line of lines) expect(line.startsWith("؟")).toBe(false);
        }
    });

    it("writes times to the millisecond", () => {
        const cues = buildCues([{ start: 0.12345, end: 2.98765, text: "Rounded." }], TWO_LINES);
        expect(cues[0]).toEqual({ start: 0.123, end: 2.988, text: "Rounded." });
    });

    it("lays out a single-line style with one line per cue", () => {
        const cues = buildCues([{ start: 0, end: 8, text: "The quick brown fox jumps over the lazy dog near the river bank today." }], ONE_LINE);
        for (const cue of cues) expect(cue.text).not.toContain("\n");
    });

    it("splits Chinese without spaces into short cues", () => {
        const text = "我们今天去公园散步，天气非常好，大家都很开心。然后我们一起吃了午饭。";
        const layout = layoutFor("zh", "two");
        const cues = buildCues([{ start: 0, end: 9, text }], layout);
        expect(cues.map(cue => cue.text.replace(/\n/g, "")).join("")).toBe(text);
        for (const cue of cues) for (const line of cue.text.split("\n")) expect(chars(line)).toBeLessThanOrEqual(16);
    });
});

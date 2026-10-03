import { describe, expect, it } from "vitest";
import { subtitleTime, toSrt, toVtt, transcriptSrt, transcriptTime } from "./speechTranscript";

describe("subtitle timestamps", () => {
    it("writes SubRip with a comma and WebVTT with a full stop", () => {
        expect(subtitleTime(3723.456, ",")).toBe("01:02:03,456");
        expect(subtitleTime(3723.456, ".")).toBe("01:02:03.456");
    });

    it("rounds to the millisecond before splitting, so a rounded value carries", () => {
        expect(subtitleTime(59.9996, ".")).toBe("00:01:00.000");
        expect(subtitleTime(3599.9996, ",")).toBe("01:00:00,000");
        expect(subtitleTime(1.0004, ",")).toBe("00:00:01,000");
        expect(subtitleTime(0.0005, ",")).toBe("00:00:00,001");
    });

    it("never writes a negative or non-numeric time", () => {
        expect(subtitleTime(-1, ",")).toBe("00:00:00,000");
        expect(subtitleTime(Number.NaN, ".")).toBe("00:00:00.000");
        expect(subtitleTime(Number.POSITIVE_INFINITY, ".")).toBe("00:00:00.000");
    });

    it("keeps counting hours past ten", () => {
        expect(subtitleTime(10 * 3600 + 5, ",")).toBe("10:00:05,000");
    });

    it("keeps Transcribe Audio's SubRip time", () => {
        expect(transcriptTime(59.9996)).toBe("00:01:00,000");
    });
});

const CUES = [
    { start: 0.5, end: 2.25, text: "Welcome to the test." },
    { start: 2.5, end: 5, text: "Two lines\nof captions." },
];

describe("SubRip", () => {
    it("numbers the cues from 1, separates them with a blank line and ends with a newline", () => {
        expect(toSrt(CUES)).toBe(
            "1\n00:00:00,500 --> 00:00:02,250\nWelcome to the test.\n\n"
            + "2\n00:00:02,500 --> 00:00:05,000\nTwo lines\nof captions.\n",
        );
    });

    it("leaves out cues with no text and numbers the rest without a gap", () => {
        const srt = toSrt([{ start: 0, end: 1, text: "First" }, { start: 1, end: 2, text: "  \n " }, { start: 2, end: 3, text: "Third" }]);
        expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:02,000 --> 00:00:03,000\nThird\n");
    });

    it("drops blank lines inside a cue, which would end it early, and tidies spacing", () => {
        expect(toSrt([{ start: 0, end: 1, text: "  one\r\n\r\n  two  words \n" }])).toBe("1\n00:00:00,000 --> 00:00:01,000\none\ntwo words\n");
    });

    it("never writes a timing arrow inside cue text", () => {
        expect(toSrt([{ start: 0, end: 1, text: "a --> b" }])).toBe("1\n00:00:00,000 --> 00:00:01,000\na -> b\n");
        // One pass would turn "--->" into "-->".
        expect(toSrt([{ start: 0, end: 1, text: "a ---> b ----> c" }])).toBe("1\n00:00:00,000 --> 00:00:01,000\na -> b -> c\n");
        expect(toVtt([{ start: 0, end: 1, text: "a ---> b" }]).split("\n").slice(3).join("\n")).not.toContain("--");
    });

    it("writes nothing for no cues", () => {
        expect(toSrt([])).toBe("");
    });

    it("keeps Transcribe Audio's .srt export", () => {
        expect(transcriptSrt([{ start: 0, end: 1.9996, text: " Hello " }])).toBe("1\n00:00:00,000 --> 00:00:02,000\nHello\n");
    });
});

describe("WebVTT", () => {
    it("starts with the WEBVTT header and a blank line, and uses full stops in times", () => {
        expect(toVtt(CUES)).toBe(
            "WEBVTT\n\n"
            + "00:00:00.500 --> 00:00:02.250\nWelcome to the test.\n\n"
            + "00:00:02.500 --> 00:00:05.000\nTwo lines\nof captions.\n",
        );
    });

    it("escapes the characters WebVTT reads as markup", () => {
        expect(toVtt([{ start: 0, end: 1, text: "Fish & chips <3 > 2" }])).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFish &amp; chips &lt;3 &gt; 2\n");
    });

    it("never writes a timing arrow inside cue text", () => {
        expect(toVtt([{ start: 0, end: 1, text: "a --> b" }])).toContain("\na -&gt; b\n");
    });

    it("leaves out cues with no text", () => {
        expect(toVtt([{ start: 0, end: 1, text: "" }, { start: 1, end: 2, text: "Only" }])).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOnly\n");
    });
});

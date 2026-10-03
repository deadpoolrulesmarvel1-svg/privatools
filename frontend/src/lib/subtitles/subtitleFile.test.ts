import { describe, expect, it } from "vitest";
import { cueParts } from "./cueText";
import {
    MAX_SUBTITLE_BYTES, MAX_SUBTITLE_CUES, SubtitleFileError, cuesOf, decodeSubtitleBytes, formatTime, parseSubtitles,
    readSubtitleFile, writeSubtitles,
} from "./subtitleFile";

const SRT = `1
00:00:01,000 --> 00:00:03,500
I went to the store

2
00:00:03,600 --> 00:00:05,000
and bought some milk.

3
00:00:06,000 --> 00:00:08,250
<i>- Are you coming?</i>
- Yes, in a minute.
`;

const VTT = `WEBVTT - A talk
Kind: captions
Language: en

STYLE
::cue(.yellow) { color: yellow; }

REGION
id:fred
width:40%

NOTE This file was written by hand.
It has two notes.

intro
00:00:01.000 --> 00:00:03.500 position:10% align:start region:fred
<v Bob>Welcome back</v> &amp; hello.

00:03.600 --> 00:05.000 line:0
<c.yellow>Thanks for coming.</c>

NOTE between cues

3
00:00:06.000 --> 00:00:08.250
<i>We’ll start soon.</i>
`;

function errorOf(run: () => unknown): SubtitleFileError {
    try { run(); } catch (error) { if (error instanceof SubtitleFileError) return error; throw error; }
    throw new Error("expected a SubtitleFileError");
}

const utf8 = (text: string) => new TextEncoder().encode(text);
function utf16(text: string, littleEndian: boolean, bom: boolean): Uint8Array {
    const units = Array.from(text, ch => ch.charCodeAt(0));
    const bytes = new Uint8Array((units.length + (bom ? 1 : 0)) * 2);
    const view = new DataView(bytes.buffer);
    let at = 0;
    if (bom) { view.setUint16(0, 0xfeff, littleEndian); at = 2; }
    for (const unit of units) { view.setUint16(at, unit, littleEndian); at += 2; }
    return bytes;
}

describe("reading SRT and VTT", () => {
    it("reads an SRT's numbers, timings and text", () => {
        const doc = parseSubtitles(SRT);
        expect(doc.format).toBe("srt");
        const cues = cuesOf(doc);
        expect(cues.map(cue => cue.id)).toEqual(["1", "2", "3"]);
        expect(cues.map(cue => [cue.start, cue.end])).toEqual([[1, 3.5], [3.6, 5], [6, 8.25]]);
        expect(cues[2].lines).toEqual(["<i>- Are you coming?</i>", "- Yes, in a minute."]);
        expect(cues[1].line).toBe(6);
    });

    it("reads a VTT's header, blocks, identifiers and cue settings", () => {
        const doc = parseSubtitles(VTT);
        expect(doc.format).toBe("vtt");
        expect(doc.header).toEqual(["WEBVTT - A talk", "Kind: captions", "Language: en"]);
        expect(doc.blocks.map(block => block.kind)).toEqual(["style", "region", "note", "cue", "cue", "note", "cue"]);
        const cues = cuesOf(doc);
        expect(cues.map(cue => cue.id)).toEqual(["intro", undefined, "3"]);
        expect(cues[0].settings).toBe("position:10% align:start region:fred");
        expect(cues[1].settings).toBe("line:0");
        expect([cues[1].start, cues[1].end]).toEqual([3.6, 5]);
    });

    it("takes a missing blank line between cues and a blank line inside a cue's text as meant", () => {
        const doc = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:02,500 --> 00:00:03,000\nTwo\n\nstill two\n\n3\n00:00:04,000 --> 00:00:05,000\nThree\n");
        expect(cuesOf(doc).map(cue => cue.lines)).toEqual([["One"], ["Two", "still two"], ["Three"]]);
    });

    it("keeps an arrow inside a cue's text as text", () => {
        const doc = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nPress A --> B\n");
        expect(cuesOf(doc)[0].lines).toEqual(["Press A --> B"]);
    });

    it("reads an SRT written with dots and without numbers", () => {
        const doc = parseSubtitles("00:00:01.000 --> 00:00:02.000\nOne\n\n00:00:03.000 --> 00:00:04.000\nTwo\n");
        expect(cuesOf(doc).map(cue => [cue.id, cue.start])).toEqual([[undefined, 1], [undefined, 3]]);
    });
});

describe("writing back in the same format", () => {
    it("round-trips an SRT exactly", () => {
        const doc = parseSubtitles(SRT);
        expect(writeSubtitles(doc, { format: "srt" }).text).toBe(SRT);
    });

    it("round-trips a VTT with its header, NOTE, STYLE and REGION blocks, identifiers, settings and tags", () => {
        const doc = parseSubtitles(VTT);
        expect(writeSubtitles(doc, { format: "vtt" })).toEqual({ text: VTT, dropped: { tags: 0, settings: 0, blocks: 0 } });
    });

    it("round-trips CRLF line endings and a byte-order mark", () => {
        const crlf = "﻿" + SRT.replace(/\n/g, "\r\n");
        const decoded = decodeSubtitleBytes(utf8(crlf));
        expect(decoded.bom).toBe(true);
        const doc = parseSubtitles(decoded.text, { bom: decoded.bom });
        expect(doc.newline).toBe("\r\n");
        expect(writeSubtitles(doc, { format: "srt" }).text).toBe(crlf);
    });

    it("keeps the blank lines a file ends with", () => {
        const text = SRT + "\n\n";
        expect(writeSubtitles(parseSubtitles(text), { format: "srt" }).text).toBe(text);
        const bare = SRT.trimEnd();
        expect(writeSubtitles(parseSubtitles(bare), { format: "srt" }).text).toBe(bare);
    });

    it("writes new text for a cue and nothing else changes", () => {
        const doc = parseSubtitles(SRT);
        const { text } = writeSubtitles(doc, { format: "srt", texts: [undefined, "y compré leche."] });
        expect(text).toBe(SRT.replace("and bought some milk.", "y compré leche."));
    });

    it("never writes a blank line or an arrow inside a cue", () => {
        const doc = parseSubtitles(SRT);
        const { text } = writeSubtitles(doc, { format: "srt", texts: ["Uno\n\n  \nA --> B"] });
        expect(text.split("\n").slice(0, 5)).toEqual(["1", "00:00:01,000 --> 00:00:03,500", "Uno", "A -> B", ""]);
    });

    it("sets a VTT header's language when it has one", () => {
        const { text } = writeSubtitles(parseSubtitles(VTT), { format: "vtt", language: "es" });
        expect(text.split("\n").slice(0, 3)).toEqual(["WEBVTT - A talk", "Kind: captions", "Language: es"]);
    });
});

describe("saving in the other format", () => {
    it("writes an SRT as VTT: timings with dots, numbers as identifiers, tags VTT shows", () => {
        const doc = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000 X1:10 X2:100 Y1:10 Y2:50\n{\\an8}<font color=\"red\">R&D</font> <i>now</i>\n");
        const { text, dropped } = writeSubtitles(doc, { format: "vtt" });
        expect(text).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nR&amp;D <i>now</i>\n");
        expect(dropped).toEqual({ tags: 2, settings: 1, blocks: 0 });
    });

    it("writes a VTT as SRT, numbering every cue and counting what SRT can't hold", () => {
        const { text, dropped } = writeSubtitles(parseSubtitles(VTT), { format: "srt" });
        expect(text).toBe([
            "1", "00:00:01,000 --> 00:00:03,500", "Welcome back & hello.", "",
            "2", "00:00:03,600 --> 00:00:05,000", "Thanks for coming.", "",
            "3", "00:00:06,000 --> 00:00:08,250", "<i>We’ll start soon.</i>", "",
        ].join("\n"));
        // A voice and a class span; two cues with settings; style, region and two notes.
        expect(dropped).toEqual({ tags: 2, settings: 2, blocks: 4 });
    });

    it("leaves a ruby reading out of an SRT, with its tags", () => {
        const doc = parseSubtitles("WEBVTT\n\n00:01.000 --> 00:02.000\n<ruby>漢字<rt>かんじ</rt></ruby>を読む\n");
        expect(writeSubtitles(doc, { format: "srt" })).toEqual({ text: "1\n00:00:01,000 --> 00:00:02,000\n漢字を読む\n", dropped: { tags: 2, settings: 0, blocks: 0 } });
    });

    it("formats times to the millisecond", () => {
        expect(formatTime(3725.5, "srt")).toBe("01:02:05,500");
        expect(formatTime(59.9996, "vtt")).toBe("00:01:00.000");
    });
});

describe("decoding a file's bytes", () => {
    it("reads UTF-8 with and without a byte-order mark", () => {
        expect(decodeSubtitleBytes(utf8("Café"))).toEqual({ text: "Café", encoding: "UTF-8", bom: false });
        expect(decodeSubtitleBytes(utf8("﻿Café"))).toEqual({ text: "Café", encoding: "UTF-8", bom: true });
    });

    it("reads UTF-16 in either byte order, with a mark or recognised without one", () => {
        for (const littleEndian of [true, false]) {
            for (const bom of [true, false]) {
                const decoded = decodeSubtitleBytes(utf16(SRT, littleEndian, bom));
                expect(decoded.text).toBe(SRT);
                expect(decoded.encoding).toBe(littleEndian ? "UTF-16LE" : "UTF-16BE");
                expect(decoded.bom).toBe(bom);
            }
        }
    });

    it("refuses a legacy 8-bit encoding rather than guessing its letters", () => {
        const latin1 = Uint8Array.from([0x43, 0x61, 0x66, 0xe9, 0x0a]);
        const error = errorOf(() => decodeSubtitleBytes(latin1, "old.srt"));
        expect(error.problem).toBe("encoding");
        expect(error.title).toBe("old.srt isn’t saved as UTF-8 or UTF-16.");
        expect(error.detail).toMatch(/save it with UTF-8 encoding/);
    });

    it("refuses a binary file and an empty one", () => {
        expect(errorOf(() => decodeSubtitleBytes(Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]), "clip.srt")).title).toBe("clip.srt isn’t a text file.");
        expect(errorOf(() => decodeSubtitleBytes(new Uint8Array(), "nothing.srt")).title).toBe("nothing.srt is empty.");
    });
});

describe("files that can't be translated say why", () => {
    it("names the line of a timing it can't read", () => {
        const error = errorOf(() => parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:02,500 -> 00:00:03,000\nTwo\n"));
        expect(error.problem).toBe("bad-timing");
        expect(error.line).toBe(6);
        expect(error.title).toBe("Line 6 isn’t a valid timing line.");
        expect(error.detail).toContain("“00:00:02,500 -> 00:00:03,000”");
    });

    it("refuses minutes or seconds of 60 or more", () => {
        expect(errorOf(() => parseSubtitles("1\n00:00:61,000 --> 00:01:02,000\nOne\n")).line).toBe(2);
        expect(errorOf(() => parseSubtitles("WEBVTT\n\n00:01.000 --> 00:60.000\nOne\n")).line).toBe(3);
    });

    it("names a VTT block with no timing line", () => {
        const error = errorOf(() => parseSubtitles("WEBVTT\n\n00:01.000 --> 00:02.000\nOne\n\nJust some words\nwith no timing\n"));
        expect(error.problem).toBe("no-timing");
        expect(error.title).toBe("Line 6 isn’t part of a cue.");
    });

    it("says what an ASS file, a text file and an empty VTT are", () => {
        expect(errorOf(() => parseSubtitles("[Script Info]\nTitle: x\n", { name: "song.ass" })).title).toBe("song.ass is an ASS or SSA subtitle file.");
        expect(errorOf(() => parseSubtitles("Just a letter.\nNo timings here.\n", { name: "notes.srt" })).title).toBe("notes.srt has no subtitle cues.");
        expect(errorOf(() => parseSubtitles("WEBVTT\n\nNOTE nothing else\n", { name: "empty.vtt" })).title).toBe("empty.vtt has no cues.");
        expect(errorOf(() => parseSubtitles(" \n\n", { name: "blank.srt" })).title).toBe("blank.srt is empty.");
    });

    it("refuses a file over the size limit before reading it, and one with too many cues", async () => {
        const big = new File(["x"], "huge.srt");
        Object.defineProperty(big, "size", { value: MAX_SUBTITLE_BYTES + 1 });
        await expect(readSubtitleFile(big)).rejects.toMatchObject({ problem: "too-large", title: "huge.srt is larger than 4 MB.", __kind: "too_large" });
        const many = Array.from({ length: MAX_SUBTITLE_CUES + 1 }, (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:02,000\nHi\n`).join("\n");
        await expect(readSubtitleFile(new File([many], "many.srt"))).rejects.toMatchObject({ problem: "too-many-cues" });
    });

    it("reads lines shaped to make a regular expression backtrack in a moment, not minutes", () => {
        const hostile = [
            "1", "00:00:01,000 --> 00:00:02,000",
            "<a ".repeat(20000), "-".repeat(50000) + ">", " ".repeat(50000) + "x", "&amp".repeat(20000), "{\\an".repeat(20000),
            "", "2", "00:00:03,000 --> 00:00:04,000", "Two", "\r\n".repeat(40) + "z",
        ].join("\n");
        const started = performance.now();
        const doc = parseSubtitles(hostile);
        const lines = cuesOf(doc)[0].lines;
        const parts = cueParts(lines);
        const { text } = writeSubtitles(doc, { format: "vtt", texts: [lines.join("\n")] });
        expect(performance.now() - started).toBeLessThan(5000);
        expect(parts).toHaveLength(1);
        expect(text).not.toContain("-->>");
        expect(text.split("\n").filter(line => line.includes("-->"))).toHaveLength(2);
    });

    it("tags every refusal as the visitor's input for analytics", () => {
        expect(errorOf(() => parseSubtitles("1\n0:0 --> x\n")).__kind).toBe("bad_input");
    });
});

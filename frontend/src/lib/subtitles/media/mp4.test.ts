import { describe, expect, it } from "vitest";
import { mediaFixture } from "@/test/media/fixtures";
import { adtsHeader, parseAudioSpecificConfig } from "./aac";
import { indexMp4 } from "./mp4";
import { NoSoundTrack } from "./types";

/** The ADTS frames in a piece: each starts with the sync word and says its own length. */
function adtsFrames(bytes: Uint8Array): number[] {
    const lengths: number[] = [];
    for (let at = 0; at < bytes.length;) {
        expect(bytes[at]).toBe(0xff);
        expect(bytes[at + 1] & 0xf6).toBe(0xf0);
        const length = ((bytes[at + 3] & 3) << 11) | (bytes[at + 4] << 3) | (bytes[at + 5] >> 5);
        lengths.push(length);
        at += length;
    }
    return lengths;
}

describe("AAC configuration", () => {
    it("reads AAC-LC and names it for ADTS", () => {
        // AAC-LC, 44.1 kHz (index 4), stereo.
        expect(parseAudioSpecificConfig(Uint8Array.of(0x12, 0x10))).toEqual({ objectType: 2, frequencyIndex: 4, sampleRate: 44100, channels: 2 });
    });

    it("reads HE-AAC's core configuration", () => {
        // SBR (5) at 24 kHz core (index 6), stereo, extension index 3, core AAC-LC.
        const config = parseAudioSpecificConfig(Uint8Array.of(0x2b, 0x11, 0x88, 0x00));
        expect(config).toMatchObject({ objectType: 2, frequencyIndex: 6, channels: 2 });
    });

    it("refuses what ADTS cannot carry", () => {
        expect(parseAudioSpecificConfig(Uint8Array.of(0x11, 0x80))).toBeNull(); // channel configuration 0
        expect(parseAudioSpecificConfig(Uint8Array.of(0x17, 0x80, 0x00, 0x00, 0x08))).toBeNull(); // explicit frequency
        expect(parseAudioSpecificConfig(Uint8Array.of(0x12))).toBeNull(); // cut short
    });

    it("writes a seven-byte ADTS header with the frame's length", () => {
        expect([...adtsHeader({ objectType: 2, frequencyIndex: 4, sampleRate: 44100, channels: 2 }, 100)]).toEqual([0xff, 0xf1, 0x50, 0x80, 0x0d, 0x7f, 0xfc]);
    });
});

describe("reading the sound of MP4, MOV and M4A files", () => {
    it.each([
        ["tone.mp4", 44100],
        ["tone-moov-last.mp4", 44100],
        ["tone.mov", 48000],
        ["tone.m4a", 16000],
    ])("finds the AAC track in %s and wraps every frame as ADTS", async (name, rate) => {
        const index = await indexMp4(mediaFixture(name));
        expect(index).not.toBeNull();
        expect(index!.container).toBe("MP4");
        expect(index!.durationSeconds).toBeGreaterThan(1.9);
        expect(index!.durationSeconds).toBeLessThan(2.2);
        expect(index!.pieces).toHaveLength(1);
        // The encoder's priming is trimmed by the edit list, so the first frame starts just before zero.
        expect(index!.pieces[0].start).toBeLessThanOrEqual(0);
        expect(index!.pieces[0].start).toBeGreaterThan(-0.1);
        const frames = adtsFrames(new Uint8Array(await index!.pieces[0].read()));
        expect(frames.length).toBeGreaterThan(Math.floor((2 * rate) / 1024));
        expect(frames.length).toBeLessThan(Math.ceil((2.2 * rate) / 1024) + 3);
    });

    it("cuts the sound into pieces of the length asked for, in order, without gaps", async () => {
        const index = (await indexMp4(mediaFixture("tone.mp4"), 0.5))!;
        expect(index.pieces.length).toBeGreaterThanOrEqual(4);
        let frames = 0;
        for (let i = 0; i < index.pieces.length; i++) {
            const piece = index.pieces[i];
            if (i > 0) expect(piece.start).toBeCloseTo(index.pieces[i - 1].start + index.pieces[i - 1].duration, 6);
            frames += adtsFrames(new Uint8Array(await piece.read())).length;
        }
        const whole = adtsFrames(new Uint8Array(await (await indexMp4(mediaFixture("tone.mp4")))!.pieces[0].read())).length;
        expect(frames).toBe(whole);
    });

    it("passes MP3 in MP4 on as plain MP3 frames", async () => {
        const index = (await indexMp4(mediaFixture("tone-mp3-in.mp4")))!;
        expect(index).not.toBeNull();
        const bytes = new Uint8Array(await index.pieces[0].read());
        expect(bytes[0]).toBe(0xff);
        expect(bytes[1] & 0xe0).toBe(0xe0);
    });

    it("leaves fragmented MP4 to the whole-file path", async () => {
        expect(await indexMp4(mediaFixture("tone-fragmented.mp4"))).toBeNull();
    });

    it("says when a video has no sound track at all", async () => {
        await expect(indexMp4(mediaFixture("no-sound.mp4"))).rejects.toBeInstanceOf(NoSoundTrack);
    });

    it("says no to files that are not MP4 at all", async () => {
        expect(await indexMp4(mediaFixture("tone.webm"))).toBeNull();
        expect(await indexMp4(mediaFixture("tone.mp3"))).toBeNull();
        expect(await indexMp4(new Blob(["not a video"]))).toBeNull();
    });
});

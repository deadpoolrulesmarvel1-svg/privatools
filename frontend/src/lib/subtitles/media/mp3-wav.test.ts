import { describe, expect, it } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { mediaFixture, wavFile } from "@/test/media/fixtures";
import { indexMp3, mpegFrame } from "./mp3";
import { indexWav } from "./wav";

const blobOf = (...parts: (Uint8Array | ArrayBuffer | Blob)[]) => new NodeBlob(parts as never[]) as unknown as Blob;

describe("MPEG audio frame headers", () => {
    it("reads an MPEG-1 Layer III frame's length and sample count", () => {
        // 128 kbit/s, 44.1 kHz, no padding: 417 bytes, 1152 samples.
        expect(mpegFrame(Uint8Array.of(0xff, 0xfb, 0x90, 0x64), 0)).toMatchObject({ length: 417, samples: 1152, sampleRate: 44100, layer: 3 });
        // The same with padding: one byte longer.
        expect(mpegFrame(Uint8Array.of(0xff, 0xfb, 0x92, 0x64), 0)!.length).toBe(418);
    });

    it("reads MPEG-2 Layer III, which carries half the samples", () => {
        // MPEG-2, 64 kbit/s, 22.05 kHz.
        expect(mpegFrame(Uint8Array.of(0xff, 0xf3, 0x80, 0xc4), 0)).toMatchObject({ samples: 576, sampleRate: 22050 });
    });

    it("refuses reserved and free-format headers", () => {
        expect(mpegFrame(Uint8Array.of(0xff, 0xeb, 0x90, 0x64), 0)).toBeNull(); // reserved version
        expect(mpegFrame(Uint8Array.of(0xff, 0xfb, 0x00, 0x64), 0)).toBeNull(); // free format
        expect(mpegFrame(Uint8Array.of(0xff, 0xfb, 0x9c, 0x64), 0)).toBeNull(); // reserved rate
        expect(mpegFrame(Uint8Array.of(0x49, 0x44, 0x33, 0x04), 0)).toBeNull(); // "ID3"
    });
});

describe("reading the sound of MP3 files", () => {
    it("finds every frame, leaves the Info frame out of the timing and keeps it in the first piece", async () => {
        const file = mediaFixture("tone.mp3");
        const index = (await indexMp3(file))!;
        expect(index.container).toBe("MP3");
        expect(index.durationSeconds).toBeGreaterThan(1.9);
        expect(index.durationSeconds).toBeLessThan(2.2);
        expect(index.pieces).toHaveLength(1);
        expect(index.pieces[0].start).toBe(0);
        const bytes = new Uint8Array(await index.pieces[0].read());
        // The piece starts at the first frame (after any ID3 tag), the Info frame.
        expect(bytes[0]).toBe(0xff);
        expect(new TextDecoder("latin1").decode(bytes.subarray(0, 64))).toMatch(/Info|Xing/);
    });

    it("cuts between frames into pieces that follow on from each other", async () => {
        const index = (await indexMp3(mediaFixture("tone.mp3"), { pieceSeconds: 0.5 }))!;
        expect(index.pieces.length).toBeGreaterThanOrEqual(4);
        for (let i = 1; i < index.pieces.length; i++) {
            expect(index.pieces[i].start).toBeCloseTo(index.pieces[i - 1].start + index.pieces[i - 1].duration, 6);
            const bytes = new Uint8Array(await index.pieces[i].read());
            expect(mpegFrame(bytes, 0)).not.toBeNull();
        }
    });

    it("steps over an ID3v2 tag and junk between frames", async () => {
        const plain = (await indexMp3(mediaFixture("tone.mp3")))!;
        // The frames alone, without the encoder's own tag.
        const mp3 = new Uint8Array(await plain.pieces[0].read());
        // A 100-byte ID3v2.4 tag in front, and 37 bytes of junk in the middle.
        const tag = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 90, ...new Array(90).fill(0)]);
        const firstFrame = mpegFrame(mp3, 0)!;
        const middle = firstFrame.length * 10;
        const tagged = (await indexMp3(blobOf(tag, mp3.subarray(0, middle), new Uint8Array(37).fill(0x55), mp3.subarray(middle))))!;
        expect(tagged).not.toBeNull();
        expect(tagged.durationSeconds).toBeCloseTo(plain.durationSeconds, 6);
    });

    it("says no to files that are not MP3", async () => {
        expect(await indexMp3(mediaFixture("tone.wav"))).toBeNull();
        expect(await indexMp3(blobOf(new TextEncoder().encode("ID3 but nothing else"))) ).toBeNull();
    });
});

describe("reading the sound of WAV files", () => {
    it("cuts the samples into pieces, each with a header of its own", async () => {
        const index = (await indexWav(mediaFixture("tone.wav"), { pieceSeconds: 0.5 }))!;
        expect(index.container).toBe("WAV");
        expect(index.durationSeconds).toBeCloseTo(2, 3);
        expect(index.pieces).toHaveLength(4);
        const bytes = new Uint8Array(await index.pieces[1].read());
        expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
        expect(new TextDecoder().decode(bytes.subarray(36, 40))).toBe("data");
        // Half a second of 8 kHz, 16-bit mono after the 44-byte header.
        expect(bytes.length).toBe(44 + 4000 * 2);
        expect(index.pieces[1].start).toBe(0.5);
    });

    it.each([
        { bits: 24, channels: 2, rate: 48000 },
        { bits: 8, channels: 1, rate: 11025 },
        { bits: 32, channels: 6, rate: 48000, float: true },
    ])("takes $bits-bit, $channels-channel samples at $rate Hz", async options => {
        const index = (await indexWav(wavFile({ ...options, seconds: 1.5 }), { pieceSeconds: 1 }))!;
        expect(index.durationSeconds).toBeCloseTo(1.5, 3);
        expect(index.pieces).toHaveLength(2);
        expect(index.pieces[0].duration).toBe(1);
        expect(index.pieces[1].duration).toBeCloseTo(0.5, 3);
        const second = new Uint8Array(await index.pieces[1].read());
        const block = options.channels * (options.bits / 8);
        expect(second.length).toBe(44 + (Math.round(options.rate * 1.5) - options.rate) * block);
    });

    it("reads a recording whose size was never written to the end of the file", async () => {
        const index = (await indexWav(wavFile({ seconds: 1, dataSize: 0 })))!;
        expect(index.durationSeconds).toBeCloseTo(1, 3);
    });

    it("says no to what it cannot cut", async () => {
        expect(await indexWav(mediaFixture("tone.mp3"))).toBeNull();
        const header = new Uint8Array(await wavFile().slice(0, 44).arrayBuffer());
        header[20] = 2; // ADPCM
        expect(await indexWav(blobOf(header))).toBeNull();
    });
});

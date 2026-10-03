import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaFile } from "@/test/media/fixtures";
import type { AudioChunk } from "../recognize";
import { mixToMono } from "@/lib/whisper";
import { MAX_SECONDS, MediaError, openAudio, WHOLE_FILE_SECONDS } from "./extract";

/** What the stand-in decoder was given, and whether it should refuse it. */
let decoded: Uint8Array[] = [];
let refuse: (bytes: Uint8Array, call: number) => boolean = () => false;

/** jsdom has no Web Audio: a decoder that hands back one second of stereo per stream it is given. */
class FakeOfflineAudioContext {
    constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
    async decodeAudioData(buffer: ArrayBuffer) {
        const bytes = new Uint8Array(buffer);
        decoded.push(bytes);
        if (refuse(bytes, decoded.length - 1)) throw new DOMException("Unable to decode audio data", "EncodingError");
        return { numberOfChannels: 2, length: this.sampleRate, duration: 1, sampleRate: this.sampleRate, getChannelData: (c: number) => new Float32Array(this.sampleRate).fill(c === 0 ? 0.2 : 0.4) };
    }
}

const fileOf = (name: string, type: string) => mediaFile(name, type);

async function all(chunks: AsyncGenerator<AudioChunk>): Promise<AudioChunk[]> {
    const out: AudioChunk[] = [];
    for await (const chunk of chunks) out.push(chunk);
    return out;
}

beforeEach(() => {
    decoded = [];
    refuse = () => false;
    vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
});
afterEach(() => vi.unstubAllGlobals());

describe("mixing to mono", () => {
    it("passes mono through and averages stereo", () => {
        const left = Float32Array.of(1, 0, -1);
        expect(mixToMono([left])).toBe(left);
        expect([...mixToMono([Float32Array.of(1, 0), Float32Array.of(0, 1)])]).toEqual([0.5, 0.5]);
    });

    it("keeps 5.1's centre channel, where speech is, and leaves out the LFE", () => {
        const channel = (value: number) => Float32Array.of(value);
        const centreOnly = mixToMono([channel(0), channel(0), channel(1), channel(0), channel(0), channel(0)]);
        const lfeOnly = mixToMono([channel(0), channel(0), channel(0), channel(1), channel(0), channel(0)]);
        const leftOnly = mixToMono([channel(1), channel(0), channel(0), channel(0), channel(0), channel(0)]);
        expect(lfeOnly[0]).toBe(0);
        expect(centreOnly[0]).toBeGreaterThan(leftOnly[0]);
    });
});

describe("opening a file's sound", () => {
    it.each([
        ["tone.mp4", "video/mp4", "MP4", [0xff, 0xf1]],
        ["tone.mov", "video/quicktime", "MP4", [0xff, 0xf1]],
        ["tone.m4a", "audio/mp4", "MP4", [0xff, 0xf1]],
        ["tone.webm", "video/webm", "Matroska", [0x1a, 0x45]],
        ["tone.mkv", "video/x-matroska", "Matroska", [0x1a, 0x45]],
        ["tone.mp3", "audio/mpeg", "MP3", [0xff]],
        ["tone.wav", "audio/wav", "WAV", [0x52, 0x49]],
    ])("reads %s in pieces and hands on 16 kHz mono", async (name, type, container, magic) => {
        const source = await openAudio(fileOf(name, type));
        expect(source.container).toBe(container);
        expect(source.durationSeconds).toBeGreaterThan(1.9);
        expect(source.durationSeconds).toBeLessThan(2.2);
        const chunks = await all(source.chunks());
        expect(chunks).toHaveLength(1);
        expect([...decoded[0].subarray(0, magic.length)]).toEqual(magic);
        const chunk = chunks[0] as { samples: Float32Array };
        // The stand-in's stereo of 0.2 and 0.4, mixed.
        expect(chunk.samples[0]).toBeCloseTo(0.3, 6);
        expect(chunk.samples.length).toBe(16000);
    });

    it("decides by a file's bytes, not its name", async () => {
        const source = await openAudio(fileOf("tone.webm", "video/mp4"));
        expect(source.container).toBe("Matroska");
    });

    it("says plainly when a video has no sound track", async () => {
        for (const name of ["no-sound.mp4", "no-sound.webm"]) {
            const error = await openAudio(fileOf(name, "video/mp4")).catch(caught => caught);
            expect(error).toBeInstanceOf(MediaError);
            expect(error.problem).toBe("no-sound");
        }
        expect(decoded).toHaveLength(0);
    });

    it("says the browser can't decode the sound when the first piece fails", async () => {
        refuse = () => true;
        const source = await openAudio(fileOf("tone.webm", "video/webm"));
        const error = await all(source.chunks()).catch(caught => caught);
        expect(error).toBeInstanceOf(MediaError);
        expect(error.problem).toBe("unreadable");
    });

    it("goes on past a later piece that fails to decode, saying where it was and how long", async () => {
        // Half-second pieces: the second will not decode, the others will.
        refuse = (_bytes, call) => call === 1;
        const source = await openAudio(fileOf("tone.mp3", "audio/mpeg"), { pieceSeconds: 0.5 });
        const chunks = await all(source.chunks());
        expect(chunks.length).toBeGreaterThanOrEqual(4);
        expect("samples" in chunks[0]).toBe(true);
        expect(chunks[1]).toMatchObject({ start: expect.closeTo(0.5, 1) });
        expect((chunks[1] as { unreadableSeconds: number }).unreadableSeconds).toBeCloseTo(0.5, 1);
        expect(chunks.slice(2).every(chunk => "samples" in chunk)).toBe(true);
    });

    it("decodes formats without a piece reader whole, within the whole-file limit", async () => {
        const ogg = mediaFile("voice.ogg", "audio/ogg", Uint8Array.of(0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0));
        const source = await openAudio(ogg, { measure: async () => 30 });
        expect(source.container).toBe("whole file");
        expect(source.durationSeconds).toBe(1);
        await expect(openAudio(ogg, { measure: async () => WHOLE_FILE_SECONDS + 60 })).rejects.toMatchObject({ problem: "too-long-whole" });
        await expect(openAudio(ogg, { measure: async () => MAX_SECONDS + 60 })).rejects.toMatchObject({ problem: "too-long" });
    });

    it("says why a file is decoded whole when it is too long for that", async () => {
        const tooLong = async () => 16 * 60;
        const fragmented = await openAudio(fileOf("tone-fragmented.mp4", "video/mp4"), { measure: tooLong }).catch(error => error);
        expect(fragmented).toMatchObject({ problem: "too-long-whole" });
        expect(fragmented.message).toBe("This file’s sound is 16 minutes long. This file is written in fragments, as some recorders save video, which this browser decodes whole, up to 15 minutes of sound.");
        const ogg = mediaFile("voice.ogg", "audio/ogg", Uint8Array.of(0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0));
        const other = await openAudio(ogg, { measure: tooLong }).catch(error => error);
        expect(other.message).toBe("This file’s sound is 16 minutes long. Files in this format are decoded whole in this browser, up to 15 minutes of sound.");
    });

    it("says an empty file is empty, before reading anything", async () => {
        const empty = mediaFile("empty.mp3", "audio/mpeg", new Uint8Array(0));
        const error = await openAudio(empty).catch(caught => caught);
        expect(error).toBeInstanceOf(MediaError);
        expect(error).toMatchObject({ problem: "empty" });
        expect(decoded).toHaveLength(0);
    });

    it("stops reading when asked: the walk through a file, and the pieces after it", async () => {
        const stopped = new AbortController();
        stopped.abort();
        await expect(openAudio(fileOf("tone.webm", "video/webm"), { signal: stopped.signal })).rejects.toMatchObject({ name: "AbortError" });
        await expect(openAudio(fileOf("tone.mp3", "audio/mpeg"), { signal: stopped.signal })).rejects.toMatchObject({ name: "AbortError" });
        const later = new AbortController();
        const source = await openAudio(fileOf("tone.mp4", "video/mp4"), { signal: later.signal, pieceSeconds: 0.5 });
        const chunks = source.chunks();
        await chunks.next();
        later.abort();
        await expect(chunks.next()).rejects.toMatchObject({ name: "AbortError" });
        expect(decoded).toHaveLength(1);
    });

    it("refuses a whole-file format it cannot measure when the file is large", async () => {
        const big = mediaFile("big.flac", "audio/flac", new Uint8Array(16));
        Object.defineProperty(big, "size", { value: 400 * 1024 * 1024 });
        await expect(openAudio(big, { measure: async () => null })).rejects.toMatchObject({ problem: "too-long-whole" });
        expect(decoded).toHaveLength(0);
    });
});

import { describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { mediaFile, wavFile } from "@/test/media/fixtures";
import { decodeRate, LEAD_SECONDS, lengthWords, MAX_SECONDS, NoiseInputError, openNoiseSource, WHOLE_FILE_SECONDS, type Decode, type SourceItem } from "./source";

const asFile = (blob: Blob, name: string, type = "") => new NodeFile([blob as unknown as NodeBlob], name, { type }) as unknown as File;

/** A decoder that hands back silence of the right length for each piece, as if the browser had decoded it. */
function fakeDecoder(seconds: (bytes: ArrayBuffer) => number, channels = 2): Decode & { calls: number[] } {
    const calls: number[] = [];
    const decode = (async (bytes: ArrayBuffer, rate: number) => {
        calls.push(rate);
        const length = Math.round(seconds(bytes) * rate);
        return { channels: Array.from({ length: channels }, () => new Float32Array(length)), rate };
    }) as Decode & { calls: number[] };
    decode.calls = calls;
    return decode;
}

async function collect(items: AsyncGenerator<SourceItem>): Promise<SourceItem[]> {
    const out: SourceItem[] = [];
    for await (const item of items) out.push(item);
    return out;
}

/** A WAV of silence: a header and `seconds` of 8-bit mono samples at 8 kHz, built without computing a tone. */
function silentWav(seconds: number): File {
    const frames = Math.round(8000 * seconds);
    const header = new Uint8Array(44);
    const view = new DataView(header.buffer);
    const text = (at: number, value: string) => { for (let i = 0; i < 4; i++) header[at + i] = value.charCodeAt(i); };
    text(0, "RIFF"); view.setUint32(4, 36 + frames, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    text(36, "data"); view.setUint32(40, frames, true);
    return new NodeFile([header, new Uint8Array(frames).fill(128)], "long.wav", { type: "audio/wav" }) as unknown as File;
}

describe("reading a recording for the noise remover", () => {
    it("hands WAV pieces to the worker as they are, without the browser's decoder", async () => {
        const decode = fakeDecoder(() => 0);
        const source = await openNoiseSource(asFile(wavFile({ rate: 22050, channels: 2, seconds: 2.5 }), "talk.wav", "audio/wav"), { decode, pieceSeconds: 1 });
        expect(source.container).toBe("WAV");
        expect(source.durationSeconds).toBeCloseTo(2.5, 3);
        const items = await collect(source.items());
        expect(items.map(item => item.kind)).toEqual(["wav", "wav", "wav"]);
        expect(items.map(item => item.kind === "wav" && item.start)).toEqual([0, 1, 2]);
        expect(decode.calls).toEqual([]);
    });

    it("decodes MP3 pieces at the file's own rate, each after the first with a lead", async () => {
        const decode = fakeDecoder(bytes => bytes.byteLength / 8000);
        const source = await openNoiseSource(mediaFile("tone.mp3", "audio/mpeg"), { decode, pieceSeconds: 0.5 });
        expect(source.container).toBe("MP3");
        const items = await collect(source.items());
        expect(items.length).toBeGreaterThanOrEqual(4);
        expect(decode.calls.every(rate => rate === 44100)).toBe(true);
        const [first, ...rest] = items as Extract<SourceItem, { kind: "pcm" }>[];
        expect(first.kind).toBe("pcm");
        expect(first.lead).toBe(0);
        // Each later piece's lead reaches back toward a second, as far as the file allows.
        for (const item of rest) {
            expect(item.kind).toBe("pcm");
            expect(item.lead).toBeGreaterThan(0);
            expect(item.lead).toBeLessThanOrEqual(LEAD_SECONDS + 1152 / 44100 + 1e-9);
        }
    });

    it("decodes Opus at 48 kHz and AAC at 24 kHz or less at twice its rate, in case it is HE-AAC", () => {
        expect(decodeRate({ codec: "opus", sampleRate: 16000 })).toBe(48000);
        expect(decodeRate({ codec: "aac", sampleRate: 22050 })).toBe(44100);
        expect(decodeRate({ codec: "aac", sampleRate: 24000 })).toBe(48000);
        expect(decodeRate({ codec: "aac", sampleRate: 44100 })).toBe(44100);
        expect(decodeRate({ codec: "mp3", sampleRate: 16000 })).toBe(16000);
        expect(decodeRate({ codec: "vorbis", sampleRate: 192000 })).toBe(96000);
        expect(decodeRate({})).toBe(48000);
        expect(decodeRate({ codec: "mp3", sampleRate: 7000 })).toBe(48000);
    });

    it("refuses an empty file before reading anything", async () => {
        const error = await openNoiseSource(asFile(new NodeBlob([]) as unknown as Blob, "empty.mp3")).catch(e => e);
        expect(error).toBeInstanceOf(NoiseInputError);
        expect(error.problem).toBe("empty");
    });

    it("says a video without a sound track has nothing to clean", async () => {
        const error = await openNoiseSource(mediaFile("no-sound.mp4", "video/mp4")).catch(e => e);
        expect(error).toMatchObject({ problem: "no-sound", message: "This file has no sound track, so there is nothing to clean." });
    });

    it("refuses a recording longer than an hour, saying how long it is", async () => {
        const error = await openNoiseSource(silentWav(MAX_SECONDS + 90)).catch(e => e);
        expect(error).toMatchObject({ problem: "too-long" });
        expect(error.message).toBe("This file’s sound is 1 h 2 min long. Voice Noise Remover takes up to 60 minutes at a time.");
    });

    it("fails on the first piece when this browser can't decode the sound", async () => {
        const decode = vi.fn(async () => { throw new Error("EncodingError"); });
        const source = await openNoiseSource(mediaFile("tone.mp3", "audio/mpeg"), { decode, pieceSeconds: 0.5 });
        const error = await source.items().next().catch(e => e);
        expect(error).toMatchObject({ name: "NoiseInputError", problem: "unreadable", message: "This browser can’t decode the sound in this file." });
    });

    it("puts a gap in place of a later piece the browser can't decode", async () => {
        let call = 0;
        const decode: Decode = async (_bytes, rate) => {
            if (++call === 2) throw new Error("EncodingError");
            return { channels: [new Float32Array(rate / 2)], rate };
        };
        const source = await openNoiseSource(mediaFile("tone.mp3", "audio/mpeg"), { decode, pieceSeconds: 0.5 });
        const items = await collect(source.items());
        expect(items[0].kind).toBe("pcm");
        expect(items[1]).toMatchObject({ kind: "gap" });
        expect((items[1] as Extract<SourceItem, { kind: "gap" }>).seconds).toBeGreaterThan(0.4);
        expect(items.slice(2).every(item => item.kind === "pcm")).toBe(true);
    });

    it("decodes other formats whole, at 48 kHz, in blocks", async () => {
        const decode = fakeDecoder(() => 130, 1);
        const file = asFile(new NodeBlob([new Uint8Array(4096).fill(7)]) as unknown as Blob, "voice.ogg", "audio/ogg");
        const source = await openNoiseSource(file, { decode, measure: async () => 130 });
        expect(source.container).toBe("whole file");
        const items = await collect(source.items());
        expect(decode.calls).toEqual([48000]);
        expect(items.map(item => item.kind === "pcm" && [item.start, item.lead, item.channels[0].length])).toEqual([[0, 0, 60 * 48000], [60, 0, 60 * 48000], [120, 0, 10 * 48000]]);
    });

    it("learns a whole file's length when decoding it, if the browser couldn't tell before", async () => {
        const decode = fakeDecoder(() => 42, 1);
        const source = await openNoiseSource(asFile(new NodeBlob([new Uint8Array(100)]) as unknown as Blob, "voice.flac"), { decode, measure: async () => null });
        expect(source.durationSeconds).toBe(0);
        await collect(source.items());
        expect(source.durationSeconds).toBe(42);
    });

    it("refuses a whole-file format longer than it decodes whole", async () => {
        const file = asFile(new NodeBlob([new Uint8Array(100)]) as unknown as Blob, "voice.flac");
        const error = await openNoiseSource(file, { measure: async () => WHOLE_FILE_SECONDS + 60 }).catch(e => e);
        expect(error).toMatchObject({ problem: "too-long-whole" });
        expect(error.message).toBe("This file’s sound is 16 minutes long. Files in this format are decoded whole in this browser, up to 15 minutes of sound.");
    });
});

describe("lengths in words", () => {
    it.each([[30, "under a minute"], [60, "1 minute"], [150, "3 minutes"], [3600, "1 hour"], [3720, "1 h 2 min"], [7200, "2 hours"]])("%i seconds is %s", (seconds, words) => {
        expect(lengthWords(seconds)).toBe(words);
    });
});

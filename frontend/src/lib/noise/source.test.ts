import { describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { mediaFile, wavFile } from "@/test/media/fixtures";
import { browserDecoder, decodeRate, LEAD_SECONDS, lengthWords, MAX_SECONDS, MAX_STEREO_SECONDS, NoiseInputError, openNoiseSource, WHOLE_FILE_SECONDS, type Decode, type SourceItem } from "./source";

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

/** A WAV of silence: a header and `seconds` of 8-bit samples at 8 kHz, built without computing a tone. */
function silentWav(seconds: number, channels = 1): File {
    const frames = Math.round(8000 * seconds);
    const bytes = frames * channels;
    const header = new Uint8Array(44);
    const view = new DataView(header.buffer);
    const text = (at: number, value: string) => { for (let i = 0; i < 4; i++) header[at + i] = value.charCodeAt(i); };
    text(0, "RIFF"); view.setUint32(4, 36 + bytes, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 8000 * channels, true); view.setUint16(32, channels, true); view.setUint16(34, 8, true);
    text(36, "data"); view.setUint32(40, bytes, true);
    return new NodeFile([header, new Uint8Array(bytes).fill(128)], "long.wav", { type: "audio/wav" }) as unknown as File;
}

/**
 * An MP3 of `seconds` of silent frames: MPEG-2.5 layer III at 8 kHz and 8
 * kbit/s, 72 bytes for each 72 ms, so an hour takes 3.6 MB. The reader walks
 * the frames; the stand-in decoder says how many channels they decode to.
 */
function silentMp3(seconds: number): File {
    const frames = Math.ceil(seconds / 0.072);
    const bytes = new Uint8Array(frames * 72);
    for (let at = 0; at < bytes.length; at += 72) bytes.set([0xff, 0xe3, 0x18, 0xc0], at);
    return new NodeFile([bytes], "long.mp3", { type: "audio/mpeg" }) as unknown as File;
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
        expect(error.message).toBe("This file’s sound is 1 h 2 min long. Voice Noise Remover takes up to 60 minutes of mono or 30 of stereo at a time.");
    });

    it("takes an hour's recording that its encoder padded past 60:00, and refuses one that reads as longer", async () => {
        // An hour of MP3 comes out at 60:00.04; the limit's own message would call it "1 hour long".
        const padded = await openNoiseSource(silentWav(MAX_SECONDS + 0.04));
        expect(padded.durationSeconds).toBeCloseTo(MAX_SECONDS + 0.04, 3);
        const error = await openNoiseSource(silentWav(MAX_SECONDS + 30)).catch(e => e);
        expect(error).toMatchObject({ problem: "too-long" });
        expect(error.message).toBe("This file’s sound is 1 h 1 min long. Voice Noise Remover takes up to 60 minutes of mono or 30 of stereo at a time.");
        const whole = asFile(new NodeBlob([new Uint8Array(100)]) as unknown as Blob, "voice.flac");
        await expect(openNoiseSource(whole, { measure: async () => WHOLE_FILE_SECONDS + 0.01 })).resolves.toBeTruthy();
    });

    it("refuses stereo longer than half an hour from a WAV's header, before decoding anything", async () => {
        const decode = fakeDecoder(() => 0);
        const error = await openNoiseSource(silentWav(MAX_STEREO_SECONDS + 60, 2), { decode }).catch(e => e);
        expect(error).toMatchObject({ problem: "too-long-stereo", seconds: MAX_STEREO_SECONDS + 60 });
        expect(error.message).toBe("This file’s sound is stereo and 31 minutes long. Voice Noise Remover takes stereo up to 30 minutes and mono up to 60.");
        expect(decode.calls).toEqual([]);
        // Mono as long, and stereo its encoder padded just past 30:00, are taken.
        await expect(openNoiseSource(silentWav(MAX_STEREO_SECONDS + 60, 1))).resolves.toMatchObject({ container: "WAV" });
        await expect(openNoiseSource(silentWav(MAX_STEREO_SECONDS + 0.04, 2))).resolves.toMatchObject({ container: "WAV" });
    });

    it("refuses decoded stereo longer than half an hour on its first piece, which comes before RNNoise loads", async () => {
        const stereo = await openNoiseSource(silentMp3(MAX_STEREO_SECONDS + 60), { decode: fakeDecoder(() => 1, 2) });
        expect(stereo.container).toBe("MP3");
        const error = await stereo.items().next().catch(e => e);
        expect(error).toMatchObject({ name: "NoiseInputError", problem: "too-long-stereo" });
        expect(error.message).toBe("This file’s sound is stereo and 31 minutes long. Voice Noise Remover takes stereo up to 30 minutes and mono up to 60.");
        // One channel, or more than two (mixed to one), may run to the hour.
        for (const channels of [1, 6]) {
            const source = await openNoiseSource(silentMp3(MAX_STEREO_SECONDS + 60), { decode: fakeDecoder(() => 1, channels) });
            await expect(source.items().next()).resolves.toMatchObject({ done: false, value: { kind: "pcm" } });
        }
    });

    it("hands the worker a copy of each decoded piece, never the decoder's own arrays", async () => {
        const made: Float32Array[] = [];
        const decode: Decode = async (_bytes, rate) => {
            const channel = new Float32Array(rate / 2).fill(0.25);
            made.push(channel);
            return { channels: [channel], rate };
        };
        const source = await openNoiseSource(mediaFile("tone.mp3", "audio/mpeg"), { decode, pieceSeconds: 0.5 });
        const items = (await collect(source.items())) as Extract<SourceItem, { kind: "pcm" }>[];
        expect(items).toHaveLength(made.length);
        items.forEach((item, i) => {
            expect(item.channels[0].buffer).not.toBe(made[i].buffer);
            expect([item.channels[0].length, item.channels[0][0], item.channels[0][made[i].length - 1]]).toEqual([made[i].length, 0.25, 0.25]);
        });
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

    it("keeps the browser's decoded sound once: its own arrays, not a copy", async () => {
        const left = new Float32Array([0.1, 0.2]);
        const right = new Float32Array([0.3, 0.4]);
        const copyFromChannel = vi.fn();
        class StandInContext {
            constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
            async decodeAudioData() {
                return { numberOfChannels: 2, length: 2, sampleRate: this.sampleRate, getChannelData: (c: number) => [left, right][c], copyFromChannel };
            }
        }
        vi.stubGlobal("OfflineAudioContext", StandInContext);
        try {
            const decoded = await browserDecoder()(new ArrayBuffer(8), 44100);
            expect(decoded.rate).toBe(44100);
            expect(decoded.channels[0]).toBe(left);
            expect(decoded.channels[1]).toBe(right);
            expect(copyFromChannel).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
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

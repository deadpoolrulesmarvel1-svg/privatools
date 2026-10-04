import { describe, expect, it } from "vitest";
import { wavFile } from "@/test/media/fixtures";
import { decodeWav, MAX_WAV_DATA_BYTES, toPcm16, WAV_HEADER_BYTES, wavHeader } from "./wav";

const text = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

describe("the WAV writer", () => {
    it("writes a 44-byte 16-bit PCM header with the sizes for the frames", () => {
        const header = wavHeader(2, 48000, 1000);
        const view = new DataView(header.buffer);
        expect(header.length).toBe(WAV_HEADER_BYTES);
        expect(text(header, 0)).toBe("RIFF");
        expect(view.getUint32(4, true)).toBe(36 + 4000);
        expect(text(header, 8)).toBe("WAVE");
        expect(text(header, 12)).toBe("fmt ");
        expect(view.getUint32(16, true)).toBe(16);
        expect(view.getUint16(20, true)).toBe(1);
        expect(view.getUint16(22, true)).toBe(2);
        expect(view.getUint32(24, true)).toBe(48000);
        expect(view.getUint32(28, true)).toBe(48000 * 4);
        expect(view.getUint16(32, true)).toBe(4);
        expect(view.getUint16(34, true)).toBe(16);
        expect(text(header, 36)).toBe("data");
        expect(view.getUint32(40, true)).toBe(4000);
    });

    it("sizes a mono file by two bytes a frame", () => {
        const view = new DataView(wavHeader(1, 48000, 48000).buffer);
        expect(view.getUint32(40, true)).toBe(96000);
        expect(view.getUint16(32, true)).toBe(2);
        expect(view.getUint32(28, true)).toBe(96000);
    });

    it("refuses more sound than a WAV's 32-bit sizes can describe", () => {
        expect(() => wavHeader(2, 48000, Math.floor(MAX_WAV_DATA_BYTES / 4))).not.toThrow();
        expect(() => wavHeader(2, 48000, Math.floor(MAX_WAV_DATA_BYTES / 4) + 1)).toThrow(RangeError);
    });

    it("interleaves channels as 16-bit samples, holding and counting what passes full scale", () => {
        const { pcm, clipped } = toPcm16([Float32Array.of(0, 0.5, 1.5, -1), Float32Array.of(-0.5, 1, -2, 0.25)]);
        expect(Array.from(pcm)).toEqual([0, -16383, 16384, 32767, 32767, -32767, -32767, 8192]);
        expect(clipped).toBe(2);
    });

    it("writes part of the channels when asked", () => {
        const { pcm } = toPcm16([Float32Array.of(0.1, 0.2, 0.3, 0.4)], 1, 2);
        expect(Array.from(pcm)).toEqual([Math.round(0.2 * 32767), Math.round(0.3 * 32767)]);
    });
});

describe("reading a WAV piece", () => {
    async function read(blob: Blob) {
        return decodeWav(await blob.arrayBuffer());
    }

    it.each([
        ["8-bit", { bits: 8 }, 1 / 127],
        ["16-bit", { bits: 16 }, 1 / 32767],
        ["24-bit", { bits: 24 }, 1 / 8388607],
        ["32-bit float", { bits: 32, float: true }, 1e-7],
    ])("reads %s samples", async (_, format, tolerance) => {
        const { sampleRate, channels } = await read(wavFile({ rate: 22050, channels: 2, seconds: 0.1, ...format }));
        expect(sampleRate).toBe(22050);
        expect(channels).toHaveLength(2);
        expect(channels[0]).toHaveLength(2205);
        for (let i = 0; i < 2205; i += 97) {
            const want = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 22050);
            expect(Math.abs(channels[0][i] - want)).toBeLessThanOrEqual(tolerance * 1.5 + 1e-7);
            expect(channels[1][i]).toBe(channels[0][i]);
        }
    });

    it("reads 32-bit integer and 64-bit float samples", () => {
        const build = (tag: number, bits: number, write: (view: DataView, at: number, value: number) => void) => {
            const frames = 4;
            const width = bits / 8;
            const bytes = new Uint8Array(44 + frames * width);
            const view = new DataView(bytes.buffer);
            bytes.set([..."RIFF"].map(c => c.charCodeAt(0)), 0);
            view.setUint32(4, 36 + frames * width, true);
            bytes.set([..."WAVEfmt "].map(c => c.charCodeAt(0)), 8);
            view.setUint32(16, 16, true);
            view.setUint16(20, tag, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, 8000, true);
            view.setUint32(28, 8000 * width, true);
            view.setUint16(32, width, true);
            view.setUint16(34, bits, true);
            bytes.set([..."data"].map(c => c.charCodeAt(0)), 36);
            view.setUint32(40, frames * width, true);
            [0.5, -0.25, 1, -1].forEach((value, i) => write(view, 44 + i * width, value));
            return bytes.buffer;
        };
        const ints = decodeWav(build(1, 32, (view, at, value) => view.setInt32(at, Math.max(-2147483648, Math.min(2147483647, Math.round(value * 2147483648))), true)));
        expect(Array.from(ints.channels[0]).map(v => Math.round(v * 1e6) / 1e6)).toEqual([0.5, -0.25, 1, -1]);
        const doubles = decodeWav(build(3, 64, (view, at, value) => view.setFloat64(at, value, true)));
        expect(Array.from(doubles.channels[0])).toEqual([0.5, -0.25, 1, -1]);
    });

    it("reads back what the writer wrote", async () => {
        const left = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10) * 0.8);
        const right = Float32Array.from({ length: 480 }, (_, i) => Math.cos(i / 7) * 0.3);
        const { pcm } = toPcm16([left, right]);
        const decoded = decodeWav(await new Blob([wavHeader(2, 48000, 480), pcm]).arrayBuffer());
        expect(decoded.sampleRate).toBe(48000);
        for (let i = 0; i < 480; i++) {
            expect(Math.abs(decoded.channels[0][i] - left[i])).toBeLessThan(1 / 16000);
            expect(Math.abs(decoded.channels[1][i] - right[i])).toBeLessThan(1 / 16000);
        }
    });

    it("says what it can't read", () => {
        const adpcm = new Uint8Array(new ArrayBuffer(48));
        const view = new DataView(adpcm.buffer);
        adpcm.set([..."RIFF"].map(c => c.charCodeAt(0)), 0);
        adpcm.set([..."WAVEfmt "].map(c => c.charCodeAt(0)), 8);
        view.setUint32(16, 16, true);
        view.setUint16(20, 2, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 8000, true);
        view.setUint16(32, 1, true);
        view.setUint16(34, 4, true);
        adpcm.set([..."data"].map(c => c.charCodeAt(0)), 36);
        view.setUint32(40, 4, true);
        expect(() => decodeWav(adpcm.buffer)).toThrow(/format 2, 4-bit/);
        expect(() => decodeWav(new Uint8Array(12).buffer)).toThrow("Not a WAV file");
        const empty = new Uint8Array(36);
        empty.set([..."RIFF"].map(c => c.charCodeAt(0)), 0);
        empty.set([..."WAVEfmt "].map(c => c.charCodeAt(0)), 8);
        new DataView(empty.buffer).setUint32(16, 16, true);
        expect(() => decodeWav(empty.buffer)).toThrow("This WAV file holds no sound data");
    });
});

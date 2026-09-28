import { describe, expect, it } from "vitest";
import { decodePng, encodePng, pngSize, readChunks, PngError } from "./png";
import { ascii, buildPng, concatBytes, pngChunk, random } from "@/test/gemini-fixtures";

function noise(length: number, seed: number): Uint8Array {
    const next = random(seed);
    return Uint8Array.from({ length }, () => Math.floor(next() * 256));
}

const rgbaOf = (bytes: Uint8Array) => Array.from(decodePng(bytes).rgba);

describe("PNG decoding", () => {
    it("reads 8-bit RGB through every row filter", () => {
        const pixels = noise(13 * 9 * 3, 1);
        for (const filter of [0, 1, 2, 3, 4, "cycle"] as const) {
            const png = decodePng(buildPng({ width: 13, height: 9, colorType: 2, pixels, filter }));
            expect(png).toMatchObject({ width: 13, height: 9, colorType: 2, bitDepth: 8 });
            for (let i = 0; i < 13 * 9; i++) {
                expect([png.rgba[i * 4], png.rgba[i * 4 + 1], png.rgba[i * 4 + 2], png.rgba[i * 4 + 3]]).toEqual([pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2], 255]);
            }
        }
    });

    it("reads RGBA, greyscale and greyscale with alpha", () => {
        const rgba = noise(7 * 5 * 4, 2);
        expect(rgbaOf(buildPng({ width: 7, height: 5, colorType: 6, pixels: rgba, filter: "cycle" }))).toEqual(Array.from(rgba));
        const grey = noise(7 * 5, 3);
        expect(rgbaOf(buildPng({ width: 7, height: 5, colorType: 0, pixels: grey, filter: 4 }))).toEqual(Array.from(grey).flatMap(g => [g, g, g, 255]));
        const greyAlpha = noise(7 * 5 * 2, 4);
        const expected: number[] = [];
        for (let i = 0; i < 35; i++) expected.push(greyAlpha[i * 2], greyAlpha[i * 2], greyAlpha[i * 2], greyAlpha[i * 2 + 1]);
        expect(rgbaOf(buildPng({ width: 7, height: 5, colorType: 4, pixels: greyAlpha, filter: 3 }))).toEqual(expected);
    });

    it("reads indexed colour at 1, 2, 4 and 8 bits, with palette transparency", () => {
        const palette = Uint8Array.from([10, 20, 30, 200, 100, 50, 0, 255, 0, 90, 90, 90]);
        const trns = Uint8Array.from([255, 128]);
        for (const bitDepth of [1, 2, 4, 8]) {
            const width = 11, height = 3, colours = Math.min(4, 1 << bitDepth);
            const indices = Array.from({ length: width * height }, (_, i) => (i * 7) % colours);
            const rowBytes = Math.ceil((width * bitDepth) / 8);
            const packed = new Uint8Array(rowBytes * height);
            indices.forEach((index, i) => {
                const x = i % width, y = Math.floor(i / width);
                const bit = x * bitDepth;
                packed[y * rowBytes + (bit >> 3)] |= index << (8 - bitDepth - (bit & 7));
            });
            const png = decodePng(buildPng({ width, height, colorType: 3, bitDepth, pixels: packed, filter: 1, before: [["PLTE", palette], ["tRNS", trns]] }));
            const expected = indices.flatMap(index => [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], index < trns.length ? trns[index] : 255]);
            expect(Array.from(png.rgba), `${bitDepth}-bit`).toEqual(expected);
        }
    });

    it("applies a greyscale transparency key", () => {
        const png = decodePng(buildPng({ width: 2, height: 1, colorType: 0, pixels: Uint8Array.of(7, 9), before: [["tRNS", Uint8Array.of(0, 9)]] }));
        expect(Array.from(png.rgba)).toEqual([7, 7, 7, 255, 9, 9, 9, 0]);
    });

    it("joins image data split over several chunks", () => {
        const pixels = noise(40 * 30 * 3, 5);
        expect(rgbaOf(buildPng({ width: 40, height: 30, colorType: 2, pixels, filter: "cycle", idatSize: 97 }))).toEqual(rgbaOf(buildPng({ width: 40, height: 30, colorType: 2, pixels })));
    });

    it("reads the size from the header alone", () => {
        expect(pngSize(buildPng({ width: 3, height: 2, colorType: 2, pixels: new Uint8Array(18) }))).toEqual({ width: 3, height: 2 });
    });

    it("refuses what it cannot keep exact, with a reason", () => {
        const refuse = (bytes: Uint8Array) => { try { decodePng(bytes); return "decoded"; } catch (error) { return error instanceof PngError ? error.message : String(error); } };
        expect(refuse(buildPng({ width: 2, height: 2, colorType: 2, bitDepth: 16, pixels: new Uint8Array(24) }))).toMatch(/16-bit/);
        expect(refuse(buildPng({ width: 2, height: 2, colorType: 2, interlace: 1, pixels: new Uint8Array(12) }))).toMatch(/Interlaced/);
        expect(refuse(buildPng({ width: 2, height: 2, colorType: 2, pixels: new Uint8Array(12), before: [["acTL", new Uint8Array(8)]] }))).toMatch(/Animated/);
        expect(refuse(buildPng({ width: 2, height: 2, colorType: 0, bitDepth: 4, pixels: new Uint8Array(2) }))).toMatch(/colour depth/);
        expect(refuse(ascii("GIF89a not a png"))).toMatch(/not a PNG/);
        const good = buildPng({ width: 4, height: 4, colorType: 2, pixels: noise(48, 6) });
        const damaged = Uint8Array.from(good);
        const idatAt = damaged.findIndex((_, i) => damaged[i] === 0x49 && damaged[i + 1] === 0x44 && damaged[i + 2] === 0x41 && damaged[i + 3] === 0x54);
        damaged[idatAt + 6] ^= 0xff;
        expect(refuse(damaged)).toMatch(/checksum/);
        expect(refuse(good.subarray(0, good.length - 30))).toMatch(/damaged|incomplete/);
    });
});

describe("PNG encoding", () => {
    it("writes back exactly the same pixels in the same colour type", () => {
        for (const [colorType, channels] of [[0, 1], [2, 3], [4, 2], [6, 4]]) {
            const source = decodePng(buildPng({ width: 17, height: 11, colorType, pixels: noise(17 * 11 * channels, colorType + 10), filter: "cycle" }));
            const again = decodePng(encodePng(source, source.rgba));
            expect(again.colorType).toBe(colorType);
            expect(Array.from(again.rgba)).toEqual(Array.from(source.rgba));
        }
    });

    it("keeps every other chunk, byte for byte, on the same side of the image data", () => {
        const before: [string, Uint8Array][] = [
            ["iCCP", concatBytes([ascii("sRGB profile\0\0"), Uint8Array.of(0x78, 0x9c, 3, 0, 0, 0, 0, 1)])],
            ["tEXt", ascii("Software\0Gemini test fixture")],
            ["eXIf", Uint8Array.of(0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 0)],
            ["caBX", ascii("jumbf c2pa manifest bytes, kept as they are")],
            ["pHYs", Uint8Array.of(0, 0, 11, 19, 0, 0, 11, 19, 1)],
        ];
        const after: [string, Uint8Array][] = [["iTXt", ascii("Comment\0\0\0\0written after the pixels")], ["tIME", Uint8Array.of(7, 234, 9, 28, 12, 0, 0)]];
        const source = decodePng(buildPng({ width: 9, height: 9, colorType: 2, pixels: noise(243, 7), before, after }));
        const types = readChunks(encodePng(source, source.rgba)).map(chunk => chunk.type);
        expect(types).toEqual(["IHDR", "iCCP", "tEXt", "eXIf", "caBX", "pHYs", "IDAT", "iTXt", "tIME"]);
        const written = readChunks(encodePng(source, source.rgba));
        for (const [type, data] of [...before, ...after]) {
            expect(Array.from(written.find(chunk => chunk.type === type)!.data), type).toEqual(Array.from(data));
        }
    });

    it("saves an indexed image as full colour and drops only the palette's own chunks", () => {
        const palette = Uint8Array.of(0, 0, 0, 255, 255, 255);
        const opaque = decodePng(buildPng({ width: 8, height: 1, colorType: 3, bitDepth: 1, pixels: Uint8Array.of(0b10101010), before: [["PLTE", palette], ["bKGD", Uint8Array.of(0)], ["tEXt", ascii("Title\0dots")]] }));
        const written = readChunks(encodePng(opaque, opaque.rgba));
        expect(written.map(chunk => chunk.type)).toEqual(["IHDR", "tEXt", "IDAT"]);
        expect(decodePng(encodePng(opaque, opaque.rgba)).colorType).toBe(2);
        const seeThrough = decodePng(buildPng({ width: 8, height: 1, colorType: 3, bitDepth: 1, pixels: Uint8Array.of(0b10101010), before: [["PLTE", palette], ["tRNS", Uint8Array.of(0)]] }));
        const again = decodePng(encodePng(seeThrough, seeThrough.rgba));
        expect(again.colorType).toBe(6);
        expect(Array.from(again.rgba)).toEqual(Array.from(seeThrough.rgba));
    });

    it("splits large image data into several chunks that decode back", () => {
        const source = decodePng(buildPng({ width: 400, height: 300, colorType: 6, pixels: noise(400 * 300 * 4, 8) }));
        const bytes = encodePng(source, source.rgba);
        expect(readChunks(bytes).filter(chunk => chunk.type === "IDAT").length).toBeGreaterThan(1);
        expect(Array.from(decodePng(bytes).rgba)).toEqual(Array.from(source.rgba));
        // The helper's own file and ours agree on the chunk format.
        expect(Array.from(pngChunk("IEND", new Uint8Array(0)))).toEqual(Array.from(bytes.subarray(bytes.length - 12)));
    });
});

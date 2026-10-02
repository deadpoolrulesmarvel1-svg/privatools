import { describe, expect, it } from "vitest";
import { exifOrientation, inspectWebp, jpegMetadata, sniffFormat, spliceJpeg, spliceWebp } from "./containers";
import { ascii, concatBytes } from "@/test/gemini-fixtures";

// ── JPEG byte streams built segment by segment ────────────────────────────

const segment = (marker: number, payload: Uint8Array) =>
    concatBytes([Uint8Array.of(0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff), payload]);

function exif(orientation: number, bigEndian = false): Uint8Array {
    const u16 = (v: number) => bigEndian ? [v >> 8, v & 0xff] : [v & 0xff, v >> 8];
    const u32 = (v: number) => bigEndian ? [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff] : [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
    const tiff = [...(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(8), ...u16(1),
        ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
    return segment(0xe1, concatBytes([ascii("Exif\0\0"), Uint8Array.from(tiff)]));
}

const icc = (space: string) => segment(0xe2, concatBytes([ascii("ICC_PROFILE\0"), Uint8Array.of(1, 1), new Uint8Array(16), ascii(space), new Uint8Array(12)]));
const JFIF = segment(0xe0, concatBytes([ascii("JFIF\0"), Uint8Array.of(1, 1, 1, 0, 72, 0, 72, 0, 0)]));
const XMP = segment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>DigitalSourceType trainedAlgorithmicMedia</x:xmpmeta>"));
const C2PA = segment(0xeb, concatBytes([ascii("JP"), Uint8Array.of(0, 1, 0, 0, 0, 1), ascii("jumb c2pa manifest")]));
const IPTC = segment(0xed, ascii("Photoshop 3.0\u00008BIM iptc"));
const MPF = segment(0xe2, ascii("MPF\0II*\0offsets into the old file"));
const ADOBE = segment(0xee, concatBytes([ascii("Adobe"), Uint8Array.of(0, 100, 0, 0, 0, 0, 0)]));
const COMMENT = segment(0xfe, ascii("a comment"));

function body(tag: number): Uint8Array {
    return concatBytes([
        segment(0xdb, Uint8Array.of(0, tag, tag, tag)),
        segment(0xc0, Uint8Array.of(8, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1)),
        segment(0xc4, Uint8Array.of(0, tag)),
        segment(0xda, Uint8Array.of(3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0)),
        Uint8Array.of(tag, 0xff, 0x00, tag, 0xff, 0xd9),
    ]);
}

const jpeg = (...parts: Uint8Array[]) => concatBytes([Uint8Array.of(0xff, 0xd8), ...parts]);

describe("file formats", () => {
    it("recognises PNG, JPEG and WebP from their bytes, not their names", () => {
        expect(sniffFormat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
        expect(sniffFormat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
        expect(sniffFormat(concatBytes([ascii("RIFF"), new Uint8Array(4), ascii("WEBP")]))).toBe("webp");
        expect(sniffFormat(ascii("GIF89a....."))).toBeNull();
        expect(sniffFormat(concatBytes([ascii("RIFF"), new Uint8Array(4), ascii("WAVE")]))).toBeNull();
    });
});

describe("JPEG metadata", () => {
    const original = jpeg(JFIF, exif(6), XMP, icc("RGB "), MPF, C2PA, IPTC, ADOBE, COMMENT, body(1));
    const encoded = jpeg(segment(0xe0, ascii("JFIF\0browser")), body(9));

    it("reads the EXIF orientation in either byte order", () => {
        expect(exifOrientation(original)).toBe(6);
        expect(exifOrientation(jpeg(exif(3, true), body(1)))).toBe(3);
        expect(exifOrientation(jpeg(JFIF, body(1)))).toBe(1);
    });

    it("carries every metadata segment into the browser's encoding except those tied to the old one", () => {
        const out = spliceJpeg(original, encoded, false);
        expect(Array.from(out)).toEqual(Array.from(jpeg(JFIF, exif(6), XMP, icc("RGB "), C2PA, IPTC, COMMENT, body(9))));
    });

    it("resets the orientation when the browser has already turned the picture upright", () => {
        expect(Array.from(spliceJpeg(original, encoded, true))).toEqual(Array.from(jpeg(JFIF, exif(1), XMP, icc("RGB "), C2PA, IPTC, COMMENT, body(9))));
        expect(exifOrientation(spliceJpeg(jpeg(exif(8, true), body(1)), encoded, true))).toBe(1);
    });

    it("drops a CMYK or greyscale colour profile, which cannot describe the RGB result", () => {
        expect(jpegMetadata(jpeg(icc("CMYK"), XMP, body(1))).map(s => s.marker)).toEqual([0xe1]);
        expect(jpegMetadata(jpeg(icc("GRAY"), body(1))).map(s => s.marker)).toEqual([]);
    });

    it("refuses a file whose segments run past its end", () => {
        expect(() => jpegMetadata(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0x40, 0, 1, 2))).toThrow(/damaged/);
    });
});

// ── WebP files built chunk by chunk ───────────────────────────────────────

const chunk = (type: string, data: Uint8Array) => {
    const size = Uint8Array.of(data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff, 0);
    return concatBytes([ascii(type), size, data, data.length & 1 ? Uint8Array.of(0) : new Uint8Array(0)]);
};
function riff(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const body = concatBytes([ascii("WEBP"), ...chunks]);
    return concatBytes([ascii("RIFF"), Uint8Array.of(body.length & 0xff, (body.length >> 8) & 0xff, (body.length >> 16) & 0xff, 0), body]);
}
function vp8l(width: number, height: number, alpha: boolean): Uint8Array {
    const bits = (width - 1) | ((height - 1) << 14) | (alpha ? 1 << 28 : 0);
    return chunk("VP8L", Uint8Array.of(0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff, 1, 2, 3));
}
const vp8x = (flags: number) => chunk("VP8X", Uint8Array.of(flags, 0, 0, 0, 99, 0, 0, 49, 0, 0));

function chunkList(bytes: Uint8Array): { type: string; data: number[] }[] {
    const out: { type: string; data: number[] }[] = [];
    for (let at = 12; at + 8 <= bytes.length;) {
        const size = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16);
        out.push({ type: String.fromCharCode(...bytes.subarray(at, at + 4)), data: Array.from(bytes.subarray(at + 8, at + 8 + size)) });
        at += 8 + size + (size & 1);
    }
    return out;
}

describe("WebP metadata", () => {
    it("tells lossless, lossy and animated files apart", () => {
        expect(inspectWebp(riff(vp8l(10, 10, false)))).toEqual({ lossless: true, animated: false });
        expect(inspectWebp(riff(chunk("VP8 ", Uint8Array.of(1, 2, 3, 4))))).toEqual({ lossless: false, animated: false });
        expect(inspectWebp(riff(vp8x(0x02), chunk("ANIM", new Uint8Array(6)), chunk("ANMF", new Uint8Array(20))))).toMatchObject({ animated: true });
    });

    it("returns the browser's file untouched when neither side has metadata", () => {
        const encoded = riff(vp8l(100, 50, false));
        expect(spliceWebp(riff(vp8l(100, 50, false)), encoded, 100, 50)).toBe(encoded);
    });

    it("leaves out metadata the browser's encoder adds of its own", () => {
        // Chrome's canvas encoder writes an sRGB profile; the original had none, so the output carries none.
        const encoded = riff(vp8x(0x20), chunk("ICCP", ascii("sRGB from the encoder")), chunk("VP8 ", Uint8Array.of(5, 6, 7, 8)));
        const out = spliceWebp(riff(chunk("VP8 ", Uint8Array.of(1, 2))), encoded, 100, 50);
        expect(Array.from(out)).toEqual(Array.from(riff(chunk("VP8 ", Uint8Array.of(5, 6, 7, 8)))));
        const withOriginalMetadata = chunkList(spliceWebp(riff(vp8x(0x08), chunk("VP8 ", Uint8Array.of(1, 2)), chunk("EXIF", ascii("mine"))), encoded, 100, 50));
        expect(withOriginalMetadata.map(c => c.type)).toEqual(["VP8X", "VP8 ", "EXIF"]);
        expect(withOriginalMetadata[0].data[0]).toBe(0x08);
    });

    it("puts the colour profile, EXIF, XMP and other chunks back in the extended layout", () => {
        const profile = ascii("icc profile bytes");
        const exifData = ascii("MM\0*exif with odd length");
        const xmp = ascii("<x:xmpmeta>trainedAlgorithmicMedia</x:xmpmeta>");
        const c2pa = ascii("c2pa manifest store");
        const original = riff(vp8x(0x20 | 0x08 | 0x04), chunk("ICCP", profile), vp8l(100, 50, false), chunk("EXIF", exifData), chunk("XMP ", xmp), chunk("C2PA", c2pa));
        const out = spliceWebp(original, riff(vp8l(100, 50, true)), 100, 50);
        const chunks = chunkList(out);
        expect(chunks.map(c => c.type)).toEqual(["VP8X", "ICCP", "VP8L", "EXIF", "XMP ", "C2PA"]);
        // ICC, alpha (from the new lossless data), EXIF and XMP flags; canvas 100 × 50 stored as width − 1 and height − 1.
        expect(chunks[0].data).toEqual([0x20 | 0x10 | 0x08 | 0x04, 0, 0, 0, 99, 0, 0, 49, 0, 0]);
        expect(chunks[1].data).toEqual(Array.from(profile));
        expect(chunks[3].data).toEqual(Array.from(exifData));
        expect(chunks[5].data).toEqual(Array.from(c2pa));
        const declared = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
        expect(declared).toBe(out.length - 8);
        expect(out.length % 2).toBe(0);
    });

    it("keeps a lossy encoding's alpha chunk ahead of its image data", () => {
        const original = riff(vp8x(0x08), chunk("VP8 ", Uint8Array.of(9, 9)), chunk("EXIF", ascii("exif")));
        const encoded = riff(vp8x(0x10), chunk("ALPH", Uint8Array.of(1, 1, 1)), chunk("VP8 ", Uint8Array.of(5, 6, 7, 8)));
        const chunks = chunkList(spliceWebp(original, encoded, 100, 50));
        expect(chunks.map(c => c.type)).toEqual(["VP8X", "ALPH", "VP8 ", "EXIF"]);
        expect(chunks[0].data[0]).toBe(0x10 | 0x08);
    });
});

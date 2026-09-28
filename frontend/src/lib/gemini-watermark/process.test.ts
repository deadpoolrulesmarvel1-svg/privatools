import { describe, expect, it } from "vitest";
import { alphaFor } from "./alpha";
import { outputName, removeGeminiSparkle } from "./process";
import { decodePng, readChunks } from "./png";
import { sparkleCandidates } from "./geometry";
import { applySparkle, ascii, background, buildPng, concatBytes, pictureToPng } from "@/test/gemini-fixtures";

function marked(width: number, height: number, layout: "legacy" | "current", seed = 1) {
    const original = background("photo", width, height, seed);
    const target = sparkleCandidates(width, height).find(candidate => candidate.layout === layout)!;
    return { original, target, image: applySparkle(original, alphaFor(target.mask, target.size), target.x, target.y) };
}

const file = (bytes: Uint8Array<ArrayBuffer>, name: string) => new File([bytes], name, { type: "application/octet-stream" });

async function refusal(promise: Promise<unknown>) {
    try { await promise; return null; } catch (error) { return error as Error & { __kind?: string }; }
}

describe("one image through the remover", () => {
    it("cleans a watermarked PNG, keeps its other chunks and every pixel outside the logo", async () => {
        const { original, target, image } = marked(1376, 768, "current");
        const before: [string, Uint8Array][] = [["tEXt", ascii("Software\0Gemini test")], ["caBX", ascii("content credentials stay")]];
        const result = await removeGeminiSparkle(file(pictureToPng(image, { before, after: [["iTXt", ascii("Comment\0\0\0\0kept")]] }), "picnic.png"));
        expect(result.status).toBe("removed");
        if (result.status !== "removed") return;
        expect(result).toMatchObject({ format: "png", width: 1376, height: 768, outName: "picnic_no-sparkle.png" });
        expect(result.detection.candidate).toMatchObject({ layout: "current", size: 48, x: target.x, y: target.y });
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        expect(result.blob.type).toBe("image/png");
        expect(readChunks(bytes).map(chunk => chunk.type)).toEqual(["IHDR", "tEXt", "caBX", ...readChunks(bytes).filter(c => c.type === "IDAT").map(() => "IDAT"), "iTXt"]);
        const out = decodePng(bytes).rgba;
        let inside = 0, outside = 0;
        for (let y = 0; y < 768; y++) {
            for (let x = 0; x < 1376; x++) {
                const i = (y * 1376 + x) * 4;
                let diff = 0;
                for (let c = 0; c < 4; c++) diff = Math.max(diff, Math.abs(out[i + c] - original.data[i + c]));
                const inBox = x >= target.x && x < target.x + target.size && y >= target.y && y < target.y + target.size;
                if (inBox) inside = Math.max(inside, diff); else outside = Math.max(outside, diff);
            }
        }
        expect(inside).toBeLessThanOrEqual(1);
        expect(outside).toBe(0);
    }, 30_000);

    it("leaves a PNG without the sparkle alone", { timeout: 30_000 }, async () => {
        const clean = background("photo", 1024, 1024, 4);
        expect(await removeGeminiSparkle(file(pictureToPng(clean), "clean.png"))).toEqual({ status: "not-found", format: "png", width: 1024, height: 1024 });
    });

    it("goes by the content, not the name", { timeout: 30_000 }, async () => {
        const { image } = marked(1024, 1024, "legacy");
        const result = await removeGeminiSparkle(file(pictureToPng(image), "download.jpg"));
        expect(result).toMatchObject({ status: "removed", format: "png", outName: "download_no-sparkle.png" });
    });

    it("refuses other files and unsupported PNGs as bad input, with the reason", async () => {
        const notImage = await refusal(removeGeminiSparkle(file(ascii("just some text"), "notes.png")));
        expect(notImage?.message).toMatch(/not a PNG, JPEG or WebP/);
        expect(notImage?.__kind).toBe("bad_input");
        const deep = await refusal(removeGeminiSparkle(file(buildPng({ width: 2, height: 2, colorType: 2, bitDepth: 16, pixels: new Uint8Array(24) }), "deep.png")));
        expect(deep?.message).toMatch(/16-bit/);
        expect(deep?.__kind).toBe("bad_input");
    });

    it("refuses a picture larger than Gemini makes before reading its pixels", async () => {
        const header = new Uint8Array(13);
        new DataView(header.buffer).setUint32(0, 9000);
        new DataView(header.buffer).setUint32(4, 9000);
        header.set([8, 2, 0, 0, 0], 8);
        const huge = buildPng({ width: 1, height: 1, colorType: 2, pixels: new Uint8Array(3) });
        huge.set(header, 16); // IHDR data now claims 9000 × 9000; the checksum no longer matters because nothing is decoded
        const error = await refusal(removeGeminiSparkle(file(huge, "huge.png")));
        expect(error?.message).toMatch(/larger than 50 megapixels/);
        expect(error?.__kind).toBe("too_large");
    });

    it("says plainly when the browser cannot open JPEG or WebP for editing", async () => {
        const jpeg = concatBytes([Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xdb, 0, 3, 0, 0xff, 0xd9)]);
        const error = await refusal(removeGeminiSparkle(file(jpeg, "photo.jpg")));
        // jsdom has no image decoder; real browsers do, and the page is checked in one.
        expect(error?.message).toMatch(/cannot open JPEG or WebP/);
        expect(error?.__kind).toBe("browser");
    });

    it("names the output after the input, in the format it really is", () => {
        expect(outputName("photo.jpeg", "jpeg")).toBe("photo_no-sparkle.jpeg");
        expect(outputName("photo.JPG", "jpeg")).toBe("photo_no-sparkle.JPG");
        expect(outputName("image.jpg", "png")).toBe("image_no-sparkle.png");
        expect(outputName("noext", "webp")).toBe("noext_no-sparkle.webp");
    });
});

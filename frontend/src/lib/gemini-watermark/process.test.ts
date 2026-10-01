import { afterEach, describe, expect, it, vi } from "vitest";
import { alphaFor } from "./alpha";
import { outputName, removeGeminiSparkle } from "./process";
import { decodePng, readChunks } from "./png";
import { failureReply, processPngBytes, type PngJobReply } from "./png-job";
import { sparklePlacements, type Family } from "./geometry";
import { MASK_SOURCES } from "./masks";
import { applySparkle, ascii, background, buildPng, concatBytes, pictureToPng } from "@/test/gemini-fixtures";

/** A photo-like picture with the logo of one layout laid on at `gain` times its usual opacity. */
function marked(width: number, height: number, family: Family, gain = 1, seed = 1) {
    const original = background("photo", width, height, seed);
    const p = sparklePlacements(width, height).find(placement => placement.family === family)!;
    const size = Math.round(MASK_SOURCES[p.mask].size * p.scaleX);
    const target = { x: p.left, y: p.top, size };
    return { original, target, image: applySparkle(original, alphaFor(p.mask, size), p.left, p.top, p.gain * gain) };
}

const file = (bytes: Uint8Array<ArrayBuffer>, name: string) => new File([bytes], name, { type: "application/octet-stream" });

async function refusal(promise: Promise<unknown>) {
    try { await promise; return null; } catch (error) { return error as Error & { __kind?: string; __userMessage?: boolean }; }
}

afterEach(() => vi.unstubAllGlobals());

describe("one image through the remover", () => {
    it("cleans a watermarked PNG, keeps its other chunks and every pixel outside the logo", async () => {
        const { original, target, image } = marked(1376, 768, "inset-96");
        const before: [string, Uint8Array][] = [["tEXt", ascii("Software\0Gemini test")], ["caBX", ascii("content credentials stay")]];
        const result = await removeGeminiSparkle(file(pictureToPng(image, { before, after: [["iTXt", ascii("Comment\0\0\0\0kept")]] }), "picnic.png"));
        expect(result.status).toBe("removed");
        if (result.status !== "removed") return;
        expect(result).toMatchObject({ format: "png", width: 1376, height: 768, outName: "picnic_no-sparkle.png" });
        expect(result.fit).toMatchObject({ family: "inset-96", size: 48, marginRight: 96, marginBottom: 96, x: target.x, y: target.y });
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
        expect(inside).toBeLessThanOrEqual(3);
        expect(outside).toBe(0);
    }, 30_000);

    it("leaves a PNG without the sparkle alone", { timeout: 30_000 }, async () => {
        const clean = background("photo", 1024, 1024, 4);
        expect(await removeGeminiSparkle(file(pictureToPng(clean), "clean.png"))).toEqual({ status: "not-found", format: "png", width: 1024, height: 1024 });
    });

    it("leaves a PNG alone when its sparkle would not come out cleanly, and says where it is", { timeout: 30_000 }, async () => {
        // A 50 px logo where the layout fixes 48 px: found, but its outline would remain.
        const original = background("flat-grey", 1024, 1024, 4);
        const image = applySparkle(original, alphaFor("v1-48", 50), 942, 942);
        const result = await removeGeminiSparkle(file(pictureToPng(image), "odd.png"));
        expect(result.status).not.toBe("removed");
        if (result.status === "not-clean") expect(result.fit).toMatchObject({ family: "corner-32", size: 48, marginRight: 32, marginBottom: 32 });
    });

    it("goes by the content, not the name", { timeout: 30_000 }, async () => {
        const { image } = marked(1024, 1024, "corner-32");
        const result = await removeGeminiSparkle(file(pictureToPng(image), "download.jpg"));
        expect(result).toMatchObject({ status: "removed", format: "png", outName: "download_no-sparkle.png" });
    });

    it("refuses other files and unsupported PNGs as bad input, with a reason written for people", async () => {
        const notImage = await refusal(removeGeminiSparkle(file(ascii("just some text"), "notes.png")));
        expect(notImage?.message).toMatch(/not a PNG, JPEG or WebP/);
        expect(notImage?.__kind).toBe("bad_input");
        expect(notImage?.__userMessage).toBe(true);
        const deep = await refusal(removeGeminiSparkle(file(buildPng({ width: 2, height: 2, colorType: 2, bitDepth: 16, pixels: new Uint8Array(24) }), "deep.png")));
        expect(deep?.message).toMatch(/16-bit/);
        expect(deep?.__kind).toBe("bad_input");
    });

    it("refuses a damaged PNG as an image, not as a PDF", async () => {
        const bytes = pictureToPng(background("gradient", 64, 64));
        const truncated = await refusal(removeGeminiSparkle(file(bytes.slice(0, bytes.length - 40), "cut.png")));
        expect(truncated?.message).toMatch(/This PNG file is damaged/);
        expect(truncated?.__kind).toBe("bad_input");
        expect(truncated?.__userMessage).toBe(true);
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

describe("the PNG worker", () => {
    it("does the whole PNG path without the page: bytes in, cleaned bytes and the fit out", () => {
        const { image } = marked(1024, 1024, "corner-32");
        const result = processPngBytes(pictureToPng(image));
        expect(result).toMatchObject({ status: "removed", width: 1024, height: 1024, fit: { family: "corner-32", size: 48, x: 944, y: 944 } });
        if (result.status === "removed") expect(decodePng(result.bytes).width).toBe(1024);
        // Its reply is plain data: it survives structured cloning to the page.
        const reply: PngJobReply = { ok: true, result };
        const copy = structuredClone(reply) as Extract<PngJobReply, { ok: true }>;
        expect(copy.result.status).toBe("removed");
        if (copy.result.status !== "removed" || result.status !== "removed") return;
        expect(copy.result.fit).toEqual(result.fit);
        expect(Buffer.from(copy.result.bytes).equals(Buffer.from(result.bytes))).toBe(true);
    });

    it("turns failures into a message and a category, never a stack", () => {
        let caught: unknown;
        try { processPngBytes(ascii("\x89PNG\r\n\x1a\n broken")); } catch (error) { caught = error; }
        expect(failureReply(caught)).toEqual({ ok: false, message: expect.stringMatching(/PNG file is damaged/), kind: "bad_input" });
        expect(failureReply(new RangeError("Array buffer allocation failed"))).toEqual({ ok: false, message: "This image could not be processed in this browser.", kind: "browser" });
    });

    it("runs in a module worker when the browser has one, and on the page when it cannot start", async () => {
        const { image } = marked(1024, 1024, "corner-32");
        const bytes = pictureToPng(image);
        const started: unknown[] = [];
        class FakeWorker {
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: Event) => void) | null = null;
            onmessageerror: (() => void) | null = null;
            constructor(url: URL, options: WorkerOptions) { started.push([url.pathname.split("/").pop(), options.type]); }
            postMessage(data: Uint8Array) {
                // Answer the way png.worker.ts does, off the current task.
                setTimeout(() => this.onmessage?.({ data: { ok: true, result: processPngBytes(data) } } as MessageEvent), 0);
            }
            terminate() { /* nothing to stop */ }
        }
        vi.stubGlobal("Worker", FakeWorker);
        const viaWorker = await removeGeminiSparkle(file(bytes, "a.png"));
        expect(started).toEqual([["png.worker.ts", "module"]]);
        expect(viaWorker).toMatchObject({ status: "removed", fit: { family: "corner-32" } });

        class BrokenWorker extends FakeWorker {
            postMessage() { setTimeout(() => this.onerror?.(new Event("error")), 0); }
        }
        vi.stubGlobal("Worker", BrokenWorker);
        const onPage = await removeGeminiSparkle(file(bytes, "b.png"));
        expect(onPage).toMatchObject({ status: "removed", fit: { family: "corner-32" } });
    }, 30_000);
});

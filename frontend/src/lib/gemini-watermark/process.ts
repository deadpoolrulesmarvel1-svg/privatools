/**
 * One image through the Gemini sparkle remover, entirely in this browser tab.
 * No network request is made: the file is read, checked and written here.
 *
 * PNG is decoded and re-encoded in plain TypeScript (png.ts), so every pixel
 * outside the sparkle and every other chunk of the file come out exactly as
 * they went in. That work runs in a Web Worker (png.worker.ts), because a
 * large PNG takes seconds to encode; where a worker cannot start, it runs on
 * the page. JPEG and WebP are decoded and re-encoded by the browser: JPEG at
 * quality 95, lossless WebP losslessly (only where the browser can write it),
 * lossy WebP at quality 95. Their metadata is copied back in afterwards
 * (containers.ts).
 *
 * An image is changed only when the sparkle is found and removal leaves it
 * clean. With no sparkle found, or one that could not be removed cleanly,
 * the file is returned untouched and is not re-saved.
 */
import { buildOutputFilename, withErrorKind, withUserMessage } from "@/lib/api";
import type { ToolErrorKind } from "@/lib/toolRun";
import { exifOrientation, inspectWebp, sniffFormat, spliceJpeg, spliceWebp, type ImageFormat } from "./containers";
import { findSparkle, removeSparkle, type RgbaImage } from "./detect";
import { sparkleRegion } from "./geometry";
import { describeFit, failureReply, MAX_MEGAPIXELS, processPngBytes, tooLarge, type PngJobReply, type SparkleFit } from "./png-job";

export { MAX_MEGAPIXELS, type SparkleFit };
export const JPEG_QUALITY = 0.95;

interface Picture {
    format: ImageFormat;
    width: number;
    height: number;
}

export interface Removed extends Picture {
    status: "removed";
    blob: Blob;
    outName: string;
    fit: SparkleFit;
}

/** The sparkle is there, but removing it would leave a visible trace, so the file is left as it was. */
export interface NotClean extends Picture {
    status: "not-clean";
    fit: SparkleFit;
}

export interface NotFound extends Picture {
    status: "not-found";
}

export type SparkleResult = Removed | NotClean | NotFound;

const MIME: Record<ImageFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const EXTENSIONS: Record<ImageFormat, string[]> = { png: ["png"], jpeg: ["jpg", "jpeg"], webp: ["webp"] };

/** Keep the file's own extension when it matches its content; otherwise use the format's usual one. */
export function outputName(name: string, format: ImageFormat): string {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    const kept = EXTENSIONS[format].includes(extension) ? name.slice(dot + 1) : EXTENSIONS[format][0];
    return buildOutputFilename(name, "no-sparkle", kept);
}

/** Every failure here is worded for the person using the tool, and says which kind it is. */
const fail = (message: string, kind: ToolErrorKind) => withUserMessage(withErrorKind(new Error(message), kind));

/** Run the PNG path in a worker; null when no worker can be started here, so the caller runs it on the page. */
function inWorker(bytes: Uint8Array): Promise<PngJobReply | null> {
    if (typeof Worker === "undefined") return Promise.resolve(null);
    let worker: Worker;
    try {
        worker = new Worker(new URL("./png.worker.ts", import.meta.url), { type: "module" });
    } catch {
        return Promise.resolve(null);
    }
    return new Promise(resolve => {
        worker.onmessage = (event: MessageEvent<PngJobReply>) => { worker.terminate(); resolve(event.data); };
        // A worker that fails to load or run reports here; the page then does the work itself.
        worker.onerror = event => { event.preventDefault(); worker.terminate(); resolve(null); };
        worker.onmessageerror = () => { worker.terminate(); resolve(null); };
        // Copied rather than transferred, so the page still has the bytes if it has to take over.
        worker.postMessage(bytes);
    });
}

function onPage(bytes: Uint8Array): PngJobReply {
    try {
        return { ok: true, result: processPngBytes(bytes) };
    } catch (error) {
        return failureReply(error);
    }
}

async function processPng(file: File, bytes: Uint8Array): Promise<SparkleResult> {
    const reply = await inWorker(bytes) ?? onPage(bytes);
    // Narrowed by hand: the project compiles without strict null checks, which discriminant narrowing needs.
    if (reply.ok === false) {
        const { message, kind } = reply as Extract<PngJobReply, { ok: false }>;
        throw fail(message, kind);
    }
    const { result } = reply as Extract<PngJobReply, { ok: true }>;
    const picture = { format: "png" as const, width: result.width, height: result.height };
    if (result.status === "not-found") return { status: "not-found", ...picture };
    if (result.status === "not-clean") return { status: "not-clean", ...picture, fit: result.fit };
    return {
        status: "removed", ...picture, fit: result.fit,
        blob: new Blob([result.bytes], { type: MIME.png }), outName: outputName(file.name, "png"),
    };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function processWithBrowserCodec(file: File, bytes: Uint8Array, format: "jpeg" | "webp"): Promise<SparkleResult> {
    // Read the container first: its metadata goes back into the output, so a file whose structure cannot be followed is refused.
    let webp: ReturnType<typeof inspectWebp> | null = null;
    let orientation = 1;
    try {
        if (format === "webp") webp = inspectWebp(bytes);
        else orientation = exifOrientation(bytes);
    } catch (error) {
        throw fail(error instanceof Error ? error.message : "This file is damaged.", "bad_input");
    }
    if (webp?.animated) throw fail("Animated WebP files are not supported. Save a single frame and try again.", "bad_input");
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
        throw fail("This browser cannot open JPEG or WebP images for editing. Try a current version of Chrome, Edge, Firefox or Safari.", "browser");
    }
    let bitmap: ImageBitmap;
    try {
        // Colours are read as stored, not converted, because the file's own colour profile is copied back in.
        bitmap = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "from-image" });
    } catch {
        throw fail(`This ${format === "jpeg" ? "JPEG" : "WebP"} file could not be read. It may be damaged.`, "bad_input");
    }
    try {
        const { width, height } = bitmap;
        const refusal = tooLarge(width, height);
        if (refusal) throw fail(refusal, "too_large");
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw fail("This browser cannot prepare the image. Try another browser.", "browser");
        context.drawImage(bitmap, 0, 0);

        // Only the corner can hold the sparkle; read just that much to decide.
        const picture = { format, width, height };
        const region = sparkleRegion(width, height);
        if (!region) return { status: "not-found", ...picture };
        const corner = context.getImageData(region.left, region.top, region.width, region.height);
        const cornerImage: RgbaImage = { width: corner.width, height: corner.height, data: corner.data };
        const frame = { width, height, left: region.left, top: region.top };
        const fit = findSparkle(cornerImage, frame);
        if (!fit) return { status: "not-found", ...picture };
        if (!fit.clean) return { status: "not-clean", ...picture, fit: describeFit(fit) };
        removeSparkle(cornerImage, fit, frame);
        context.putImageData(corner, region.left, region.top);

        const lossless = Boolean(webp?.lossless);
        const encoded = await toBlob(canvas, MIME[format], format === "webp" && lossless ? 1 : JPEG_QUALITY);
        if (!encoded || encoded.type !== MIME[format]) {
            throw fail(`This browser cannot save ${format === "jpeg" ? "JPEG" : "WebP"} images. Try Chrome, Edge or Firefox.`, "browser");
        }
        const encodedBytes = new Uint8Array(await encoded.arrayBuffer());
        if (lossless && !inspectWebp(encodedBytes).lossless) {
            throw fail("This browser can only save WebP with lossy compression, which would lower the quality of this lossless image. Try Chrome or Edge, or convert it to PNG first.", "browser");
        }
        // The browser drew the picture upright, so a copied EXIF orientation is reset to match.
        const out = format === "jpeg"
            ? spliceJpeg(bytes, encodedBytes, orientation !== 1)
            : spliceWebp(bytes, encodedBytes, width, height);
        return {
            status: "removed", ...picture, fit: describeFit(fit),
            blob: new Blob([out], { type: MIME[format] }), outName: outputName(file.name, format),
        };
    } finally {
        bitmap.close();
    }
}

/** Find and remove the visible sparkle in one PNG, JPEG or WebP file. */
export async function removeGeminiSparkle(file: File): Promise<SparkleResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const format = sniffFormat(bytes);
    if (!format) throw fail("This file is not a PNG, JPEG or WebP image.", "bad_input");
    if (format === "png") return processPng(file, bytes);
    return processWithBrowserCodec(file, bytes, format);
}

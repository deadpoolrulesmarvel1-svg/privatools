/**
 * One image through the Gemini sparkle remover, entirely in this browser tab.
 * No network request is made: the file is read, checked and written here.
 *
 * PNG is decoded and re-encoded in plain TypeScript (png.ts), so every pixel
 * outside the sparkle and every other chunk of the file come out exactly as
 * they went in. JPEG and WebP are decoded and re-encoded by the browser:
 * JPEG at quality 95, lossless WebP losslessly (only where the browser can
 * write it), lossy WebP at quality 95. Their metadata is copied back in
 * afterwards (containers.ts).
 *
 * An image with no sparkle found is returned untouched and is not re-saved.
 */
import { buildOutputFilename, withErrorKind } from "@/lib/api";
import { exifOrientation, inspectWebp, sniffFormat, spliceJpeg, spliceWebp, type ImageFormat } from "./containers";
import { detectSparkle, removeSparkle, type Detection, type RgbaImage } from "./detect";
import { sparkleRegion } from "./geometry";
import { decodePng, encodePng, PngError, pngSize } from "./png";

/** Pictures larger than Gemini makes (its 4K images stay under 20 megapixels) are refused rather than risk the tab. */
export const MAX_MEGAPIXELS = 50;
export const JPEG_QUALITY = 0.95;

export interface Removed {
    status: "removed";
    blob: Blob;
    outName: string;
    format: ImageFormat;
    width: number;
    height: number;
    detection: Detection;
}

export interface NotFound {
    status: "not-found";
    format: ImageFormat;
    width: number;
    height: number;
}

export type SparkleResult = Removed | NotFound;

const MIME: Record<ImageFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const EXTENSIONS: Record<ImageFormat, string[]> = { png: ["png"], jpeg: ["jpg", "jpeg"], webp: ["webp"] };

/** Keep the file's own extension when it matches its content; otherwise use the format's usual one. */
export function outputName(name: string, format: ImageFormat): string {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    const kept = EXTENSIONS[format].includes(extension) ? name.slice(dot + 1) : EXTENSIONS[format][0];
    return buildOutputFilename(name, "no-sparkle", kept);
}

const refuse = (message: string) => withErrorKind(new Error(message), "bad_input");

function checkSize(width: number, height: number): void {
    if (width * height > MAX_MEGAPIXELS * 1_000_000) {
        throw withErrorKind(new Error(`This image is larger than ${MAX_MEGAPIXELS} megapixels, more than Gemini produces. Use the image as Gemini saved it.`), "too_large");
    }
}

async function processPng(file: File, bytes: Uint8Array): Promise<SparkleResult> {
    let png;
    try {
        const { width, height } = pngSize(bytes);
        checkSize(width, height);
        png = decodePng(bytes);
    } catch (error) {
        throw error instanceof PngError ? refuse(error.message) : error;
    }
    const image: RgbaImage = { width: png.width, height: png.height, data: png.rgba };
    const detection = detectSparkle(image);
    if (!detection) return { status: "not-found", format: "png", width: png.width, height: png.height };
    removeSparkle(image, detection);
    const out = encodePng(png, image.data);
    return {
        status: "removed", format: "png", width: png.width, height: png.height, detection,
        blob: new Blob([out], { type: MIME.png }), outName: outputName(file.name, "png"),
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
        throw refuse(error instanceof Error ? error.message : "This file is damaged.");
    }
    if (webp?.animated) throw refuse("Animated WebP files are not supported. Save a single frame and try again.");
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
        throw withErrorKind(new Error("This browser cannot open JPEG or WebP images for editing. Try a current version of Chrome, Edge, Firefox or Safari."), "browser");
    }
    let bitmap: ImageBitmap;
    try {
        // Colours are read as stored, not converted, because the file's own colour profile is copied back in.
        bitmap = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "from-image" });
    } catch {
        throw refuse(`This ${format === "jpeg" ? "JPEG" : "WebP"} file could not be read. It may be damaged.`);
    }
    try {
        const { width, height } = bitmap;
        checkSize(width, height);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw withErrorKind(new Error("This browser cannot prepare the image. Try another browser."), "browser");
        context.drawImage(bitmap, 0, 0);

        // Only the corner can hold the sparkle; read just that much to decide.
        const region = sparkleRegion(width, height);
        if (!region) return { status: "not-found", format, width, height };
        const corner = context.getImageData(region.left, region.top, region.width, region.height);
        const cornerImage: RgbaImage = { width: corner.width, height: corner.height, data: corner.data };
        const frame = { width, height, left: region.left, top: region.top };
        const detection = detectSparkle(cornerImage, frame);
        if (!detection) return { status: "not-found", format, width, height };
        removeSparkle(cornerImage, detection, frame);
        context.putImageData(corner, region.left, region.top);

        const lossless = Boolean(webp?.lossless);
        const encoded = await toBlob(canvas, MIME[format], format === "webp" && lossless ? 1 : JPEG_QUALITY);
        if (!encoded || encoded.type !== MIME[format]) {
            throw withErrorKind(new Error(`This browser cannot save ${format === "jpeg" ? "JPEG" : "WebP"} images. Try Chrome, Edge or Firefox.`), "browser");
        }
        const encodedBytes = new Uint8Array(await encoded.arrayBuffer());
        if (lossless && !inspectWebp(encodedBytes).lossless) {
            throw withErrorKind(new Error("This browser can only save WebP with lossy compression, which would lower the quality of this lossless image. Try Chrome or Edge, or convert it to PNG first."), "browser");
        }
        // The browser drew the picture upright, so a copied EXIF orientation is reset to match.
        const out = format === "jpeg"
            ? spliceJpeg(bytes, encodedBytes, orientation !== 1)
            : spliceWebp(bytes, encodedBytes, width, height);
        return {
            status: "removed", format, width, height, detection,
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
    if (!format) throw refuse("This file is not a PNG, JPEG or WebP image.");
    if (format === "png") return processPng(file, bytes);
    return processWithBrowserCodec(file, bytes, format);
}

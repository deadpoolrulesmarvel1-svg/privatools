/**
 * The whole PNG path, from file bytes to cleaned file bytes: decode, find,
 * remove, encode. It touches no DOM, so it runs in png.worker.ts and keeps a
 * large picture from freezing the page; process.ts runs the same function on
 * the page where a worker cannot start.
 *
 * Its result and errors cross the worker boundary, so they are plain data.
 */
import { findSparkle, removeSparkle, type Fit, type Geometry } from "./detect";
import type { Family } from "./geometry";
import { decodePng, encodePng, PngError, pngSize } from "./png";

/** Pictures larger than Gemini makes (its 4K images stay under 20 megapixels) are refused rather than risk the tab. */
export const MAX_MEGAPIXELS = 50;

/** What was found, in plain numbers. */
export interface SparkleFit extends Geometry {
    family: Family;
    /** Where the layout usually puts its logo; a fit can differ from it by a pixel or two. */
    layout: Geometry;
    /** The box holding the logo, in the picture's pixels. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** The fitted opacity, as a multiple of the calibrated capture's. */
    gain: number;
}

export function describeFit(fit: Fit): SparkleFit {
    return {
        family: fit.family, size: fit.size, marginRight: fit.marginRight, marginBottom: fit.marginBottom, layout: fit.layout,
        x: fit.x, y: fit.y, width: fit.map.width, height: fit.map.height, gain: fit.gain,
    };
}

export type PngJobResult =
    | { status: "removed"; width: number; height: number; fit: SparkleFit; bytes: Uint8Array<ArrayBuffer> }
    | { status: "not-clean"; width: number; height: number; fit: SparkleFit }
    | { status: "not-found"; width: number; height: number };

/** A refusal the person can act on, with its category for the usage signal. */
export class PngJobError extends Error {
    constructor(message: string, readonly kind: "bad_input" | "too_large") {
        super(message);
        this.name = "PngJobError";
    }
}

export function tooLarge(width: number, height: number): string | null {
    return width * height > MAX_MEGAPIXELS * 1_000_000
        ? `This image is larger than ${MAX_MEGAPIXELS} megapixels, more than Gemini produces. Use the image as Gemini saved it.`
        : null;
}

export function processPngBytes(bytes: Uint8Array): PngJobResult {
    let png;
    try {
        const { width, height } = pngSize(bytes);
        const refusal = tooLarge(width, height);
        if (refusal) throw new PngJobError(refusal, "too_large");
        png = decodePng(bytes);
    } catch (error) {
        throw error instanceof PngError ? new PngJobError(error.message, "bad_input") : error;
    }
    const { width, height } = png;
    const image = { width, height, data: png.rgba };
    const fit = findSparkle(image);
    if (!fit) return { status: "not-found", width, height };
    if (!fit.clean) return { status: "not-clean", width, height, fit: describeFit(fit) };
    removeSparkle(image, fit);
    return { status: "removed", width, height, fit: describeFit(fit), bytes: encodePng(png, image.data) };
}

/** What the worker sends back. */
export type PngJobReply =
    | { ok: true; result: PngJobResult }
    | { ok: false; message: string; kind: "bad_input" | "too_large" | "browser" };

export function failureReply(error: unknown): PngJobReply {
    if (error instanceof PngJobError) return { ok: false, message: error.message, kind: error.kind };
    return { ok: false, message: "This image could not be processed in this browser.", kind: "browser" };
}

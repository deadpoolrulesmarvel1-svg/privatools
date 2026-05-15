/**
 * Thin wrappers around ImageToPdfUI that constrain the accept filter and
 * relabel the dropzone for the named SEO entries (JPG / PNG / HEIC → PDF).
 * All three POST to the same /image-to-pdf backend endpoint.
 */
import { ImageToPdfUI } from "./ImageToPdfUI";

export function JpgToPdfUI() {
    return (
        <ImageToPdfUI
            accept=".jpg,.jpeg,image/jpeg"
            formatsLabel="JPG / JPEG photos — multiple allowed"
            nounLabel="JPG"
        />
    );
}

export function PngToPdfUI() {
    return (
        <ImageToPdfUI
            accept=".png,image/png"
            formatsLabel="PNG images — transparency preserved, multiple allowed"
            nounLabel="PNG"
        />
    );
}

export function HeicToPdfUI() {
    return (
        <ImageToPdfUI
            accept=".heic,.heif,image/heic,image/heif"
            formatsLabel="HEIC / HEIF iPhone photos — multiple allowed"
            nounLabel="HEIC photo"
        />
    );
}

export function WebpToPdfUI() {
    return (
        <ImageToPdfUI
            accept=".webp,image/webp"
            formatsLabel="WebP images — multiple allowed"
            nounLabel="WebP"
        />
    );
}

export function TiffToPdfUI() {
    return (
        <ImageToPdfUI
            accept=".tiff,.tif,image/tiff"
            formatsLabel="TIFF / TIF scans (multi-page TIFFs are unpacked) — multiple allowed"
            nounLabel="TIFF"
        />
    );
}

export function BmpToPdfUI() {
    return (
        <ImageToPdfUI
            accept=".bmp,image/bmp"
            formatsLabel="BMP / Windows bitmap images — multiple allowed"
            nounLabel="BMP"
        />
    );
}

export function GifToPdfUI() {
    return (
        <ImageToPdfUI
            accept=".gif,image/gif"
            formatsLabel="GIF images (first frame for animated GIFs) — multiple allowed"
            nounLabel="GIF"
        />
    );
}

export function SvgToPdfUI() {
    return (
        <ImageToPdfUI
            accept=".svg,image/svg+xml"
            formatsLabel="SVG vector files — each becomes one PDF page, multiple allowed"
            nounLabel="SVG"
        />
    );
}

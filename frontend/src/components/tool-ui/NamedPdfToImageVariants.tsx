/**
 * Thin wrappers around GenericUI for PDF → {TIFF, BMP, GIF} that all post to
 * /pdf-to-image with a fixed `format` param. PDF-to-SVG has its own dedicated
 * endpoint so it's a separate component.
 */
import { GenericUI } from "./GenericUI";

export function PdfToTiffUI() {
    return (
        <GenericUI
            slug="pdf-to-tiff"
            toolName="Convert PDF to TIFF"
            outputLabel="pages.tif"
            accepts=".pdf"
            params={{ format: "tiff", dpi: 200 }}
        />
    );
}

export function PdfToBmpUI() {
    return (
        <GenericUI
            slug="pdf-to-bmp"
            toolName="Convert PDF to BMP"
            outputLabel="pages.zip"
            accepts=".pdf"
            params={{ format: "bmp", dpi: 150 }}
        />
    );
}

export function PdfToGifUI() {
    return (
        <GenericUI
            slug="pdf-to-gif"
            toolName="Convert PDF to GIF"
            outputLabel="pages.zip"
            accepts=".pdf"
            params={{ format: "gif", dpi: 150 }}
        />
    );
}

export function PdfToSvgUI() {
    return (
        <GenericUI
            slug="pdf-to-svg"
            toolName="Convert PDF to SVG (vector)"
            outputLabel="pages.zip"
            accepts=".pdf"
        />
    );
}

export function PdfToJpgUI() {
    return (
        <GenericUI
            slug="pdf-to-jpg"
            toolName="Convert PDF to JPG"
            outputLabel="pages.zip"
            accepts=".pdf"
            params={{ format: "jpeg", dpi: 150 }}
        />
    );
}

export function PdfToPngUI() {
    return (
        <GenericUI
            slug="pdf-to-png"
            toolName="Convert PDF to PNG"
            outputLabel="pages.zip"
            accepts=".pdf"
            params={{ format: "png", dpi: 150 }}
        />
    );
}

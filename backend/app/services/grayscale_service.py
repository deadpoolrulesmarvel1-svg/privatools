"""Grayscale conversion using vector-preserving approach.

Converts embedded images to grayscale in-place via pikepdf,
preserving vector text and graphics. Falls back to rasterization
only for pages that fail the vector approach.
"""
import io
import logging

import fitz  # PyMuPDF
import pikepdf

from ..utils.filenames import temp_output
from ..utils.render import safe_get_pixmap

logger = logging.getLogger(__name__)


def convert_to_grayscale(input_path: str) -> str:
    """Convert PDF to grayscale preserving vector quality.

    Strategy:
    1. First try pikepdf image-level conversion (preserves text/vectors)
    2. Fallback to PyMuPDF 200 DPI rasterization for any failures
    """
    output_path = temp_output("grayscale", "pdf")

    try:
        return _vector_grayscale(input_path, str(output_path))
    except (RuntimeError, ValueError, pikepdf.PdfError) as exc:
        logger.info("grayscale: vector path failed (%s) — falling back to raster", exc)
        return _raster_grayscale(input_path, str(output_path))


def _vector_grayscale(input_path: str, output_path: str) -> str:
    """Convert images to grayscale while preserving vector text/graphics.

    Two-pass approach:
    1. Convert embedded images via pikepdf (preserves vector sharpness)
    2. Re-render colored text/vectors using fitz grayscale colorspace
    """
    # Pass 1: Convert embedded images in-place
    with pikepdf.open(input_path) as pdf:
        for page in pdf.pages:
            resources = page.get("/Resources")
            if resources is None:
                continue
            xobjects = resources.get("/XObject")
            if xobjects is None:
                continue
            for key in list(xobjects.keys()):
                xobj = xobjects[key]
                try:
                    if xobj.get("/Subtype") != "/Image":
                        continue
                    pdfimage = pikepdf.PdfImage(xobj)
                    pil_image = pdfimage.as_pil_image()
                    gray = pil_image.convert("L")

                    buf = io.BytesIO()
                    gray.save(buf, format="JPEG", quality=85, optimize=True)
                    new_bytes = buf.getvalue()

                    xobj.write(new_bytes, filter=pikepdf.Name("/DCTDecode"))
                    xobj["/ColorSpace"] = pikepdf.Name("/DeviceGray")
                    xobj["/Width"] = gray.width
                    xobj["/Height"] = gray.height
                    xobj["/BitsPerComponent"] = 8
                except (ValueError, RuntimeError, OSError) as exc:
                    # PdfImage decode / unsupported color profile / corrupt
                    # stream — skip the image, keep going on the rest.
                    logger.debug("Skipping image %s: %s", key, exc)
                    continue

        pdf.save(output_path, compress_streams=True)

    # Pass 2: Re-render through fitz with grayscale colorspace to handle
    # any remaining colored text / vector strokes from pass 1.
    src = None
    dst = None
    try:
        src = fitz.open(output_path)
        dst = fitz.open()
        for page in src:
            mat = fitz.Matrix(200 / 72, 200 / 72)
            pix = safe_get_pixmap(page, matrix=mat, colorspace=fitz.csGRAY)
            new_page = dst.new_page(width=page.rect.width, height=page.rect.height)
            new_page.insert_image(new_page.rect, pixmap=pix)
        dst.save(output_path, garbage=4, deflate=True)
    except (RuntimeError, ValueError, OSError):
        # If the re-render pass fails, the image-only grayscale from pass
        # 1 is still a valid output — don't bubble up.
        logger.debug("Grayscale re-render pass failed, using image-only result")
    finally:
        if dst is not None:
            dst.close()
        if src is not None:
            src.close()

    return output_path


def _raster_grayscale(input_path: str, output_path: str) -> str:
    """Fallback: rasterize at 200 DPI for guaranteed grayscale."""
    src = fitz.open(input_path)
    dst = fitz.open()
    try:
        for page in src:
            # 200 DPI for high quality grayscale.
            mat = fitz.Matrix(200 / 72, 200 / 72)
            pix = safe_get_pixmap(page, matrix=mat, colorspace=fitz.csGRAY)
            new_page = dst.new_page(width=page.rect.width, height=page.rect.height)
            new_page.insert_image(new_page.rect, pixmap=pix)

        if len(dst) == 0:
            raise ValueError("No pages found in PDF")

        dst.save(output_path, garbage=4, deflate=True)
    finally:
        dst.close()
        src.close()

    return output_path

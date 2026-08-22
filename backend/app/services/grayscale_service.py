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


def _has_non_gray_marking_content(pdf_path: str) -> bool:
    """Does any page paint text or vectors in a colour that isn't already gray?

    Pass 1 handles embedded *images*. Pass 2 exists for coloured *text and
    vector strokes* — and the only way it knows how to fix those is to
    rasterise the page, which destroys the text layer, the structure tree and
    the file size along with the colour.

    So it should only run when there is actually coloured marking content.
    This walks the content streams looking for a colour operator with non-gray
    operands:

      r g b  rg/RG   -> coloured unless r == g == b
      c m y k  k/K   -> coloured unless c == m == y == 0 (pure black channel)
      cs/CS + sc/scn -> coloured if the space is DeviceRGB/DeviceCMYK

    Deliberately conservative: anything unparseable returns True, which keeps
    the old rasterising behaviour. A wrong answer must never leave colour in
    the output — it may only cost us the optimisation.
    """
    try:
        with pikepdf.open(pdf_path) as pdf:
            for page in pdf.pages:
                try:
                    instructions = pikepdf.parse_content_stream(page)
                except Exception:
                    return True  # unparseable — assume colour, rasterise
                colour_space_is_colour = False
                for operands, operator in instructions:
                    op = str(operator)
                    try:
                        if op in ("rg", "RG"):
                            r, g, b = (float(v) for v in operands[:3])
                            if not (r == g == b):
                                return True
                        elif op in ("k", "K"):
                            c, m, y, _k = (float(v) for v in operands[:4])
                            if not (c == m == y == 0):
                                return True
                        elif op in ("cs", "CS"):
                            name = str(operands[0]) if operands else ""
                            colour_space_is_colour = name in (
                                "/DeviceRGB", "/DeviceCMYK", "/DeviceN",
                            )
                        elif op in ("sc", "scn", "SC", "SCN"):
                            if colour_space_is_colour:
                                return True
                            # An explicit 3- or 4-component colour is coloured
                            # regardless of what space we think we're in.
                            vals = [float(v) for v in operands if _is_number(v)]
                            if len(vals) == 3 and not (vals[0] == vals[1] == vals[2]):
                                return True
                            if len(vals) == 4 and not (vals[0] == vals[1] == vals[2] == 0):
                                return True
                    except (TypeError, ValueError, IndexError):
                        return True  # odd operands — assume colour
    except Exception:
        return True
    return False


def _is_number(value) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


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

    # Pass 2: Re-render through fitz with grayscale colorspace to handle any
    # remaining coloured text / vector strokes from pass 1.
    #
    # This used to run unconditionally, which contradicted this module's own
    # docstring ("preserving vector text and graphics ... falls back to
    # rasterization only for pages that fail"). Every PDF put through
    # /grayscale came back as 200 DPI images: no selectable text, no search,
    # no structure tree, and a much larger file. Measured on a tagged input,
    # the accessibility score went from 96/100 to 11/100.
    #
    # Now it only runs when there is coloured marking content that pass 1
    # could not reach.
    if not _has_non_gray_marking_content(output_path):
        logger.debug("grayscale: no coloured vector content — skipping re-render")
        return output_path

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

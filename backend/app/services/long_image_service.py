"""Stitch every page of a PDF into one tall image (PNG/JPEG).

Distinct from pdf-to-image (which yields one image per page / a zip): this
renders all pages and vertically concatenates them into a single shareable
image — handy for posting a whole short doc as one picture.
"""
from __future__ import annotations

import fitz  # PyMuPDF
from PIL import Image

from ..utils.exceptions import ProcessingError
from ..utils.filenames import temp_output

# Bound output height / memory so a huge PDF can't produce a multi-GB canvas.
_MAX_PAGES = 200
_GAP_PX = 12  # subtle separator between pages
_FORMATS = {"png": ("PNG", "png"), "jpg": ("JPEG", "jpg"), "jpeg": ("JPEG", "jpg")}


def pdf_to_long_image(input_path: str, fmt: str = "png", dpi: int = 100) -> str:
    """Render every page and stack them vertically into one image.

    Returns the temp-file path of the stitched image.
    """
    fmt = (fmt or "png").lower().strip()
    if fmt not in _FORMATS:
        raise ProcessingError("format must be one of: png, jpg")
    pil_fmt, ext = _FORMATS[fmt]
    dpi = max(36, min(200, int(dpi)))

    doc = fitz.open(input_path)
    try:
        n = doc.page_count
        if n == 0:
            raise ProcessingError("PDF has no pages")
        if n > _MAX_PAGES:
            raise ProcessingError(f"PDF has too many pages to stitch (max {_MAX_PAGES})")

        tiles: list[Image.Image] = []
        max_w = 0
        total_h = 0
        try:
            for i in range(n):
                pix = doc[i].get_pixmap(dpi=dpi)
                img = Image.frombytes(
                    "RGBA" if pix.alpha else "RGB", [pix.width, pix.height], pix.samples
                )
                if img.mode != "RGB":
                    rgb = img.convert("RGB")
                    img.close()
                    img = rgb
                tiles.append(img)
                max_w = max(max_w, img.width)
                total_h += img.height

            canvas_h = total_h + _GAP_PX * (n - 1)
            canvas = Image.new("RGB", (max_w, canvas_h), "white")
            y = 0
            for idx, img in enumerate(tiles):
                x = (max_w - img.width) // 2  # centre narrower pages
                canvas.paste(img, (x, y))
                y += img.height + _GAP_PX
        finally:
            for img in tiles:
                img.close()

        output_path = temp_output("long_image", ext)
        save_kwargs: dict = {"optimize": True}
        if pil_fmt == "JPEG":
            save_kwargs["quality"] = 90
        canvas.save(str(output_path), pil_fmt, **save_kwargs)
        canvas.close()
        return str(output_path)
    finally:
        doc.close()

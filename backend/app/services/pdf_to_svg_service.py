"""PDF → SVG (true vector) using PyMuPDF's built-in SVG export.

For multi-page PDFs we emit one SVG per page and bundle them in a zip.
For single-page PDFs we return the SVG file directly.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import fitz  # PyMuPDF

from ..utils.cleanup import open_pdf_document
from ..utils.filenames import temp_output


def pdf_to_svg(input_path: str) -> str:
    # A PDF that needs a password, cannot be read or has no pages is refused
    # with a 400 in the site's own words.
    doc = open_pdf_document(input_path)
    try:
        svg_paths: list[str] = []
        for i, page in enumerate(doc):
            svg_text = page.get_svg_image(matrix=fitz.Identity)
            out_path = temp_output(f"page_{i + 1}", "svg")
            out_path.write_text(svg_text, encoding="utf-8")
            svg_paths.append(str(out_path))
    finally:
        doc.close()

    if len(svg_paths) == 1:
        return svg_paths[0]

    zip_path = temp_output("pdf_to_svg", "zip")
    with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
        for f in svg_paths:
            zf.write(f, Path(f).name)
    # Clean up individual SVGs after zipping
    for f in svg_paths:
        try:
            Path(f).unlink(missing_ok=True)
        except OSError:
            pass
    return str(zip_path)

"""Convert PDF → HTML using PyMuPDF's html exporter.

PyMuPDF's `page.get_text("html")` returns a per-page HTML fragment with
inline styles preserving fonts and positioning. We stitch the fragments
together inside a minimal wrapper.
"""

from __future__ import annotations

import html as _html

from ..utils.cleanup import open_pdf_document
from ..utils.filenames import temp_output


def pdf_to_html(input_path: str) -> str:
    output_path = temp_output("pdf_html", "html")

    doc = open_pdf_document(input_path)
    try:
        title = (doc.metadata or {}).get("title") or "PDF"
        title_safe = _html.escape(str(title))
        parts = [
            "<!DOCTYPE html>",
            "<html><head><meta charset='utf-8'>",
            f"<title>{title_safe}</title>",
            "<style>"
            "body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;}"
            ".pdf-page{border-bottom:1px dashed #ccc;padding:1rem 0;}"
            ".pdf-page:last-child{border-bottom:none;}"
            "</style>",
            "</head><body>",
        ]
        for i, page in enumerate(doc, start=1):
            parts.append(f"<section class='pdf-page' aria-label='Page {i}'>")
            parts.append(page.get_text("html"))
            parts.append("</section>")
        parts.append("</body></html>")
        output_path.write_text("".join(parts), encoding="utf-8")
    finally:
        doc.close()

    return str(output_path)

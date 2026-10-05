from pypdf import PdfReader

from ..utils.cleanup import end_is_missing, refuse_if_misread
from ..utils.declared_pages import pypdf_reading


def extract_text(input_path: str) -> dict:
    reader = PdfReader(input_path)
    # pypdf rebuilds a damaged cross-reference table from the bytes. Cut short,
    # it may find fewer pages than the file had; with a common defect in a
    # valid file, it may take the objects of a PDF attached inside it for the
    # file's own, and give that PDF's text (utils.cleanup.refuse_if_misread).
    # It says neither, so its reading is always compared, and lost pages count
    # only when the file's end is missing.
    refuse_if_misread(input_path, lambda declared: pypdf_reading(reader, declared),
                      lost=end_is_missing(input_path))
    pages = []
    full_text_parts = []

    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        pages.append({"page": i + 1, "text": text})
        full_text_parts.append(text)

    full_text = "\n\n".join(full_text_parts)
    result: dict = {
        "text": full_text,
        "pages": pages,
        "characters": len(full_text),
    }
    # Flag image-only PDFs so the UI can suggest OCR. Treat <5 characters as
    # effectively empty — accounts for whitespace-only / single-glyph noise.
    if len(full_text.strip()) < 5:
        result["warning"] = (
            "This PDF has no text layer — run OCR PDF first to make it searchable"
        )
    return result

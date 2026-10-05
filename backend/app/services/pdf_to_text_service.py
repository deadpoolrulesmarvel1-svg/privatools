from pypdf import PdfReader

from ..utils.cleanup import end_is_missing, refuse_if_pages_lost


def extract_text(input_path: str) -> dict:
    reader = PdfReader(input_path)
    if end_is_missing(input_path):
        # Cut short: pypdf rebuilds what it can, and may find fewer pages
        # than the file had (utils.cleanup.refuse_if_pages_lost).
        refuse_if_pages_lost(input_path, lambda declared: len(reader.pages))
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

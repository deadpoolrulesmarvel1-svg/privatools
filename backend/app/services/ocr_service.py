import io
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor

import fitz  # PyMuPDF
import pikepdf
import pytesseract
from PIL import Image

from ..utils.cleanup import ensure_temp_dir
from ..utils.exceptions import ValidationError
from ..utils.filenames import temp_output
from ..utils.render import check_render_page_count, safe_get_pixmap

logger = logging.getLogger(__name__)

_MAX_WORKERS = min(os.cpu_count() or 2, 4)

# Tesseract language packs available in the slim image. Add packs to the
# Dockerfile (e.g. tesseract-ocr-fra) to extend this list.
SUPPORTED_LANGS: set[str] = {
    "eng",  # English
    # Multi-language combos like "eng+fra" must be allowed if individual packs
    # are present — we validate against this set on the route layer.
}

VALID_DPI_MIN = 100
VALID_DPI_MAX = 400

# Hard wall-clock per tesseract invocation. Tesseract can wedge on weird
# inputs (scanned-on-a-roll PDFs, mostly-noise images) — a 90s cap means a
# stuck worker won't sit on a process slot forever. pytesseract translates
# this to its own RuntimeError which the global handler maps to a clean 500.
_TESS_TIMEOUT_SECS = 90

# Tesseract supports language codes that look like ISO-639 (alnum + underscore).
# Anything else is a forgery attempt or a typo — reject before pytesseract
# shells out to tesseract and a stray "rm -rf" lands in the argv.
_LANG_RE = re.compile(r"^[A-Za-z0-9_]{2,12}(?:\+[A-Za-z0-9_]{2,12})*$")


def _validate_lang(lang: str) -> str:
    """Validate `lang` (single code or `eng+fra` combo) before shelling out.

    Returns the normalised string. Raises :class:`ValidationError` on bad
    syntax. Whether the pack is installed is checked at the route layer
    via `pytesseract.get_languages()` — re-checking here would add a
    subprocess per request.
    """
    if not lang or not _LANG_RE.match(lang.strip()):
        raise ValidationError(
            f"Invalid OCR language code '{lang}'. Use ISO codes like 'eng' or 'eng+fra'."
        )
    return lang.strip()


def _render_page_to_image(page: fitz.Page, dpi: int = 200) -> Image.Image:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = safe_get_pixmap(page, matrix=mat)
    mode = "RGBA" if pix.alpha else "RGB"
    img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
    return img.convert("RGB") if mode == "RGBA" else img


def _render_and_ocr_text(args: tuple) -> tuple[int, str]:
    """Render page to image then OCR. For use with ThreadPoolExecutor."""
    idx, page_bytes, page_count, lang, dpi = args
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    try:
        img = _render_page_to_image(doc[0], dpi=dpi)
    finally:
        doc.close()
    text = pytesseract.image_to_string(img, lang=lang, timeout=_TESS_TIMEOUT_SECS)
    return (idx, text)


def _render_and_ocr_pdf(args: tuple) -> tuple[int, bytes]:
    """Render page then OCR to PDF bytes. For use with ThreadPoolExecutor."""
    idx, page_bytes, lang, dpi = args
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    try:
        img = _render_page_to_image(doc[0], dpi=dpi)
    finally:
        doc.close()
    ocr_pdf = pytesseract.image_to_pdf_or_hocr(
        img, extension="pdf", lang=lang, timeout=_TESS_TIMEOUT_SECS
    )
    return (idx, ocr_pdf)


def _extract_single_page_pdf(src_path: str, page_idx: int) -> bytes:
    """Extract a single page from a PDF as bytes."""
    doc = fitz.open(src_path)
    try:
        single = fitz.open()
        try:
            single.insert_pdf(doc, from_page=page_idx, to_page=page_idx)
            return single.tobytes()
        finally:
            single.close()
    finally:
        doc.close()


def _clamp_dpi(dpi: int) -> int:
    if dpi < VALID_DPI_MIN:
        return VALID_DPI_MIN
    if dpi > VALID_DPI_MAX:
        return VALID_DPI_MAX
    return dpi


def extract_text(input_path: str, lang: str = "eng", dpi: int = 200) -> str:
    """Extract text from a PDF using OCR (Tesseract).

    Uses parallel processing for multi-page PDFs.
    """
    ensure_temp_dir()
    lang = _validate_lang(lang)
    dpi = _clamp_dpi(dpi)
    logger.info("ocr.extract_text start lang=%s dpi=%d", lang, dpi)

    doc = fitz.open(input_path)
    try:
        page_count = len(doc)
    finally:
        doc.close()
    check_render_page_count(page_count)

    if page_count == 1:
        # Single page — no overhead from parallelism
        doc = fitz.open(input_path)
        try:
            img = _render_page_to_image(doc[0], dpi=dpi)
        finally:
            doc.close()
        text = pytesseract.image_to_string(img, lang=lang, timeout=_TESS_TIMEOUT_SECS)
        logger.info("ocr.extract_text done pages=1 chars=%d", len(text))
        return f"--- Page 1 ---\n{text}"

    # Multi-page — parallel OCR
    page_pdfs = [_extract_single_page_pdf(input_path, i) for i in range(page_count)]
    tasks = [(i, pb, page_count, lang, dpi) for i, pb in enumerate(page_pdfs)]

    results = [None] * page_count
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for idx, text in pool.map(_render_and_ocr_text, tasks):
            results[idx] = f"--- Page {idx + 1} ---\n{text}"

    logger.info("ocr.extract_text done pages=%d", page_count)
    return "\n\n".join(results)


def extract_text_to_file(input_path: str, lang: str = "eng", dpi: int = 200) -> str:
    """Extract text from a PDF and write to a .txt temp file."""
    text = extract_text(input_path, lang=lang, dpi=dpi)
    out_path = temp_output("ocr", "txt")
    out_path.write_text(text, encoding="utf-8")
    return str(out_path)


def extract_searchable_pdf_to_file(
    input_path: str, lang: str = "eng", dpi: int = 200
) -> str:
    """Generate a searchable PDF by OCR'ing each page in parallel."""
    lang = _validate_lang(lang)
    dpi = _clamp_dpi(dpi)
    out_path = temp_output("ocr_searchable", "pdf")
    logger.info("ocr.searchable_pdf start lang=%s dpi=%d", lang, dpi)

    doc = fitz.open(input_path)
    try:
        page_count = len(doc)
    finally:
        doc.close()
    if page_count == 0:
        raise ValidationError("Cannot run OCR on an empty PDF.")
    check_render_page_count(page_count)

    if page_count == 1:
        # Single page — direct processing
        doc = fitz.open(input_path)
        try:
            img = _render_page_to_image(doc[0], dpi=dpi)
        finally:
            doc.close()
        ocr_pdf_bytes = pytesseract.image_to_pdf_or_hocr(
            img, extension="pdf", lang=lang, timeout=_TESS_TIMEOUT_SECS
        )
        with pikepdf.open(io.BytesIO(ocr_pdf_bytes)) as page_pdf:
            page_pdf.save(str(out_path))
        logger.info("ocr.searchable_pdf done pages=1")
        return str(out_path)

    # Multi-page — parallel OCR
    page_pdfs = [_extract_single_page_pdf(input_path, i) for i in range(page_count)]
    tasks = [(i, pb, lang, dpi) for i, pb in enumerate(page_pdfs)]

    ocr_results = [None] * page_count
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for idx, pdf_bytes in pool.map(_render_and_ocr_pdf, tasks):
            ocr_results[idx] = pdf_bytes

    # Merge in order
    with pikepdf.Pdf.new() as merged:
        for pdf_bytes in ocr_results:
            with pikepdf.open(io.BytesIO(pdf_bytes)) as page_pdf:
                merged.pages.append(page_pdf.pages[0])
        merged.save(str(out_path))

    logger.info("ocr.searchable_pdf done pages=%d", page_count)
    return str(out_path)

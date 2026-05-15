import os
import uuid
import io
from concurrent.futures import ThreadPoolExecutor

import fitz  # PyMuPDF
import pikepdf
import pytesseract
from PIL import Image
from ..utils.cleanup import get_temp_path, ensure_temp_dir

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


def _render_page_to_image(page: fitz.Page, dpi: int = 200) -> Image.Image:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    mode = "RGBA" if pix.alpha else "RGB"
    img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
    return img.convert("RGB") if mode == "RGBA" else img


def _ocr_single_page(args: tuple) -> tuple[int, str]:
    """OCR a single page image. Returns (page_index, text)."""
    idx, img_bytes, width, height, lang = args
    img = Image.frombytes("RGB", (width, height), img_bytes)
    text = pytesseract.image_to_string(img, lang=lang)
    return (idx, text)


def _render_and_ocr_text(args: tuple) -> tuple[int, str]:
    """Render page to image then OCR. For use with ThreadPoolExecutor."""
    idx, page_bytes, page_count, lang, dpi = args
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    page = doc[0]
    img = _render_page_to_image(page, dpi=dpi)
    doc.close()
    text = pytesseract.image_to_string(img, lang=lang)
    return (idx, text)


def _render_and_ocr_pdf(args: tuple) -> tuple[int, bytes]:
    """Render page then OCR to PDF bytes. For use with ThreadPoolExecutor."""
    idx, page_bytes, lang, dpi = args
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    page = doc[0]
    img = _render_page_to_image(page, dpi=dpi)
    doc.close()
    ocr_pdf = pytesseract.image_to_pdf_or_hocr(img, extension="pdf", lang=lang)
    return (idx, ocr_pdf)


def _extract_single_page_pdf(src_path: str, page_idx: int) -> bytes:
    """Extract a single page from a PDF as bytes."""
    doc = fitz.open(src_path)
    single = fitz.open()
    single.insert_pdf(doc, from_page=page_idx, to_page=page_idx)
    buf = single.tobytes()
    single.close()
    doc.close()
    return buf


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
    dpi = _clamp_dpi(dpi)

    doc = fitz.open(input_path)
    page_count = len(doc)
    doc.close()

    if page_count == 1:
        # Single page — no overhead from parallelism
        doc = fitz.open(input_path)
        img = _render_page_to_image(doc[0], dpi=dpi)
        doc.close()
        text = pytesseract.image_to_string(img, lang=lang)
        return f"--- Page 1 ---\n{text}"

    # Multi-page — parallel OCR
    page_pdfs = [_extract_single_page_pdf(input_path, i) for i in range(page_count)]
    tasks = [(i, pb, page_count, lang, dpi) for i, pb in enumerate(page_pdfs)]

    results = [None] * page_count
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for idx, text in pool.map(_render_and_ocr_text, tasks):
            results[idx] = f"--- Page {idx + 1} ---\n{text}"

    return "\n\n".join(results)


def extract_text_to_file(input_path: str, lang: str = "eng", dpi: int = 200) -> str:
    """Extract text from a PDF and write to a .txt temp file."""
    text = extract_text(input_path, lang=lang, dpi=dpi)
    out_path = get_temp_path(f"ocr_{uuid.uuid4().hex}.txt")
    out_path.write_text(text, encoding="utf-8")
    return str(out_path)


def extract_searchable_pdf_to_file(
    input_path: str, lang: str = "eng", dpi: int = 200
) -> str:
    """Generate a searchable PDF by OCR'ing each page in parallel."""
    ensure_temp_dir()
    dpi = _clamp_dpi(dpi)
    out_path = get_temp_path(f"ocr_searchable_{uuid.uuid4().hex}.pdf")

    doc = fitz.open(input_path)
    page_count = len(doc)
    if page_count == 0:
        doc.close()
        raise ValueError("Cannot run OCR on an empty PDF.")
    doc.close()

    if page_count == 1:
        # Single page — direct processing
        doc = fitz.open(input_path)
        img = _render_page_to_image(doc[0], dpi=dpi)
        doc.close()
        ocr_pdf_bytes = pytesseract.image_to_pdf_or_hocr(img, extension="pdf", lang=lang)
        with pikepdf.open(io.BytesIO(ocr_pdf_bytes)) as page_pdf:
            page_pdf.save(str(out_path))
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

    return str(out_path)

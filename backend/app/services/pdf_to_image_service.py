import os
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
import fitz  # PyMuPDF
from PIL import Image
from pathlib import Path
from ..utils.cleanup import get_temp_path, ensure_temp_dir

_MAX_WORKERS = min(os.cpu_count() or 2, 4)


def _render_and_save(args: tuple) -> str:
    """Render a single page and save as image. Returns the saved path."""
    page_bytes, dpi, pil_format, ext, idx = args
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    doc.close()
    img_path = get_temp_path(f"page_{idx + 1}_{uuid.uuid4().hex}.{ext}")
    img.save(str(img_path), pil_format)
    return str(img_path)


_MULTIPAGE_FORMATS = {"tiff", "tif"}  # formats that bundle all pages in one file


def pdf_to_images(input_path: str, fmt: str = "jpeg", dpi: int = 150) -> str:
    """Convert PDF pages to images using PyMuPDF with parallel rendering.

    Same DPI and quality as before, faster for multi-page PDFs.
    For multi-page formats (TIFF), all pages are bundled into a single file.
    """
    ensure_temp_dir()
    doc = fitz.open(input_path)

    fmt_lower = fmt.lower()
    pil_format = "JPEG" if fmt_lower in ("jpeg", "jpg") else fmt_lower.upper()
    ext = "jpg" if fmt_lower in ("jpeg", "jpg") else ("tif" if fmt_lower in _MULTIPAGE_FORMATS else fmt_lower)

    # ── Multi-page TIFF: render every page, save all into one TIFF ────────
    if fmt_lower in _MULTIPAGE_FORMATS:
        pages_pil: list[Image.Image] = []
        for page in doc:
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            pages_pil.append(Image.frombytes("RGB", [pix.width, pix.height], pix.samples))
        doc.close()
        out_path = get_temp_path(f"pdf_to_tiff_{uuid.uuid4().hex}.tif")
        first, *rest = pages_pil
        first.save(
            str(out_path), format="TIFF",
            save_all=True, append_images=rest,
            compression="tiff_deflate",
        )
        return str(out_path)

    if len(doc) == 1:
        # Single page — direct (no parallel overhead)
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = doc[0].get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img_path = get_temp_path(f"page_1_{uuid.uuid4().hex}.{ext}")
        img.save(str(img_path), pil_format)
        doc.close()
        return str(img_path)

    page_count = len(doc)

    if page_count <= 3:
        # Few pages — sequential is fine
        image_paths = []
        for i, page in enumerate(doc):
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            img_path = get_temp_path(f"page_{i + 1}_{uuid.uuid4().hex}.{ext}")
            img.save(str(img_path), pil_format)
            image_paths.append(str(img_path))
        doc.close()
    else:
        # Multi-page — parallel render + save
        page_pdfs = []
        for i in range(page_count):
            single = fitz.open()
            single.insert_pdf(doc, from_page=i, to_page=i)
            page_pdfs.append(single.tobytes())
            single.close()
        doc.close()

        tasks = [(pb, dpi, pil_format, ext, i) for i, pb in enumerate(page_pdfs)]

        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            image_paths = list(pool.map(_render_and_save, tasks))

    zip_path = get_temp_path(f"images_{uuid.uuid4().hex}.zip")
    with zipfile.ZipFile(str(zip_path), "w") as zf:
        for f in image_paths:
            zf.write(f, Path(f).name)
    return str(zip_path)

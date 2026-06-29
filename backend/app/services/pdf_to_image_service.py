"""PDF page → image rasterisation.

Already the highest-throughput tool in the suite. Pages are rendered in
parallel via a thread pool — PyMuPDF + Pillow both release the GIL on
the heavy work, so we genuinely get a speedup. Worker cap is
`min(cpu_count() - 1, 4)`, matching the project-wide convention.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List

import fitz  # PyMuPDF
from PIL import Image

from ..utils.cleanup import ensure_temp_dir, get_temp_path
from ..utils.render import safe_get_pixmap

logger = logging.getLogger(__name__)

# Cap workers at cpu_count()-1 (matches other services), and at 4 max
# so we don't thrash on 16-core boxes when single-page renders are fast.
_MAX_WORKERS = min(max(1, (os.cpu_count() or 2) - 1), 4)


def _render_and_save(args: tuple) -> str:
    """Render a single page and save as image. Returns the saved path."""
    page_bytes, dpi, pil_format, ext, idx = args
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    try:
        page = doc[0]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = safe_get_pixmap(page, matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    finally:
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
    started = time.monotonic()
    try:
        input_size = os.path.getsize(input_path)
    except OSError:
        input_size = 0

    doc = fitz.open(input_path)

    fmt_lower = fmt.lower()
    pil_format = "JPEG" if fmt_lower in ("jpeg", "jpg") else fmt_lower.upper()
    ext = "jpg" if fmt_lower in ("jpeg", "jpg") else ("tif" if fmt_lower in _MULTIPAGE_FORMATS else fmt_lower)

    page_count = len(doc)
    logger.info(
        "pdf_to_image: start pages=%d fmt=%s dpi=%d input_bytes=%d",
        page_count, fmt_lower, dpi, input_size,
    )

    image_paths: List[str] = []
    try:
        # ── Multi-page TIFF: render every page, save all into one TIFF ────
        if fmt_lower in _MULTIPAGE_FORMATS:
            pages_pil: list[Image.Image] = []
            for page in doc:
                mat = fitz.Matrix(dpi / 72, dpi / 72)
                pix = safe_get_pixmap(page, matrix=mat)
                pages_pil.append(
                    Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                )
            out_path = get_temp_path(f"pdf_to_tiff_{uuid.uuid4().hex}.tif")
            first, *rest = pages_pil
            first.save(
                str(out_path), format="TIFF",
                save_all=True, append_images=rest,
                compression="tiff_deflate",
            )
            duration_ms = int((time.monotonic() - started) * 1000)
            try:
                out_size = os.path.getsize(out_path)
            except OSError:
                out_size = 0
            logger.info(
                "pdf_to_image: done fmt=tiff pages=%d duration_ms=%d output_bytes=%d",
                page_count, duration_ms, out_size,
            )
            return str(out_path)

        if page_count == 1:
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = safe_get_pixmap(doc[0], matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            img_path = get_temp_path(f"page_1_{uuid.uuid4().hex}.{ext}")
            img.save(str(img_path), pil_format)
            duration_ms = int((time.monotonic() - started) * 1000)
            try:
                out_size = os.path.getsize(img_path)
            except OSError:
                out_size = 0
            logger.info(
                "pdf_to_image: done fmt=%s pages=1 duration_ms=%d output_bytes=%d",
                fmt_lower, duration_ms, out_size,
            )
            return str(img_path)

        if page_count <= 3:
            for i, page in enumerate(doc):
                mat = fitz.Matrix(dpi / 72, dpi / 72)
                pix = safe_get_pixmap(page, matrix=mat)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                img_path = get_temp_path(f"page_{i + 1}_{uuid.uuid4().hex}.{ext}")
                img.save(str(img_path), pil_format)
                image_paths.append(str(img_path))
        else:
            # Multi-page — parallel render + save.
            page_pdfs = []
            for i in range(page_count):
                single = fitz.open()
                single.insert_pdf(doc, from_page=i, to_page=i)
                page_pdfs.append(single.tobytes())
                single.close()

            tasks = [(pb, dpi, pil_format, ext, i) for i, pb in enumerate(page_pdfs)]

            with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
                image_paths = list(pool.map(_render_and_save, tasks))
    except Exception:
        # Sweep any partial images we already wrote before re-raising.
        for f in image_paths:
            try:
                Path(f).unlink(missing_ok=True)
            except OSError:
                pass
        raise
    finally:
        doc.close()

    zip_path = get_temp_path(f"images_{uuid.uuid4().hex}.zip")
    try:
        with zipfile.ZipFile(str(zip_path), "w") as zf:
            for f in image_paths:
                zf.write(f, Path(f).name)
        # Once they're in the zip, the loose files aren't needed.
        for f in image_paths:
            try:
                Path(f).unlink(missing_ok=True)
            except OSError:
                pass
    except Exception:
        try:
            Path(zip_path).unlink(missing_ok=True)
        except OSError:
            pass
        for f in image_paths:
            try:
                Path(f).unlink(missing_ok=True)
            except OSError:
                pass
        raise

    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        zip_size = os.path.getsize(zip_path)
    except OSError:
        zip_size = 0
    logger.info(
        "pdf_to_image: done fmt=%s pages=%d duration_ms=%d output_bytes=%d",
        fmt_lower, page_count, duration_ms, zip_size,
    )
    return str(zip_path)

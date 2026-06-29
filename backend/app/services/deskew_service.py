import io
import logging
import math
import os
from concurrent.futures import ThreadPoolExecutor

import fitz  # PyMuPDF
from PIL import Image

from ..utils.exceptions import ProcessingError
from ..utils.filenames import temp_output
from ..utils.render import safe_get_pixmap

logger = logging.getLogger(__name__)

_MAX_WORKERS = min(os.cpu_count() or 2, 4)


def _detect_skew_angle_fast(pix: fitz.Pixmap) -> float:
    """Ultra-fast skew detection using row-sum variance."""
    w, h = pix.width, pix.height
    samples = pix.samples

    # Use every 4th pixel for maximum speed
    step = 4

    def compute_variance(angle: float) -> float:
        rad = math.radians(angle)
        cos_a, sin_a = math.cos(rad), math.sin(rad)
        cx, cy = w / 2, h / 2

        row_sums = []
        for yr in range(0, h, step):
            row_sum = 0
            for xr in range(0, w, step):
                sx = int(cos_a * (xr - cx) + sin_a * (yr - cy) + cx)
                sy = int(-sin_a * (xr - cx) + cos_a * (yr - cy) + cy)
                if 0 <= sx < w and 0 <= sy < h:
                    row_sum += 255 - samples[sy * w + sx]
            row_sums.append(row_sum)

        if not row_sums:
            return 0.0
        mean = sum(row_sums) / len(row_sums)
        return sum((s - mean) ** 2 for s in row_sums) / len(row_sums)

    # Coarse: -5 to +5 in 2° steps (6 checks)
    best_angle = 0.0
    best_var = -1.0
    for a in range(-4, 6, 2):
        v = compute_variance(float(a))
        if v > best_var:
            best_var = v
            best_angle = float(a)

    # Fine: ±2° around best in 0.5° steps (8 checks)
    for a5 in range(int((best_angle - 2) * 2), int((best_angle + 2) * 2) + 1):
        angle = a5 * 0.5
        v = compute_variance(angle)
        if v > best_var:
            best_var = v
            best_angle = angle

    return best_angle


def _detect_and_deskew_page(args: tuple) -> tuple:
    """Detect skew and deskew a single page. Returns (idx, pdf_bytes_or_None, needs_original)."""
    idx, page_bytes = args

    doc = fitz.open(stream=page_bytes, filetype="pdf")
    try:
        page = doc[0]

        # Ultra-low DPI for detection
        detect_pix = safe_get_pixmap(page, matrix=fitz.Matrix(0.4, 0.4), colorspace=fitz.csGRAY)
        angle = _detect_skew_angle_fast(detect_pix)

        if abs(angle) <= 0.3:
            return (idx, None, True)  # Keep original page

        # Render at 100 DPI and rotate
        pix = safe_get_pixmap(page, matrix=fitz.Matrix(100 / 72, 100 / 72))
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        rotated = img.rotate(-angle, expand=True, fillcolor=(255, 255, 255),
                             resample=Image.Resampling.BICUBIC)

        img_buf = io.BytesIO()
        rotated.save(img_buf, format="PNG")
        png_bytes = img_buf.getvalue()

        w, h = page.rect.width, page.rect.height
    finally:
        doc.close()

    return (idx, (w, h, png_bytes), False)


def deskew(input_path: str) -> str:
    """Deskew PDF pages using parallel skew detection."""
    output_path = temp_output("deskewed", "pdf")

    src = fitz.open(input_path)
    try:
        page_count = len(src)
        logger.info("deskew: start pages=%d", page_count)

        if page_count <= 2:
            # Few pages — direct sequential
            dst = fitz.open()
            try:
                for page in src:
                    detect_pix = safe_get_pixmap(page, matrix=fitz.Matrix(0.4, 0.4), colorspace=fitz.csGRAY)
                    angle = _detect_skew_angle_fast(detect_pix)

                    if abs(angle) > 0.3:
                        pix = safe_get_pixmap(page, matrix=fitz.Matrix(200 / 72, 200 / 72))
                        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                        rotated = img.rotate(-angle, expand=True, fillcolor=(255, 255, 255),
                                             resample=Image.Resampling.BICUBIC)
                        img_buf = io.BytesIO()
                        rotated.save(img_buf, format="PNG")
                        new_page = dst.new_page(width=page.rect.width, height=page.rect.height)
                        new_page.insert_image(new_page.rect, stream=img_buf.getvalue())
                    else:
                        dst.insert_pdf(src, from_page=page.number, to_page=page.number)

                if len(dst) == 0:
                    raise ProcessingError("No pages found in PDF")
                dst.save(str(output_path), garbage=4, deflate=True)
            finally:
                dst.close()
            return str(output_path)

        # Multi-page — parallel processing
        page_pdfs = []
        for i in range(page_count):
            single = fitz.open()
            try:
                single.insert_pdf(src, from_page=i, to_page=i)
                page_pdfs.append(single.tobytes())
            finally:
                single.close()

        tasks = [(i, pb) for i, pb in enumerate(page_pdfs)]

        results: list = [None] * page_count
        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            for idx, data, needs_original in pool.map(_detect_and_deskew_page, tasks):
                results[idx] = (data, needs_original)

        # Assemble — reuse `src` for original-page inserts so we don't open
        # the input twice (was a small leak: src_copy never got closed on
        # an exception thrown during dst.new_page).
        dst = fitz.open()
        try:
            for i, (data, needs_original) in enumerate(results):
                if needs_original:
                    dst.insert_pdf(src, from_page=i, to_page=i)
                else:
                    w, h, png_bytes = data
                    new_page = dst.new_page(width=w, height=h)
                    new_page.insert_image(new_page.rect, stream=png_bytes)

            if len(dst) == 0:
                raise ProcessingError("No pages found in PDF")

            dst.save(str(output_path), garbage=4, deflate=True)
        finally:
            dst.close()
    finally:
        src.close()

    return str(output_path)

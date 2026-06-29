"""Images → single PDF.

Pages appear in the same order they were supplied (the route hands us
`input_paths` in upload order — FastAPI's `List[UploadFile]` preserves
multipart order, and we iterate that list directly without sorting).
Each image is checked against `MAX_IMAGE_PIXELS` (200 MP) before any
decoding, so a "1 GB pixel bomb" upload fails fast.
"""
from __future__ import annotations

import logging
import os
import time
import uuid

from PIL import Image
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.platypus import Image as RLImage
from reportlab.platypus import SimpleDocTemplate

from ..utils.cleanup import ensure_temp_dir, get_temp_path

logger = logging.getLogger(__name__)

# Register HEIC/HEIF support so PIL (and therefore ReportLab) can open .heic/.heif
try:
    from pillow_heif import register_heif_opener  # type: ignore
    register_heif_opener()
except ImportError:  # pragma: no cover — falls back to JPEG/PNG/etc only
    pass

_HEIC_EXTS = {".heic", ".heif"}
_SVG_EXTS = {".svg"}


def _svg_to_png(svg_path: str) -> str:
    """Rasterize an SVG to a high-res PNG temp file via cairosvg."""
    from cairosvg import svg2png  # cairosvg ships with the rembg dep tree

    from .svg_safety import block_external_refs

    out_path = get_temp_path(f"svg_to_png_{uuid.uuid4().hex}.png")
    with open(svg_path, "rb") as f:
        svg_data = f.read()
    # Pass bytestring= (NOT url=) so relative refs can't resolve against the
    # server filesystem, and block_external_refs denies absolute file:// (LFI)
    # and http(s):// (SSRF) references — only inline data: URIs are allowed.
    # Render at 2x for crisp output even after PDF embed scaling.
    svg2png(
        bytestring=svg_data,
        write_to=str(out_path),
        output_width=2400,
        url_fetcher=block_external_refs,
    )
    return str(out_path)

PAGE_SIZES = {
    "A4": A4,
    "Letter": LETTER,
    "auto": "auto",  # sentinel — handled specially in images_to_pdf
}

# Memory cap to prevent OOM on huge images — 200 MP per source image. A 16K
# (15360×8640) image is ~130 MP, so this still allows generous photo sizes
# while blocking malicious "1 GB pixel array" uploads. The global Pillow
# `Image.MAX_IMAGE_PIXELS` (set in `app/utils/__init__.py`) is 150 MP; this
# per-image cap is the explicit, friendly-error gate we hit *before* PIL
# raises DecompressionBombError so users see a useful message.
MAX_IMAGE_PIXELS = 200_000_000


def _open_image_size(path: str) -> tuple[int, int]:
    """Return the pixel dimensions of an image without keeping it loaded.

    Enforces the per-image pixel cap so callers can fail fast before any
    decoding work runs.
    """
    with Image.open(path) as img:
        w, h = img.size
        if w * h > MAX_IMAGE_PIXELS:
            raise ValueError(
                f"Image {os.path.basename(path)} is too large ({w}x{h} = "
                f"{(w * h) // 1_000_000} MP). Max {MAX_IMAGE_PIXELS // 1_000_000} MP per image."
            )
        return w, h


def images_to_pdf(input_paths: list, page_size: str = "A4") -> str:
    ensure_temp_dir()
    started = time.monotonic()
    total_input_bytes = 0
    for p in input_paths:
        try:
            total_input_bytes += os.path.getsize(p)
        except OSError:
            pass
    logger.info(
        "image_to_pdf: start images=%d page_size=%s total_input_bytes=%d",
        len(input_paths), page_size, total_input_bytes,
    )

    output_path = get_temp_path(f"images_to_pdf_{uuid.uuid4().hex}.pdf")

    # Track intermediate transcoded files so we can delete them even on error.
    intermediates: list[str] = []

    # "auto": each page matches its source image's pixel dimensions (treating
    # 1 px = 1 PDF point, which gives a 72 DPI document at original scale).
    auto = (page_size == "auto")
    fixed_size = None if auto else PAGE_SIZES.get(page_size, A4)
    if not auto and fixed_size == "auto":  # paranoia
        fixed_size = A4

    try:
        if auto:
            # Build a multi-page PDF page-by-page so each page can be a different
            # size. ReportLab's SimpleDocTemplate only supports a single pagesize.
            from reportlab.pdfgen.canvas import Canvas

            c: Canvas | None = None
            for path in input_paths:
                ext = os.path.splitext(path)[1].lower()
                if ext in _HEIC_EXTS:
                    img_width, img_height = _open_image_size(path)
                    jpeg_path = get_temp_path(f"heic_to_jpeg_{uuid.uuid4().hex}.jpg")
                    with Image.open(path) as img:
                        img.convert("RGB").save(jpeg_path, "JPEG", quality=92)
                    intermediates.append(str(jpeg_path))
                    embed_path = str(jpeg_path)
                elif ext in _SVG_EXTS:
                    png_path = _svg_to_png(path)
                    intermediates.append(png_path)
                    img_width, img_height = _open_image_size(png_path)
                    embed_path = png_path
                else:
                    img_width, img_height = _open_image_size(path)
                    embed_path = path

                if c is None:
                    c = Canvas(str(output_path), pagesize=(img_width, img_height))
                else:
                    c.setPageSize((img_width, img_height))
                c.drawImage(embed_path, 0, 0, width=img_width, height=img_height)
                c.showPage()

            if c is None:
                # Empty input — write a minimal blank A4 PDF rather than crash.
                c = Canvas(str(output_path), pagesize=A4)
                c.showPage()
            c.save()
        else:
            doc = SimpleDocTemplate(str(output_path), pagesize=fixed_size)
            story = []

            page_width, page_height = fixed_size
            margin = 36  # 0.5 inch
            max_width = page_width - 2 * margin
            max_height = page_height - 2 * margin

            for path in input_paths:
                ext = os.path.splitext(path)[1].lower()
                # ReportLab can't load HEIC directly even with pillow-heif registered —
                # transcode to a temp JPEG and feed it the JPEG instead.
                if ext in _HEIC_EXTS:
                    img_width, img_height = _open_image_size(path)
                    jpeg_path = get_temp_path(f"heic_to_jpeg_{uuid.uuid4().hex}.jpg")
                    with Image.open(path) as img:
                        img.convert("RGB").save(jpeg_path, "JPEG", quality=92)
                    intermediates.append(str(jpeg_path))
                    embed_path = str(jpeg_path)
                elif ext in _SVG_EXTS:
                    # Rasterize vector SVG → PNG so ReportLab can embed it.
                    png_path = _svg_to_png(path)
                    intermediates.append(png_path)
                    img_width, img_height = _open_image_size(png_path)
                    embed_path = png_path
                else:
                    img_width, img_height = _open_image_size(path)
                    embed_path = path

                ratio = min(max_width / img_width, max_height / img_height)
                new_width = img_width * ratio
                new_height = img_height * ratio

                rl_img = RLImage(embed_path, width=new_width, height=new_height)
                story.append(rl_img)

            doc.build(story)
    finally:
        # Drop the intermediate JPEG/PNG transcodes — they're embedded in
        # the output PDF already, no need to keep them on disk.
        for p in intermediates:
            try:
                os.unlink(p)
            except OSError:
                pass

    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        out_size = os.path.getsize(output_path)
    except OSError:
        out_size = 0
    logger.info(
        "image_to_pdf: done images=%d duration_ms=%d output_bytes=%d",
        len(input_paths), duration_ms, out_size,
    )
    return str(output_path)

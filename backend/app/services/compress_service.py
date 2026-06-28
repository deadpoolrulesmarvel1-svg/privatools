"""PDF compression using pikepdf with improved quality settings.

Uses pikepdf object-stream compression + per-image JPEG re-encoding. We
deliberately do NOT shell out to Ghostscript: the deploy VM does not
guarantee a `gs` binary, and pikepdf's pure-Python path is predictable
and fast enough for the upload sizes the frontend permits (≤500 MB).

Presets (`light` / `recommended` / `extreme`) map to user-facing labels
in the React UI. `custom` lets the slider override quality + max dim
without touching the preset table.
"""
import io
import logging
import os
import time
import uuid
from typing import Any

import pikepdf
from PIL import Image

from ..utils.cleanup import ensure_temp_dir, get_temp_path, safe_open_pdf

logger = logging.getLogger(__name__)

_PRESETS = {
    "light": {"max_image_dim": 2200, "jpeg_quality": 85},
    "recommended": {"max_image_dim": 1800, "jpeg_quality": 75},
    "extreme": {"max_image_dim": 1400, "jpeg_quality": 60},
}


def _recompress_image(
    data: bytes,
    current_filter: str,
    max_image_dim: int,
    jpeg_quality: int,
) -> bytes | None:
    """Downsample and re-compress an image; return new bytes or None to skip."""
    try:
        # `with` so the decoded image is released even on the image-heavy
        # path where this runs once per embedded image, per page.
        with Image.open(io.BytesIO(data)) as src:
            img = src.convert("RGB") if src.mode in ("RGBA", "P") else src
            w, h = img.size
            if w > max_image_dim or h > max_image_dim:
                img.thumbnail((max_image_dim, max_image_dim), Image.LANCZOS)
            out = io.BytesIO()
            # Progressive JPEG for better web loading + optimize for smaller size
            img.save(
                out,
                format="JPEG",
                quality=jpeg_quality,
                optimize=True,
                progressive=True,
            )
            return out.getvalue()
    except Exception:
        return None


def _open_pdf_mmap(input_path: str) -> Any:
    """Open `input_path` with pikepdf, preferring mmap when the build supports it.

    Older pikepdf wheels don't expose `AccessMode.mmap`; fall back to the
    default open in that case. Either way we still get the friendly
    password / corrupt translations from `safe_open_pdf`.
    """
    access_mode = getattr(getattr(pikepdf, "AccessMode", None), "mmap", None)
    if access_mode is not None:
        try:
            return safe_open_pdf(input_path, access_mode=access_mode)
        except TypeError:
            # Older pikepdf builds accept access_mode= as keyword but on a
            # different parameter — degrade silently.
            pass
    return safe_open_pdf(input_path)


def compress_pdf(
    input_path: str,
    level: str = "recommended",
    jpeg_quality_override: int | None = None,
    max_image_dim_override: int | None = None,
) -> str:
    """Compress a PDF.

    `level` picks one of the named presets (light / recommended / extreme).
    `jpeg_quality_override` and `max_image_dim_override` let the caller
    override the preset values for one specific job (e.g. user sliders).
    """
    ensure_temp_dir()
    started = time.monotonic()
    input_size = 0
    try:
        input_size = os.path.getsize(input_path)
    except OSError:
        pass
    output_path = get_temp_path(f"compressed_{uuid.uuid4().hex}.pdf")
    preset = _PRESETS.get(level, _PRESETS["recommended"])
    max_image_dim = int(max_image_dim_override) if max_image_dim_override is not None else int(preset["max_image_dim"])
    jpeg_quality = int(jpeg_quality_override) if jpeg_quality_override is not None else int(preset["jpeg_quality"])
    jpeg_quality = max(15, min(95, jpeg_quality))
    max_image_dim = max(300, min(4000, max_image_dim))

    logger.info(
        "compress: start level=%s jpeg_q=%d max_dim=%d input_bytes=%d",
        level, jpeg_quality, max_image_dim, input_size,
    )

    with _open_pdf_mmap(input_path) as pdf:
        for page in pdf.pages:
            resources = page.get("/Resources")
            if resources is None:
                continue
            xobjects = resources.get("/XObject")
            if xobjects is None:
                continue
            for key in list(xobjects.keys()):
                xobj = xobjects[key]
                try:
                    if xobj.get("/Subtype") != "/Image":
                        continue
                    raw = xobj.read_raw_bytes()

                    # Skip tiny images (logos, icons) — not worth recompressing
                    img_w = int(xobj.get("/Width", 0))
                    img_h = int(xobj.get("/Height", 0))
                    if img_w < 50 or img_h < 50:
                        continue

                    new_bytes = _recompress_image(
                        raw,
                        str(xobj.get("/Filter", "")),
                        max_image_dim=max_image_dim,
                        jpeg_quality=jpeg_quality,
                    )
                    # Only replace if actually smaller
                    if new_bytes and len(new_bytes) < len(raw):
                        xobj.write(new_bytes, filter=pikepdf.Name("/DCTDecode"))
                        # Get dimensions from the recompressed image
                        with Image.open(io.BytesIO(new_bytes)) as recompressed_img:
                            xobj["/Width"] = recompressed_img.width
                            xobj["/Height"] = recompressed_img.height
                        xobj["/ColorSpace"] = pikepdf.Name("/DeviceRGB")
                        xobj["/BitsPerComponent"] = 8
                except Exception as exc:
                    logger.debug("Skipping image %s: %s", key, exc)
                    continue

        # Stream compression + garbage collection
        pdf.save(
            str(output_path),
            compress_streams=True,
            recompress_flate=True,
            object_stream_mode=pikepdf.ObjectStreamMode.generate,
        )

    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        out_size = os.path.getsize(output_path)
    except OSError:
        out_size = 0
    logger.info(
        "compress: done level=%s duration_ms=%d input_bytes=%d output_bytes=%d ratio=%.2f",
        level, duration_ms, input_size, out_size,
        (out_size / input_size) if input_size else 1.0,
    )
    return str(output_path)

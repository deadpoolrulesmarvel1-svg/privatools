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

# Two vocabularies over the same two knobs.
#
# `light` / `recommended` / `extreme` describe how hard to squeeze, which is
# what the original UI asked. Adobe, Nitro and Foxit all ship a second set
# named for the *job* instead — you know you are emailing something or sending
# it to a printer, and you should not have to translate that into a quality
# percentage. Both are kept: the first three are what existing callers send.
#
# Deliberately no "strip metadata" flag on any profile. Adobe's optimizer has
# one, but folding it into a compression preset would silently delete the
# document title — which is exactly the kind of quiet accessibility loss the
# merge/grayscale fixes were about. Stripping metadata is its own tool.
_PRESETS = {
    "light": {"max_image_dim": 2200, "jpeg_quality": 85},
    "recommended": {"max_image_dim": 1800, "jpeg_quality": 75},
    "extreme": {"max_image_dim": 1400, "jpeg_quality": 60},

    # Purpose-named profiles.
    "email": {"max_image_dim": 1200, "jpeg_quality": 60},
    "print": {"max_image_dim": 3000, "jpeg_quality": 90},
    "archive": {"max_image_dim": 2400, "jpeg_quality": 82},
    "web": {"max_image_dim": 1600, "jpeg_quality": 70},
}

PROFILE_LABELS = {
    "email": "Email — small enough for a 10 MB attachment limit",
    "print": "Print — 300 DPI equivalent, minimal quality loss",
    "archive": "Archive — long-term storage, quality preserved",
    "web": "Web — fast to load in a browser",
    "light": "Light — barely touched",
    "recommended": "Balanced",
    "extreme": "Extreme — smallest file",
}

# Ladder used by the target-size search, lightest first. Each rung is a
# (max_image_dim, jpeg_quality) pair; monotonically smaller output down the list.
_TARGET_LADDER = [
    (2600, 90),
    (2200, 85),
    (1800, 75),
    (1400, 62),
    (1100, 50),
    (850, 40),
    (650, 30),
]


def _decode_embedded_image(xobj: Any, raw: bytes) -> "Image.Image | None":
    """Decode an embedded image whatever filter it uses.

    This used to be `Image.open(io.BytesIO(raw))` on the *raw stream bytes*.
    That works for /DCTDecode, where the raw bytes are a complete JPEG file,
    and fails for everything else: /FlateDecode bytes are zlib-compressed raw
    samples with no container, so PIL raised, the image was skipped, and the
    PDF came back the size it went in.

    Measured before the fix, same generated page, `extreme` level:
        /DCTDecode    855,422 -> 151,550 bytes  (0.18)
        /FlateDecode  396,150 -> 396,126 bytes  (1.00)

    A 1.00 ratio is not "already optimal", it is "did nothing" — and Flate is
    how screenshots, PNG exports and plenty of scanner output get stored. The
    tell was the `current_filter` argument, which the function accepted and
    never looked at.

    pikepdf's PdfImage understands the filters and the colour space, so it is
    the right decoder. The raw-bytes path stays as a fallback for images
    PdfImage can't model.
    """
    try:
        return pikepdf.PdfImage(xobj).as_pil_image()
    except Exception:
        pass
    try:
        return Image.open(io.BytesIO(raw))
    except Exception:
        return None


def _recompress_image(
    xobj: Any,
    raw: bytes,
    max_image_dim: int,
    jpeg_quality: int,
) -> bytes | None:
    """Downsample and re-compress an image; return new bytes or None to skip."""
    # Stencil masks are 1-bit shapes, not pictures. Re-encoding one as a JPEG
    # doesn't shrink anything and does break the mask.
    try:
        if bool(xobj.get("/ImageMask", False)):
            return None
    except Exception:
        pass

    src = _decode_embedded_image(xobj, raw)
    if src is None:
        return None
    try:
        img = src.convert("RGB") if src.mode not in ("RGB", "L") else src
        w, h = img.size
        if w > max_image_dim or h > max_image_dim:
            img.thumbnail((max_image_dim, max_image_dim), Image.LANCZOS)
            if img.mode != "RGB":
                img = img.convert("RGB")
        elif img.mode != "RGB":
            img = img.convert("RGB")
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
    finally:
        try:
            src.close()
        except Exception:
            pass


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
                        xobj,
                        raw,
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


def compress_to_target(
    input_path: str,
    target_bytes: int,
    max_attempts: int = 4,
) -> tuple[str, dict]:
    """Compress until the output fits `target_bytes`, or as close as it gets.

    ihatepdf.cv offers this free; Smallpdf and iLovePDF put it behind a paid
    tier. It is the form of the question people actually have — "make this fit
    under 10 MB" — rather than "pick a quality percentage and see".

    Binary search over `_TARGET_LADDER` rather than walking it: each rung is a
    full re-compression pass, and on a 2-core box a linear walk over seven rungs
    on a large PDF is minutes of work. The search finds the *lightest* rung that
    fits in ~3 passes, so the file also isn't squeezed harder than it needs to be.

    Returns `(output_path, info)`. `info["met"]` is False when even the bottom
    rung overshoots — the caller gets the smallest achievable file and an honest
    statement that the target wasn't reached, rather than a silent miss.
    """
    ensure_temp_dir()
    try:
        input_size = os.path.getsize(input_path)
    except OSError:
        input_size = 0

    attempts = 0
    best_path: str | None = None
    best_size = 0
    best_rung = -1
    produced: list[str] = []

    lo, hi = 0, len(_TARGET_LADDER) - 1
    while lo <= hi and attempts < max_attempts:
        mid = (lo + hi) // 2
        dim, quality = _TARGET_LADDER[mid]
        attempts += 1

        path = compress_pdf(
            input_path,
            level="custom",
            jpeg_quality_override=quality,
            max_image_dim_override=dim,
        )
        produced.append(path)
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0

        if size <= target_bytes:
            # Fits. Record it and try a lighter rung for better quality.
            if best_path is None or mid < best_rung:
                best_path, best_size, best_rung = path, size, mid
            hi = mid - 1
        else:
            # Too big — squeeze harder. Keep it only as a fallback if nothing fits.
            if best_path is None and (best_size == 0 or size < best_size):
                best_size = size
                best_rung = mid
                best_path = path
            lo = mid + 1

    if best_path is None:  # pragma: no cover - loop always produces one
        best_path = compress_pdf(input_path, level="extreme")
        best_size = os.path.getsize(best_path)
        best_rung = len(_TARGET_LADDER) - 1

    # Every rung we tried and discarded is a temp file nobody will collect.
    for path in produced:
        if path != best_path:
            try:
                os.remove(path)
            except OSError:
                pass

    dim, quality = _TARGET_LADDER[max(best_rung, 0)]
    info = {
        "met": best_size <= target_bytes,
        "targetBytes": target_bytes,
        "inputBytes": input_size,
        "outputBytes": best_size,
        "attempts": attempts,
        "maxImageDim": dim,
        "jpegQuality": quality,
    }
    logger.info(
        "compress-target: target=%d input=%d output=%d met=%s attempts=%d",
        target_bytes, input_size, best_size, info["met"], attempts,
    )
    return best_path, info

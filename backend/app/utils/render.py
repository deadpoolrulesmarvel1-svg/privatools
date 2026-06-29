"""Bounded PDF page rasterization.

A PDF page's MediaBox is attacker-controlled (the spec allows up to
14400×14400 pt). `fitz.Page.get_pixmap()` allocates `width×height×channels`
bytes eagerly, so a single crafted page rendered at a normal DPI is tens of GB —
enough to OOM-kill a uvicorn worker (≈50% of capacity on the 2-core VM) with a
~1 MB upload, no auth, repeatable. Pillow's decompression-bomb guard does NOT
cover fitz pixmaps.

`safe_get_pixmap` computes the *output* pixel count (page rect × scale) and
rejects anything over the cap BEFORE allocating. Use it instead of
`page.get_pixmap(...)` everywhere a user-supplied PDF is rendered.
"""

from __future__ import annotations

import os

import fitz  # PyMuPDF

from .exceptions import ValidationError


def _env_int(name: str, default: int) -> int:
    try:
        v = int(os.environ.get(name, "").strip())
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


# ~100 MP output cap. A 600-DPI A3 page is ~70 MP, so legitimate high-res
# renders pass; the 14400 pt bomb is rejected at any usable DPI.
MAX_PIXMAP_MP = _env_int("MAX_PIXMAP_MP", 100)
MAX_PIXMAP_PIXELS = MAX_PIXMAP_MP * 1_000_000


def estimate_pixmap_pixels(page: "fitz.Page", *, matrix=None, dpi=None) -> float:
    """Pixels a get_pixmap(matrix=/dpi=) call would allocate for this page."""
    rect = page.rect
    if dpi is not None:
        sx = sy = dpi / 72.0
    elif matrix is not None:
        sx, sy = abs(matrix.a), abs(matrix.d)
    else:
        sx = sy = 1.0
    return (rect.width * sx) * (rect.height * sy)


def safe_get_pixmap(page: "fitz.Page", *, matrix=None, dpi=None, **kwargs):
    """`page.get_pixmap(...)` with an output-size guard (OOM protection).

    Rejects renders larger than ``MAX_PIXMAP_PIXELS`` before allocating. Accepts
    the same ``matrix=``/``dpi=`` + passthrough kwargs (``colorspace``,
    ``alpha``, …) as ``get_pixmap``.
    """
    px = estimate_pixmap_pixels(page, matrix=matrix, dpi=dpi)
    if px > MAX_PIXMAP_PIXELS:
        w = int(page.rect.width * (dpi / 72.0 if dpi else (abs(matrix.a) if matrix else 1.0)))
        h = int(page.rect.height * (dpi / 72.0 if dpi else (abs(matrix.d) if matrix else 1.0)))
        raise ValidationError(
            f"A page is too large to render ({w}×{h} px, ~{int(px // 1_000_000)} MP). "
            f"Max {MAX_PIXMAP_MP} MP per page — reduce the resolution or the source page size."
        )
    if dpi is not None:
        return page.get_pixmap(dpi=dpi, **kwargs)
    if matrix is not None:
        return page.get_pixmap(matrix=matrix, **kwargs)
    return page.get_pixmap(**kwargs)

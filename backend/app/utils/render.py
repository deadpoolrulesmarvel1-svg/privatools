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

import math
import os

import fitz  # PyMuPDF

from .exceptions import ToolError, ValidationError


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

# How many megapixels one request may draw, all its pages together, in the
# tools that draw every page and fit a page too large for the cap
# (fitted_zoom): PDF to Image, Invert Colors, PDF to PowerPoint. Deskew and
# Transparent Background, which spend more on each pixel, take a share of it
# (plan_renders). Drawing is where these tools spend their time and memory, and
# the pages' sizes decide it, not the upload's: a 70 KB PDF can hold pages that
# each draw to 100 megapixels. 2,000 megapixels is about 900 A4 pages at
# 150 DPI, 230 at 300 DPI and 57 at 600 DPI; at the most a pixel costs here
# (a PNG, 70 ns of CPU), about two and a half minutes of CPU.
RENDER_BUDGET_MP = _env_int("RENDER_BUDGET_MP", 2000)


class RenderBudgetError(ToolError):
    """Drawing every page would pass the request's render budget (HTTP 422)."""

    status_code = 422


# Page-count backstop for the all-pages-in-RAM paths (OCR, multi-page TIFF):
# even with each page individually size-capped, accumulating thousands of
# rendered pages OOMs. Generous default so legitimate large docs pass.
MAX_RENDER_PAGES = _env_int("MAX_RENDER_PAGES", 2000)


def check_render_page_count(n: int) -> None:
    """Reject an operation that would hold an absurd number of rendered pages
    in memory at once."""
    if n > MAX_RENDER_PAGES:
        raise ValidationError(
            f"This PDF has too many pages ({n}) for this operation. "
            f"Max {MAX_RENDER_PAGES} pages — split it first."
        )


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


def fitted_zoom(page: "fitz.Page", zoom: float, max_pixels: float | None = None) -> float:
    """`zoom`, or the largest zoom below it at which the page still renders
    within `max_pixels` (at most MAX_PIXMAP_PIXELS, the default).

    For tools that render one page at a time and release it: a page too large
    for the cap at the resolution asked for (a photo made into a page the size
    of its pixels, a poster) is drawn at the largest size that fits instead of
    failing. Every other page gets exactly `zoom`. Paths that hold every
    rendered page at once keep safe_get_pixmap's refusal. Call it through
    plan_renders, which also holds the request to its render budget.
    """
    cap = MAX_PIXMAP_PIXELS if max_pixels is None else min(max_pixels, MAX_PIXMAP_PIXELS)
    area = page.rect.width * page.rect.height
    if area <= 0 or area * zoom * zoom <= cap:
        return zoom
    # A hair under the exact fit, so float rounding cannot tip it over the cap.
    return math.sqrt(cap / area) * 0.999


def plan_renders(pages, zoom: float, *, advice: str, max_pixels: float | None = None,
                 share: float = 1.0) -> list[float]:
    """The zoom to draw each page at (fitted_zoom), once the whole request is
    known to fit its render budget: RENDER_BUDGET_MP times `share` megapixels,
    all pages together. Over it, nothing is drawn and the request is refused
    (RenderBudgetError, 422) with `advice` on what to do instead.

    Counted before any drawing, from the pages' sizes, so a refusal is at once.
    """
    zooms, total = [], 0.0
    for page in pages:
        page_zoom = fitted_zoom(page, zoom, max_pixels)
        zooms.append(page_zoom)
        total += page.rect.width * page.rect.height * page_zoom * page_zoom
    budget = RENDER_BUDGET_MP * share
    if total > budget * 1_000_000:
        raise RenderBudgetError(
            f"This PDF would need about {round(total / 1_000_000):,} megapixels of drawing, "
            f"and one request can draw up to {round(budget):,}. {advice}"
        )
    return zooms


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
        # Worded to reach the visitor as it is: the page's friendlyError turns
        # any message saying "too large" into advice to compress the file.
        raise ValidationError(
            f"A page of this PDF is bigger than the server can draw: {w:,} × {h:,} pixels, "
            f"about {int(px // 1_000_000):,} megapixels, where the limit is {MAX_PIXMAP_MP:,} a page. "
            f"Make the page smaller with Resize PDF, or choose a lower resolution where the tool offers one."
        )
    if dpi is not None:
        return page.get_pixmap(dpi=dpi, **kwargs)
    if matrix is not None:
        return page.get_pixmap(matrix=matrix, **kwargs)
    return page.get_pixmap(**kwargs)

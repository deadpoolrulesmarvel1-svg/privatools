"""Highlight every occurrence of a search string in a PDF.

Uses PyMuPDF's text search (which already handles multi-line text and font
variants) and adds a real PDF Highlight annotation per hit, so the result is
a fully-editable / removable annotation in any PDF reader.
"""

from __future__ import annotations

import re
import uuid
from typing import Iterable, Tuple

import fitz  # PyMuPDF

from ..utils.cleanup import ensure_temp_dir, get_temp_path

# Friendly named colors → RGB tuples (0-1 floats expected by PyMuPDF).
NAMED_COLORS: dict[str, Tuple[float, float, float]] = {
    "yellow": (1.0, 0.93, 0.0),
    "green":  (0.55, 0.93, 0.55),
    "pink":   (1.0, 0.63, 0.78),
    "blue":   (0.55, 0.78, 1.0),
    "orange": (1.0, 0.66, 0.0),
    "red":    (1.0, 0.45, 0.45),
    "purple": (0.78, 0.65, 1.0),
}

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


def _parse_color(color: str) -> Tuple[float, float, float]:
    color = (color or "").strip().lower()
    if color in NAMED_COLORS:
        return NAMED_COLORS[color]
    m = _HEX_RE.match(color)
    if m:
        h = m.group(1)
        return (
            int(h[0:2], 16) / 255.0,
            int(h[2:4], 16) / 255.0,
            int(h[4:6], 16) / 255.0,
        )
    raise ValueError(
        f"Unknown color '{color}'. Use one of: "
        + ", ".join(sorted(NAMED_COLORS.keys()))
        + " or a hex string like #ffea00."
    )


def highlight_text(
    input_path: str,
    query: str,
    color: str = "yellow",
    case_sensitive: bool = False,
) -> Tuple[str, int]:
    """Return (output_path, total_hit_count)."""
    if not query:
        raise ValueError("Search query is required")

    rgb = _parse_color(color)
    ensure_temp_dir()
    output_path = get_temp_path(f"highlighted_{uuid.uuid4().hex}.pdf")

    flags = 0 if case_sensitive else fitz.TEXT_DEHYPHENATE
    total_hits = 0

    doc = fitz.open(input_path)
    try:
        for page in doc:
            quads: Iterable[fitz.Quad]
            try:
                # PyMuPDF >=1.18 supports quads=True for accurate highlight
                # boxes that follow rotated/italic text.
                quads = page.search_for(query, quads=True, flags=flags)
            except TypeError:
                # Older PyMuPDF — fall back to rectangles.
                quads = page.search_for(query, flags=flags)
            if not quads:
                continue
            annot = page.add_highlight_annot(list(quads))
            annot.set_colors(stroke=rgb)
            annot.update()
            total_hits += len(list(quads)) if hasattr(quads, "__len__") else 1

        doc.save(str(output_path), garbage=4, deflate=True)
    finally:
        doc.close()

    return str(output_path), total_hits

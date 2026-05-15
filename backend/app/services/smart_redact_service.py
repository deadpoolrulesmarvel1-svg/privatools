"""Smart Redact — search & redact PDF by text strings.

Frontend extracts text and (via local NER + regex) suggests strings the user
wants to redact. The backend then locates each string in the actual PDF and
applies a real PyMuPDF redaction annotation, which permanently removes the
content beneath the rectangle (not just a black overlay you can copy through).
"""

from __future__ import annotations

import uuid
from typing import Iterable, Tuple

import fitz  # PyMuPDF

from ..utils.cleanup import ensure_temp_dir, get_temp_path


def _hex_to_rgb(hex_color: str) -> Tuple[float, float, float]:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return (0, 0, 0)
    try:
        return (
            int(h[0:2], 16) / 255.0,
            int(h[2:4], 16) / 255.0,
            int(h[4:6], 16) / 255.0,
        )
    except ValueError:
        return (0, 0, 0)


def smart_redact(
    input_path: str,
    needles: Iterable[str],
    color: str = "#000000",
    case_sensitive: bool = False,
) -> Tuple[str, int]:
    """Apply real redaction annotations for every match of every needle."""
    ensure_temp_dir()
    output_path = get_temp_path(f"smart_redacted_{uuid.uuid4().hex}.pdf")
    fill = _hex_to_rgb(color)
    flags = 0 if case_sensitive else fitz.TEXT_DEHYPHENATE

    # Dedupe + drop empties so we don't redact giant common strings by accident.
    needle_set = sorted({n.strip() for n in needles if n and len(n.strip()) >= 2}, key=len, reverse=True)
    if not needle_set:
        raise ValueError("No usable strings to redact (each must be ≥ 2 characters).")

    total_hits = 0
    doc = fitz.open(input_path)
    try:
        for page in doc:
            for needle in needle_set:
                try:
                    quads = page.search_for(needle, quads=True, flags=flags)
                except TypeError:
                    quads = page.search_for(needle, flags=flags)
                if not quads:
                    continue
                for q in quads:
                    rect = q.rect if hasattr(q, "rect") else q
                    page.add_redact_annot(rect, fill=fill)
                    total_hits += 1
            page.apply_redactions()
        doc.save(str(output_path), garbage=4, deflate=True)
    finally:
        doc.close()

    return str(output_path), total_hits

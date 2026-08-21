"""Find visible watermarks in a PDF. Analysis only — never mutates the file.

Grounded in what watermark tools actually emit rather than what the PDF spec
permits. Inspecting PrivaTools' own `/watermark` output showed the assumption
that a watermark is "one shared object drawn on every page" is wrong: each page
gets its own Form XObject xref. Detecting by object identity would have found
nothing.

What IS reliable is `page.get_texttrace()`, which reports per-span opacity and
writing direction. A watermark span reads `opacity=0.3, dir=(0.707, -0.707)`
(45°); body text reads `opacity=1.0, dir=(1.0, 0.0)`. Detection therefore keys
on a per-span signature — text, opacity bucket, direction bucket — repeated
across pages.

Two suppression rules keep the expensive failure (deleting real content) rare:
running heads and page numbers are never reported, and a candidate is dropped
if removing it would leave a page empty.
"""

from __future__ import annotations

import hashlib
from typing import Any

import fitz

# A span must appear on at least this share of pages to count as repeated.
_REPEAT_RATIO = 0.8
# Opaque, unrotated text this small in a margin band is a running head.
_MARGIN_BAND = 0.10          # top/bottom 10% of the page
_HEADER_MAX_AREA = 0.05      # of total page area
_MIN_CONFIDENCE = 0.5
_MAX_CANDIDATES = 20


def _is_rotated(direction: tuple[float, float]) -> bool:
    """True when a span is not drawn left-to-right along the page axis."""
    dx, dy = direction
    return abs(dy) > 0.01 or dx < 0.99


def _span_text(span: dict) -> str:
    return "".join(chr(c[0]) for c in span.get("chars", [])).strip()


def _span_bbox(span: dict) -> tuple[float, float, float, float] | None:
    """`get_texttrace()` already reports a span bbox — use it rather than
    recomputing from the per-char tuples, whose layout is
    (unicode, glyph_id, origin, bbox)."""
    bbox = span.get("bbox")
    if not bbox or len(bbox) != 4:
        return None
    return tuple(float(v) for v in bbox)


def _looks_like_running_head(bbox, page_rect, opacity: float, rotated: bool) -> bool:
    """Suppress headers, footers and page numbers.

    Repetition alone does not make a watermark — a running head appears on every
    page too. What separates them is that a head is opaque, unrotated, small,
    and in a margin band.
    """
    if opacity < 0.99 or rotated:
        return False
    x0, y0, x1, y1 = bbox
    page_h = page_rect.height or 1.0
    page_area = (page_rect.width or 1.0) * page_h
    area_ratio = ((x1 - x0) * (y1 - y0)) / page_area if page_area else 1.0
    in_margin = (y1 <= page_h * _MARGIN_BAND) or (y0 >= page_h * (1 - _MARGIN_BAND))
    return in_margin and area_ratio <= _HEADER_MAX_AREA


def _score(*, pages_hit: int, page_count: int, opacity: float, rotated: bool,
           area_ratio: float, text: str) -> float:
    score = 0.0
    if page_count and pages_hit / page_count >= _REPEAT_RATIO:
        score += 0.45
    if opacity < 0.99:
        score += 0.20
    if rotated:
        score += 0.15
    if area_ratio > 0.25:
        score += 0.10
    if any(w in text.lower() for w in
           ("watermark", "draft", "confidential", "sample", "specimen", "preview", "copy")):
        score += 0.25
    return round(min(score, 1.0), 2)


def _page_has_other_content(page, watermark_texts: set[str]) -> bool:
    """Would anything survive removing these spans?"""
    for span in page.get_texttrace():
        if _span_text(span) and _span_text(span) not in watermark_texts:
            return True
    return bool(page.get_drawings()) or bool(page.get_images())


def _label(group: dict, page_count: int) -> str:
    """Plain-language description. The watermark text is reproduced verbatim so
    the user recognises their own mark."""
    bits = []
    if group["rotated"]:
        bits.append("Rotated")
    if group["opacity"] < 0.99:
        bits.append("translucent" if bits else "Translucent")
    bits.append("text" if bits else "Text")
    prefix = " ".join(bits)
    pages = len(group["pages"])
    return (
        f"{prefix} \u201c{group['text'][:40]}\u201d on "
        f"{pages} of {page_count} page{'s' if page_count != 1 else ''}"
    )


def detect_watermarks(input_path: str) -> dict[str, Any]:
    """Return watermark candidates. Never deletes anything."""
    doc = fitz.open(input_path)
    try:
        page_count = len(doc)
        if page_count == 0:
            return {"candidates": [], "page_count": 0, "flattened_suspected": False}

        # signature -> aggregate
        groups: dict[tuple, dict[str, Any]] = {}

        for index, page in enumerate(doc, start=1):
            rect = page.rect
            page_area = (rect.width or 1.0) * (rect.height or 1.0)
            for span in page.get_texttrace():
                text = _span_text(span)
                if not text:
                    continue
                opacity = float(span.get("opacity", 1.0))
                direction = tuple(span.get("dir", (1.0, 0.0)))
                rotated = _is_rotated(direction)
                bbox = _span_bbox(span)
                if bbox is None:
                    continue
                if _looks_like_running_head(bbox, rect, opacity, rotated):
                    continue
                # An opaque, unrotated span is ordinary content, however often
                # it repeats. Only translucent or rotated text is a candidate.
                if opacity >= 0.99 and not rotated:
                    continue

                key = (text, round(opacity, 2), round(direction[0], 2), round(direction[1], 2))
                entry = groups.setdefault(key, {
                    "text": text, "opacity": opacity, "rotated": rotated,
                    "pages": [], "bbox": bbox, "area_ratio": 0.0,
                })
                entry["pages"].append(index)
                entry["area_ratio"] = max(
                    entry["area_ratio"],
                    ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) / page_area,
                )

        candidates = []
        watermark_texts = {g["text"] for g in groups.values()}
        for key, g in groups.items():
            confidence = _score(
                pages_hit=len(g["pages"]), page_count=page_count,
                opacity=g["opacity"], rotated=g["rotated"],
                area_ratio=g["area_ratio"], text=g["text"],
            )
            if confidence < _MIN_CONFIDENCE:
                continue
            # Never offer to strip a page's only content.
            if not any(_page_has_other_content(doc[p - 1], watermark_texts) for p in g["pages"]):
                continue

            digest = hashlib.sha256(repr(key).encode("utf-8")).hexdigest()[:12]
            candidates.append({
                "id": f"wm_{digest}",
                "kind": "text_span",
                "confidence": confidence,
                "pages": sorted(g["pages"]),
                "page_count": len(g["pages"]),
                "bbox": [round(v, 2) for v in g["bbox"]],
                "removal": "lossless",
                "text": g["text"],
                # NB: never .capitalize() this — it would lowercase the user's
                # own watermark text, showing "CONFIDENTIAL" back as
                # "confidential". The text is quoted verbatim.
                "label": _label(g, page_count),
            })

        candidates.sort(key=lambda c: (-c["confidence"], c["id"]))
        return {
            "candidates": candidates[:_MAX_CANDIDATES],
            "page_count": page_count,
            "flattened_suspected": False,
        }
    finally:
        doc.close()

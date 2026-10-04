import math

import fitz  # PyMuPDF

from ..utils.colors import hex_to_rgb_float
from ..utils.cleanup import process_pdf
from ..utils.filenames import temp_output
from ..utils.page_space import drawing_unturned


def add_shapes(input_path: str, shapes: list) -> str:
    """Add shapes (rectangle, circle, line, arrow) to PDF pages.

    Args:
        shapes: List of dicts with keys:
            - type: 'rectangle', 'circle', 'line', 'arrow'
            - page: page number (1-indexed); the route refuses one the PDF
              does not have
            - x, y: start coordinates, in points from the top-left corner of
              the page's visible area (its CropBox), before any /Rotate
            - width, height: dimensions (for rect/circle)
            - x2, y2: end coordinates (for line/arrow)
            - color: hex color string
            - fill: hex fill color (optional, for rect/circle)
            - stroke_width: line thickness
    """
    output_path = temp_output("shapes", "pdf")

    def draw(doc: fitz.Document) -> None:
        for s in shapes:
            pg_num = int(s.get("page", 1))
            pg_idx = pg_num - 1
            if pg_idx < 0 or pg_idx >= len(doc):
                continue
            page = doc[pg_idx]
            with drawing_unturned(page):
                _draw_shape(page, s)

        doc.save(str(output_path), garbage=4, deflate=True)

    # A locked, damaged or pageless PDF is refused in the standard words; work
    # that fails on a repaired one is refused as damaged, never redone on a
    # rebuild that may have left pages out (utils.cleanup.process_pdf).
    process_pdf(input_path, draw, rebuild=False)
    return str(output_path)


def _draw_shape(page: fitz.Page, s: dict) -> None:
    """Draw one shape on `page`, in the page's stored coordinates."""
    shape_type = s.get("type", "rectangle")
    shape = page.new_shape()

    color = hex_to_rgb_float(s.get("color", "#000000"))
    fill_raw = s.get("fill", "")
    # Pass `None` default so an invalid hex doesn't accidentally
    # fill a rect that the caller wanted stroke-only.
    fill_color = (
        hex_to_rgb_float(fill_raw, default=None) if fill_raw else None
    )
    stroke_w = float(s.get("stroke_width", 2))

    x = float(s.get("x", 0))
    y = float(s.get("y", 0))

    if shape_type == "rectangle":
        w = float(s.get("width", 100))
        h = float(s.get("height", 50))
        rect = fitz.Rect(x, y, x + w, y + h)
        shape.draw_rect(rect)

    elif shape_type == "circle":
        w = float(s.get("width", 60))
        h = float(s.get("height", 60))
        center = fitz.Point(x + w / 2, y + h / 2)
        shape.draw_circle(center, min(w, h) / 2)

    elif shape_type in ("line", "arrow"):
        x2 = float(s.get("x2", x + 100))
        y2 = float(s.get("y2", y))
        shape.draw_line(fitz.Point(x, y), fitz.Point(x2, y2))

        if shape_type == "arrow":
            # Arrowhead — two short lines back-angled 30° from the
            # main segment, drawn from the tip toward the tail.
            angle = math.atan2(y2 - y, x2 - x)
            arrow_len = 12
            a1 = angle + math.radians(150)
            a2 = angle - math.radians(150)
            shape.draw_line(
                fitz.Point(x2, y2),
                fitz.Point(
                    x2 + arrow_len * math.cos(a1),
                    y2 + arrow_len * math.sin(a1),
                ),
            )
            shape.draw_line(
                fitz.Point(x2, y2),
                fitz.Point(
                    x2 + arrow_len * math.cos(a2),
                    y2 + arrow_len * math.sin(a2),
                ),
            )

    shape.finish(color=color, fill=fill_color, width=stroke_w)
    shape.commit(overlay=True)

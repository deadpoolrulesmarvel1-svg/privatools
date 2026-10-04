import fitz  # PyMuPDF

from ..utils.colors import hex_to_rgb_float
from ..utils.cleanup import process_pdf
from ..utils.filenames import temp_output
from ..utils.page_space import markup_quad, settle_rotation


def annotate_pdf(input_path: str, annotations: list) -> str:
    """Add annotations (highlight, underline, strikethrough, note) to a PDF.

    Args:
        annotations: List of dicts with keys:
            - type: 'highlight', 'underline', 'strikethrough', 'note'
            - page: page number (1-indexed); the route refuses one the PDF
              does not have
            - x, y, width, height: region coordinates, in points from the
              top-left corner of the page's visible area (its CropBox), before
              any /Rotate. A negative width or height counts back from x or y;
              the route refuses an empty box. A note is pinned at x, y.
            - color: hex color (optional, default yellow for highlight)
            - text: note text (for 'note' type)

    Highlights, underlines and strikethroughs run along the text under the
    box, the way it reads (markup_quad), and across the page as shown where
    there is no text.
    """
    output_path = temp_output("annotated", "pdf")

    def annotate(doc: fitz.Document) -> None:
        for ann in annotations:
            ann_type = ann.get("type", "highlight")
            pg_num = int(ann.get("page", 1))
            pg_idx = pg_num - 1
            if pg_idx < 0 or pg_idx >= len(doc):
                continue

            page = doc[pg_idx]
            settle_rotation(page)
            x = float(ann.get("x", 0))
            y = float(ann.get("y", 0))
            w = float(ann.get("width", 100))
            h = float(ann.get("height", 14))
            rect = fitz.Rect(x, y, x + w, y + h).normalize()

            # Default yellow for highlight if no/invalid color supplied.
            color = hex_to_rgb_float(ann.get("color", "#ffff00"), default=(1, 1, 0))

            markup = {
                "highlight": page.add_highlight_annot,
                "underline": page.add_underline_annot,
                "strikethrough": page.add_strikeout_annot,
            }.get(ann_type)
            if markup is not None:
                annot = markup(markup_quad(page, rect))
                annot.set_colors(stroke=color)
                annot.update()
            elif ann_type == "note":
                text = ann.get("text", "Note")
                annot = page.add_text_annot(fitz.Point(x, y), text)
                annot.set_colors(stroke=color)
                annot.update()

        doc.save(str(output_path), garbage=4, deflate=True)

    # A locked, damaged or pageless PDF is refused in the standard words; work
    # that fails on a repaired one is refused as damaged, never redone on a
    # rebuild that may have left pages out (utils.cleanup.process_pdf).
    process_pdf(input_path, annotate, rebuild=False)
    return str(output_path)

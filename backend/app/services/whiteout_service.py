import fitz  # PyMuPDF

from ..utils.cleanup import process_pdf
from ..utils.filenames import temp_output
from ..utils.page_space import drawing_unturned


def whiteout_pdf(input_path: str, regions: list) -> str:
    """Cover regions of a PDF page with white boxes (eraser/white-out).

    Args:
        regions: List of dicts with keys: page (1-indexed), x, y, width, height,
            in points from the top-left corner of the page's visible area
            (its CropBox), before any /Rotate the page has. The route refuses
            a page the PDF does not have.
    """
    output_path = temp_output("whiteout", "pdf")

    def cover(doc: fitz.Document) -> None:
        # Group regions by page
        by_page: dict[int, list] = {}
        for r in regions:
            pg = int(r.get("page", 1))
            by_page.setdefault(pg, []).append(r)

        for pg_num, rects in by_page.items():
            pg_idx = pg_num - 1
            if pg_idx < 0 or pg_idx >= len(doc):
                continue
            page = doc[pg_idx]
            with drawing_unturned(page):
                shape = page.new_shape()
                for r in rects:
                    rx = float(r.get("x", 0))
                    ry = float(r.get("y", 0))
                    rw = float(r.get("width", 50))
                    rh = float(r.get("height", 20))
                    rect = fitz.Rect(rx, ry, rx + rw, ry + rh)
                    shape.draw_rect(rect)
                shape.finish(color=(1, 1, 1), fill=(1, 1, 1))
                shape.commit(overlay=True)

        doc.save(str(output_path), garbage=4, deflate=True)

    # A locked, damaged or pageless PDF is refused in the standard words; work
    # that fails on a repaired one is refused as damaged, never redone on a
    # rebuild that may have left pages out (utils.cleanup.process_pdf).
    process_pdf(input_path, cover, rebuild=False)
    return str(output_path)

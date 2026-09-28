import math

import fitz  # PyMuPDF

from ..utils.cleanup import open_pdf_document
from ..utils.exceptions import ProcessingError
from ..utils.filenames import temp_output

# A4 landscape dimensions in points (72 dpi)
A4_W = 842  # 297mm
A4_H = 595  # 210mm


def nup(input_path: str, pages_per_sheet: int = 2) -> str:
    output_path = temp_output("nup", "pdf")

    pages_per_sheet = max(1, pages_per_sheet)
    cols = math.ceil(math.sqrt(pages_per_sheet))
    rows = math.ceil(pages_per_sheet / cols)

    src = open_pdf_document(input_path)  # a PDF without pages: 400 "This PDF has no pages."
    dst = fitz.open()
    try:
        cell_w = A4_W / cols
        cell_h = A4_H / rows

        for sheet_start in range(0, len(src), pages_per_sheet):
            # Create a new landscape A4 page
            page = dst.new_page(width=A4_W, height=A4_H)
            batch = list(
                range(sheet_start, min(sheet_start + pages_per_sheet, len(src)))
            )

            for i, pg_idx in enumerate(batch):
                col = i % cols
                row = i // cols

                # Target rectangle for this cell
                x0 = col * cell_w
                y0 = row * cell_h
                x1 = x0 + cell_w
                y1 = y0 + cell_h
                target_rect = fitz.Rect(x0, y0, x1, y1)

                # Show the source page in the target rectangle (auto-scales).
                page.show_pdf_page(target_rect, src, pg_idx)

        if len(dst) == 0:
            raise ProcessingError("No pages found in PDF")

        dst.save(str(output_path))
    finally:
        dst.close()
        src.close()

    return str(output_path)

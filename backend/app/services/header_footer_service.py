"""Add header/footer using PyMuPDF direct text insertion."""
import fitz  # PyMuPDF

from ..utils.cleanup import process_pdf
from ..utils.filenames import temp_output


def add_header_footer(
    input_path: str,
    header_text: str = "",
    footer_text: str = "",
    font_size: int = 10,
) -> str:
    output_path = temp_output("headerfooter", "pdf")

    def add(doc: fitz.Document) -> None:
        margin = 20

        for page in doc:
            rect = page.rect
            w, h = rect.width, rect.height

            if header_text:
                page.insert_text(
                    fitz.Point(w / 2, margin + font_size),
                    header_text,
                    fontsize=font_size,
                    fontname="helv",
                    color=(0, 0, 0),
                )

            if footer_text:
                page.insert_text(
                    fitz.Point(w / 2, h - margin),
                    footer_text,
                    fontsize=font_size,
                    fontname="helv",
                    color=(0, 0, 0),
                )

        doc.save(str(output_path), garbage=4, deflate=True)

    # A locked, damaged or pageless PDF is refused in the standard words; work
    # that fails on a repaired one is refused as damaged, never redone on a
    # rebuild that may have left pages out (utils.cleanup.process_pdf).
    process_pdf(input_path, add, rebuild=False)
    return str(output_path)

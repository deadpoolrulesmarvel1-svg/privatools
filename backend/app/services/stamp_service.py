import fitz  # PyMuPDF

from ..utils.cleanup import process_pdf
from ..utils.exceptions import ValidationError
from ..utils.filenames import temp_output
from ..utils.page_range import parse_page_range


# Available stamp presets
STAMP_PRESETS = {
    "confidential": {"text": "CONFIDENTIAL", "color": (1, 0, 0)},
    "draft": {"text": "DRAFT", "color": (0.5, 0.5, 0.5)},
    "approved": {"text": "APPROVED", "color": (0, 0.6, 0)},
    "final": {"text": "FINAL", "color": (0, 0, 0.8)},
    "copy": {"text": "COPY", "color": (0.6, 0, 0.6)},
    "void": {"text": "VOID", "color": (1, 0, 0)},
    "sample": {"text": "SAMPLE", "color": (0, 0.5, 0.5)},
    "not_approved": {"text": "NOT APPROVED", "color": (1, 0, 0)},
}


def stamp_pdf(input_path: str, stamp_type: str = "confidential",
              custom_text: str | None = None, opacity: float = 0.3,
              position: str = "center", pages: str = "all") -> str:
    """Add a stamp to PDF pages using PyMuPDF."""
    output_path = temp_output("stamped", "pdf")

    # Get stamp config
    if stamp_type == "custom" and custom_text:
        text = custom_text.upper()
        color = (1, 0, 0)
    elif stamp_type in STAMP_PRESETS:
        preset = STAMP_PRESETS[stamp_type]
        text = preset["text"]
        color = preset["color"]
    else:
        text = "CONFIDENTIAL"
        color = (1, 0, 0)

    # Apply opacity by blending color toward white
    r = color[0] + (1 - color[0]) * (1 - opacity)
    g = color[1] + (1 - color[1]) * (1 - opacity)
    b = color[2] + (1 - color[2]) * (1 - opacity)
    faded_color = (r, g, b)

    def stamp(doc) -> None:
        total = len(doc)
        # The shared parser, as Rotate PDF uses it: "all", "1,3,5-8",
        # "8-", "9-end"; blank means every page. A page the PDF does not
        # have, or a typing mistake, is refused with the parser's words. It
        # used to stamp every page instead, with a 200. A ValidationError,
        # not the parser's ValueError: process_pdf would count that as damage
        # on a file MuPDF had to repair.
        try:
            page_indices = parse_page_range(pages or "all", total, allow_empty=True)
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc
        if not page_indices:
            page_indices = list(range(total))

        for pg_idx in page_indices:
            page = doc[pg_idx]
            rect = page.rect
            cx, cy = rect.width / 2, rect.height / 2

            # Font size based on page width and text length
            font_size = min(rect.width / (len(text) * 0.55), 72)

            tw = fitz.get_text_length(text, fontname="helv", fontsize=font_size)

            if position == "diagonal":
                # PyMuPDF only supports 0/90/180/270 — use center for diagonal
                text_point = fitz.Point(cx - tw / 2, cy + font_size / 3)
                rotate = 0
            elif position == "top":
                text_point = fitz.Point(cx - tw / 2, rect.height * 0.12)
                rotate = 0
            elif position == "bottom":
                text_point = fitz.Point(cx - tw / 2, rect.height * 0.92)
                rotate = 0
            else:  # center
                text_point = fitz.Point(cx - tw / 2, cy + font_size / 3)
                rotate = 0

            page.insert_text(
                text_point,
                text,
                fontsize=font_size,
                fontname="helv",
                color=faded_color,
                rotate=rotate,
                overlay=True,
            )

        doc.save(str(output_path), garbage=4, deflate=True)

    # A PDF that is damaged, needs a password or has no pages is a 400 that
    # says so, and so is one whose damage stops the stamping part-way: never
    # stamped again on a rebuild, which could move the pages it names.
    process_pdf(input_path, stamp, rebuild=False)
    return str(output_path)

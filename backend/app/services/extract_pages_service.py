import pikepdf

from ..utils.pdf_accessibility import (
    preserve_document_properties,
    preserve_structure_tree,
)

from ..utils.cleanup import safe_open_pdf
from ..utils.exceptions import ValidationError
from ..utils.filenames import temp_output
from ..utils.page_range import parse_page_range


# Kept as a module-level export so existing route tests that import
# `parse_page_ranges` from this module keep working.
def parse_page_ranges(pages_str: str, total_pages: int) -> list[int]:
    """Compatibility shim — delegates to utils.page_range.parse_page_range."""
    return parse_page_range(pages_str, total_pages, allow_empty=True)


def extract_pages(input_path: str, pages_str: str) -> str:
    output_path = temp_output("extracted", "pdf")

    with safe_open_pdf(input_path) as pdf:
        total = len(pdf.pages)
        indices = parse_page_range(pages_str, total, allow_empty=True)
        if not indices:
            raise ValidationError("No valid pages specified")

        with pikepdf.Pdf.new() as new_pdf:
            for idx in indices:
                new_pdf.pages.append(pdf.pages[idx])
            # Pdf.new() starts from an empty catalog, so /Lang, the title and
            # /ViewerPreferences are dropped unless carried over explicitly.
            preserve_document_properties(pdf, new_pdf)
            # Must run after the pages are appended: that is what populates the
            # object map letting each struct element's /Pg resolve to the page
            # already in new_pdf instead of a duplicate.
            preserve_structure_tree(pdf, new_pdf)
            new_pdf.save(str(output_path))

    return str(output_path)

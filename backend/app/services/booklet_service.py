import pikepdf

from ..utils.cleanup import safe_open_pdf
from ..utils.filenames import temp_output


def make_booklet(input_path: str) -> str:
    """Rearrange pages for booklet printing (saddle-stitch).

    For a document of N pages, pages are ordered so that when printed
    double-sided and folded in half, they form a booklet.
    Page count is padded to a multiple of 4 with blank pages.
    """
    output_path = temp_output("booklet", "pdf")

    with safe_open_pdf(input_path) as pdf:
        n = len(pdf.pages)
        if n == 0:
            # An empty source would otherwise silently produce a 0-page booklet
            # (and the MediaBox lookup below assumes at least one page).
            raise ValueError("Cannot create a booklet from an empty PDF")
        # Pad to multiple of 4
        while n % 4 != 0:
            blank = pikepdf.Page(pikepdf.Dictionary(
                Type=pikepdf.Name.Page,
                MediaBox=pdf.pages[0].MediaBox,
                Resources=pikepdf.Dictionary(),
            ))
            pdf.pages.append(blank)
            n += 1

        # Build booklet order
        order = []
        for i in range(n // 2):
            if i % 2 == 0:
                order.append(n - 1 - i)
                order.append(i)
            else:
                order.append(i)
                order.append(n - 1 - i)

        with pikepdf.Pdf.new() as new_pdf:
            for idx in order:
                new_pdf.pages.append(pdf.pages[idx])
            new_pdf.save(str(output_path))

    return str(output_path)

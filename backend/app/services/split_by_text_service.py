"""Split a PDF at every page containing a search term.

Each chunk runs from the first page (or the previous split point) up to
the page just BEFORE the next match. Returns a zip of the chunks named
part1.pdf, part2.pdf, …
"""

from __future__ import annotations

import re
import zipfile

import pikepdf

from ..utils.cleanup import _DAMAGED_PDF, open_pdf_document, open_pikepdf
from ..utils.exceptions import PdfCorruptError, ValidationError
from ..utils.filenames import temp_output
from ..utils.page_removal import PageCopier, WorkBudget, prune_to_page_tree


def split_by_text(input_path: str, search: str, case_sensitive: bool = False) -> str:
    if not search or not search.strip():
        raise ValidationError("search text cannot be empty")

    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = re.compile(re.escape(search.strip()), flags)

    # A locked, unreadable or pageless PDF gets open_pdf_document's 400.
    src = open_pdf_document(input_path)
    try:
        n = len(src)

        # Find all page indices where the term appears.
        match_indices: list[int] = []
        for i in range(n):
            if pattern.search(src[i].get_text()):
                match_indices.append(i)
    finally:
        src.close()

    if not match_indices:
        raise ValidationError(f"Search term '{search}' not found in any page")

    # Build chunks: each chunk starts at a match (or page 0 for the first
    # chunk if the first match is not on page 0) and ends just before the
    # next match. Drop any leading pages that come before the first match —
    # they're not part of any chunk by definition of "split at the term".
    # Convention: include all pages, with the first chunk covering pages
    # 0..first_match-1 IF the user wants the pre-match prefix kept. We do
    # include it for completeness (label "part1" = before first match).
    boundaries: list[tuple[int, int]] = []
    cursor = 0
    for m in match_indices:
        if m > cursor:
            boundaries.append((cursor, m))
        cursor = m
    boundaries.append((cursor, n))

    pdf = open_pikepdf(input_path)
    chunk_paths: list = []
    try:
        if len(pdf.pages) != n:
            # MuPDF searched the pages and qpdf copies them: of a damaged file
            # they can recover different pages (4 and 2 of a PDF cut short),
            # and the parts would be cut at pages qpdf does not have.
            raise PdfCorruptError(_DAMAGED_PDF)
        copier = PageCopier(pdf, budget=WorkBudget.for_files("split-by-text", input_path))
        for idx, (start, end) in enumerate(boundaries, start=1):
            with pikepdf.Pdf.new() as chunk:
                copier.copy(chunk, range(start, end))
                # The other parts' pages must not ride along with this part's
                # links, form fields and threads.
                chunk_out = temp_output(f"split_text_part{idx}", "pdf")
                prune_to_page_tree(chunk, budget=copier.budget).save(str(chunk_out))
            chunk_paths.append(chunk_out)
    finally:
        pdf.close()

    zip_path = temp_output("split_text", "zip")
    with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as z:
        for i, p in enumerate(chunk_paths, start=1):
            z.write(str(p), arcname=f"part{i}.pdf")

    # Best-effort cleanup of intermediate chunk files
    for p in chunk_paths:
        try:
            p.unlink()
        except OSError:
            pass

    return str(zip_path)

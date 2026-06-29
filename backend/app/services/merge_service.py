"""Merge PDFs with optional per-file page ranges (Smallpdf-style).

Inputs are processed in the order they appear in `input_paths` — FastAPI
preserves the multipart upload order, so the merged PDF respects what
the user dragged into the UI. We deliberately avoid `set()`-based
de-duplication or any sorted iteration that could shuffle the order.
"""

from __future__ import annotations

import logging
import os
import time
from typing import List, Optional, Sequence

import pikepdf

from ..utils.cleanup import ensure_temp_dir, safe_open_pdf
from ..utils.filenames import temp_output
from ..utils.page_range import parse_page_range

logger = logging.getLogger(__name__)


def _parse_page_range(spec: str, total_pages: int) -> List[int]:
    """Thin wrapper around the shared parser so callers keep the old name."""
    return parse_page_range(spec, total_pages)


def merge_pdfs(
    input_paths: Sequence[str],
    page_ranges: Optional[Sequence[Optional[str]]] = None,
) -> str:
    """Merge PDFs. If `page_ranges` is provided it must be the same length as
    `input_paths`; each entry is either None / 'all' (include all pages) or
    a Smallpdf-style range string like '1-3,5,7-end'.
    """
    ensure_temp_dir()
    started = time.monotonic()
    if page_ranges is not None and len(page_ranges) != len(input_paths):
        raise ValueError(
            f"page_ranges length ({len(page_ranges)}) must match input file count ({len(input_paths)})."
        )

    total_input_bytes = 0
    for p in input_paths:
        try:
            total_input_bytes += os.path.getsize(p)
        except OSError:
            pass
    logger.info(
        "merge: start files=%d total_input_bytes=%d", len(input_paths), total_input_bytes,
    )

    dst = pikepdf.Pdf.new()
    total_pages_out = 0
    try:
        for idx, path in enumerate(input_paths):
            with safe_open_pdf(path) as src:
                total = len(src.pages)
                spec = (page_ranges[idx] if page_ranges is not None else None)
                if spec is None or (isinstance(spec, str) and spec.strip().lower() in ("", "all")):
                    dst.pages.extend(src.pages)
                    total_pages_out += total
                else:
                    indices = _parse_page_range(spec, total)
                    for i in indices:
                        dst.pages.append(src.pages[i])
                    total_pages_out += len(indices)

        # Unique per-request path (UUID) — a fixed "merged.pdf" over the shared
        # temp dir let concurrent /merge requests clobber each other's output
        # (cross-user PDF leak + corrupt downloads). The route sets the
        # user-facing download filename separately, so this is transparent.
        output = temp_output("merged", "pdf")
        dst.save(str(output))
    finally:
        # pikepdf.Pdf doesn't have a true close() in all builds, but we drop
        # the handle so the underlying file descriptors release promptly.
        try:
            dst.close()
        except AttributeError:
            pass

    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        out_size = os.path.getsize(output)
    except OSError:
        out_size = 0
    logger.info(
        "merge: done files=%d pages=%d duration_ms=%d output_bytes=%d",
        len(input_paths), total_pages_out, duration_ms, out_size,
    )
    return str(output)

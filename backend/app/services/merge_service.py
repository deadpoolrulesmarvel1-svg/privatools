"""Merge PDFs with optional per-file page ranges (Smallpdf-style)."""

from __future__ import annotations

from typing import List, Optional, Sequence

import pikepdf

from ..utils.cleanup import ensure_temp_dir, get_temp_path, safe_open_pdf


def _parse_page_range(spec: str, total_pages: int) -> List[int]:
    """Convert "1-3,5,7-end" into a 0-indexed page list, validated against
    total_pages. Raises ValueError on syntax / out-of-bounds errors.
    """
    spec = (spec or "").strip().lower()
    if not spec or spec == "all":
        return list(range(total_pages))

    out: List[int] = []
    seen: set[int] = set()
    for part in spec.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            start_raw, end_raw = (x.strip() for x in token.split("-", 1))
            start = 1 if start_raw == "" else _to_page(start_raw, total_pages)
            end = total_pages if end_raw in ("", "end") else _to_page(end_raw, total_pages)
            if start > end:
                raise ValueError(f"Invalid range '{token}': start page must be <= end page.")
            for p in range(start, end + 1):
                if p - 1 not in seen:
                    seen.add(p - 1)
                    out.append(p - 1)
        else:
            p = _to_page(token, total_pages)
            if p - 1 not in seen:
                seen.add(p - 1)
                out.append(p - 1)
    if not out:
        raise ValueError(f"Page range '{spec}' selected zero pages.")
    return out


def _to_page(token: str, total_pages: int) -> int:
    if not token.isdigit():
        raise ValueError(f"Invalid page number '{token}'.")
    p = int(token)
    if p < 1 or p > total_pages:
        raise ValueError(f"Page {p} is out of bounds (PDF has {total_pages} pages).")
    return p


def merge_pdfs(
    input_paths: Sequence[str],
    page_ranges: Optional[Sequence[Optional[str]]] = None,
) -> str:
    """Merge PDFs. If `page_ranges` is provided it must be the same length as
    `input_paths`; each entry is either None / 'all' (include all pages) or
    a Smallpdf-style range string like '1-3,5,7-end'.
    """
    ensure_temp_dir()
    if page_ranges is not None and len(page_ranges) != len(input_paths):
        raise ValueError(
            f"page_ranges length ({len(page_ranges)}) must match input file count ({len(input_paths)})."
        )

    dst = pikepdf.Pdf.new()
    for idx, path in enumerate(input_paths):
        with safe_open_pdf(path) as src:
            total = len(src.pages)
            spec = (page_ranges[idx] if page_ranges is not None else None)
            if spec is None or (isinstance(spec, str) and spec.strip().lower() in ("", "all")):
                dst.pages.extend(src.pages)
            else:
                indices = _parse_page_range(spec, total)
                for i in indices:
                    dst.pages.append(src.pages[i])

    output = get_temp_path("merged.pdf")
    dst.save(str(output))
    return str(output)

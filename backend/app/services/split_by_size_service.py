"""Split a PDF into chunks bounded by file size.

Original implementation re-serialized the *entire* accumulated chunk on every
page just to measure size — O(n²) memory and time on a 500-page PDF that hit
the boundary near the end. This rewrite serializes incrementally by writing
each candidate chunk to a temp file and only re-checking total size every
SAMPLE_EVERY pages, then trims back if we overshot.
"""

from __future__ import annotations

import os
import uuid
import zipfile
from pathlib import Path

import pikepdf

from ..utils.cleanup import ensure_temp_dir, get_temp_path

# How many pages to add before re-checking the on-disk size. Lower = more
# accurate boundary, higher = less work per chunk. 5 is a good compromise for
# typical mixed-content PDFs (text + a few images per page).
SAMPLE_EVERY = 5
MIN_CHUNK_PAGES = 1


def split_by_size(input_path: str, max_size_mb: float = 10.0) -> str:
    ensure_temp_dir()
    if max_size_mb <= 0:
        raise ValueError("max_size_mb must be > 0")

    max_bytes = int(max_size_mb * 1024 * 1024)
    zip_path = get_temp_path(f"split_size_{uuid.uuid4().hex}.zip")
    chunk_paths: list[Path] = []

    def _save_chunk(pages_for_chunk: list) -> Path:
        out_path = get_temp_path(f"chunk_{uuid.uuid4().hex}.pdf")
        with pikepdf.Pdf.new() as out:
            out.pages.extend(pages_for_chunk)
            out.save(str(out_path))
        return out_path

    try:
        with pikepdf.open(input_path) as src:
            total_pages = len(src.pages)
            if total_pages == 0:
                raise ValueError("Cannot split an empty PDF.")

            chunks: list[list] = []
            current: list = []

            for i, page in enumerate(src.pages):
                current.append(page)
                # Only check disk size every SAMPLE_EVERY pages OR on the last
                # page — keeps the inner loop cheap.
                if (len(current) % SAMPLE_EVERY == 0) or i == total_pages - 1:
                    candidate = _save_chunk(current)
                    sz = os.path.getsize(candidate)

                    if sz > max_bytes and len(current) > MIN_CHUNK_PAGES:
                        # Overshot. Pop pages off the end one at a time and
                        # re-test until we're under the cap (or down to 1 page).
                        candidate.unlink(missing_ok=True)
                        while len(current) > MIN_CHUNK_PAGES:
                            popped = current.pop()
                            candidate = _save_chunk(current)
                            sz = os.path.getsize(candidate)
                            if sz <= max_bytes:
                                break
                            candidate.unlink(missing_ok=True)
                        chunks.append(current)
                        chunk_paths.append(candidate)
                        # Start the next chunk with the page we just popped.
                        current = [popped]  # type: ignore[name-defined]
                    else:
                        # Either still under cap, or we're forced to keep this
                        # single oversized page in its own chunk. Keep going.
                        candidate.unlink(missing_ok=True)

            if current:
                chunks.append(current)
                chunk_paths.append(_save_chunk(current))

            with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
                for idx, path in enumerate(chunk_paths, start=1):
                    zf.write(str(path), f"part_{idx:03d}.pdf")

        return str(zip_path)
    finally:
        for path in chunk_paths:
            path.unlink(missing_ok=True)

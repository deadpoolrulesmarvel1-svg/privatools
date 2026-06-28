import asyncio
import logging
import math
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import nup_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_PAGES_PER_SHEET = (2, 4, 6, 9, 16)
VALID_ORIENTATIONS = {"side", "stack", "horizontal", "vertical"}

# A4 landscape dimensions in points (72 dpi) — must match nup_service constants
_A4_W = 842
_A4_H = 595


def _nup_2up_stack(input_path: str) -> str:
    """Lay out 2 source pages per A4 sheet, stacked vertically (1 column × 2 rows).

    Inlined here (instead of in services/) so the route can implement the new
    `orientation="stack"` knob without touching the shared nup_service.
    """
    import fitz  # PyMuPDF — already a project dependency

    ensure_temp_dir()
    output_path = get_temp_path(f"nup_{uuid.uuid4().hex}.pdf")

    src = fitz.open(input_path)
    if len(src) == 0:
        src.close()
        raise ValueError("PDF has no pages to lay out")

    dst = fitz.open()
    cell_w = _A4_W
    cell_h = _A4_H / 2

    try:
        for sheet_start in range(0, len(src), 2):
            page = dst.new_page(width=_A4_W, height=_A4_H)
            batch = list(range(sheet_start, min(sheet_start + 2, len(src))))
            for i, pg_idx in enumerate(batch):
                # i=0 → top half, i=1 → bottom half (1 col × 2 rows)
                y0 = i * cell_h
                target_rect = fitz.Rect(0, y0, cell_w, y0 + cell_h)
                page.show_pdf_page(target_rect, src, pg_idx)

        dst.save(str(output_path))
    finally:
        dst.close()
        src.close()

    return str(output_path)


@router.post("/nup")
async def nup(
    file: UploadFile = File(...),
    pages_per_sheet: int = Form(2),
    orientation: str = Form("side"),
):
    """Combine multiple PDF pages onto each output sheet (n-up layout).

    `orientation` only matters when `pages_per_sheet == 2`:
      - "side" (default) — 2 columns × 1 row (horizontal side-by-side)
      - "stack"          — 1 column × 2 rows (vertical, stacked)

    The frontend also sends the older "horizontal"/"vertical" aliases; those
    map to "side"/"stack" respectively for backwards-compat.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    if pages_per_sheet not in VALID_PAGES_PER_SHEET:
        raise HTTPException(
            status_code=400,
            detail=f"pages_per_sheet must be one of {', '.join(str(p) for p in VALID_PAGES_PER_SHEET)}",
        )

    # Normalize orientation: accept "side"/"horizontal" → side, "stack"/"vertical" → stack.
    orient_raw = (orientation or "side").strip().lower()
    if orient_raw in ("", "side", "horizontal"):
        orient = "side"
    elif orient_raw in ("stack", "vertical"):
        orient = "stack"
    else:
        raise HTTPException(
            status_code=400,
            detail="orientation must be 'side' or 'stack'",
        )

    ensure_temp_dir()
    temp_path = None
    output_path = None

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        validate_pdf_content(content)
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_path.write_bytes(content)

        # Cheap pre-flight: catch encrypted PDFs before PyMuPDF chokes with
        # the user-hostile "document closed or encrypted" error.
        try:
            import pikepdf
            with pikepdf.open(str(temp_path)):
                pass
        except pikepdf.PasswordError as exc:
            raise HTTPException(
                status_code=400,
                detail="PDF is password-protected — unlock it first",
            ) from exc
        except pikepdf.PdfError as exc:
            raise HTTPException(
                status_code=400,
                detail="PDF appears corrupt or unreadable",
            ) from exc

        if pages_per_sheet == 2 and orient == "stack":
            output_path = _nup_2up_stack(str(temp_path))
        else:
            # All other layouts (2-side / 4 / 6 / 9 / 16) go through the shared service.
            output_path = await asyncio.to_thread(nup_service.nup, str(temp_path), pages_per_sheet=pages_per_sheet)

        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)

        # Build a descriptive download filename: <stem>_<n>up_<orient>.pdf when
        # orientation is meaningful (2-up only), else <stem>_<n>up.pdf.
        stem = safe_stem(file.filename)
        if pages_per_sheet == 2:
            download_name = f"{stem}_2up_{orient}.pdf"
        else:
            download_name = f"{stem}_{pages_per_sheet}up.pdf"

        return FileResponse(
            path=output_path,
            filename=download_name,
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        raise
    except ValueError as exc:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF is password-protected — unlock it first",
            ) from exc
        if "corrupt" in msg or "damaged" in msg or "cannot open" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF appears corrupt or unreadable",
            ) from exc
        logger.exception("Unexpected error in /nup")
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..utils.route_helpers import pdf_page_count, require_item_pages
from ..services import edit_pdf_service
from ..utils.pdf_errors import pdf_read_error

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_EDITS = 5000
VALID_EDIT_TYPES = {"text", "rectangle", "circle", "line", "arrow", "pen", "highlight", "image"}


def _sanitize_edits(edits_list: list) -> list:
    """Filter the edits list to entries the service can handle.

    Returns a new list containing only entries that have:
      - a dict shape
      - a recognised edit "type"
      - numeric placement fields (or the chance to fall back to defaults)

    Each entry is wrapped in its own try/except so a single malformed edit
    doesn't poison the rest of the request. We log the rejections so the dev
    console still surfaces them.
    """
    cleaned: list[dict] = []
    for i, edit in enumerate(edits_list):
        try:
            if not isinstance(edit, dict):
                logger.warning("edit-pdf: dropping non-object edit at index %d", i)
                continue
            edit_type = str(edit.get("type", "")).lower()
            if edit_type not in VALID_EDIT_TYPES:
                logger.warning(
                    "edit-pdf: dropping edit #%d with unknown type %r", i, edit_type
                )
                continue
            # Probe required numerics so a string like "abc" doesn't crash the
            # whole canvas during the actual render pass.
            for key in ("x", "y", "x1", "y1", "x2", "y2", "width", "height", "radius",
                        "font_size", "opacity", "stroke_width"):
                if key in edit and edit[key] not in (None, ""):
                    try:
                        float(edit[key])
                    except (TypeError, ValueError):
                        raise ValueError(f"field {key!r} is not numeric")
            if edit_type == "pen" and not isinstance(edit.get("points"), list):
                raise ValueError("pen edit needs a points list")
            cleaned.append(edit)
        except Exception as exc:  # noqa: BLE001 — defensive, we log and drop
            logger.warning(
                "edit-pdf: dropping edit #%d (%s)", i, exc
            )
            continue
    return cleaned


EDITS_DESCRIPTION = (
    "JSON array of edits. Each has `type` (text, rectangle, circle, line, arrow, pen, highlight "
    "or image) and `page`, counted from 1 (a page the PDF does not have is refused with 400). "
    "Positions (`x`, `y`, `x1`, `y1`, `x2`, `y2` and pen `points`) are in points (1/72 inch) "
    "from the bottom-left corner of the page as it is shown: its visible area (CropBox), after "
    "any /Rotate setting it has. Text and images stay upright as the page is shown."
)


@router.post("/edit-pdf")
async def edit_pdf(
    file: UploadFile = File(...),
    edits: str = Form(..., description=EDITS_DESCRIPTION),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        edits_list = json.loads(edits)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid edits JSON") from exc

    if not isinstance(edits_list, list):
        raise HTTPException(status_code=400, detail="Edits must be a JSON array")
    if len(edits_list) == 0:
        raise HTTPException(status_code=400, detail="No edits provided")
    if len(edits_list) > MAX_EDITS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many edits ({len(edits_list)} > {MAX_EDITS})",
        )

    cleaned_edits = _sanitize_edits(edits_list)
    if not cleaned_edits:
        raise HTTPException(
            status_code=400,
            detail="No valid edits to apply — check the edit types and coordinates",
        )

    ensure_temp_dir()
    temp_pdf = None
    output_path = None

    try:
        validate_pdf_content(content)
        temp_pdf = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_pdf.write_bytes(content)

        # An edit on a page the PDF does not have used to be skipped, and the
        # visitor got an unchanged file back. Numbered as the caller sent them.
        page_count = await pdf_page_count(temp_pdf)
        if page_count == 0:
            raise HTTPException(status_code=400, detail="PDF has no pages")
        require_item_pages(edits_list, page_count, noun="Edit")

        output_path = await asyncio.to_thread(edit_pdf_service.edit_pdf, str(temp_pdf), cleaned_edits)
        cleanup = BackgroundTask(remove_files, str(temp_pdf), output_path)
        return FileResponse(
            path=output_path,
            filename="edited.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_pdf)] if temp_pdf is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = ([str(temp_pdf)] if temp_pdf is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        if (pdf_error := pdf_read_error(e)) is not None:
            raise HTTPException(status_code=pdf_error[0], detail=pdf_error[1]) from e
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

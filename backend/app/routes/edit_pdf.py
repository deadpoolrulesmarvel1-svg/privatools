import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import edit_pdf_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_EDITS = 5000
VALID_EDIT_TYPES = {"text", "rectangle", "circle", "line", "highlight", "image"}


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
            cleaned.append(edit)
        except Exception as exc:  # noqa: BLE001 — defensive, we log and drop
            logger.warning(
                "edit-pdf: dropping edit #%d (%s)", i, exc
            )
            continue
    return cleaned


@router.post("/edit-pdf")
async def edit_pdf(
    file: UploadFile = File(...),
    edits: str = Form(...),
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
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

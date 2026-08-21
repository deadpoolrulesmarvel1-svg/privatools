"""Visible watermark removal — detect, then apply.

Two round-trips on purpose. A false positive here deletes content the user
wanted and they may not notice for months, so detection always produces a
preview the user confirms; there is no one-shot auto-remove. The preview IS the
feature.

Stateless between the two calls: `apply` re-runs detection on the re-uploaded
file and matches by candidate id. That costs one extra parse and avoids any
server-side session, which suits a product that stores nothing.
"""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..rate_limit import EXPENSIVE_RATE_LIMIT, limiter
from ..services.watermark_detect_service import detect_watermarks
from ..services.image_watermark_remove_service import remove_image_watermark
from ..services.watermark_remove_service import remove_watermarks
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_image_content,
    validate_pdf_content,
)
from ..utils.concurrency import run_bounded
from ..utils.route_helpers import no_store_headers, safe_stem, stream_upload_to_disk

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/remove-watermark/detect")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def detect_watermark(request: Request, file: UploadFile = File(...)):
    """Report watermark candidates. Never modifies the document."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")

    ensure_temp_dir()
    temp_path = get_temp_path(f"wmdetect_{uuid.uuid4().hex}.pdf")
    try:
        await stream_upload_to_disk(file, temp_path, validate=validate_pdf_content)
        result = await run_bounded(detect_watermarks, str(temp_path))
        return JSONResponse(result, headers=no_store_headers())
    except HTTPException:
        remove_files(str(temp_path))
        raise
    except Exception as exc:  # noqa: BLE001 — global handler sanitizes 5xx
        remove_files(str(temp_path))
        logger.exception("watermark detection failed")
        raise HTTPException(
            status_code=500, detail="Could not analyse this PDF. Please try again."
        ) from exc
    finally:
        remove_files(str(temp_path))


@router.post("/remove-watermark/apply")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def apply_watermark_removal(
    request: Request,
    file: UploadFile = File(...),
    candidate_ids: str = Form(...),
):
    """Remove the confirmed candidates. `candidate_ids` is a JSON array."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")

    try:
        wanted = json.loads(candidate_ids)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail="candidate_ids must be a JSON array"
        ) from exc
    if not isinstance(wanted, list) or not all(isinstance(x, str) for x in wanted):
        raise HTTPException(status_code=400, detail="candidate_ids must be a JSON array of ids")
    if not wanted:
        raise HTTPException(status_code=400, detail="Select at least one watermark to remove")

    ensure_temp_dir()
    temp_path = get_temp_path(f"wmapply_{uuid.uuid4().hex}.pdf")
    output_path = None
    try:
        await stream_upload_to_disk(file, temp_path, validate=validate_pdf_content)
        output_path = await run_bounded(remove_watermarks, str(temp_path), wanted)
        stem = safe_stem(file.filename, "document")
        return FileResponse(
            output_path,
            media_type="application/pdf",
            filename=f"{stem}_no_watermark.pdf",
            background=BackgroundTask(remove_files, str(temp_path), output_path),
            headers=no_store_headers(),
        )
    except HTTPException:
        remove_files(str(temp_path), *([output_path] if output_path else []))
        raise
    except Exception:
        remove_files(str(temp_path), *([output_path] if output_path else []))
        raise


@router.post("/remove-image-watermark")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def remove_image_watermark_route(
    request: Request,
    file: UploadFile = File(...),
    regions: str = Form(...),
    method: str = Form("telea"),
):
    """Inpaint the selected regions out of an image.

    `regions` is a JSON array of {x, y, width, height} in image pixels — the
    boxes the user dragged over the watermark.
    """
    try:
        parsed = json.loads(regions)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="regions must be a JSON array") from exc
    if not isinstance(parsed, list) or not parsed:
        raise HTTPException(status_code=400, detail="Select the watermark area to remove")

    ensure_temp_dir()
    suffix = (file.filename or "image.png").rsplit(".", 1)[-1].lower()
    if suffix not in ("png", "jpg", "jpeg", "webp", "bmp"):
        suffix = "png"
    temp_path = get_temp_path(f"imgwm_{uuid.uuid4().hex}.{suffix}")
    output_path = None
    try:
        await stream_upload_to_disk(file, temp_path, validate=validate_image_content)
        output_path = await run_bounded(
            remove_image_watermark, str(temp_path), parsed, method
        )
        stem = safe_stem(file.filename, "image")
        return FileResponse(
            output_path,
            media_type=f"image/{'jpeg' if suffix in ('jpg', 'jpeg') else suffix}",
            filename=f"{stem}_no_watermark.{suffix}",
            background=BackgroundTask(remove_files, str(temp_path), output_path),
            headers=no_store_headers(),
        )
    except HTTPException:
        remove_files(str(temp_path), *([output_path] if output_path else []))
        raise
    except Exception:
        remove_files(str(temp_path), *([output_path] if output_path else []))
        raise

"""Shared upload-tool lifecycle.

~130 route handlers hand-roll the same sequence — validate the upload, stream it
to a temp file, run the (sync) service off the event loop, return a FileResponse
that cleans the temps in the background, and map errors — and every divergence
bug (the `/tmp` split, leaked exception strings, a missed offload, a forgotten
cleanup path) was born from a copy that drifted. `process_pdf_upload` is the one
correct implementation of that lifecycle for the common single-PDF-in,
single-file-out tool, so a fix lands everywhere at once.

A handler that takes extra form params binds them with a closure:

    @router.post("/grayscale")
    async def grayscale_pdf(file: UploadFile = File(...)):
        return await process_pdf_upload(
            file, grayscale_service.convert_to_grayscale, output_filename="grayscale.pdf",
        )

    @router.post("/flatten")
    async def flatten_pdf(file: UploadFile = File(...), scope: str = Form("all")):
        # ...validate scope...
        return await process_pdf_upload(
            file, lambda p: flatten_service.flatten(p, scope=scope),
            output_filename="flattened.pdf",
        )
"""

from __future__ import annotations

import logging
import uuid
from typing import Callable

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from .cleanup import ensure_temp_dir, get_temp_path, remove_files, validate_pdf_content
from .concurrency import run_bounded
from .route_helpers import stream_upload_to_disk

logger = logging.getLogger(__name__)


async def process_pdf_upload(
    file: UploadFile,
    run: Callable[[str], str],
    *,
    output_filename: str,
    media_type: str = "application/pdf",
    response_headers: dict[str, str] | None = None,
    input_suffix: str = ".pdf",
    validate: Callable[[bytes], None] | None = validate_pdf_content,
) -> FileResponse:
    """Validate → stream the upload to a temp file (early magic-byte check) → run
    ``run(temp_path)`` off the event loop under the heavy-work gate → return the
    result as a FileResponse that deletes both temps in the background.

    ``run`` is a callable taking the temp input path and returning the output
    path (sync — it's offloaded via run_bounded). Bind any extra params with a
    lambda. On any error the temp + partial output are removed and a generic 500
    is raised (the global handler sanitizes the message); HTTPExceptions raised
    inside ``run`` (or validation) pass through with their status/detail.
    """
    if not (file.filename or "").lower().endswith(input_suffix):
        kind = input_suffix.lstrip(".").upper()
        raise HTTPException(status_code=400, detail=f"Uploaded file is not a {kind}")

    ensure_temp_dir()
    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}{input_suffix}")
    output_path: str | None = None
    try:
        await stream_upload_to_disk(file, temp_path, validate=validate)
        output_path = await run_bounded(run, str(temp_path))
        cleanup = BackgroundTask(
            remove_files, str(temp_path), output_path
        )
        return FileResponse(
            path=output_path,
            filename=output_filename,
            media_type=media_type,
            background=cleanup,
            headers=response_headers,
        )
    except HTTPException:
        remove_files(str(temp_path), *([output_path] if output_path else []))
        raise
    except Exception as exc:  # noqa: BLE001 — map to a generic 500 (sanitized globally)
        remove_files(str(temp_path), *([output_path] if output_path else []))
        logger.exception("upload tool failed: %s", getattr(run, "__name__", "run"))
        raise HTTPException(
            status_code=500, detail="Processing failed. Please try again."
        ) from exc

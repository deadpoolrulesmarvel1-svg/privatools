import asyncio
import logging
import os
import uuid
import zipfile
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from ..services import compress_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import read_upload, safe_filename, safe_stem, unique_arcname
from ..utils.concurrency import run_bounded

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_LEVELS = {
    # Intensity vocabulary (what the original UI sends).
    "light", "recommended", "extreme", "custom",
    # Purpose vocabulary — you know you are emailing something; you should
    # not have to translate that into a quality percentage.
    "email", "print", "archive", "web",
}
MAX_FILES = 100
# Enough headroom for any real attachment limit; guards the target search
# from a nonsense value that would just burn passes.
MAX_TARGET_MB = 500.0


@router.post("/compress")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def compress_pdf(
    request: Request,
    files: List[UploadFile] = File(...),
    level: str = Form("recommended"),
    jpeg_quality: int | None = Form(None, ge=15, le=95),
    max_image_dim: int | None = Form(None, ge=300, le=4000),
    target_size_mb: float | None = Form(None, gt=0),
):
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one PDF file")
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Please upload at most {MAX_FILES} PDF files",
        )
    if level not in VALID_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"level must be one of: {', '.join(sorted(VALID_LEVELS))}",
        )
    if level == "custom" and jpeg_quality is None and max_image_dim is None and target_size_mb is None:
        raise HTTPException(
            status_code=400,
            detail="level=custom requires jpeg_quality, max_image_dim or target_size_mb",
        )
    if target_size_mb is not None and target_size_mb > MAX_TARGET_MB:
        raise HTTPException(
            status_code=400,
            detail=f"target_size_mb must be {MAX_TARGET_MB:g} or less",
        )

    ensure_temp_dir()
    input_paths: list[str] = []
    output_paths: list[str] = []

    try:
        for file in files:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename or 'unknown'} is not a PDF",
                )
            content = await read_upload(file, label=file.filename or "unknown")
            validate_pdf_content(content)
            temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            temp_path.write_bytes(content)
            input_paths.append(str(temp_path))

        total_original = 0
        total_compressed = 0
        target_reports: list[dict] = []
        for inp in input_paths:
            total_original += os.path.getsize(inp)
            try:
                if target_size_mb is not None:
                    # "Make this fit under 10 MB" is the question people
                    # actually have. ihatepdf.cv answers it free; Smallpdf and
                    # iLovePDF put it behind a paid tier.
                    out, target_info = await run_bounded(
                        compress_service.compress_to_target,
                        inp,
                        int(target_size_mb * 1024 * 1024),
                    )
                    target_reports.append(target_info)
                else:
                    out = await run_bounded(
                        compress_service.compress_pdf,
                        inp,
                        level=level,
                        jpeg_quality_override=jpeg_quality,
                        max_image_dim_override=max_image_dim,
                    )
            except ValueError as exc:
                msg = str(exc).lower()
                if "password" in msg or "encrypted" in msg:
                    raise HTTPException(
                        status_code=400,
                        detail="PDF is password-protected — unlock it first",
                    ) from exc
                if "corrupt" in msg or "damaged" in msg:
                    raise HTTPException(
                        status_code=400,
                        detail="PDF appears corrupt or unreadable",
                    ) from exc
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            total_compressed += os.path.getsize(out)
            output_paths.append(out)

        # Single file: return the PDF directly with a meaningful name
        if len(output_paths) == 1:
            stem = safe_stem(files[0].filename)
            cleanup = BackgroundTask(remove_files, *input_paths, *output_paths)
            return FileResponse(
                path=output_paths[0],
                filename=f"{stem}_compressed.pdf",
                media_type="application/pdf",
                background=cleanup,
                headers={
                    "X-Original-Size": str(total_original),
                    "X-Compressed-Size": str(total_compressed),
                    # False when even the most aggressive pass overshoots. Said
                    # out loud rather than silently handing back a file that
                    # misses the limit the user asked for.
                    **({"X-Target-Met": str(target_reports[0]["met"]).lower()}
                       if target_reports else {}),
                },
            )

        # Multiple files: return a ZIP
        zip_path = str(get_temp_path(f"compressed_{uuid.uuid4().hex}.zip"))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            seen: dict[str, int] = {}
            for i, out in enumerate(output_paths):
                original_name = safe_filename(files[i].filename, f"file_{i+1}.pdf")
                arcname = unique_arcname(f"compressed_{original_name}", seen)
                zf.write(out, arcname)

        cleanup = BackgroundTask(remove_files, *input_paths, *output_paths, zip_path)
        return FileResponse(
            path=zip_path,
            filename="compressed_pdfs.zip",
            media_type="application/zip",
            background=cleanup,
            headers={
                "X-Original-Size": str(total_original),
                "X-Compressed-Size": str(total_compressed),
                **({"X-Target-Met": str(all(r["met"] for r in target_reports)).lower()}
                   if target_reports else {}),
            },
        )
    except HTTPException:
        remove_files(*input_paths, *output_paths)
        raise
    except Exception as exc:
        remove_files(*input_paths, *output_paths)
        logger.exception("Unexpected error in /compress")
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF is password-protected — unlock it first",
            ) from exc
        if "corrupt" in msg or "damaged" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF appears corrupt or unreadable",
            ) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc

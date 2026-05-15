import os
import uuid
import zipfile
import logging
from typing import List
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..utils.route_helpers import safe_filename, read_upload
from ..services import compress_service

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_LEVELS = {"light", "recommended", "extreme", "custom"}
MAX_FILES = 100


@router.post("/compress")
async def compress_pdf(
    files: List[UploadFile] = File(...),
    level: str = Form("recommended"),
    jpeg_quality: int | None = Form(None, ge=15, le=95),
    max_image_dim: int | None = Form(None, ge=300, le=4000),
):
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Please upload at most {MAX_FILES} PDF files")
    if level not in VALID_LEVELS:
        raise HTTPException(status_code=400, detail=f"level must be one of: {', '.join(sorted(VALID_LEVELS))}")
    if level == "custom" and jpeg_quality is None and max_image_dim is None:
        raise HTTPException(
            status_code=400,
            detail="level=custom requires at least one of jpeg_quality or max_image_dim",
        )

    ensure_temp_dir()
    input_paths: list[str] = []
    output_paths: list[str] = []

    try:
        for file in files:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(status_code=400, detail=f"File {file.filename} is not a PDF")
            content = await read_upload(file, label=file.filename or "unknown")
            validate_pdf_content(content)
            temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            temp_path.write_bytes(content)
            input_paths.append(str(temp_path))

        total_original = 0
        total_compressed = 0
        for inp in input_paths:
            total_original += os.path.getsize(inp)
            out = compress_service.compress_pdf(
                inp,
                level=level,
                jpeg_quality_override=jpeg_quality,
                max_image_dim_override=max_image_dim,
            )
            total_compressed += os.path.getsize(out)
            output_paths.append(out)

        # Single file: return the PDF directly
        if len(output_paths) == 1:
            cleanup = BackgroundTask(remove_files, *input_paths, *output_paths)
            return FileResponse(
                path=output_paths[0],
                filename="compressed.pdf",
                media_type="application/pdf",
                background=cleanup,
                headers={
                    "X-Original-Size": str(total_original),
                    "X-Compressed-Size": str(total_compressed),
                },
            )

        # Multiple files: return a ZIP
        zip_path = str(get_temp_path(f"compressed_{uuid.uuid4().hex}.zip"))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for i, out in enumerate(output_paths):
                original_name = safe_filename(files[i].filename, f"file_{i+1}.pdf")
                arcname = f"compressed_{original_name}"
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
            },
        )
    except HTTPException:
        remove_files(*input_paths, *output_paths)
        raise
    except Exception as e:
        remove_files(*input_paths, *output_paths)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

"""Phase 5 routes: merge images, QR code reader."""

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..services import merge_images_service
from ..utils.cleanup import ensure_temp_dir, get_temp_path, remove_files
from ..utils.exceptions import ToolError
from ..utils.route_helpers import read_upload, cleanup_on_error, MAX_SIZE

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_MERGE_FILES = 25
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ALLOWED_DIRECTIONS = {"horizontal", "vertical"}


async def _read_upload(file: UploadFile, *, label: str, max_bytes: int = MAX_SIZE) -> bytes:
    return await read_upload(file, label=label, max_bytes=max_bytes)


def _cleanup_on_error(*paths: str | Path | None) -> None:
    cleanup_on_error(*paths)


# ─── Merge Images ────────────────────────────────────────
@router.post("/merge-images")
async def merge_images(
    files: list[UploadFile] = File(...),
    direction: str = Form("horizontal"),
):
    """Merge multiple images horizontally or vertically."""
    if not files or len(files) < 2:
        raise HTTPException(status_code=400, detail="Please upload at least 2 images")
    if len(files) > MAX_MERGE_FILES:
        raise HTTPException(status_code=400, detail=f"Please upload at most {MAX_MERGE_FILES} images")

    clean_direction = (direction or "").strip().lower()
    if clean_direction not in ALLOWED_DIRECTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"direction must be one of: {', '.join(sorted(ALLOWED_DIRECTIONS))}",
        )

    ensure_temp_dir()
    temp_paths: list[Path] = []
    out = None
    try:
        for upload in files:
            suffix = Path(upload.filename or "").suffix.lower()
            if suffix not in ALLOWED_IMAGE_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail="Only JPG, PNG, WebP, and BMP images are supported",
                )

            content = await _read_upload(upload, label=f"Image '{upload.filename or 'unknown'}'")
            temp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
            temp.write_bytes(content)
            temp_paths.append(temp)

        out = await asyncio.to_thread(
            merge_images_service.merge_images,
            [str(p) for p in temp_paths], clean_direction,
        )
        all_temps = [str(p) for p in temp_paths] + [out]
        cleanup = BackgroundTask(remove_files, *all_temps)
        return FileResponse(
            out, filename="merged.png", media_type="image/png", background=cleanup,
        )
    except ValueError as exc:
        _cleanup_on_error(*temp_paths, out)
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        _cleanup_on_error(*temp_paths, out)
        raise
    except Exception as e:
        _cleanup_on_error(*temp_paths, out)
        logger.exception("merge-images error")
        raise HTTPException(status_code=500, detail="Image merge failed")


# ─── QR Code Reader ──────────────────────────────────────
@router.post("/read-qr")
async def read_qr(file: UploadFile = File(...)):
    """Decode QR codes from an uploaded image."""
    fname = file.filename or ""
    suffix = Path(fname).suffix.lower()
    if suffix not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Please upload an image")

    ensure_temp_dir()
    temp = None
    try:
        content = await _read_upload(file, label="Image file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
        temp.write_bytes(content)

        # Import lazily — pyzbar requires a native libzbar shared library that
        # isn't guaranteed to be installed in every dev environment. Failing at
        # request time (with a clear 503) is far better than crashing the whole
        # app at startup when this single tool isn't reachable.
        try:
            from ..services import qr_reader_service
        except ImportError as exc:
            logger.warning("qr_reader_service unavailable: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="QR code reader is unavailable on this server (missing libzbar)",
            )

        codes = await asyncio.to_thread(qr_reader_service.read_qr, str(temp))
        return JSONResponse({"codes": codes})
    except HTTPException:
        _cleanup_on_error(temp)
        raise
    except ToolError:
        # DependencyError (missing libzbar) etc. carry their own status_code —
        # propagate so the global handler returns 503/400 instead of a generic 500.
        _cleanup_on_error(temp)
        raise
    except Exception as e:
        _cleanup_on_error(temp)
        logger.exception("read-qr error")
        raise HTTPException(status_code=500, detail="QR code reading failed")
    finally:
        # Always clean up the uploaded temp file
        if temp:
            remove_files(str(temp))

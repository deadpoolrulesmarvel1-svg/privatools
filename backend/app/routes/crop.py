import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import crop_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)

# Upper sanity bound. Anything past this is almost certainly a frontend bug —
# the largest standard page (A0) is ~3370 pt.
_MAX_CROP_POINTS = 5000


@router.post("/crop")
async def crop_pdf(
    file: UploadFile = File(...),
    top: float = Form(0.0),
    bottom: float = Form(0.0),
    left: float = Form(0.0),
    right: float = Form(0.0),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    if any(v < 0 for v in (top, bottom, left, right)):
        raise HTTPException(
            status_code=400, detail="Crop values must be non-negative"
        )
    if any(v > _MAX_CROP_POINTS for v in (top, bottom, left, right)):
        raise HTTPException(
            status_code=400,
            detail=f"Crop values must be {_MAX_CROP_POINTS} points or less",
        )

    ensure_temp_dir()
    temp_path = None
    output_path = None

    try:
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        validate_pdf_content(content)
        temp_path.write_bytes(content)

        # Cross-margin sanity: detect cases like left+right >= every page's width.
        # Peek the first page only — pikepdf is cheap to open.
        try:
            import pikepdf
            with pikepdf.open(str(temp_path)) as _peek:
                if len(_peek.pages) == 0:
                    raise HTTPException(status_code=400, detail="PDF has no pages")
                first = _peek.pages[0]
                mb = first.mediabox
                pw = float(mb[2]) - float(mb[0])
                ph = float(mb[3]) - float(mb[1])
                if left + right >= pw:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Left + right margins ({left + right:.1f} pt) exceed "
                            f"the page width ({pw:.1f} pt)"
                        ),
                    )
                if top + bottom >= ph:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Top + bottom margins ({top + bottom:.1f} pt) exceed "
                            f"the page height ({ph:.1f} pt)"
                        ),
                    )
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

        output_path = await asyncio.to_thread(
            crop_service.crop_pdf,
            str(temp_path), top=top, bottom=bottom, left=left, right=right
        )
        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_cropped.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        raise
    except Exception as exc:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        logger.exception("Unexpected error in /crop")
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

import asyncio
import uuid
import zipfile
import logging
from io import BytesIO
from typing import List, Optional

import pikepdf
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..utils.route_helpers import safe_filename, read_upload, unique_arcname
from ..services import protect_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_FILES = 100


def _is_already_encrypted(content: bytes) -> bool:
    """Detect whether a PDF blob is already password-protected without raising.

    Returns True if pikepdf reports the PDF as encrypted, or if it refuses to
    open without a password. Falls back to False on any other error so the
    standard PDF-validation path can produce the friendlier message.
    """
    try:
        with pikepdf.open(BytesIO(content)) as pdf:
            return bool(pdf.is_encrypted)
    except pikepdf.PasswordError:
        return True
    except Exception:
        return False


@router.post("/protect")
async def protect_pdf(
    files: List[UploadFile] = File(...),
    password: str = Form(...),
    owner_password: Optional[str] = Form(None),
    allow_print: bool = Form(True),
    allow_extract: bool = Form(False),
    allow_modify: bool = Form(False),
):
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Please upload at most {MAX_FILES} PDF files")

    clean_password = (password or "").strip()
    if not clean_password:
        raise HTTPException(status_code=400, detail="Password cannot be empty")
    if len(clean_password) > 128:
        raise HTTPException(status_code=400, detail="Password must be 128 characters or fewer")
    clean_owner_password = (owner_password or "").strip() or None
    if clean_owner_password and len(clean_owner_password) > 128:
        raise HTTPException(status_code=400, detail="Owner password must be 128 characters or fewer")

    ensure_temp_dir()
    input_paths: list[str] = []
    output_paths: list[str] = []

    try:
        for file in files:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(status_code=400, detail=f"File {file.filename} is not a PDF")
            content = await read_upload(file, label=file.filename or "unknown")
            validate_pdf_content(content)
            if _is_already_encrypted(content):
                raise HTTPException(
                    status_code=400,
                    detail="This PDF is already password-protected — unlock it first",
                )
            temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            temp_path.write_bytes(content)
            input_paths.append(str(temp_path))

        for inp in input_paths:
            out = await asyncio.to_thread(
                protect_service.protect_pdf,
                inp,
                password=clean_password,
                owner_pw=clean_owner_password,
                allow_print=allow_print,
                allow_extract=allow_extract,
                allow_modify=allow_modify,
            )
            output_paths.append(out)

        # Single file: return the PDF directly
        if len(output_paths) == 1:
            cleanup = BackgroundTask(remove_files, *input_paths, *output_paths)
            return FileResponse(
                path=output_paths[0],
                filename="protected.pdf",
                media_type="application/pdf",
                background=cleanup,
            )

        # Multiple files: return a ZIP
        zip_path = str(get_temp_path(f"protected_{uuid.uuid4().hex}.zip"))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            seen: dict[str, int] = {}
            for i, out in enumerate(output_paths):
                original_name = safe_filename(files[i].filename, f"file_{i+1}.pdf")
                arcname = unique_arcname(f"protected_{original_name}", seen)
                zf.write(out, arcname)

        cleanup = BackgroundTask(remove_files, *input_paths, *output_paths, zip_path)
        return FileResponse(
            path=zip_path,
            filename="protected_pdfs.zip",
            media_type="application/zip",
            background=cleanup,
        )
    except HTTPException:
        remove_files(*input_paths, *output_paths)
        raise
    except Exception as e:
        remove_files(*input_paths, *output_paths)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

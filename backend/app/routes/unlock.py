import asyncio
import uuid
import zipfile
import logging
from io import BytesIO
from typing import List

import pikepdf
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..utils.exceptions import ToolError
from ..utils.route_helpers import safe_filename, read_upload, unique_arcname
from ..services import unlock_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_FILES = 100


def _is_encrypted(content: bytes) -> bool:
    """Return True if the PDF blob is encrypted, False if it opens cleanly."""
    try:
        with pikepdf.open(BytesIO(content)) as pdf:
            return bool(pdf.is_encrypted)
    except pikepdf.PasswordError:
        return True
    except Exception:
        # If pikepdf can't even open it, let the downstream validate path
        # raise the canonical "corrupt PDF" error.
        return False


@router.post("/unlock")
async def unlock_pdf(
    files: List[UploadFile] = File(...),
    password: str = Form(...),
):
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Please upload at most {MAX_FILES} PDF files")

    clean_password = (password or "").strip()
    if not clean_password:
        raise HTTPException(status_code=400, detail="Password cannot be empty")
    if len(clean_password) > 128:
        raise HTTPException(status_code=400, detail="Password must be 128 characters or fewer")

    ensure_temp_dir()
    input_paths: list[str] = []
    output_paths: list[str] = []

    try:
        for file in files:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(status_code=400, detail=f"File {file.filename} is not a PDF")
            content = await read_upload(file, label=file.filename or "unknown")
            validate_pdf_content(content)
            if not _is_encrypted(content):
                raise HTTPException(
                    status_code=400,
                    detail="PDF is not encrypted, nothing to unlock",
                )
            temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            temp_path.write_bytes(content)
            input_paths.append(str(temp_path))

        for inp in input_paths:
            out = await asyncio.to_thread(unlock_service.unlock_pdf, inp, password=clean_password)
            output_paths.append(out)

        # Single file: return the PDF directly
        if len(output_paths) == 1:
            cleanup = BackgroundTask(remove_files, *input_paths, *output_paths)
            return FileResponse(
                path=output_paths[0],
                filename="unlocked.pdf",
                media_type="application/pdf",
                background=cleanup,
            )

        # Multiple files: return a ZIP
        zip_path = str(get_temp_path(f"unlocked_{uuid.uuid4().hex}.zip"))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            seen: dict[str, int] = {}
            for i, out in enumerate(output_paths):
                original_name = safe_filename(files[i].filename, f"file_{i+1}.pdf")
                arcname = unique_arcname(f"unlocked_{original_name}", seen)
                zf.write(out, arcname)

        cleanup = BackgroundTask(remove_files, *input_paths, *output_paths, zip_path)
        return FileResponse(
            path=zip_path,
            filename="unlocked_pdfs.zip",
            media_type="application/zip",
            background=cleanup,
        )
    except HTTPException:
        remove_files(*input_paths, *output_paths)
        raise
    except ToolError:
        # Service-level errors (PdfEncryptedError etc) carry their own status_code
        # and detail string — let the global handler map them. Re-raising here
        # keeps the 400/413/etc semantics instead of getting masked as a 500.
        remove_files(*input_paths, *output_paths)
        raise
    except pikepdf.PasswordError:
        remove_files(*input_paths, *output_paths)
        raise HTTPException(
            status_code=400,
            detail="That password didn't match — double-check it",
        )
    except ValueError as e:
        remove_files(*input_paths, *output_paths)
        msg = str(e).lower()
        if "incorrect password" in msg or "wrong password" in msg or "password" in msg:
            raise HTTPException(
                status_code=400,
                detail="That password didn't match — double-check it",
            )
        raise HTTPException(status_code=400, detail=str(e) or "Could not unlock PDF")
    except Exception as e:
        remove_files(*input_paths, *output_paths)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

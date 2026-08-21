import asyncio
import json
import logging
import uuid
import zipfile
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import bates_numbering_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_filename, safe_stem, unique_arcname

router = APIRouter()
logger = logging.getLogger(__name__)

# 6 positions — matches the spec the frontend BatesUI sends.
VALID_POSITIONS = {
    "bottom-right",
    "bottom-left",
    "bottom-center",
    "top-right",
    "top-left",
    "top-center",
}

MAX_START_NUMBER = 10_000_000   # ~10 million docs is enough for any single load.
MAX_DIGITS = 10
MAX_FILES = 100
MAX_AFFIX_CHARS = 32
MIN_FONT_SIZE = 4
MAX_FONT_SIZE = 72


def _validate_stamp_options(
    position: str, start_number: int, digits: int, prefix: str, suffix: str, font_size: int
) -> None:
    """Shared by the single-file and batch endpoints so their rules can't drift."""
    if position not in VALID_POSITIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Position must be one of: {', '.join(sorted(VALID_POSITIONS))}",
        )

    if start_number < 0:
        raise HTTPException(
            status_code=400,
            detail="start_number must be non-negative",
        )
    if start_number > MAX_START_NUMBER:
        raise HTTPException(
            status_code=400,
            detail=f"start_number must be {MAX_START_NUMBER:,} or less",
        )
    if digits < 1 or digits > MAX_DIGITS:
        raise HTTPException(
            status_code=400,
            detail=f"digits must be between 1 and {MAX_DIGITS}",
        )

    # Detect "start_number too large to fit in `digits` zero-padded characters".
    # If the final page would exceed 10**digits we'd visually drop leading zeros,
    # which usually surprises legal users. We don't know page count yet, so
    # only check the start itself here — service can't render fewer digits than
    # `str(start_number)` needs.
    if len(str(start_number)) > digits:
        raise HTTPException(
            status_code=400,
            detail=(
                f"start_number {start_number} needs {len(str(start_number))} digits "
                f"but 'digits' is {digits}. Increase digits or lower start_number."
            ),
        )

    if len(prefix) > MAX_AFFIX_CHARS or len(suffix) > MAX_AFFIX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Prefix and suffix must be {MAX_AFFIX_CHARS} characters or fewer",
        )
    if font_size < MIN_FONT_SIZE or font_size > MAX_FONT_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"font_size must be between {MIN_FONT_SIZE} and {MAX_FONT_SIZE}",
        )


@router.post("/bates-numbering")
async def bates_numbering(
    file: UploadFile = File(...),
    prefix: str = Form(""),
    start_number: int = Form(1),
    digits: int = Form(6),
    position: str = Form("bottom-right"),
    suffix: str = Form(""),
    font_size: int = Form(10),
    pages: str = Form(""),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    _validate_stamp_options(position, start_number, digits, prefix, suffix, font_size)

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

        output_path, next_number = await asyncio.to_thread(
            bates_numbering_service.add_bates_numbering,
            str(temp_path),
            prefix=prefix,
            start_number=start_number,
            digits=digits,
            position=position,
            suffix=suffix,
            font_size=font_size,
            pages=pages or None,
        )
        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_bates.pdf",
            media_type="application/pdf",
            background=cleanup,
            headers={
                # Lets a caller chain documents manually and keep one sequence.
                "X-Bates-Next": str(next_number),
                "X-Bates-First": bates_numbering_service.format_bates(
                    prefix, start_number, digits, suffix
                ),
            },
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
        logger.exception("Unexpected error in /bates-numbering")
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


@router.post("/bates-numbering-batch")
async def bates_numbering_batch(
    files: List[UploadFile] = File(...),
    prefix: str = Form(""),
    start_number: int = Form(1),
    digits: int = Form(6),
    position: str = Form("bottom-right"),
    suffix: str = Form(""),
    font_size: int = Form(10),
):
    """Stamp several documents as ONE continuous sequence.

    The distinguishing feature versus calling /bates-numbering N times: the
    second file continues from where the first stopped. A production set is
    numbered continuously across every file in it — restarting each file is
    what made the single-file tool unusable for the audience Bates exists for.

    Returns a ZIP, plus an `X-Bates-Manifest` header recording which range
    landed on which file.
    """
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one PDF file")
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400, detail=f"Please upload at most {MAX_FILES} PDF files"
        )
    for f in files:
        if not (f.filename or "").lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400, detail=f"'{f.filename}' is not a PDF"
            )
    _validate_stamp_options(position, start_number, digits, prefix, suffix, font_size)

    ensure_temp_dir()
    input_paths: list[str] = []
    output_paths: list[str] = []
    zip_path = None

    try:
        for f in files:
            content = await f.read()
            if not content:
                raise HTTPException(
                    status_code=400, detail=f"'{f.filename}' is empty"
                )
            validate_pdf_content(content)
            path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            path.write_bytes(content)
            input_paths.append(str(path))

        output_paths, manifest = await asyncio.to_thread(
            bates_numbering_service.add_bates_numbering_batch,
            input_paths,
            prefix=prefix,
            start_number=start_number,
            digits=digits,
            position=position,
            suffix=suffix,
            font_size=font_size,
        )
        for entry, f in zip(manifest, files):
            entry["file"] = safe_filename(f.filename, "document.pdf")

        zip_path = str(get_temp_path(f"bates_{uuid.uuid4().hex}.zip"))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            seen: dict[str, int] = {}
            for i, out in enumerate(output_paths):
                original = safe_filename(files[i].filename, f"file_{i + 1}.pdf")
                zf.write(out, unique_arcname(f"bates_{original}", seen))
            # The production log a paralegal would otherwise rebuild by hand.
            zf.writestr("bates-manifest.json", json.dumps(manifest, indent=2))

        cleanup = BackgroundTask(remove_files, *input_paths, *output_paths, zip_path)
        return FileResponse(
            path=zip_path,
            filename="bates_numbered.zip",
            media_type="application/zip",
            background=cleanup,
            headers={"X-Bates-Manifest": json.dumps(manifest)},
        )
    except HTTPException:
        remove_files(*input_paths, *output_paths, *( [zip_path] if zip_path else [] ))
        raise
    except Exception as exc:
        remove_files(*input_paths, *output_paths, *( [zip_path] if zip_path else [] ))
        logger.exception("Unexpected error in /bates-numbering-batch")
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise HTTPException(
                status_code=400,
                detail="One of the PDFs is password-protected — unlock it first",
            ) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc


@router.post("/bates-remove")
async def bates_remove(
    file: UploadFile = File(...),
    prefix: str = Form(""),
    suffix: str = Form(""),
    digits: int = Form(6),
):
    """Remove Bates stamps from a document.

    Redaction, not an overlay: the point of removing a production number is
    that it is no longer in the file, so covering it would defeat the purpose.
    Matching is confined to the page margins and to text shaped like a Bates
    number, so body content is not touched.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    if digits < 1 or digits > MAX_DIGITS:
        raise HTTPException(
            status_code=400, detail=f"digits must be between 1 and {MAX_DIGITS}"
        )
    if len(prefix) > MAX_AFFIX_CHARS or len(suffix) > MAX_AFFIX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Prefix and suffix must be {MAX_AFFIX_CHARS} characters or fewer",
        )

    ensure_temp_dir()
    temp_path = None
    output_path = None

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        validate_pdf_content(content)
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_path.write_bytes(content)

        output_path, removed = await asyncio.to_thread(
            bates_numbering_service.remove_bates_numbering,
            str(temp_path),
            prefix=prefix,
            suffix=suffix,
            digits=digits,
        )
        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_bates_removed.pdf",
            media_type="application/pdf",
            background=cleanup,
            # Reported so the UI can say "nothing matched" instead of silently
            # handing back an identical file.
            headers={"X-Bates-Removed": str(removed)},
        )
    except HTTPException:
        remove_files(*([str(temp_path)] if temp_path else []),
                     *([output_path] if output_path else []))
        raise
    except Exception as exc:
        remove_files(*([str(temp_path)] if temp_path else []),
                     *([output_path] if output_path else []))
        logger.exception("Unexpected error in /bates-remove")
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF is password-protected — unlock it first",
            ) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc

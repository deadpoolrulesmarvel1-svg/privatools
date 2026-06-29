import asyncio
import logging
import uuid
from fastapi import APIRouter, File, Form, Request, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from ..rate_limit import EXPENSIVE_RATE_LIMIT, limiter
from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import ocr_service
from ..utils.concurrency import run_bounded

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_OUTPUTS = {"json", "txt", "searchable_pdf"}

VALID_LANGS = {
    "eng", "fra", "deu", "spa", "ita", "por", "chi_sim", "chi_tra", "jpn", "kor",
    "ara", "hin", "rus", "nld", "pol", "tur", "vie", "ukr", "ces", "ron", "hun",
    "ell", "bul", "hrv", "slk", "slv", "srp", "cat", "dan", "fin", "nor", "swe",
    "tha", "heb", "ind", "msa", "ben", "tam", "tel", "kan", "mal", "mar", "guj",
    "pan", "urd",
}


@router.post("/ocr")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def ocr_pdf(
    request: Request,
    file: UploadFile = File(...),
    lang: str = Form("eng"),
    output: str = Form("json"),
    dpi: int = Form(200, ge=ocr_service.VALID_DPI_MIN, le=ocr_service.VALID_DPI_MAX),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    # Allow multi-language combos like "eng+fra" if every component is whitelisted.
    lang_components = [c.strip() for c in lang.split("+") if c.strip()]
    if not lang_components or any(c not in VALID_LANGS for c in lang_components):
        raise HTTPException(status_code=400, detail=f"Invalid language code: {lang}")

    if output not in VALID_OUTPUTS:
        raise HTTPException(status_code=400, detail=f"output must be one of: {', '.join(sorted(VALID_OUTPUTS))}")

    ensure_temp_dir()
    temp_path = None
    out_path = None

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        validate_pdf_content(content)
        temp_path.write_bytes(content)

        if output == "txt":
            out_path = await run_bounded(ocr_service.extract_text_to_file, str(temp_path), lang=lang, dpi=dpi)
            cleanup = BackgroundTask(remove_files, str(temp_path), out_path)
            return FileResponse(
                path=out_path,
                filename="extracted_text.txt",
                media_type="text/plain; charset=utf-8",
                background=cleanup,
            )
        if output == "searchable_pdf":
            out_path = await run_bounded(ocr_service.extract_searchable_pdf_to_file, str(temp_path), lang=lang, dpi=dpi)
            cleanup = BackgroundTask(remove_files, str(temp_path), out_path)
            return FileResponse(
                path=out_path,
                filename="searchable.pdf",
                media_type="application/pdf",
                background=cleanup,
            )
        else:
            text = await run_bounded(ocr_service.extract_text, str(temp_path), lang=lang, dpi=dpi)
            remove_files(str(temp_path))
            return JSONResponse({"text": text})
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + ([out_path] if out_path else [])
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + ([out_path] if out_path else [])
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

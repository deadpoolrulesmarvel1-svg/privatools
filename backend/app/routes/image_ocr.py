"""Image OCR route: extract text from images using Tesseract."""
import asyncio
import logging
import tempfile
import os
from functools import lru_cache
from fastapi import APIRouter, File, Form, Request, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from ..utils.cleanup import remove_files

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"}

# Allowlist of language codes we accept in the API surface — keeps the
# validation cheap and prevents users from forging odd ISO codes. Whether
# the lang pack is actually installed on the host is checked below via
# pytesseract.get_languages().
VALID_LANGS = {
    "eng", "fra", "deu", "spa", "ita", "por", "chi_sim", "chi_tra", "jpn", "kor",
    "ara", "hin", "rus", "nld", "pol", "tur", "vie", "ukr", "ces", "ron", "hun",
    "ell", "bul", "hrv", "slk", "slv", "srp", "cat", "dan", "fin", "nor", "swe",
    "tha", "heb", "ind", "msa", "ben", "tam", "tel", "kan", "mal", "mar", "guj",
    "pan", "urd",
}
VALID_OUTPUTS = {"json", "txt"}


@lru_cache(maxsize=1)
def _installed_langs() -> frozenset[str]:
    """Languages tesseract actually has installed. Cached; empty on failure.

    Returning an empty set falls back to the static allowlist — better to be
    permissive than to break the endpoint when pytesseract can't list packs.
    """
    try:
        import pytesseract
        return frozenset(pytesseract.get_languages(config=""))
    except Exception:
        return frozenset()


def _extract_text(image_path: str, lang: str) -> str:
    """Run Tesseract OCR on an image — CPU-bound, runs in thread."""
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        raise RuntimeError("pytesseract and Pillow are required for image OCR")

    # Reuse the same timeout the PDF OCR path enforces — without it a crafted
    # image can wedge tesseract and pin a shared thread-pool worker forever
    # (the request timeout can't cancel a running OS thread). pytesseract spawns
    # a watchdog that kills the stuck process and raises RuntimeError on timeout.
    from ..services.ocr_service import _TESS_TIMEOUT_SECS

    img = Image.open(image_path)
    # Convert to RGB if needed (e.g. RGBA PNGs)
    if img.mode not in ("L", "RGB"):
        img = img.convert("RGB")
    text = pytesseract.image_to_string(img, lang=lang, timeout=_TESS_TIMEOUT_SECS)
    return text.strip()


@router.post("/image-ocr")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def image_ocr(
    request: Request,
    file: UploadFile = File(...),
    lang: str = Form("eng"),
    output: str = Form("json"),
):
    # Validate extension
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image format. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Support multi-language combos like "eng+fra"
    lang_parts = [p.strip() for p in lang.split("+") if p.strip()]
    if not lang_parts:
        raise HTTPException(status_code=400, detail="Invalid language code")
    for part in lang_parts:
        if part not in VALID_LANGS:
            raise HTTPException(status_code=400, detail=f"Invalid language code: {part}")

    # Cross-check against actually-installed packs (best-effort — empty set
    # means we couldn't query tesseract so we skip the check).
    installed = _installed_langs()
    if installed:
        missing = [p for p in lang_parts if p not in installed]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Language pack not installed: {', '.join(missing)}. "
                    f"Available: {', '.join(sorted(installed))}"
                ),
            )

    if output not in VALID_OUTPUTS:
        raise HTTPException(status_code=400, detail=f"output must be one of: {', '.join(sorted(VALID_OUTPUTS))}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    # Magic-byte check — protects against an HTML/JS/etc. upload tagged
    # with a .png extension. Pulling validate_image_content from utils so
    # the bytes are vetted before we hand them to PIL/tesseract.
    from ..utils.cleanup import validate_image_content
    validate_image_content(content)
    # Atomically create temp file via mkstemp (0600 perms, no race
    # between create-and-reopen on shared /tmp).
    fd, tmp_path = tempfile.mkstemp(suffix=ext)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
    except Exception:
        remove_files(tmp_path)
        raise

    try:
        text = await asyncio.to_thread(_extract_text, tmp_path, lang)
    except RuntimeError as e:
        remove_files(tmp_path)
        # pytesseract raises RuntimeError on its watchdog timeout — surface that
        # as 504 (the image was too complex/malformed) rather than a generic 500.
        if "timeout" in str(e).lower():
            raise HTTPException(
                status_code=504,
                detail="OCR timed out — the image was too large, complex, or malformed.",
            )
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        remove_files(tmp_path)
        logger.exception("OCR failed")
        raise HTTPException(status_code=500, detail="OCR processing failed. Is Tesseract installed?")
    finally:
        # Clean up input file
        remove_files(tmp_path)

    if output == "txt":
        fd_txt, txt_path = tempfile.mkstemp(suffix=".txt")
        with os.fdopen(fd_txt, "w", encoding="utf-8") as handle:
            handle.write(text)
        cleanup = BackgroundTask(remove_files, txt_path)
        return FileResponse(
            path=txt_path,
            filename="extracted_text.txt",
            media_type="text/plain; charset=utf-8",
            background=cleanup,
        )
    else:
        return JSONResponse({"text": text, "language": lang, "characters": len(text)})

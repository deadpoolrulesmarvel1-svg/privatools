import asyncio
import logging
import uuid
from typing import Optional

import pikepdf
from fastapi import APIRouter, File, Form, Request, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import metadata_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_METADATA_FIELD_CHARS = 500


@router.post("/metadata")
async def get_metadata(file: UploadFile = File(...)):
    """Read PDF metadata and return as JSON."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    ensure_temp_dir()
    temp_path = None

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        validate_pdf_content(content)
        temp_path.write_bytes(content)

        meta = await asyncio.to_thread(metadata_service.read_metadata, str(temp_path))
        return JSONResponse(meta)
    except HTTPException:
        if temp_path is not None:
            remove_files(str(temp_path))
        raise
    except Exception as e:
        if temp_path is not None:
            remove_files(str(temp_path))
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
    finally:
        if temp_path is not None:
            remove_files(str(temp_path))


def _apply_metadata_update(
    input_path: str,
    *,
    title: Optional[str],
    author: Optional[str],
    subject: Optional[str],
    keywords: Optional[str],
) -> str:
    """Write metadata in-place at the route layer with proper clear/preserve semantics.

    For each field:
      - ``None``        → preserve existing value (field was not sent by the client)
      - ``""`` (empty)  → clear the field
      - ``"foo"``       → set to "foo"

    The service helper (``metadata_service.write_metadata``) can't distinguish
    "preserve" from "clear" because both arrive as empty strings, so we apply
    the writes here instead.
    """
    ensure_temp_dir()
    output_path = get_temp_path(f"metadata_{uuid.uuid4().hex}.pdf")

    with pikepdf.open(input_path) as pdf:
        # `update_docinfo=False` is important here: by default pikepdf
        # **rewrites docinfo from XMP** when the context manager exits, which
        # would wipe out any docinfo fields that aren't mirrored in XMP yet.
        # That makes "preserve" impossible for fields we didn't touch.
        with pdf.open_metadata(update_docinfo=False) as xmp:
            # Title
            if title is not None:
                if title == "":
                    xmp.pop("dc:title", None)
                else:
                    xmp["dc:title"] = title
            # Author
            if author is not None:
                if author == "":
                    xmp.pop("dc:creator", None)
                else:
                    xmp["dc:creator"] = [author]
            # Subject
            if subject is not None:
                if subject == "":
                    xmp.pop("dc:description", None)
                else:
                    xmp["dc:description"] = subject
            # Keywords
            if keywords is not None:
                if keywords == "":
                    xmp.pop("pdf:Keywords", None)
                else:
                    xmp["pdf:Keywords"] = keywords

        # Mirror to docinfo for older readers that don't read XMP.
        if title is not None:
            if title == "" and "/Title" in pdf.docinfo:
                del pdf.docinfo["/Title"]
            elif title:
                pdf.docinfo["/Title"] = title
        if author is not None:
            if author == "" and "/Author" in pdf.docinfo:
                del pdf.docinfo["/Author"]
            elif author:
                pdf.docinfo["/Author"] = author
        if subject is not None:
            if subject == "" and "/Subject" in pdf.docinfo:
                del pdf.docinfo["/Subject"]
            elif subject:
                pdf.docinfo["/Subject"] = subject
        if keywords is not None:
            if keywords == "" and "/Keywords" in pdf.docinfo:
                del pdf.docinfo["/Keywords"]
            elif keywords:
                pdf.docinfo["/Keywords"] = keywords

        pdf.save(str(output_path))

    return str(output_path)


@router.post("/metadata/update")
async def update_metadata(request: Request, file: UploadFile = File(...)):
    """Update PDF metadata fields and return the rewritten file.

    Each form field follows the same convention:
      - field absent from the form → preserve existing value
      - field present with empty string → clear the value
      - field present with text → overwrite

    We read the raw form rather than using ``Form(None)`` because FastAPI
    coerces missing AND empty-string form fields to ``None``, which makes
    "clear" indistinguishable from "preserve".
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    form = await request.form()

    def _field(name: str) -> Optional[str]:
        if name not in form:
            return None
        value = form[name]
        # UploadFile sneaking in under the same name? Treat as absent.
        if not isinstance(value, str):
            return None
        return value

    title = _field("title")
    author = _field("author")
    subject = _field("subject")
    keywords = _field("keywords")

    for field_name, field_value in {
        "title": title,
        "author": author,
        "subject": subject,
        "keywords": keywords,
    }.items():
        if field_value is not None and len(field_value) > MAX_METADATA_FIELD_CHARS:
            raise HTTPException(
                status_code=400,
                detail=f"{field_name} must be {MAX_METADATA_FIELD_CHARS} characters or fewer",
            )

    ensure_temp_dir()
    temp_path = None
    output_path = None

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        validate_pdf_content(content)
        temp_path.write_bytes(content)

        # pikepdf rewrites the whole PDF here — offload so the resave doesn't
        # block the event loop on a large file (the read path is already async).
        output_path = await asyncio.to_thread(
            _apply_metadata_update,
            str(temp_path),
            title=title,
            author=author,
            subject=subject,
            keywords=keywords,
        )
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="updated_metadata.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

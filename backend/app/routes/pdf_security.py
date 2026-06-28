"""Companion security tools: PDF/A validator, signature verifier, sanitizer.

NOTE — the `/set-permissions` endpoint (consumed by `PermissionsUI`) is
defined in `phase4_tools.py`, not here. The frontend posts to
`POST /api/set-permissions`; that handler already validates the upload,
applies an owner password and per-action permission flags, and cleans up
temp files via BackgroundTasks. This file intentionally stays narrow and
just covers the "verify / sanitize" surface.
"""

import asyncio
import logging
import os
import tempfile

import fitz
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import remove_files, validate_pdf_content

router = APIRouter()
logger = logging.getLogger(__name__)


async def _read_pdf(upload: UploadFile, label: str = "PDF") -> bytes:
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail=f"{label} is empty")
    validate_pdf_content(data)
    return data


@router.post("/pdfa-validator")
async def pdfa_validator(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    data = await _read_pdf(file)

    def _work():
        doc = None
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            meta = doc.metadata or {}
            errors = []
            standard = ""
            is_pdfa = False

            xml_meta = doc.get_xml_metadata() if hasattr(doc, "get_xml_metadata") else ""
            xml_meta_lower = str(xml_meta).lower()
            if "pdfaid" in xml_meta_lower or "pdfa" in xml_meta_lower:
                is_pdfa = True
                standard = "PDF/A (detected)"
            else:
                errors.append(
                    "PDF/A identifier not found in XMP metadata — this looks like a "
                    "regular PDF, not PDF/A. Convert it via the PDF→PDF/A tool first."
                )

            if not meta.get("title"):
                errors.append("Missing title metadata (required for PDF/A)")
            if not meta.get("author"):
                errors.append("Missing author metadata (required for PDF/A)")
            if doc.is_encrypted:
                errors.append("Encrypted PDFs cannot be PDF/A compliant")

            return {
                "valid": is_pdfa and len(errors) == 0,
                "standard": standard,
                "errors": errors,
            }
        finally:
            if doc is not None:
                doc.close()

    try:
        result = await asyncio.to_thread(_work)
        return JSONResponse(result)
    except fitz.FileDataError as exc:
        raise HTTPException(status_code=400, detail="Invalid or corrupted PDF") from exc
    except Exception as exc:
        logger.exception("PDF/A validator error")
        raise HTTPException(status_code=500, detail="Failed to validate PDF/A") from exc


@router.post("/verify-signature")
async def verify_signature(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    data = await _read_pdf(file)

    def _work():
        doc = None
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            signatures = []
            for page in doc:
                widgets = page.widgets()
                if not widgets:
                    continue
                for widget in widgets:
                    if widget.field_type_string == "Sig":
                        signatures.append(
                            {"signer": widget.field_value or "Unknown", "date": "", "status": "detected"}
                        )
            return signatures
        finally:
            if doc is not None:
                doc.close()

    try:
        signatures = await asyncio.to_thread(_work)
        has_signatures = len(signatures) > 0
        return JSONResponse(
            {
                "has_signatures": has_signatures,
                "signatures": signatures,
                "note": (
                    "Signatures detected but cryptographic verification is not yet "
                    "supported. Use a dedicated PDF reader (e.g. Adobe Acrobat) for "
                    "full validation."
                ),
            }
        )
    except fitz.FileDataError as exc:
        raise HTTPException(status_code=400, detail="Invalid or corrupted PDF") from exc
    except Exception as exc:
        logger.exception("Verify signature error")
        raise HTTPException(status_code=500, detail="Failed to verify signatures") from exc


@router.post("/sanitize")
async def sanitize_pdf(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    data = await _read_pdf(file)

    # Shared holder so the handler can clean up a partially-written temp file
    # if _work raises after mkstemp but before/while saving.
    paths: dict[str, str | None] = {"tmp_path": None}

    def _work():
        doc = None
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            doc.set_metadata({})

            for page in doc:
                annot = page.first_annot
                while annot is not None:
                    next_annot = annot.next
                    # Screen (19) and widget (20) annotations may contain JS actions.
                    # Note: subtype 20 (widget) is what AcroForm fields are; this
                    # endpoint is for full sanitisation, so we accept that signed
                    # forms become un-fillable here. Use /delete-annotations when
                    # the goal is just to remove comments.
                    if annot.type[0] in (19, 20):
                        page.delete_annot(annot)
                    annot = next_annot

            # mkstemp atomically creates the file with 0600 perms so the
            # subsequent doc.save() can't race with another process on /tmp.
            fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
            os.close(fd)
            paths["tmp_path"] = tmp_path
            doc.save(tmp_path, clean=True, garbage=4, deflate=True)
            return tmp_path
        finally:
            if doc is not None:
                doc.close()

    try:
        tmp_path = await asyncio.to_thread(_work)

        cleanup = BackgroundTask(remove_files, tmp_path)
        return FileResponse(
            tmp_path,
            media_type="application/pdf",
            filename="sanitized.pdf",
            background=cleanup,
        )
    except fitz.FileDataError as exc:
        raise HTTPException(status_code=400, detail="Invalid or corrupted PDF") from exc
    except Exception as exc:
        if paths["tmp_path"] is not None:
            remove_files(paths["tmp_path"])
        logger.exception("Sanitize PDF error")
        raise HTTPException(status_code=500, detail="Failed to sanitize PDF") from exc

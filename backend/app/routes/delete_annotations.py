import asyncio
import logging
import uuid

import pikepdf
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, validate_pdf_content, remove_files
from ..services import delete_annotations_service

router = APIRouter()
logger = logging.getLogger(__name__)


def _delete_annotations_preserving_widgets(input_path: str) -> str:
    """Strip annotations but keep AcroForm widgets.

    The legacy service deletes the whole /Annots array, which also wipes form
    fields (widgets are technically annotations of subtype `/Widget`). This
    variant walks each page and only removes annots that aren't widgets, so
    a fillable form survives.
    """
    ensure_temp_dir()
    output_path = get_temp_path(f"no_annots_{uuid.uuid4().hex}.pdf")

    with pikepdf.open(input_path) as pdf:
        for page in pdf.pages:
            if "/Annots" not in page:
                continue
            annots = page["/Annots"]
            kept = []
            for annot in annots:
                try:
                    subtype = str(annot.get("/Subtype", ""))
                except Exception:
                    subtype = ""
                if subtype == "/Widget":
                    kept.append(annot)
            if kept:
                page["/Annots"] = kept
            else:
                del page["/Annots"]
        pdf.save(str(output_path))

    return str(output_path)


@router.post("/delete-annotations")
async def delete_annotations(
    file: UploadFile = File(...),
    keep_form_fields: bool = Form(True),
):
    """Strip comments, highlights, sticky notes etc.

    `keep_form_fields=True` (default) preserves AcroForm widgets, which are
    technically `/Widget` annotations but most users wouldn't expect "delete
    annotations" to also nuke a fillable form.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

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

        if keep_form_fields:
            output_path = await asyncio.to_thread(_delete_annotations_preserving_widgets, str(temp_path))
        else:
            output_path = await asyncio.to_thread(delete_annotations_service.delete_annotations, str(temp_path))

        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="no_annotations.pdf",
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

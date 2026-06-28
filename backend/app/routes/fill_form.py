import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, validate_pdf_content, remove_files
from ..utils.exceptions import ValidationError
from ..services import fill_form_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/fill-form/fields")
async def get_fields(file: UploadFile = File(...)):
    """Inspect a PDF and return the list of fillable AcroForm fields."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    ensure_temp_dir()
    temp_path = None
    try:
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        validate_pdf_content(content)
        temp_path.write_bytes(content)
        fields = await asyncio.to_thread(fill_form_service.get_form_fields, str(temp_path))
        remove_files(str(temp_path))
        return JSONResponse({"fields": fields})
    except HTTPException:
        if temp_path is not None:
            remove_files(str(temp_path))
        raise
    except ValidationError:
        # No AcroForm — the frontend treats `fields: []` as a friendly empty
        # state instead of an error, so we mirror that contract.
        if temp_path is not None:
            remove_files(str(temp_path))
        return JSONResponse({"fields": []})
    except Exception as exc:
        if temp_path is not None:
            remove_files(str(temp_path))
        # Older service errors used plain strings; keep the back-compat path
        # so a "no form field" string also degrades to an empty list.
        if "no form field" in str(exc).lower():
            return JSONResponse({"fields": []})
        logger.exception("Unexpected error reading form fields")
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}")


@router.post("/fill-form")
async def fill_form(file: UploadFile = File(...), field_values: str = Form(...)):
    """Fill an AcroForm PDF with the supplied {field_name: value} map."""
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

        try:
            values = json.loads(field_values)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail="field_values must be valid JSON",
            ) from exc

        if not isinstance(values, dict):
            raise HTTPException(
                status_code=400,
                detail="field_values must be a JSON object of field-name → value",
            )

        output_path = await asyncio.to_thread(fill_form_service.fill_form, str(temp_path), values)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="filled_form.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        if temp_path is not None:
            remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        raise
    except ValidationError as exc:
        if temp_path is not None:
            remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        if temp_path is not None:
            remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        # Some services still raise bare ValueError("no form field")
        if "no form field" in str(exc).lower():
            raise HTTPException(status_code=400, detail=str(exc))
        logger.exception("Unexpected error filling form")
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}")

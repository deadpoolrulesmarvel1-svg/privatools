"""Phase 4 routes: white-out, attachments, permissions, JSON/XML conversion, annotate, shapes, EPUB/RTF."""

import asyncio
import json
import logging
import re
import uuid
from json import JSONDecodeError
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import (
    annotate_service,
    attachment_service,
    epub_to_pdf_service,
    json_to_pdf_service,
    permissions_service,
    rtf_to_pdf_service,
    shapes_service,
    whiteout_service,
    xml_to_pdf_service,
)
from ..utils.cleanup import ensure_temp_dir, get_temp_path, remove_files, validate_pdf_content
from ..utils.route_helpers import read_upload, cleanup_on_error, MAX_SIZE

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_JSON_ITEMS = 1000
SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._ -]+")


async def _read_upload(file: UploadFile, *, label: str, max_bytes: int = MAX_SIZE) -> bytes:
    return await read_upload(file, label=label, max_bytes=max_bytes)


def _cleanup_on_error(*paths: str | Path | None) -> None:
    cleanup_on_error(*paths)


def _safe_attachment_name(name: str | None) -> str:
    base = Path(name or "").name.strip()
    if not base:
        base = "attachment.bin"
    base = SAFE_FILENAME_RE.sub("_", base).strip("._ ")
    if not base:
        base = "attachment.bin"
    if len(base) > 120:
        stem, ext = Path(base).stem, Path(base).suffix
        base = f"{stem[:100]}{ext[:20]}"
    return base


def _safe_suffix(filename: str, fallback: str = ".bin") -> str:
    suffix = Path(filename).suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,12}", suffix):
        return suffix
    return fallback


def _parse_json_list(raw: str, *, field_name: str) -> list[dict[str, Any]]:
    if not (raw or "").strip():
        raise HTTPException(status_code=400, detail=f"{field_name} is required")
    try:
        parsed = json.loads(raw)
    except JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be valid JSON") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail=f"{field_name} must be a JSON array")
    if not parsed:
        raise HTTPException(status_code=400, detail=f"{field_name} must contain at least one item")
    if len(parsed) > MAX_JSON_ITEMS:
        raise HTTPException(status_code=400, detail=f"{field_name} cannot contain more than {MAX_JSON_ITEMS} items")
    if not all(isinstance(item, dict) for item in parsed):
        raise HTTPException(status_code=400, detail=f"Each item in {field_name} must be an object")
    return parsed


# ─── White-Out / Eraser ──────────────────────────────────
@router.post("/whiteout-pdf")
async def whiteout_pdf(
    file: UploadFile = File(...),
    regions: str = Form("[]"),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")

    region_list = _parse_json_list(regions, field_name="regions")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="PDF file")
        validate_pdf_content(content)
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp.write_bytes(content)
        out = await asyncio.to_thread(whiteout_service.whiteout_pdf, str(temp), region_list)
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="whiteout.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("whiteout error")
        raise HTTPException(status_code=500, detail="White-out failed")


# ─── Add Attachment ───────────────────────────────────────
@router.post("/add-attachment")
async def add_attachment(
    file: UploadFile = File(...),
    attachment: UploadFile = File(...),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")

    safe_attachment_name = _safe_attachment_name(attachment.filename)
    ensure_temp_dir()
    temp_pdf = None
    temp_att = None
    out = None
    try:
        pdf_content = await _read_upload(file, label="PDF file")
        validate_pdf_content(pdf_content)
        att_content = await _read_upload(attachment, label="Attachment file")
        if len(pdf_content) + len(att_content) > MAX_SIZE:
            raise HTTPException(status_code=413, detail="Combined file size exceeds the upload limit")

        temp_pdf = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_pdf.write_bytes(pdf_content)

        att_suffix = _safe_suffix(safe_attachment_name)
        temp_att = get_temp_path(f"att_{uuid.uuid4().hex}{att_suffix}")
        temp_att.write_bytes(att_content)

        out = await asyncio.to_thread(attachment_service.add_attachment, str(temp_pdf), str(temp_att), safe_attachment_name)
        cleanup = BackgroundTask(remove_files, str(temp_pdf), str(temp_att), out)
        return FileResponse(out, filename="with_attachment.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp_pdf, temp_att, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp_pdf, temp_att, out)
        logger.exception("attachment error")
        raise HTTPException(status_code=500, detail="Attachment failed")


# ─── PDF Permissions ──────────────────────────────────────
@router.post("/set-permissions")
async def set_permissions(
    file: UploadFile = File(...),
    owner_password: str = Form(""),
    allow_print: bool = Form(True),
    allow_copy: bool = Form(True),
    allow_modify: bool = Form(True),
    allow_annotate: bool = Form(True),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    if len((owner_password or "")) > 128:
        raise HTTPException(status_code=400, detail="owner_password must be 128 characters or fewer")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="PDF file")
        validate_pdf_content(content)
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp.write_bytes(content)
        # Avoid a predictable static owner password in the service default.
        safe_owner_password = (owner_password or "").strip() or uuid.uuid4().hex
        out = await asyncio.to_thread(
            permissions_service.set_permissions,
            str(temp),
            safe_owner_password,
            allow_print,
            allow_copy,
            allow_modify,
            allow_annotate,
        )
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="permissions.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("permissions error")
        raise HTTPException(status_code=500, detail="Permission setting failed")


# ─── JSON → PDF ──────────────────────────────────────────
@router.post("/json-to-pdf")
async def json_to_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Please upload a .json file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="JSON file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.json")
        temp.write_bytes(content)
        out = await asyncio.to_thread(json_to_pdf_service.json_to_pdf, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="document.pdf", media_type="application/pdf", background=cleanup)
    except JSONDecodeError:
        _cleanup_on_error(temp, out)
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except ValueError as exc:
        _cleanup_on_error(temp, out)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("json-to-pdf error")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── XML → PDF ───────────────────────────────────────────
@router.post("/xml-to-pdf")
async def xml_to_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".xml"):
        raise HTTPException(status_code=400, detail="Please upload an .xml file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="XML file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.xml")
        temp.write_bytes(content)
        out = await asyncio.to_thread(xml_to_pdf_service.xml_to_pdf, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="document.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("xml-to-pdf error")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── PDF Annotate ─────────────────────────────────────────
@router.post("/annotate-pdf")
async def annotate_pdf(
    file: UploadFile = File(...),
    annotations: str = Form("[]"),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")

    ann_list = _parse_json_list(annotations, field_name="annotations")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="PDF file")
        validate_pdf_content(content)
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp.write_bytes(content)
        out = await asyncio.to_thread(annotate_service.annotate_pdf, str(temp), ann_list)
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="annotated.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("annotate error")
        raise HTTPException(status_code=500, detail="Annotation failed")


# ─── Add Shapes ──────────────────────────────────────────
@router.post("/add-shapes")
async def add_shapes(
    file: UploadFile = File(...),
    shapes: str = Form("[]"),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")

    shape_list = _parse_json_list(shapes, field_name="shapes")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="PDF file")
        validate_pdf_content(content)
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp.write_bytes(content)
        out = await asyncio.to_thread(shapes_service.add_shapes, str(temp), shape_list)
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="shapes.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("shapes error")
        raise HTTPException(status_code=500, detail="Shape addition failed")


# ─── EPUB → PDF ──────────────────────────────────────────
@router.post("/epub-to-pdf")
async def epub_to_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".epub"):
        raise HTTPException(status_code=400, detail="Please upload an .epub file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="EPUB file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.epub")
        temp.write_bytes(content)
        out = await asyncio.to_thread(epub_to_pdf_service.epub_to_pdf, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="book.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("epub-to-pdf error")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── RTF → PDF ───────────────────────────────────────────
@router.post("/rtf-to-pdf")
async def rtf_to_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".rtf"):
        raise HTTPException(status_code=400, detail="Please upload a .rtf file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="RTF file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.rtf")
        temp.write_bytes(content)
        out = await asyncio.to_thread(rtf_to_pdf_service.rtf_to_pdf, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="document.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("rtf-to-pdf error")
        raise HTTPException(status_code=500, detail="Conversion failed")

from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from ..auth.api_key import API_KEY_HEADER, require_api_key
from ..rate_limit import EXPENSIVE_RATE_LIMIT, limiter
from ..services import (
    bates_numbering_service,
    booklet_service,
    compress_service,
    delete_annotations_service,
    deskew_service,
    flatten_service,
    header_footer_service,
    nup_service,
    page_numbers_service,
    pdf_to_pdfa_service,
    repair_service,
    reverse_pdf_service,
    rotate_service,
    stamp_service,
    strip_metadata_service,
    watermark_service,
)
from ..services import grayscale_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import no_store_headers, read_upload, safe_stem

router = APIRouter(tags=["developer"])

MAX_PIPELINE_STEPS = 12

# The pipeline's step catalog, and the single source of truth for what
# `/api/pipeline` can chain. `run` takes the input path and returns the output
# path — every service below already has exactly that shape, which is why the
# whole SPA chain can run server-side in ONE request instead of re-uploading
# the document once per step.
#
# Deliberately absent: `invert-colors` and `remove-blank-pages`. Their logic
# lives inline in the route handler rather than a service module, so the
# pipeline cannot call them without extracting a service first.
PIPELINE_STEP_META = {
    # ── Optimize ──────────────────────────────────────────────────────────
    "compress-pdf": {
        "label": "Compress PDF",
        "description": "Reduce PDF byte size with the recommended compression preset.",
        "run": compress_service.compress_pdf,
    },
    "repair-pdf": {
        "label": "Repair PDF",
        "description": "Rebuild a damaged or malformed PDF structure.",
        "run": repair_service.repair_pdf,
    },
    "deskew-pdf": {
        "label": "Deskew",
        "description": "Straighten pages that were scanned at an angle.",
        "run": deskew_service.deskew,
    },
    "grayscale-pdf": {
        "label": "Grayscale",
        "description": "Convert every page to grayscale.",
        "run": grayscale_service.convert_to_grayscale,
    },
    "flatten-pdf": {
        "label": "Flatten PDF",
        "description": "Merge form fields and annotations into the page content.",
        "run": flatten_service.flatten_pdf,
    },
    # ── Organize ──────────────────────────────────────────────────────────
    "rotate-pdf": {
        "label": "Rotate pages",
        "description": "Rotate every page by the default quarter turn.",
        "run": rotate_service.rotate_pdf,
    },
    "reverse-pdf": {
        "label": "Reverse page order",
        "description": "Reverse the order of all pages in the document.",
        "run": reverse_pdf_service.reverse_pdf,
    },
    "nup": {
        "label": "N-up layout",
        "description": "Place multiple pages onto each printed sheet.",
        "run": nup_service.nup,
    },
    "booklet-pdf": {
        "label": "Booklet imposition",
        "description": "Reorder pages for saddle-stitch booklet printing.",
        "run": booklet_service.make_booklet,
    },
    # ── Stamp ─────────────────────────────────────────────────────────────
    "page-numbers": {
        "label": "Add page numbers",
        "description": "Stamp sequential page numbers using the default position.",
        "run": page_numbers_service.add_page_numbers,
    },
    "bates-numbering": {
        "label": "Bates numbering",
        "description": "Apply sequential Bates numbers for legal discovery.",
        "run": bates_numbering_service.add_bates_numbering,
    },
    "header-footer": {
        "label": "Header and footer",
        "description": "Add the default header and footer to every page.",
        "run": header_footer_service.add_header_footer,
    },
    "watermark": {
        "label": "Watermark",
        "description": "Overlay the default text watermark on every page.",
        "run": watermark_service.add_watermark,
    },
    "stamp-pdf": {
        "label": "Stamp",
        "description": "Apply the default status stamp to every page.",
        "run": stamp_service.stamp_pdf,
    },
    # ── Security ──────────────────────────────────────────────────────────
    "strip-metadata": {
        "label": "Strip metadata",
        "description": "Remove document info and XMP metadata from the PDF.",
        "run": strip_metadata_service.strip_metadata,
    },
    "delete-annotations": {
        "label": "Delete annotations",
        "description": "Remove every annotation and comment from the document.",
        "run": delete_annotations_service.delete_annotations,
    },
    # ── Convert ───────────────────────────────────────────────────────────
    "pdf-to-pdfa": {
        "label": "Convert to PDF/A",
        "description": "Convert the document to the PDF/A archival profile.",
        "run": pdf_to_pdfa_service.convert_to_pdfa,
    },
}

# `run` is a callable and must never reach a JSON response body.
PIPELINE_STEP_PUBLIC = {
    slug: {k: v for k, v in meta.items() if k != "run"}
    for slug, meta in PIPELINE_STEP_META.items()
}

PIPELINE_TEMPLATES = [
    {
        "id": "email-ready",
        "name": "Email-ready PDF",
        "description": "Compress the PDF, then strip identifying metadata before sharing.",
        "steps": ["compress-pdf", "strip-metadata"],
    },
    {
        "id": "privacy-scrub",
        "name": "Privacy scrub",
        "description": "Remove embedded PDF metadata before publishing.",
        "steps": ["strip-metadata"],
    },
]


class PipelineValidateRequest(BaseModel):
    steps: list[str | dict[str, Any]] = Field(..., min_length=1, max_length=MAX_PIPELINE_STEPS)


def _slug_from_step(step: str | dict[str, Any]) -> str:
    if isinstance(step, str):
        return step
    for key in ("slug", "tool", "id"):
        value = step.get(key)
        if isinstance(value, str):
            return value
    raise HTTPException(status_code=400, detail="Each pipeline step needs a slug")


def _normalize_steps(steps: list[str | dict[str, Any]]) -> list[str]:
    normalized = [_slug_from_step(step).strip() for step in steps]
    if not normalized:
        raise HTTPException(status_code=400, detail="Pipeline needs at least one step")
    if len(normalized) > MAX_PIPELINE_STEPS:
        raise HTTPException(
            status_code=400,
            detail=f"Pipeline supports at most {MAX_PIPELINE_STEPS} steps per run",
        )
    unsupported = [slug for slug in normalized if slug not in PIPELINE_STEP_META]
    if unsupported:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported pipeline step(s): "
                f"{', '.join(unsupported)}. Supported steps: "
                f"{', '.join(sorted(PIPELINE_STEP_META))}."
            ),
        )
    return normalized


def _steps_from_form(raw: str) -> list[str]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="steps must be valid JSON") from exc
    if isinstance(parsed, dict):
        parsed = parsed.get("steps")
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="steps must be a JSON array")
    return _normalize_steps(parsed)


def _share_path(steps: list[str]) -> str:
    payload = {"version": 1, "steps": steps}
    # Keep this JSON compact so CLI/frontend share URLs stay short. The
    # frontend and CLI both use base64url for the same payload shape.
    import base64

    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return f"/pipeline?p={encoded}"


def _run_step(slug: str, input_path: str) -> str:
    """Run one pipeline step. Takes the previous step's output as its input."""
    meta = PIPELINE_STEP_META.get(slug)
    if meta is None:
        raise HTTPException(status_code=400, detail=f"Unsupported pipeline step: {slug}")
    return meta["run"](input_path)



@router.get("/developer/status")
async def developer_status(_: str = Depends(require_api_key)):
    return JSONResponse(
        {
            "status": "ok",
            "docs": "/api-docs",
            "openapi": "/openapi.json",
            "apiKeyHeader": API_KEY_HEADER,
            "authConfigured": bool(os.environ.get("PRIVATOOLS_API_KEYS")),
        }
    )


@router.get("/pipeline/templates")
async def pipeline_templates(_: str = Depends(require_api_key)):
    return JSONResponse({"templates": PIPELINE_TEMPLATES, "supportedSteps": PIPELINE_STEP_PUBLIC})


@router.post("/pipeline/validate")
async def validate_pipeline(
    payload: PipelineValidateRequest,
    _: str = Depends(require_api_key),
):
    steps = _normalize_steps(payload.steps)
    return JSONResponse(
        {
            "ok": True,
            "steps": steps,
            "sharePath": _share_path(steps),
            "supportedSteps": PIPELINE_STEP_PUBLIC,
        }
    )


@router.post("/pipeline")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def run_pipeline(
    request: Request,
    file: UploadFile = File(...),
    steps: str = Form(...),
    _: str = Depends(require_api_key),
):
    normalized_steps = _steps_from_form(steps)
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Pipeline input must be a PDF")

    ensure_temp_dir()
    paths: list[str] = []
    try:
        content = await read_upload(file, label=file.filename or "pipeline input")
        validate_pdf_content(content)
        input_path = get_temp_path(f"pipeline_{uuid.uuid4().hex}.pdf")
        input_path.write_bytes(content)
        paths.append(str(input_path))

        current_path = str(input_path)
        for slug in normalized_steps:
            current_path = await asyncio.to_thread(_run_step, slug, current_path)
            paths.append(current_path)

        cleanup = BackgroundTask(remove_files, *paths)
        stem = safe_stem(file.filename, "document")
        return FileResponse(
            current_path,
            filename=f"{stem}_pipeline.pdf",
            media_type="application/pdf",
            background=cleanup,
            headers=no_store_headers(
                {
                    "X-Pipeline-Steps": ",".join(normalized_steps),
                    "X-Pipeline-Step-Count": str(len(normalized_steps)),
                }
            ),
        )
    except HTTPException:
        remove_files(*paths)
        raise
    except Exception as exc:
        remove_files(*paths)
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {exc}") from exc

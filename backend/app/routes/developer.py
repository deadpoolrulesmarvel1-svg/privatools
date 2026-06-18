from __future__ import annotations

import json
import os
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from ..auth.api_key import API_KEY_HEADER, require_api_key
from ..services import compress_service, strip_metadata_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import no_store_headers, read_upload, safe_stem

router = APIRouter(tags=["developer"])

MAX_PIPELINE_STEPS = 12

PIPELINE_STEP_META = {
    "compress-pdf": {
        "label": "Compress PDF",
        "description": "Reduce PDF byte size with the recommended compression preset.",
    },
    "strip-metadata": {
        "label": "Strip metadata",
        "description": "Remove document info and XMP metadata from the PDF.",
    },
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
    if slug == "compress-pdf":
        return compress_service.compress_pdf(input_path, level="recommended")
    if slug == "strip-metadata":
        return strip_metadata_service.strip_metadata(input_path)
    # _normalize_steps prevents this path, but keep the guard near execution.
    raise HTTPException(status_code=400, detail=f"Unsupported pipeline step: {slug}")


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
    return JSONResponse({"templates": PIPELINE_TEMPLATES, "supportedSteps": PIPELINE_STEP_META})


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
            "supportedSteps": PIPELINE_STEP_META,
        }
    )


@router.post("/pipeline")
async def run_pipeline(
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
            current_path = _run_step(slug, current_path)
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

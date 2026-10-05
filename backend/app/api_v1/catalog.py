"""Public operation metadata, backed by the installed routes and quota policy.

operation_metadata.json is a reviewed response-MIME/category/website-alias
inventory. Request schemas always come from FastAPI, never that inventory.
New routes are included automatically; undeclared response shapes remain
unspecified until their owner adds a reviewed contract or OpenAPI metadata.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi.routing import APIRoute, iter_route_contexts

from ..services.hidden_text_service import MAX_PAGES as _HIDDEN_TEXT_PAGES
from ..services.hidden_text_service import TIME_LIMIT_BASE_SECONDS as _HIDDEN_TEXT_BASE_SECONDS
from ..services.hidden_text_service import TIME_LIMIT_MAX_SECONDS as _HIDDEN_TEXT_MAX_SECONDS
from ..services.image_to_pdf_service import MAX_DECODED_MEGAPIXELS as _IMAGE_MEGAPIXELS
from ..services import form_detect_service as _form_detect
from ..services import pdf_to_markdown_service as _markdown
from . import quota

PREFIX = "/api/v1"
DISCOVERY_PATHS = {f"{PREFIX}/operations", f"{PREFIX}/openapi.json"}
_METADATA = json.loads(Path(__file__).with_name("operation_metadata.json").read_text())

CONSTRAINTS = {
    "/merge": ["Upload 2–100 PDFs using repeated files fields, in output order.", "page_ranges is a JSON-encoded array with one entry per file; null, an empty string, or all includes every page."],
    "/compress": ["Upload 1–100 PDFs. One file returns PDF; multiple files return ZIP.", "level=custom requires at least one of jpeg_quality, max_image_dim, or target_size_mb.", "target_size_mb is a requested target, not a guarantee of the resulting file size."],
    "/rotate": ["angle must be a multiple of 90 between -360 and 360. pages defaults to all."],
    "/image-to-pdf": ["Upload 1–100 images using repeated files fields, in page order, up to 200 MB combined. Accepted: JPG, PNG, WebP, BMP, TIFF, GIF, HEIC/HEIF and SVG. Formats are read from the content, whatever a file is called, and a file in no accepted format, or one that cannot be read, is refused with 400.", f"Images other than JPEG are decoded and may add up to {_IMAGE_MEGAPIXELS:,} megapixels, a HEIC megapixel counting half; a larger batch, or one image with more pixels than its format allows, is refused with 413.", "page_size accepts A4 (the default), Letter, or auto, which makes each page the size of its image."],
    "/pipeline": ["steps is a JSON-encoded array of 1–12 supported step identifiers. Read /pipeline/templates for the current supportedSteps.", "The processing charge is the sum of the selected step costs."],
    "/pipeline/validate": ["Validates the pipeline definition without processing a file. Use supportedSteps from /pipeline/templates."],
    "/smart-redact": ["needles is a JSON-encoded array of up to 500 text strings. The API applies supplied terms; browser-side entity detection is not part of this endpoint."],
    "/pdf-to-long-image": ["format accepts png, jpg, or jpeg. At most 200 PDF pages; rendering DPI is clamped to 36–200."],
    "/verify-signature": ["Checks that each signature matches the file and the certificate embedded with it, and reports what was saved after signing. Certificates are not checked against a trust list or for revocation.", "A signature made with SHA-1 or MD5, which can be forged, has status weak, never valid; digest_algorithm names the digest of every checked signature.", "The check stops after 10 to 60 seconds, depending on file size; a signature it could not finish has status unchecked and a reason."],
    "/sanitize": ["A file whose layered page content decodes to more than 6 MiB, or needs more memory than the server allows, is refused with 413. Layered content that will not parse is refused with 400, rather than returned with its hidden layers left in it.", "The work stops after 20 to 90 seconds, depending on file size, with 504."],
    "/pdf-to-markdown": ["Returns Markdown (text/markdown): headings, paragraphs, lists, tables ruled with lines as GitHub tables, monospaced text as code, web and mail links, superscripts (footnote marks, exponents) as <sup>, and [Image: ...] placeholders holding a tagged picture's alternative text or its caption, in reading order across columns. page_markers (default false) puts <!-- page N --> before each page; remove_headers_footers (default false) leaves out lines repeated at the top or bottom of at least 40% of the pages, the same on each but for a page number, unless they are in a table or run straight on into the text.", f"chunk=headings splits before each heading of the two highest levels, and chunk=size at about chunk_size characters ({_markdown.CHUNK_MIN:,}–{_markdown.CHUNK_MAX:,}, default {_markdown.CHUNK_DEFAULT:,}); chunk_output=zip (default) returns a ZIP of .md files, chunk_output=single one file with <!-- chunk N of M --> before each part. The X-Markdown-Report header is a JSON summary, including pagesWithoutText: pages with no text layer, which are not converted.", f"A file with more than {_markdown.MAX_PAGES:,} pages, or needing more memory than the server allows, is refused with 413; one with no text layer at all (a scan; run OCR first), or needing more than {_markdown.CPU_SECONDS_BASE} seconds plus {_markdown.CPU_SECONDS_PER_PAGE} per page of processing ({_markdown.CPU_SECONDS_MAX} at most), with 422. The work stops after {_markdown.TIME_LIMIT_SECONDS} seconds with 504."],
    "/form-creator/detect": ["Read-only: returns JSON candidates for /form-creator and creates nothing. Each gives page, x, y, width and height in /form-creator's numbers, a type (text, checkbox, signature, or date where its label names a date: send that as text), a suggested name unique in the file, the label it was named after, multiline, and a confidence: a heuristic score from 0 to 1, not a probability. It finds drawn lines, boxes, table cells and box characters beside labels, so it can miss fields or propose wrong ones; nothing is proposed over a field the PDF already has.", f"A file with more than {_form_detect.MAX_PAGES} pages, or needing more memory than the server allows, is refused with 413; one whose pages are all pictures (a scan) and hold nothing to find, or needing more than {_form_detect.CPU_SECONDS_BASE} seconds plus {_form_detect.CPU_SECONDS_PER_PAGE} per page of processing ({_form_detect.CPU_SECONDS_MAX} at most), with 422. The work stops after {_form_detect.TIME_LIMIT_SECONDS} seconds with 504. At most {_form_detect.MAX_CANDIDATES} candidates are returned (truncated says when more were found)."],
    "/hidden-text-checker": ["Read-only: returns a JSON report and no file. Each finding gives the page, a reason (invisible, transparent, same-colour, tiny, off-page, clipped, hidden-layer, covered, hidden-annotation or unapplied-redaction), the text and boxes as fractions of the page as shown. Invisible text over a page image (an OCR layer) is listed under ocr, not as a finding. summary.pagesNotChecked names pages that could not be read, and summary.pagesPartlyChecked pages where some checks could not run; the notes say which.", f"A file with more than {_HIDDEN_TEXT_PAGES} pages, or needing more memory than the server allows, is refused with 413, and one none of whose pages can be read with 400. The check stops after {_HIDDEN_TEXT_BASE_SECONDS} to {_HIDDEN_TEXT_MAX_SECONDS} seconds, depending on file size, with 504. A clean report means none of the checks matched, not that the file is safe in every way."],
}


def public_routes(app):
    """Resolve lazy includes using FastAPI's effective mounted route contexts."""
    return [
        route for route in iter_route_contexts(app.routes)
        if isinstance(route.original_route, APIRoute)
        and route.path.startswith(PREFIX + "/")
        and route.path not in DISCOVERY_PATHS
        and route.include_in_schema
    ]


def operation_id(method: str, path: str) -> str:
    # Method + public path remains stable through Python handler/module renames.
    parts = path.removeprefix(PREFIX).strip("/").split("/")
    slug = "_".join("by_" + part[1:-1] if part.startswith("{") else part.replace("-", "_") for part in parts)
    return "v1_" + method.lower() + "_" + re.sub(r"[^a-zA-Z0-9_]", "_", slug)


def metadata(path: str) -> dict:
    short = path.removeprefix(PREFIX)
    if short in {"/whoami", "/usage"}:
        return {"category": "Key and usage", "response_media": ["application/json"]}
    return _METADATA["operations"].get(short, {"category": "Jobs" if short.startswith("/jobs") else "Other", "response_media": []})


def cost(path: str) -> dict:
    if path == PREFIX + "/pipeline":
        return {"units": None, "mode": "pipeline_steps", "description": "Sum of the selected pipeline step costs.", "step_units": getattr(quota, "PIPELINE_STEP_COSTS", {})}
    if path == PREFIX + "/jobs":
        return {"units": None, "mode": "operation", "description": "Charge for the selected operation on accepted submission; idempotent replay does not repeat the processing charge."}
    units = quota.cost_for(path)
    return {"units": units, "mode": "fixed", "description": "No processing units." if units == 0 else f"{units} processing unit{'s' if units != 1 else ''} per admitted request."}


def build_catalog(app) -> dict:
    from .schema import build_schema

    schema = build_schema(app)
    operations = []
    for path, methods in sorted(schema["paths"].items()):
        for method, operation in sorted(methods.items()):
            info = metadata(path)
            extra = operation.get("x-privatools", {})
            operations.append({
                "id": operation["operationId"], "method": method.upper(), "path": path,
                "summary": operation.get("summary", path), "description": operation.get("description", ""),
                "category": info["category"], "tool_aliases": info.get("tool_aliases", []),
                "request_body": operation.get("requestBody"), "parameters": operation.get("parameters", []),
                "responses": operation["responses"], "cost": cost(path),
                "async": extra.get("async", {"supported": False}),
                "constraints": CONSTRAINTS.get(path.removeprefix(PREFIX), []),
                "retry_safe": method in {"get", "head"},
            })
    limits = quota.policy() if hasattr(quota, "policy") else {
        "daily_units": quota.DAILY_UNITS, "daily_request_bytes": quota.DAILY_BYTES,
        "byte_accounting": "Request-body bytes, including multipart overhead.",
    }
    return {
        "schema_version": "1", "api_version": "v1", "base_path": PREFIX,
        "openapi_url": PREFIX + "/openapi.json", "limits": limits,
        "operations": operations, "components": schema.get("components", {}),
        "async": schema.get("x-privatools-async", {}),
        "unavailable_tools": _METADATA["unavailable_tools"],
    }

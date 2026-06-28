import asyncio
import logging
import uuid
import zipfile
from io import BytesIO
from typing import List

import pikepdf
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, validate_pdf_content, remove_files
from ..utils.route_helpers import safe_filename, read_upload, unique_arcname
from ..services import strip_metadata_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_FILES = 100


def _detect_present_metadata(content: bytes) -> set[str]:
    """Inspect a PDF and return labels for the metadata categories it carries.

    The labels match the frontend's `STRIPPED` constant so the UI can light up
    only the items that were actually present in the source file:
      - title
      - author
      - subject
      - keywords
      - creator
      - producer
      - dates
      - xmp
      - gps  (XMP exif:GPS* keys, if any)
    """
    present: set[str] = set()
    try:
        with pikepdf.open(BytesIO(content)) as pdf:
            docinfo = pdf.docinfo or {}
            mapping = {
                "/Title": "title",
                "/Author": "author",
                "/Subject": "subject",
                "/Keywords": "keywords",
                "/Creator": "creator",
                "/Producer": "producer",
                "/CreationDate": "dates",
                "/ModDate": "dates",
            }
            for k, label in mapping.items():
                if k in docinfo:
                    present.add(label)
            # XMP — only count it as "xmp" if there's something there beyond
            # the empty default skeleton.
            try:
                with pdf.open_metadata() as xmp:
                    if any(True for _ in xmp.keys()):
                        present.add("xmp")
                    # Scan for any exif:GPS* keys
                    for key in xmp.keys():
                        if "GPS" in str(key):
                            present.add("gps")
                            break
            except Exception:
                pass
    except Exception:
        # Don't fail the request just because we couldn't classify what was
        # there. The strip itself still runs.
        return present
    return present


@router.post("/strip-metadata")
async def strip_metadata(files: List[UploadFile] = File(...)):
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Please upload at most {MAX_FILES} PDF files",
        )

    ensure_temp_dir()
    input_paths: list[str] = []
    output_paths: list[str] = []
    union_present: set[str] = set()

    try:
        for file in files:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename} is not a PDF",
                )
            content = await read_upload(file, label=file.filename or "unknown")
            validate_pdf_content(content)
            union_present.update(_detect_present_metadata(content))
            temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            temp_path.write_bytes(content)
            input_paths.append(str(temp_path))

        for inp in input_paths:
            out = await asyncio.to_thread(strip_metadata_service.strip_metadata, inp)
            output_paths.append(out)

        # X-Stripped-Items lets the frontend's "Privacy receipt" UI render
        # only the items that actually existed in the source files. Order is
        # stable so the UI doesn't reshuffle on every call.
        stripped_header = ",".join(sorted(union_present)) if union_present else ""

        # Single file: return the PDF directly
        if len(output_paths) == 1:
            cleanup = BackgroundTask(remove_files, *input_paths, *output_paths)
            return FileResponse(
                path=output_paths[0],
                filename="stripped.pdf",
                media_type="application/pdf",
                background=cleanup,
                headers={"X-Stripped-Items": stripped_header},
            )

        # Multiple files: return a ZIP
        zip_path = str(get_temp_path(f"stripped_{uuid.uuid4().hex}.zip"))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            seen: dict[str, int] = {}
            for i, out in enumerate(output_paths):
                original_name = safe_filename(files[i].filename, f"file_{i+1}.pdf")
                arcname = unique_arcname(f"stripped_{original_name}", seen)
                zf.write(out, arcname)

        cleanup = BackgroundTask(remove_files, *input_paths, *output_paths, zip_path)
        return FileResponse(
            path=zip_path,
            filename="stripped_pdfs.zip",
            media_type="application/zip",
            background=cleanup,
            headers={"X-Stripped-Items": stripped_header},
        )
    except HTTPException:
        remove_files(*input_paths, *output_paths)
        raise
    except Exception as e:
        remove_files(*input_paths, *output_paths)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

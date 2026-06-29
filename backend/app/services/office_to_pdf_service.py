"""Convert Office documents to PDF via headless LibreOffice.

Hardening notes:
  * Extension is validated against an allowlist before LibreOffice ever
    sees the file. Otherwise a caller could rename `.dll` → `.docx` and
    LibreOffice would happily try to import it.
  * Args are passed as a list (`create_subprocess_exec`, not `shell=True`)
    so there is no shell substitution on filenames.
  * Per-conversion profile dir lives in the temp tree and is cleaned up
    in a finally so we don't leak ~10 MB per request when LibreOffice
    crashes mid-conversion.
  * Errors raise typed exceptions (ExternalToolError / ToolTimeoutError)
    instead of bare Exception so the global handler maps to 502/504.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path

from ..utils.exceptions import (
    ExternalToolError,
    ProcessingError,
    ToolTimeoutError,
    UnsupportedFileError,
)
from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)

# Extensions LibreOffice will accept. Everything else is rejected up front
# — LibreOffice's binary import filters have a long history of CVEs, so
# narrowing the input surface here meaningfully reduces risk.
ALLOWED_EXTENSIONS = {
    ".docx", ".xlsx", ".pptx",
    ".doc", ".xls", ".ppt",
    ".odt", ".ods", ".odp",
    ".rtf", ".csv",
}

LIBREOFFICE_TIMEOUT = 120  # seconds


async def office_to_pdf(input_path: str) -> str:
    """Convert an Office document at `input_path` to PDF.

    Returns the absolute path of the resulting PDF in the temp dir.
    """
    suffix = Path(input_path).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileError(
            f"Unsupported Office format '{suffix or 'unknown'}'. "
            f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
        )

    temp_input = temp_output("office", suffix.lstrip("."))
    # Offload the copy — an office upload can be tens of MB and copy2 would
    # otherwise block the event loop (the conversion subprocess below is async).
    await asyncio.to_thread(shutil.copy2, input_path, str(temp_input))

    temp_dir = temp_input.parent
    # Per-conversion LibreOffice profile dir. Without this, LibreOffice tries
    # to create its first-run profile under $HOME — but the container's
    # appuser has no home dir, so that fails with "User installation could
    # not be completed" and the whole conversion bails out.
    #
    # The profile path MUST be absolute. Passing a relative path produces
    # `file://temp/...` which LibreOffice interprets as a URL with hostname
    # "temp" and silently hangs trying to resolve it.
    profile_dir = temp_output("lo_profile").resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    logger.info("office_to_pdf start suffix=%s", suffix)

    proc: asyncio.subprocess.Process | None = None
    try:
        proc = await asyncio.create_subprocess_exec(
            "libreoffice",
            f"-env:UserInstallation=file://{profile_dir}",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(temp_dir),
            str(temp_input),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            _, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=LIBREOFFICE_TIMEOUT
            )
        except asyncio.TimeoutError as exc:
            proc.kill()
            # Drain whatever LibreOffice already wrote so the process is reaped.
            try:
                await proc.communicate()
            except (OSError, ValueError):
                pass
            raise ToolTimeoutError(
                "LibreOffice conversion timed out — try a smaller document."
            ) from exc

        if proc.returncode != 0:
            # Keep just the last stderr line so we don't dump LibreOffice's
            # very chatty initialisation messages into the user's error toast.
            err = (stderr or b"").decode("utf-8", errors="replace").strip()
            last = err.splitlines()[-1] if err else f"exit {proc.returncode}"
            raise ExternalToolError(f"LibreOffice conversion failed: {last}")

        output_path = temp_input.with_suffix(".pdf")
        if not output_path.exists():
            raise ProcessingError(
                "LibreOffice produced no output file — the document may be malformed."
            )

        return str(output_path)
    finally:
        # Kill the subprocess on EVERY exit path so it can't outlive its request.
        # On cancellation (client disconnect / request timeout) the wait_for above
        # raises CancelledError, NOT TimeoutError, so the timeout branch's kill is
        # skipped — without this, LibreOffice would keep running orphaned, holding
        # CPU + a profile dir after the user is long gone (the request-timeout
        # subprocess leak the deep research flagged).
        if proc is not None and proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        # Tear down BOTH per-conversion temp resources here. The caller only
        # knows the original upload and the returned PDF — not this intermediate
        # copy (a separate office_*.<ext> file) nor the LibreOffice profile dir.
        # Without cleaning temp_input here it leaks on EVERY path (success and
        # each failure: timeout / conversion error / missing output) until the
        # janitor's next sweep, widening the "deleted promptly" window with a
        # full copy of the user's document. Offload the rmtree — the profile dir
        # is many small files and rmtree on the loop would stall concurrent reqs.
        await asyncio.to_thread(shutil.rmtree, str(profile_dir), ignore_errors=True)
        try:
            temp_input.unlink(missing_ok=True)
        except OSError:
            logger.debug("office_to_pdf: could not remove temp input %s", temp_input)

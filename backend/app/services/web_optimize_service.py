"""Linearize a PDF for byte-range / web streaming.

A linearized ("fast web view") PDF lets a viewer render the first page
before the whole file has finished downloading, which matters for PDFs
served from a CDN. Done via `qpdf --linearize`, which is already in the
base image.
"""

from __future__ import annotations

import asyncio

from ..utils.cleanup import NO_PAGES_MESSAGE, open_pikepdf
from ..utils.exceptions import (
    ExternalToolError,
    PdfCorruptError,
    ProcessingError,
    ToolTimeoutError,
    ValidationError,
)
from ..utils.filenames import temp_output

QPDF_TIMEOUT = 60  # seconds


def _check_readable(input_path: str) -> None:
    """Raise pikepdf's PasswordError or PdfError for a PDF qpdf cannot read,
    PdfCorruptError for one it had to repair that lost pages (qpdf's command
    would leave them out of the linearized file), and ValidationError for one
    with no page.

    qpdf answers such a file with exit status 2, which it also gives a disk or
    permission fault, so its status cannot say whose the failure was. Its
    library, through pikepdf, says it by type, and the route's catch-all
    answers that with the standard 400 (utils.pdf_errors). A PDF with no page
    gets the 400 the other PDF tools give it, whatever qpdf would make of it.
    An intact file only has its cross-reference table read twice.
    """
    with open_pikepdf(input_path) as pdf:
        if not len(pdf.pages):
            raise ValidationError(NO_PAGES_MESSAGE)


def _refuse_if_damaged(input_path: str) -> None:
    """After qpdf failed: refuse the input if it is damaged, judged as
    process_pdf judges it, by a page object MuPDF cannot read
    (utils.cleanup._has_unreadable_page). pikepdf reads such a file, qpdf's
    command does not, and its exit status can't say whose the failure was.
    Anything else stays the server's fault."""
    from ..utils.cleanup import _has_unreadable_page, open_pdf_document

    doc = open_pdf_document(input_path)  # raises the standard 400s itself
    try:
        if _has_unreadable_page(doc):
            raise PdfCorruptError()
    finally:
        doc.close()


async def web_optimize(input_path: str) -> str:
    output_path = temp_output("weboptim", "pdf")

    await asyncio.to_thread(_check_readable, input_path)
    proc = await asyncio.create_subprocess_exec(
        "qpdf",
        "--linearize",
        input_path,
        str(output_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=QPDF_TIMEOUT)
    except asyncio.TimeoutError as exc:
        proc.kill()
        try:
            await proc.communicate()
        except (OSError, ValueError):
            pass
        raise ToolTimeoutError("qpdf linearize timed out") from exc
    finally:
        # On cancellation (client disconnect / request timeout) wait_for raises
        # CancelledError, not TimeoutError — kill here so qpdf can't outlive the
        # request (request-timeout subprocess leak).
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass

    # qpdf exit codes: 0 = ok, 3 = warnings (file still produced)
    if proc.returncode not in (0, 3):
        err = (stderr or b"").decode("utf-8", errors="replace").strip()
        # Keep the first 200 chars of stderr — qpdf's messages are usually
        # already a single line ("operation succeeded with warnings: ...").
        await asyncio.to_thread(_refuse_if_damaged, input_path)
        raise ExternalToolError(f"qpdf linearize failed: {err[:200]}")

    if not output_path.exists():
        raise ProcessingError("qpdf produced no output")

    return str(output_path)

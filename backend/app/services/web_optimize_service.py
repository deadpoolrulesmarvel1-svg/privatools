"""Linearize a PDF for byte-range / web streaming.

A linearized ("fast web view") PDF lets a viewer render the first page
before the whole file has finished downloading, which matters for PDFs
served from a CDN. Done via `qpdf --linearize`, which is already in the
base image.
"""

from __future__ import annotations

import asyncio

from ..utils.exceptions import (
    ExternalToolError,
    ProcessingError,
    ToolTimeoutError,
)
from ..utils.filenames import temp_output

QPDF_TIMEOUT = 60  # seconds


async def web_optimize(input_path: str) -> str:
    output_path = temp_output("weboptim", "pdf")

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
        raise ExternalToolError(f"qpdf linearize failed: {err[:200]}")

    if not output_path.exists():
        raise ProcessingError("qpdf produced no output")

    return str(output_path)

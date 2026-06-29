import asyncio
import logging
import shutil

import fitz  # PyMuPDF

from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)


def _convert_to_pdfa_sync(input_path: str) -> str:
    output_path = temp_output("pdfa", "pdf")

    doc = fitz.open(input_path)
    try:
        # Set PDF/A metadata in the document info
        meta = doc.metadata or {}
        meta["producer"] = "PrivaTools PDF/A Converter"
        meta["creator"] = "PrivaTools"
        doc.set_metadata(meta)

        # Save with maximum cleaning and garbage collection.
        doc.save(
            str(output_path),
            garbage=4,
            deflate=True,
            clean=True,
        )
    finally:
        doc.close()

    # Pass 2: tag with PDF/A-2b XMP metadata via pikepdf. If pikepdf is
    # unavailable or the tagging step fails we still return the cleaned
    # PDF from pass 1 — it's a valid PDF, just not certified PDF/A.
    try:
        import pikepdf
    except ImportError:
        return str(output_path)

    temp_out2 = temp_output("pdfa_xmp", "pdf")
    try:
        with pikepdf.open(str(output_path)) as pdf:
            with pdf.open_metadata(set_pikepdf_as_editor=False) as xmp:
                xmp["pdfaid:part"] = "2"
                xmp["pdfaid:conformance"] = "B"
                xmp["dc:title"] = meta.get("title", "Converted Document")
                xmp["pdf:Producer"] = "PrivaTools PDF/A Converter"
            pdf.save(str(temp_out2))
        shutil.move(str(temp_out2), str(output_path))
    except (pikepdf.PdfError, OSError, KeyError) as exc:
        # XMP tagging is best-effort — the cleaned PDF from pass 1 is
        # still valid output. Clean up the partial temp file.
        logger.debug("pdfa: XMP tagging skipped (%s)", exc)
        temp_out2.unlink(missing_ok=True)

    return str(output_path)


async def convert_to_pdfa(input_path: str) -> str:
    """Convert a PDF to PDF/A-2b using PyMuPDF + pikepdf XMP tagging.

    PyMuPDF saves with garbage collection and cleaning to produce a
    well-formed PDF; pikepdf then adds the PDF/A-2b XMP markers. The work
    is pure CPU/IO, so it's offloaded to a thread to avoid blocking the
    event loop (this was declared async but ran synchronously before).
    """
    return await asyncio.to_thread(_convert_to_pdfa_sync, input_path)


import logging

from ..utils.exceptions import ProcessingError
from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)


def svg_to_png(input_path: str, scale: float = 2.0) -> str:
    """Convert SVG to PNG. Tries cairosvg first, then PyMuPDF as fallback."""
    output_path = temp_output("svg", "png")

    # Read the SVG file
    with open(input_path, "rb") as f:
        svg_data = f.read()

    # Try cairosvg (best quality)
    try:
        import cairosvg

        from .svg_safety import block_external_refs
        # block_external_refs denies file:// (LFI) and http(s):// (SSRF) refs
        # in the uploaded SVG; only inline data: URIs are allowed.
        cairosvg.svg2png(
            bytestring=svg_data,
            write_to=str(output_path),
            scale=scale,
            url_fetcher=block_external_refs,
        )
        return str(output_path)
    except (ImportError, OSError) as exc:
        # ImportError → cairosvg not installed
        # OSError → libcairo / pango system libs missing
        logger.debug("svg_to_png: cairosvg unavailable (%s) — trying fitz", exc)

    # Fallback: use PyMuPDF (supports SVG in recent versions)
    try:
        import fitz
        doc = fitz.open(stream=svg_data, filetype="svg")
        try:
            if len(doc) > 0:
                page = doc[0]
                mat = fitz.Matrix(scale * 2, scale * 2)  # Higher scale for quality
                pix = page.get_pixmap(matrix=mat, alpha=True)
                pix.save(str(output_path))
                return str(output_path)
        finally:
            doc.close()
    except (RuntimeError, ValueError) as exc:
        logger.debug("svg_to_png: fitz fallback failed (%s)", exc)

    raise ProcessingError(
        "SVG conversion failed — cairosvg system dependencies are missing."
    )

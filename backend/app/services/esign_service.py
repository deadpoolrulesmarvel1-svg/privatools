import base64
import io

import fitz  # PyMuPDF
from PIL import Image, UnidentifiedImageError

from ..utils.exceptions import FileTooLargeError, ValidationError
from ..utils.filenames import temp_output
from ..utils.images import image_read_error
from ..utils.page_space import drawing_unturned

# The modes Pillow writes as PNG; a signature in any other is converted first.
_PNG_MODES = frozenset({"1", "L", "LA", "I", "I;16", "I;16B", "P", "RGB", "RGBA"})


def esign_pdf(input_path: str, signature_data: str,
              page_number: int = 1, x: float = 100, y: float = 100,
              width: float = 200, height: float = 80) -> str:
    """Place an e-signature image on a PDF page.

    Args:
        input_path: Path to input PDF
        signature_data: Base64-encoded signature image (PNG/JPEG)
        page_number: Page to sign (1-indexed)
        x: X position from left (in PDF points)
        y: Y position from top (in PDF points)
        width: Signature width
        height: Signature height

    x and y are measured from the top-left corner of the page's visible area
    (its CropBox), before any /Rotate the page has. The signature stays
    upright as the page is shown.
    """
    output_path = temp_output("signed", "pdf")

    # Decode signature image — handle data URI prefix if present.
    if "," in signature_data:
        signature_data = signature_data.split(",", 1)[1]

    try:
        sig_bytes = base64.b64decode(signature_data)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValidationError("Invalid base64 signature data") from exc

    # Validate it's an image and normalise to PNG. `with` makes sure we
    # release the underlying file descriptor even on conversion failures.
    try:
        with Image.open(io.BytesIO(sig_bytes)) as img:
            # PNG cannot hold every mode a valid picture decodes to, such as a
            # CMYK JPEG from a print workflow: those are drawn as RGBA. Pillow
            # would otherwise refuse to write them, and that refusal is not
            # the visitor's fault.
            picture = img if img.mode in _PNG_MODES else img.convert("RGBA")
            buf = io.BytesIO()
            picture.save(buf, format="PNG")
            sig_bytes = buf.getvalue()
    except UnidentifiedImageError as exc:
        raise ValidationError("Signature isn't a recognised image format.") from exc
    except Exception as exc:
        # A picture its decoder cannot read gets the wording every image tool
        # gives (utils.images); Pillow's own words never reach the page.
        known = image_read_error(exc)
        if known is None and not isinstance(exc, (OSError, ValueError)):
            raise
        status, detail = known or (400, "The signature must be a PNG, JPG or WebP picture.")
        raise (FileTooLargeError if status == 413 else ValidationError)(detail) from exc

    doc = fitz.open(input_path)
    try:
        pg_idx = page_number - 1
        if pg_idx < 0 or pg_idx >= len(doc):
            pg_idx = 0

        page = doc[pg_idx]
        rect = fitz.Rect(x, y, x + width, y + height)

        # The box is in the page's stored coordinates. Turning the image with
        # the page keeps the signature upright where the page is shown; the
        # page is unturned while it goes in, because PyMuPDF places images on
        # a turned page from the wrong corner when the visible area does not
        # start at 0,0 (utils/page_space.py).
        with drawing_unturned(page) as rotation:
            page.insert_image(rect, stream=sig_bytes, rotate=rotation)

        doc.save(str(output_path), garbage=4, deflate=True)
    finally:
        doc.close()

    return str(output_path)

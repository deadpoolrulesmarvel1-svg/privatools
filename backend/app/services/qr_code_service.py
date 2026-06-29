"""QR code rendering with custom foreground/background colors and optional
centre logo overlay.

We render directly via PIL using the QR module matrix produced by reportlab's
bundled qrencoder — this avoids adding any new dependency while letting us
support arbitrary fg/bg colors and a centred logo (which the raw reportlab
QrCodeWidget does not support).
"""
import io
import os

import pikepdf
from PIL import Image
from reportlab.graphics.barcode import qrencoder
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from ..utils.cleanup import safe_open_pdf
from ..utils.colors import hex_to_rgb_int, parse_hex_color
from ..utils.exceptions import ValidationError
from ..utils.filenames import temp_output


def _validate_hex(value: str, *, label: str) -> tuple[int, int, int]:
    """Validate `#RGB` / `#RRGGBB` and return the (R, G, B) int tuple.

    Raises ValueError with a friendly message keyed off the substring "invalid"
    so the frontend friendlyError() routes it correctly.
    """
    try:
        parse_hex_color(value)  # raises ValueError on malformed input
    except ValueError as exc:
        raise ValueError(f"{label} must be a valid hex color (e.g. #000000 or #f0f) — {exc}") from exc
    return hex_to_rgb_int(value)


def _build_qr_image(
    data: str,
    *,
    px_size: int,
    fg_color: str,
    bg_color: str,
    logo_bytes: bytes | None = None,
) -> Image.Image:
    """Render the QR matrix to an RGBA PIL image at `px_size` square.

    Uses error-correction level H when a logo is present so the embedded
    logo doesn't break scannability; otherwise level M (good default).
    Hex colors are validated here so the caller's friendly-error path
    catches malformed input before any rendering work.
    """
    fg_rgb = _validate_hex(fg_color, label="fg_color")
    bg_rgb = _validate_hex(bg_color, label="bg_color")

    # Higher error correction when a logo will cover the centre.
    level_name = "H" if logo_bytes else "M"
    ec_level = getattr(qrencoder.QRErrorCorrectLevel, level_name)
    qr = qrencoder.QRCode(None, ec_level)
    qr.addData(data)
    qr.make()

    module_count = qr.getModuleCount()
    border = 4  # standard "quiet zone" of 4 modules
    total_modules = module_count + border * 2
    # Snap pixel size to an integer multiple of total_modules so every module
    # is sharp (no anti-aliasing seams).
    box = max(1, px_size // total_modules)
    full_px = box * total_modules

    img = Image.new("RGB", (full_px, full_px), bg_rgb)
    # Draw modules directly with putpixel-equivalent via a small RGB block.
    block = Image.new("RGB", (box, box), fg_rgb)
    for r, row in enumerate(qr.modules):
        for c, is_dark in enumerate(row):
            if is_dark:
                img.paste(block, ((c + border) * box, (r + border) * box))

    if logo_bytes:
        try:
            # `with` closes the decoded source; convert always yields a fresh
            # RGBA copy we can paste with transparency.
            with Image.open(io.BytesIO(logo_bytes)) as _logo_src:
                logo = _logo_src.convert("RGBA")
        except Exception as exc:  # pragma: no cover — friendly error path
            raise ValueError("Logo is not a valid image format") from exc
        # Target roughly 20% of the QR width. Error correction H tolerates up to
        # ~30% damage, so 20% gives plenty of margin.
        target = max(box * 4, full_px // 5)
        logo.thumbnail((target, target), Image.LANCZOS)
        # Auto-pad with the QR background so the QR's modules remain readable
        # immediately around the logo (helps scanners lock on).
        pad = max(4, target // 20)
        plate_w, plate_h = logo.width + pad * 2, logo.height + pad * 2
        plate = Image.new("RGBA", (plate_w, plate_h), bg_rgb + (255,))
        plate.paste(logo, (pad, pad), logo)
        # Centre the plate
        cx = (full_px - plate_w) // 2
        cy = (full_px - plate_h) // 2
        img_rgba = img.convert("RGBA")
        img_rgba.paste(plate, (cx, cy), plate)
        img = img_rgba.convert("RGB")

    # Final resize to the requested pixel size if our snapped value differs.
    if full_px != px_size:
        img = img.resize((px_size, px_size), Image.NEAREST)
    return img


def generate_qr_png(
    data: str,
    *,
    size: int = 300,
    fg_color: str = "#000000",
    bg_color: str = "#ffffff",
    logo_bytes: bytes | None = None,
) -> str:
    """Generate a QR PNG with optional fg/bg colors and centre logo."""
    output_path = temp_output("qr", "png")
    img = _build_qr_image(data, px_size=int(size), fg_color=fg_color, bg_color=bg_color, logo_bytes=logo_bytes)
    img.save(str(output_path), "PNG", optimize=True)
    return str(output_path)


def generate_qr_pdf(
    data: str,
    *,
    size: int = 300,
    fg_color: str = "#000000",
    bg_color: str = "#ffffff",
    logo_bytes: bytes | None = None,
) -> str:
    """Generate a standalone single-page PDF containing the QR.

    The PDF page size matches the requested QR pixel size at 72 DPI.
    """
    output_path = temp_output("qr", "pdf")
    img = _build_qr_image(data, px_size=int(size), fg_color=fg_color, bg_color=bg_color, logo_bytes=logo_bytes)

    # Drop the PIL image into a single-page PDF via reportlab so colors travel.
    page_size = float(size)
    c = canvas.Canvas(str(output_path), pagesize=(page_size, page_size))
    img_buf = io.BytesIO()
    img.save(img_buf, "PNG")
    img_buf.seek(0)
    c.drawImage(ImageReader(img_buf), 0, 0, width=page_size, height=page_size)
    c.showPage()
    c.save()
    return str(output_path)


def embed_qr_in_pdf(
    input_path: str,
    data: str,
    *,
    page: int = 1,
    x: float = 50,
    y: float = 50,
    qr_size: float = 100,
    fg_color: str = "#000000",
    bg_color: str = "#ffffff",
    logo_bytes: bytes | None = None,
) -> str:
    output_path = temp_output("qr_embedded", "pdf")

    # Generate QR as PNG first
    qr_png_path = generate_qr_png(
        data,
        size=max(64, int(qr_size)),
        fg_color=fg_color,
        bg_color=bg_color,
        logo_bytes=logo_bytes,
    )

    try:
        with safe_open_pdf(input_path) as pdf:
            page_count = len(pdf.pages)
            # Reject an out-of-range page instead of silently clamping (which
            # stamped the QR onto the wrong page and returned 200).
            if not 1 <= page <= page_count:
                raise ValidationError(
                    f"Page {page} is out of range — the PDF has {page_count} page(s)."
                )
            target_page = pdf.pages[page - 1]

            mediabox = target_page.mediabox
            pg_width = float(mediabox[2]) - float(mediabox[0])
            pg_height = float(mediabox[3]) - float(mediabox[1])

            packet = io.BytesIO()
            c = canvas.Canvas(packet, pagesize=(pg_width, pg_height))
            c.drawImage(ImageReader(qr_png_path), x, y, width=qr_size, height=qr_size, mask="auto")
            c.save()
            packet.seek(0)

            # `with` so the overlay Pdf is closed even if add_overlay/save raises —
            # this runs on a per-request hot path and previously leaked the object.
            # Keep the save inside the block so overlay objects stay resolvable.
            with pikepdf.Pdf.open(packet) as overlay_pdf:
                pikepdf.Page(target_page).add_overlay(overlay_pdf.pages[0])
                pdf.save(str(output_path))
    finally:
        # The intermediate QR PNG is embedded in the output now — drop it (it
        # was previously leaked on every call).
        try:
            os.unlink(qr_png_path)
        except OSError:
            pass

    return str(output_path)

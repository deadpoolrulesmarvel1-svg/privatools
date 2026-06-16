import logging

from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)


# barcode types supported
BARCODE_TYPES = {
    "code128": "code128",
    "code39": "code39",
    "ean13": "ean13",
    "ean8": "ean8",
    "upca": "upca",
    "isbn13": "isbn13",
    "qr": "qr",
}


def generate_barcode(
    data: str,
    barcode_type: str = "code128",
    output_format: str = "png",
) -> str:
    """Generate a barcode image from data.

    Uses python-barcode for linear barcodes, qrcode for QR codes.
    Invalid data must raise ValueError instead of producing a placeholder:
    callers need a real failure, not a PNG that merely looks barcode-ish.
    """
    if barcode_type == "qr":
        import qrcode

        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(data)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        out = temp_output("barcode", "png")
        img.save(str(out))
        return str(out)

    try:
        import barcode
        from barcode.writer import ImageWriter

        bc_class = barcode.get_barcode_class(barcode_type)
        bc = bc_class(data, writer=ImageWriter())
        # `bc.save()` returns the path with the extension appended, so
        # we pass an extensionless stem here.
        out = temp_output("barcode", None)
        return bc.save(str(out))
    except (KeyError, ValueError, IndexError) as exc:
        # KeyError → unknown barcode type via get_barcode_class.
        # ValueError/IndexError → invalid data for the chosen type
        # (e.g. EAN-13 needs 12 digits + check).
        logger.warning(
            "Barcode generation rejected invalid input for type=%s: %s",
            barcode_type, exc,
        )
        raise ValueError(f"Invalid data for {barcode_type} barcode") from exc

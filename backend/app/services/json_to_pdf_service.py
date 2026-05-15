import json
import os
import uuid

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from ..utils.cleanup import ensure_temp_dir, get_temp_path

# Caps to keep one request from spinning up an unbounded ReportLab canvas.
MAX_INPUT_BYTES = 5 * 1024 * 1024     # 5 MB JSON file
MAX_DEPTH = 25                         # arbitrary nesting cap
MAX_PRETTY_LINES = 50_000              # ~5,000 PDF pages worst-case


def _validate_depth(obj, depth: int = 0) -> None:
    """Raise ValueError if the JSON tree nests more than MAX_DEPTH levels —
    protects ReportLab from generating a comically long PDF.
    """
    if depth > MAX_DEPTH:
        raise ValueError(f"JSON nests deeper than {MAX_DEPTH} levels — too deep to render.")
    if isinstance(obj, dict):
        for v in obj.values():
            _validate_depth(v, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            _validate_depth(v, depth + 1)


def json_to_pdf(input_path: str) -> str:
    """Convert a JSON file to a formatted PDF."""
    ensure_temp_dir()
    output_path = get_temp_path(f"json_{uuid.uuid4().hex}.pdf")

    if os.path.getsize(input_path) > MAX_INPUT_BYTES:
        raise ValueError(f"JSON file too large (>{MAX_INPUT_BYTES // (1024 * 1024)} MB).")

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    _validate_depth(data)

    c = canvas.Canvas(str(output_path), pagesize=A4)
    width, height = A4
    margin = 54
    y = height - margin
    font_size = 9
    line_height = 12

    c.setFont("Courier", font_size)

    # Pretty-print JSON
    formatted = json.dumps(data, indent=2, ensure_ascii=False)
    lines = formatted.split("\n")
    if len(lines) > MAX_PRETTY_LINES:
        raise ValueError(
            f"JSON would render {len(lines):,} lines (cap {MAX_PRETTY_LINES:,}) — "
            "consider trimming the input."
        )

    for line in lines:
        if y < margin:
            c.showPage()
            c.setFont("Courier", font_size)
            y = height - margin

        # Colorize keys vs values
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        x = margin + indent * 4.5

        if ":" in stripped and stripped.startswith('"'):
            # Key-value pair - draw key in bold
            key_end = stripped.index(":")
            key = stripped[:key_end + 1]
            val = stripped[key_end + 1:]
            c.setFont("Courier-Bold", font_size)
            c.setFillColorRGB(0.2, 0.2, 0.6)
            c.drawString(x, y, key)
            kw = c.stringWidth(key, "Courier-Bold", font_size)
            c.setFont("Courier", font_size)
            c.setFillColorRGB(0, 0, 0)
            c.drawString(x + kw, y, val)
        else:
            c.drawString(x, y, stripped)

        y -= line_height

    c.save()
    return str(output_path)

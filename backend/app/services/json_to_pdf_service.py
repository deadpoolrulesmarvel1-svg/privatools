import json
import os
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from ..utils.exceptions import FileTooLargeError, ValidationError
from ..utils.filenames import temp_output

# Caps to keep one request from spinning up an unbounded ReportLab canvas.
MAX_INPUT_BYTES = 5 * 1024 * 1024     # 5 MB JSON file
MAX_DEPTH = 25                         # arbitrary nesting cap
MAX_PRETTY_LINES = 50_000              # ~5,000 PDF pages worst-case

# The refusals below reach the visitor as they are, so they avoid the words
# the website's friendlyError turns into advice about damaged or locked PDFs
# ("malformed", "corrupt", "password", "too large", ...).
TOO_DEEP = f"This JSON nests deeper than {MAX_DEPTH} levels, too deep to print."


def _validate_depth(obj, depth: int = 0) -> None:
    """Raise :class:`ValidationError` if the JSON tree nests more than MAX_DEPTH levels —
    protects ReportLab from generating a comically long PDF.
    """
    if depth > MAX_DEPTH:
        raise ValidationError(TOO_DEEP)
    if isinstance(obj, dict):
        for v in obj.values():
            _validate_depth(v, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            _validate_depth(v, depth + 1)


def _load(input_path: str):
    """The parsed JSON, or a refusal that says what is wrong with the file."""
    if os.path.getsize(input_path) > MAX_INPUT_BYTES:
        raise FileTooLargeError(
            f"This JSON file is bigger than {MAX_INPUT_BYTES // (1024 * 1024)} MB, the most JSON to PDF takes."
        )
    try:
        # Given bytes, json works out the encoding itself: UTF-8 with or
        # without a byte order mark (Windows tools often write one), UTF-16
        # (what Windows PowerShell 5.1's > and Out-File write) or UTF-32.
        # Reading the file as UTF-8 text refused all but BOM-less UTF-8.
        return json.loads(Path(input_path).read_bytes())
    except json.JSONDecodeError as exc:
        raise ValidationError(
            f"This file is not valid JSON: {exc.msg} at line {exc.lineno}, column {exc.colno}."
        ) from exc
    except UnicodeDecodeError as exc:
        raise ValidationError("This file is not valid JSON: it is not text in UTF-8, UTF-16 or UTF-32.") from exc
    except RecursionError as exc:  # thousands of levels, before _validate_depth can say so
        raise ValidationError(TOO_DEEP) from exc


def json_to_pdf(input_path: str) -> str:
    """Convert a JSON file to a formatted PDF."""
    data = _load(input_path)
    _validate_depth(data)
    output_path = temp_output("json", "pdf")

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
        raise ValidationError(
            f"This JSON would print as {len(lines):,} lines, and JSON to PDF prints at most "
            f"{MAX_PRETTY_LINES:,}. Split it into smaller files."
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

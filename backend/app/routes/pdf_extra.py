import asyncio
import csv
import io
import json
import logging
import os
import re
import tempfile
import uuid
import zipfile

import fitz
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from starlette.background import BackgroundTask

from ..utils.cleanup import remove_files, validate_pdf_content
from ..utils.exceptions import PdfEncryptedError
from ..utils.page_space import drawing_unturned
from ..utils.render import safe_get_pixmap

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_FORM_FIELDS = 300
MAX_FORM_OPTIONS = 50
MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024  # effectively unlimited
MAX_TEXT_BYTES = 2 * 1024 * 1024 * 1024


async def _read_upload(file: UploadFile, max_bytes: int, label: str) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail=f"{label} is empty")
    return data


def _open_pdf(data: bytes) -> fitz.Document:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except fitz.FileDataError as exc:
        raise HTTPException(status_code=400, detail="Invalid or corrupted PDF") from exc
    if doc.needs_pass:
        # PyMuPDF opens it, then fails on the first page it reads, which the
        # routes here answered as a 500 ("Processing failed").
        doc.close()
        raise HTTPException(status_code=400, detail=PdfEncryptedError.default_detail)
    return doc


class _TempPath:
    """Tiny shim that mimics the relevant ``tempfile.NamedTemporaryFile``
    surface (``.name``, ``.close()``) but is created via ``mkstemp`` so
    there's no race between creating the file under one path and reopening
    it under the same path. Existing callers that do ``tmp.close()``
    followed by writing to ``tmp.name`` keep working unchanged.
    """

    __slots__ = ("name", "_fd")

    def __init__(self, suffix: str) -> None:
        self._fd, self.name = tempfile.mkstemp(suffix=suffix)

    def close(self) -> None:
        # Close the fd if it's still open. Safe to call multiple times.
        fd = self._fd
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
            self._fd = None  # type: ignore[assignment]


def _new_temp_file(suffix: str) -> "_TempPath":
    return _TempPath(suffix)


def _to_float(value: object, label: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{label} must be a number") from exc


def _to_int(value: object, label: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{label} must be an integer") from exc


def _parse_form_fields(raw: str) -> list[dict]:
    if not (raw or "").strip():
        raise HTTPException(status_code=400, detail="form_fields is required")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="form_fields must be valid JSON") from exc

    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="form_fields must be a JSON array")
    if not parsed:
        raise HTTPException(status_code=400, detail="form_fields must contain at least one field")
    if len(parsed) > MAX_FORM_FIELDS:
        raise HTTPException(status_code=400, detail=f"form_fields cannot exceed {MAX_FORM_FIELDS} items")

    normalized: list[dict] = []
    widget_count = 0
    for idx, item in enumerate(parsed, start=1):
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail=f"Field #{idx} must be an object")

        name = str(item.get("name", "")).strip()
        if not name:
            raise HTTPException(status_code=400, detail=f"Field #{idx} name is required")
        if len(name) > 80:
            raise HTTPException(status_code=400, detail=f"Field #{idx} name must be <= 80 characters")

        field_type = str(item.get("type", "text")).strip().lower()
        if field_type not in {"text", "checkbox", "radio", "combobox", "listbox", "signature"}:
            raise HTTPException(status_code=400, detail=f"Field #{idx} has unsupported type '{field_type}'")

        page = _to_int(item.get("page", 1), f"Field #{idx} page")
        x = _to_float(item.get("x"), f"Field #{idx} x")
        y = _to_float(item.get("y"), f"Field #{idx} y")
        width = _to_float(item.get("width"), f"Field #{idx} width")
        height = _to_float(item.get("height"), f"Field #{idx} height")
        if page < 1:
            raise HTTPException(status_code=400, detail=f"Field #{idx} page must be >= 1")
        if width <= 0 or height <= 0:
            raise HTTPException(status_code=400, detail=f"Field #{idx} width/height must be > 0")

        field_data: dict[str, object] = {
            "name": name,
            "type": field_type,
            "page": page,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "required": bool(item.get("required", False)),
        }

        if field_type == "text":
            field_data["value"] = str(item.get("value", ""))
            field_data["multiline"] = bool(item.get("multiline", False))
        elif field_type == "checkbox":
            field_data["checked"] = bool(item.get("checked", False))
        elif field_type in {"combobox", "listbox", "radio"}:
            raw_options = item.get("options", [])
            if isinstance(raw_options, str):
                options = [o.strip() for o in raw_options.split(",") if o.strip()]
            elif isinstance(raw_options, list):
                options = [str(o).strip() for o in raw_options if str(o).strip()]
            else:
                options = []
            if not options:
                raise HTTPException(status_code=400, detail=f"Field #{idx} options are required for {field_type}")
            if len(options) > MAX_FORM_OPTIONS:
                raise HTTPException(status_code=400, detail=f"Field #{idx} options cannot exceed {MAX_FORM_OPTIONS}")
            field_data["options"] = options
            field_data["value"] = str(item.get("value", options[0]))
            if field_type == "radio":
                # Each option becomes a button whose "on" state is named after
                # it, so options must differ, and Off already means "none".
                if len(set(options)) != len(options):
                    raise HTTPException(status_code=400, detail=f"Field #{idx} options must all be different")
                if any(o.lower() == "off" for o in options):
                    raise HTTPException(status_code=400, detail=f"Field #{idx} cannot use Off as an option")
                value = str(field_data["value"]).strip()
                if value and value != "Off" and value not in options:
                    raise HTTPException(status_code=400, detail=f"Field #{idx} default value must be one of its options")
                field_data["value"] = "" if value == "Off" else value

        widget_count += len(field_data["options"]) if field_type == "radio" else 1
        normalized.append(field_data)

    if widget_count > MAX_FORM_FIELDS:
        raise HTTPException(
            status_code=400,
            detail=f"form_fields cannot exceed {MAX_FORM_FIELDS} fields; each radio option counts as one",
        )
    return normalized


@router.post("/pdf-to-epub")
async def pdf_to_epub(file: UploadFile = File(...)):
    """Convert PDF to simple EPUB by extracting text per page."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    data = await _read_upload(file, MAX_PDF_BYTES, "PDF")
    validate_pdf_content(data)

    tmp = None
    try:
        tmp = _new_temp_file(".epub")
        tmp.close()

        def _work(out_path: str) -> None:
            doc = _open_pdf(data)
            try:
                pages_html: list[str] = []
                for i, page in enumerate(doc):
                    text = page.get_text("html")
                    pages_html.append(f'<div id="page{i + 1}">{text}</div>')

                with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
                    archive.writestr(
                        "META-INF/container.xml",
                        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
                    )
                    content_html = f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Converted PDF</title></head><body>{"".join(pages_html)}</body></html>'
                    archive.writestr("content.xhtml", content_html)
                    archive.writestr(
                        "content.opf",
                        """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:{uuid.uuid4()}</dc:identifier><dc:title>Converted PDF</dc:title><dc:language>en</dc:language></metadata>
<manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="content"/></spine>
</package>""",
                    )
            finally:
                doc.close()

        await asyncio.to_thread(_work, tmp.name)

        cleanup = BackgroundTask(remove_files, tmp.name)
        return FileResponse(tmp.name, media_type="application/epub+zip", filename="converted.epub", background=cleanup)
    except HTTPException:
        if tmp is not None:
            remove_files(tmp.name)
        raise
    except Exception as exc:
        if tmp is not None:
            remove_files(tmp.name)
        logger.exception("pdf-to-epub error")
        raise HTTPException(status_code=500, detail="PDF to EPUB conversion failed") from exc


@router.post("/markdown-to-pdf")
async def markdown_to_pdf(file: UploadFile = File(...)):
    """Convert Markdown text to PDF with full formatting support."""
    fname = (file.filename or "").lower()
    if not any(fname.endswith(ext) for ext in (".md", ".markdown", ".txt")):
        raise HTTPException(status_code=400, detail="Please upload a .md, .markdown, or .txt file")
    raw = await _read_upload(file, MAX_TEXT_BYTES, "Input file")
    text = raw.decode("utf-8", errors="replace")

    # Try to use a proper Markdown parser; fall back to regex for basic formatting
    try:
        import mistune
        html_body = mistune.html(text)
    except ImportError:
        try:
            import markdown
            html_body = markdown.markdown(text, extensions=["tables", "fenced_code", "codehilite"])
        except ImportError:
            # Absolute fallback: basic regex
            html_body = text
            html_body = re.sub(r"^### (.+)$", r"<h3>\1</h3>", html_body, flags=re.MULTILINE)
            html_body = re.sub(r"^## (.+)$", r"<h2>\1</h2>", html_body, flags=re.MULTILINE)
            html_body = re.sub(r"^# (.+)$", r"<h1>\1</h1>", html_body, flags=re.MULTILINE)
            html_body = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", html_body)
            html_body = re.sub(r"\*(.+?)\*", r"<i>\1</i>", html_body)
            html_body = re.sub(r"`(.+?)`", r"<code>\1</code>", html_body)
            html_body = re.sub(r"^- (.+)$", r"<li>\1</li>", html_body, flags=re.MULTILINE)
            html_body = html_body.replace("\n\n", "<br/><br/>")

    full_html = (
        "<html><head><style>"
        "body{font-family:sans-serif;font-size:11px;line-height:1.6;color:#222}"
        "h1{font-size:22px;color:#1a1a2e;border-bottom:2px solid #e0e0e0;padding-bottom:6px;margin-top:18px}"
        "h2{font-size:18px;color:#16213e;margin-top:14px}"
        "h3{font-size:15px;color:#333;margin-top:12px}"
        "code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-size:10px;font-family:monospace}"
        "pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow-x:auto;font-size:10px}"
        "pre code{background:none;padding:0}"
        "table{border-collapse:collapse;width:100%;margin:12px 0}"
        "th{background:#2d3748;color:#fff;padding:6px 10px;text-align:left;border:1px solid #4a5568;font-size:10px}"
        "td{padding:5px 10px;border:1px solid #cbd5e0;font-size:10px}"
        "tr:nth-child(even) td{background:#f7fafc}"
        "blockquote{border-left:4px solid #667eea;margin:12px 0;padding:8px 16px;background:#f0f4ff;color:#444}"
        "li{margin:3px 0}"
        "a{color:#667eea}"
        "hr{border:none;border-top:1px solid #e0e0e0;margin:16px 0}"
        "</style></head><body>"
        f"{html_body}</body></html>"
    )

    tmp = None
    try:
        tmp = _new_temp_file(".pdf")
        tmp.close()

        def _work(out_path: str) -> None:
            # Use fitz Story for proper multi-page rendering
            try:
                writer = fitz.DocumentWriter(out_path)
                story = fitz.Story(html=full_html)
                mediabox = fitz.paper_rect("a4")
                where = mediabox + fitz.Rect(50, 50, -50, -50)
                more = True
                while more:
                    dev = writer.begin_page(mediabox)
                    more, _ = story.place(where)
                    story.draw(dev)
                    writer.end_page()
                writer.close()
            except Exception as e:
                # Fallback for older PyMuPDF versions
                doc = fitz.open()
                page = doc.new_page()
                try:
                    rect = page.rect + fitz.Rect(40, 40, -40, -40)
                    page.insert_htmlbox(rect, full_html)
                except Exception as e:
                    page.insert_text((40, 60), text, fontsize=11)
                doc.save(out_path)
                doc.close()

        await asyncio.to_thread(_work, tmp.name)

        cleanup = BackgroundTask(remove_files, tmp.name)
        return FileResponse(tmp.name, media_type="application/pdf", filename="document.pdf", background=cleanup)
    except Exception as exc:
        if tmp is not None:
            remove_files(tmp.name)
        logger.exception("markdown-to-pdf error")
        raise HTTPException(status_code=500, detail="Markdown to PDF conversion failed") from exc


@router.post("/csv-to-pdf")
async def csv_to_pdf(file: UploadFile = File(...)):
    """Convert CSV to a PDF table."""
    fname = (file.filename or "").lower()
    if not any(fname.endswith(ext) for ext in (".csv", ".tsv", ".txt")):
        raise HTTPException(status_code=400, detail="Please upload a .csv or .tsv file")
    raw = await _read_upload(file, MAX_TEXT_BYTES, "CSV file")
    text = raw.decode("utf-8", errors="replace")

    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    # Build HTML table with styling
    html_parts = [
        '<html><head><style>',
        'body { font-family: sans-serif; font-size: 9px; }',
        'table { border-collapse: collapse; width: 100%; }',
        'th { background: #2d3748; color: #fff; font-weight: bold; padding: 6px 8px; text-align: left; border: 1px solid #4a5568; }',
        'td { padding: 4px 8px; border: 1px solid #cbd5e0; }',
        'tr:nth-child(even) td { background: #f7fafc; }',
        '</style></head><body><table>',
    ]

    # First row as header
    html_parts.append('<tr>')
    for cell in rows[0]:
        escaped = str(cell).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        html_parts.append(f'<th>{escaped}</th>')
    html_parts.append('</tr>')

    # Data rows (no truncation)
    for row in rows[1:]:
        html_parts.append('<tr>')
        for cell in row:
            escaped = str(cell).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            html_parts.append(f'<td>{escaped}</td>')
        html_parts.append('</tr>')

    html_parts.append('</table></body></html>')
    html_content = ''.join(html_parts)

    tmp = None
    try:
        tmp = _new_temp_file(".pdf")
        tmp.close()

        def _work(out_path: str) -> None:
            # Use fitz Story for multi-page HTML rendering
            try:
                writer = fitz.DocumentWriter(out_path)
                story = fitz.Story(html=html_content)
                mediabox = fitz.paper_rect("a4")
                where = mediabox + fitz.Rect(30, 30, -30, -30)
                more = True
                while more:
                    dev = writer.begin_page(mediabox)
                    more, _ = story.place(where)
                    story.draw(dev)
                    writer.end_page()
                writer.close()
            except Exception as e:
                # Fallback for older PyMuPDF versions
                doc = fitz.open()
                page = doc.new_page()
                y = 40
                for row in rows:
                    line = " | ".join(str(cell) for cell in row)
                    if y > page.rect.height - 40:
                        page = doc.new_page()
                        y = 40
                    page.insert_text((40, y), line, fontsize=9)
                    y += 14
                doc.save(out_path)
                doc.close()

        await asyncio.to_thread(_work, tmp.name)

        cleanup = BackgroundTask(remove_files, tmp.name)
        return FileResponse(tmp.name, media_type="application/pdf", filename="table.pdf", background=cleanup)
    except Exception as exc:
        if tmp is not None:
            remove_files(tmp.name)
        logger.exception("csv-to-pdf error")
        raise HTTPException(status_code=500, detail="CSV to PDF conversion failed") from exc


@router.post("/add-hyperlinks")
async def add_hyperlinks(file: UploadFile = File(...)):
    """Auto-detect URLs in a PDF and make them clickable."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    data = await _read_upload(file, MAX_PDF_BYTES, "PDF")
    validate_pdf_content(data)

    tmp = None
    try:
        tmp = _new_temp_file(".pdf")
        tmp.close()

        def _work(out_path: str) -> None:
            doc = _open_pdf(data)
            try:
                url_pattern = re.compile(r"https?://[^\s<>\"{}|\\^`\[\]]+")

                for page in doc:
                    text_dict = page.get_text("dict")
                    for block in text_dict.get("blocks", []):
                        for line in block.get("lines", []):
                            for span in line.get("spans", []):
                                urls = url_pattern.finditer(span.get("text", ""))
                                span_text = span.get("text", "")
                                text_len = len(span_text) or 1
                                found_any = False
                                for match in urls:
                                    found_any = True
                                    url = match.group()
                                    # Calculate proportional rect for this URL within the span
                                    full_rect = fitz.Rect(span["bbox"])
                                    span_width = full_rect.width
                                    char_start = match.start() / text_len
                                    char_end = match.end() / text_len
                                    url_rect = fitz.Rect(
                                        full_rect.x0 + span_width * char_start,
                                        full_rect.y0,
                                        full_rect.x0 + span_width * char_end,
                                        full_rect.y1,
                                    )
                                    page.insert_link({"kind": 2, "from": url_rect, "uri": url})
                                if not found_any:
                                    continue

                doc.save(out_path)
            finally:
                doc.close()

        await asyncio.to_thread(_work, tmp.name)

        cleanup = BackgroundTask(remove_files, tmp.name)
        return FileResponse(tmp.name, media_type="application/pdf", filename="linked.pdf", background=cleanup)
    except HTTPException:
        if tmp is not None:
            remove_files(tmp.name)
        raise
    except Exception as exc:
        if tmp is not None:
            remove_files(tmp.name)
        logger.exception("add-hyperlinks error")
        raise HTTPException(status_code=500, detail="Failed to add hyperlinks") from exc


_RADIO = 1 << 15              # field flag: the buttons form a radio group
_NO_TOGGLE_TO_OFF = 1 << 14   # field flag: clicking the chosen button keeps it chosen
_REQUIRED = 1 << 1
_RADIO_BUTTON_MAX = 14.0      # points
_RADIO_LABEL_MAX = 11.0       # the size text fields use
_RADIO_LABEL_GAP = 4.0


def _pdf_name(text: str) -> str:
    """`text` as a PDF name token, #-escaping what name syntax does not allow."""
    return "/" + "".join(
        chr(byte) if 0x21 <= byte <= 0x7E and chr(byte) not in "()<>[]{}/%#" else f"#{byte:02X}"
        for byte in text.encode("utf-8")
    )


def _radio_layout(rect: fitz.Rect, options: list[str]):
    """Place a button per option inside the box the user drew.

    The options share the box equally, stacked when it is taller than it is
    wide and side by side otherwise. Each label sits right of its button,
    shrunk where needed to leave a gap before the next option. Yields (option,
    button rect, label baseline point, label font size); a size of 0 means no
    room.
    """
    stacked = rect.height > rect.width
    step = (rect.height if stacked else rect.width) / len(options)
    for i, option in enumerate(options):
        if stacked:
            cell = fitz.Rect(rect.x0, rect.y0 + i * step, rect.x1, rect.y0 + (i + 1) * step)
        else:
            cell = fitz.Rect(rect.x0 + i * step, rect.y0, rect.x0 + (i + 1) * step, rect.y1)
        size = min(cell.width, cell.height, _RADIO_BUTTON_MAX)
        middle = (cell.y0 + cell.y1) / 2
        button = fitz.Rect(cell.x0, middle - size / 2, cell.x0 + size, middle + size / 2)
        room = cell.x1 - button.x1 - 2 * _RADIO_LABEL_GAP
        width_at_1pt = fitz.get_text_length(option, fontname="helv", fontsize=1)
        fontsize = min(_RADIO_LABEL_MAX, 0.8 * size, room / width_at_1pt) if room > 0 and width_at_1pt else 0
        # 0.35 em below the middle puts the middle of Helvetica's capitals there.
        yield option, button, fitz.Point(button.x1 + _RADIO_LABEL_GAP, middle + 0.35 * fontsize), fontsize


def _delete_keys(doc: fitz.Document, xref: int, keys: tuple[str, ...]) -> None:
    """Remove `keys` from the dictionary `xref`.

    PyMuPDF's xref_set_key(..., "null") keeps the key with a null value. The
    PDF spec treats that as absent, but PDFium (Chrome's viewer) does not: a
    radio button with /FT null does not inherit its group's /FT.
    """
    for key in keys:
        doc.xref_set_key(xref, key, "null")
    pattern = r"/(?:%s) null(?=[\s/>])" % "|".join(keys)
    doc.update_object(xref, re.sub(pattern, "", doc.xref_object(xref, compressed=True)))


def _replace_fields(doc: fitz.Document, old: list[int], new: int) -> None:
    """Replace the AcroForm /Fields entries `old` with one entry `new`.

    Keys are only set on the object that holds them: PyMuPDF's xref_set_key
    cannot write through an indirect object on a key path.
    """
    catalog = doc.pdf_catalog()
    kind, value = doc.xref_get_key(catalog, "AcroForm")
    owner, key = (int(value.split()[0]), "Fields") if kind == "xref" else (catalog, "AcroForm/Fields")
    kind, value = doc.xref_get_key(owner, key)
    if kind == "xref":  # the array is an object of its own
        owner, key = int(value.split()[0]), None
        value = doc.xref_object(owner, compressed=True)
    entries: list[str] = []
    for num, gen in re.findall(r"(\d+) (\d+) R", value):
        if int(num) not in old:
            entries.append(f"{num} {gen} R")
        elif f"{new} 0 R" not in entries:
            entries.append(f"{new} 0 R")
    array = f"[{' '.join(entries)}]"
    if key is None:
        doc.update_object(owner, array)
    else:
        doc.xref_set_key(owner, key, array)


def _add_radio_group(doc: fitz.Document, page: fitz.Page, field: dict, rect: fitz.Rect) -> None:
    """Add a radio group: one field for the name, flags and chosen option,
    with a button per option as its kids, each labelled on the page.

    PyMuPDF cannot build this. Each button is added as a radio widget in the
    Off state, because switching a new radio on fails inside PyMuPDF (its
    check reads the widget's Parent/Kids before the widget has an xref). The
    buttons then move under a new parent field, and each one's "on"
    appearance, which MuPDF names Yes, is renamed after its option.
    """
    name = str(field["name"])
    chosen = str(field.get("value", ""))
    buttons: list[tuple[str, int]] = []
    for option, button, label_at, fontsize in _radio_layout(rect, list(field["options"])):
        widget = fitz.Widget()
        widget.field_type = fitz.PDF_WIDGET_TYPE_RADIOBUTTON
        widget.field_name = name
        widget.rect = button
        widget.border_color = (0, 0, 0)
        widget.border_width = 1
        widget.fill_color = (1, 1, 1)
        widget.field_value = False
        buttons.append((option, page.add_widget(widget).xref))
        if fontsize:
            page.insert_text(label_at, option, fontname="helv", fontsize=fontsize)

    flags = _RADIO | _NO_TOGGLE_TO_OFF | (_REQUIRED if field.get("required") else 0)
    parent = doc.get_new_xref()
    doc.update_object(parent, (
        f"<</FT/Btn/Ff {flags}/T{fitz.get_pdf_str(name)}/TU{fitz.get_pdf_str(name)}"
        f"/V{_pdf_name(chosen) if chosen else '/Off'}"
        f"/Kids[{' '.join(f'{xref} 0 R' for _, xref in buttons)}]>>"
    ))
    for option, xref in buttons:
        on_kind, on_look = doc.xref_get_key(xref, "AP/N/Yes")
        off_kind, off_look = doc.xref_get_key(xref, "AP/N/Off")
        if on_kind != "xref" or off_kind != "xref":
            raise RuntimeError("PyMuPDF did not draw the radio button's on and off appearances")
        _delete_keys(doc, xref, ("FT", "Ff", "T", "TU", "V"))  # the group holds these
        doc.xref_set_key(xref, "Parent", f"{parent} 0 R")
        doc.xref_set_key(xref, "AP/N", f"<<{_pdf_name(option)} {on_look}/Off {off_look}>>")
        doc.xref_set_key(xref, "AS", _pdf_name(option) if option == chosen else "/Off")
        doc.xref_set_key(xref, "MK/CA", "(l)")  # the dot viewers draw when they redraw it
    _replace_fields(doc, [xref for _, xref in buttons], parent)


FORM_FIELDS_DESCRIPTION = (
    "JSON array of fields. Each has `name`, `type` (text, checkbox, radio, combobox, listbox "
    "or signature), `page`, counted from 1, and `x`, `y`, `width` and `height` in points "
    "(1/72 inch) from the top-left corner of the page's visible area (its CropBox), before any "
    "/Rotate setting it has is applied; the box must lie on the page. Optional `required`; "
    "`value` and `multiline` (text), `checked` (checkbox), `options` and `value` (radio, "
    "combobox, listbox)."
)


@router.post("/form-creator")
async def form_creator(
    file: UploadFile = File(...),
    form_fields: str = Form(..., description=FORM_FIELDS_DESCRIPTION),
):
    """Create fillable form fields in an existing PDF."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    fields = _parse_form_fields(form_fields)
    data = await _read_upload(file, MAX_PDF_BYTES, "PDF")
    validate_pdf_content(data)

    tmp = None
    try:
        tmp = _new_temp_file(".pdf")
        tmp.close()

        def _work(out_path: str) -> None:
            doc = _open_pdf(data)
            try:
                if len(doc) == 0:
                    raise HTTPException(status_code=400, detail="PDF has no pages")

                seen_names: set[str] = set()
                for idx, field in enumerate(fields, start=1):
                    page_index = int(field["page"]) - 1
                    if page_index < 0 or page_index >= len(doc):
                        raise HTTPException(status_code=400, detail=f"Field #{idx} references page {field['page']} but PDF has {len(doc)} pages")

                    name = str(field["name"]).strip()
                    field_type = str(field["type"])
                    if name in seen_names:
                        raise HTTPException(status_code=400, detail=f"Duplicate field name '{name}' is not allowed")
                    seen_names.add(name)

                    page = doc[page_index]
                    rect = fitz.Rect(
                        float(field["x"]),
                        float(field["y"]),
                        float(field["x"]) + float(field["width"]),
                        float(field["y"]) + float(field["height"]),
                    )
                    # Fields are measured on the page as stored, from the top-left
                    # corner of its visible area, before /Rotate. Unturned, the
                    # page's rect is that area; turned, it is the page as shown,
                    # which refused good fields and passed ones off the page.
                    with drawing_unturned(page):
                        _add_field(doc, page, field, name, field_type, rect)

                try:
                    doc.need_appearances(True)
                except Exception as e:
                    pass
                doc.save(out_path)
            finally:
                doc.close()

        await asyncio.to_thread(_work, tmp.name)

        cleanup = BackgroundTask(remove_files, tmp.name)
        return FileResponse(tmp.name, media_type="application/pdf", filename="form.pdf", background=cleanup)
    except HTTPException:
        if tmp is not None:
            remove_files(tmp.name)
        raise
    except Exception as exc:
        if tmp is not None:
            remove_files(tmp.name)
        logger.exception("form-creator error")
        raise HTTPException(status_code=500, detail="Form creation failed") from exc


def _add_field(doc: fitz.Document, page: fitz.Page, field: dict, name: str, field_type: str, rect: fitz.Rect) -> None:
    """Add one field to `page`, which the caller has unturned (drawing_unturned)."""
    if not page.rect.contains(rect):
        raise HTTPException(status_code=400, detail=f"Field '{name}' rectangle is out of page bounds")

    if field_type == "radio":
        _add_radio_group(doc, page, field, rect)
        return

    widget = fitz.Widget()
    widget.field_name = name
    widget.field_label = name
    widget.rect = rect
    widget.text_font = "Helv"
    widget.text_fontsize = 11
    widget.field_flags = 0
    if bool(field.get("required")):
        widget.field_flags |= (1 << 1)

    if field_type == "text":
        widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
        widget.field_value = str(field.get("value", ""))
        if bool(field.get("multiline", False)):
            widget.field_flags |= (1 << 12)
    elif field_type == "checkbox":
        widget.field_type = fitz.PDF_WIDGET_TYPE_CHECKBOX
        widget.field_value = "Yes" if bool(field.get("checked", False)) else "Off"
    elif field_type == "combobox":
        widget.field_type = fitz.PDF_WIDGET_TYPE_COMBOBOX
        widget.choice_values = [str(o) for o in field.get("options", [])]
        widget.field_value = str(field.get("value", ""))
    elif field_type == "listbox":
        widget.field_type = fitz.PDF_WIDGET_TYPE_LISTBOX
        widget.choice_values = [str(o) for o in field.get("options", [])]
        widget.field_value = str(field.get("value", ""))
    elif field_type == "signature":
        widget.field_type = fitz.PDF_WIDGET_TYPE_SIGNATURE
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported field type: {field_type}")

    page.add_widget(widget)


@router.post("/transparent-background")
async def transparent_background(
    file: UploadFile = File(...),
    threshold: int = Form(245, ge=180, le=255),
    dpi: int = Form(144, ge=72, le=300),
):
    """Convert near-white pixels to transparent by rasterizing each page."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    data = await _read_upload(file, MAX_PDF_BYTES, "PDF")
    validate_pdf_content(data)

    tmp = None
    try:
        tmp = _new_temp_file(".pdf")
        tmp.close()

        def _work(out_path: str) -> None:
            src_doc = _open_pdf(data)
            out_doc = fitz.open()
            try:
                if len(src_doc) == 0:
                    raise HTTPException(status_code=400, detail="PDF has no pages")

                matrix = fitz.Matrix(dpi / 72, dpi / 72)

                for page in src_doc:
                    pix = safe_get_pixmap(page, matrix=matrix, alpha=False)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    rgba = img.convert("RGBA")
                    rgb_data = list(img.getdata())
                    rgba_data = [
                        (r, g, b, 0 if (r >= threshold and g >= threshold and b >= threshold) else 255)
                        for (r, g, b) in rgb_data
                    ]
                    rgba.putdata(rgba_data)

                    png_bytes = io.BytesIO()
                    rgba.save(png_bytes, format="PNG", optimize=True)

                    out_page = out_doc.new_page(width=page.rect.width, height=page.rect.height)
                    out_page.insert_image(out_page.rect, stream=png_bytes.getvalue())

                out_doc.save(out_path, deflate=True, clean=True)
            finally:
                src_doc.close()
                out_doc.close()

        await asyncio.to_thread(_work, tmp.name)

        cleanup = BackgroundTask(remove_files, tmp.name)
        return FileResponse(tmp.name, media_type="application/pdf", filename="transparent.pdf", background=cleanup)
    except HTTPException:
        if tmp is not None:
            remove_files(tmp.name)
        raise
    except Exception as exc:
        if tmp is not None:
            remove_files(tmp.name)
        logger.exception("transparent-background error")
        raise HTTPException(status_code=500, detail="Transparent background conversion failed") from exc

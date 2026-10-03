"""WeasyPrint's log lines never carry a visitor's data: URI whole.

WeasyPrint logs every picture or stylesheet it leaves out with its URL
("Failed to load image at 'data:image/png;base64,iVBORw0...'"), so a picture
inlined in the HTML sent to HTML to PDF put the whole picture, in base64, in
the server's logs. utils.weasyprint_loader shortens a data: URI in any
WeasyPrint log record to its media type and size.
"""

from __future__ import annotations

import base64
import io
import logging

import pytest
from PIL import Image

from backend.app.services import html_to_pdf_service as html_service
from backend.app.utils import weasyprint_loader  # noqa: F401  (installs the filter)

PAYLOAD = base64.b64encode(bytes(range(256)) * 12).decode()


def _messages(caplog) -> list[str]:
    return [record.getMessage() for record in caplog.records if record.name.startswith("weasyprint")]


def test_a_data_uri_in_a_weasyprint_record_is_shortened_to_its_type_and_size(caplog):
    uri = "data:image/png;base64," + PAYLOAD
    with caplog.at_level(logging.INFO, logger="weasyprint"):
        logging.getLogger("weasyprint").error("Failed to load image at %r: %s", uri, "ValueError: broken")
    assert _messages(caplog) == [f"Failed to load image at 'data:image/png ({len(uri)} bytes)': ValueError: broken"]


def test_the_progress_logger_is_shortened_too(caplog):
    uri = "data:text/css;base64," + PAYLOAD
    with caplog.at_level(logging.INFO, logger="weasyprint"):
        logging.getLogger("weasyprint.progress").info("Step 2 - Fetching and parsing CSS - %s", uri)
    assert _messages(caplog) == [f"Step 2 - Fetching and parsing CSS - data:text/css ({len(uri)} bytes)"]


def test_a_data_uri_with_spaces_and_quotes_is_shortened_whole(caplog):
    uri = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='10'><text>private words</text></svg>"
    with caplog.at_level(logging.INFO, logger="weasyprint"):
        logging.getLogger("weasyprint").warning("Malformed URL: %s", uri)
    assert _messages(caplog) == [f"Malformed URL: data:image/svg+xml ({len(uri)} bytes)"]


def test_a_data_uri_inside_an_argument_or_the_message_is_shortened(caplog):
    uri = "data:image/gif;base64," + PAYLOAD
    with caplog.at_level(logging.INFO, logger="weasyprint"):
        logging.getLogger("weasyprint").error("Error fetching: %s", ValueError(f'Error fetching "{uri}"'))
        logging.getLogger("weasyprint").warning(f"Invalid image {uri}")
    assert _messages(caplog) == [
        f'Error fetching: Error fetching "data:image/gif ({len(uri)} bytes)"',
        f"Invalid image data:image/gif ({len(uri)} bytes)",
    ]


def test_other_records_are_left_alone(caplog):
    with caplog.at_level(logging.INFO, logger="weasyprint"):
        logging.getLogger("weasyprint.progress").info("Step 5 - Creating layout - Page %d", 3)
        logging.getLogger("weasyprint").warning("Ignored `%s` at %d:%d, %s.", "metadata: x", 4, 2, "unknown property")
        logging.getLogger("weasyprint").error("Failed to load image at %r: %s", "https://example.com/a.png", "404")
    assert _messages(caplog) == [
        "Step 5 - Creating layout - Page 3",
        "Ignored `metadata: x` at 4:2, unknown property.",
        "Failed to load image at 'https://example.com/a.png': 404",
    ]


def test_a_picture_left_out_of_a_conversion_is_not_logged_whole(tmp_path, monkeypatch, caplog):
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 30, 30)).save(buf, "PNG")
    cut_off = base64.b64encode(buf.getvalue()[: len(buf.getvalue()) // 2]).decode()
    css = base64.b64encode(b"h1 { color: rgb(10, 20, 30) }").decode()
    html = (f'<link rel="stylesheet" href="data:text/css;base64,{css}">'
            f'<h1>Before</h1><img src="data:image/png;base64,{cut_off}"><p>After</p>')
    monkeypatch.setattr(html_service, "_weasyprint_ok", None)
    with caplog.at_level(logging.INFO, logger="weasyprint"):
        try:
            html_service._weasyprint_html_to_pdf(html, str(tmp_path / "page.pdf"))
        except ImportError as exc:
            pytest.skip(f"WeasyPrint's native libraries are not available here: {exc}")
    messages = _messages(caplog)
    assert any(message.startswith("Failed to load image at 'data:image/png (") for message in messages), messages
    assert any(message.startswith("Step 2 - Fetching and parsing CSS - data:text/css (") for message in messages), messages
    assert cut_off[:40] not in caplog.text and css not in caplog.text

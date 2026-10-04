"""Extract Tables answers a PDF without a ruled table with a 400 that says so.

The service refuses such a file with ValidationError("No tables found in the
PDF"): a ToolError, not a ValueError. The route caught only ValueError and
HTTPException, so its catch-all turned the refusal into a 500, and the page
said "Processing failed. Please try again." for every intact PDF without
ruled tables, offering a retry that can never work (PR #336 review).
"""

from __future__ import annotations

import fitz  # PyMuPDF
import pytest
from fastapi.testclient import TestClient

from backend.app import main


@pytest.fixture
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


def _pdf(*, ruled_table: bool) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "A letter, with no table in it.", fontsize=12)
    if ruled_table:
        for row in range(3):
            for col in range(3):
                cell = fitz.Rect(72 + col * 120, 100 + row * 24, 192 + col * 120, 124 + row * 24)
                page.draw_rect(cell, color=(0, 0, 0), width=1)
                page.insert_text((cell.x0 + 4, cell.y1 - 7), f"r{row}c{col}", fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


def test_a_pdf_without_a_ruled_table_is_a_400_that_says_so(quiet_client):
    response = quiet_client.post("/api/extract-tables",
                                 files={"file": ("letter.pdf", _pdf(ruled_table=False), "application/pdf")})
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "No tables found in the PDF"


def test_a_ruled_table_is_still_extracted(quiet_client):
    response = quiet_client.post("/api/extract-tables",
                                 files={"file": ("table.pdf", _pdf(ruled_table=True), "application/pdf")})
    assert response.status_code == 200, response.text
    assert response.text.splitlines()[0] == "r0c0,r0c1,r0c2"

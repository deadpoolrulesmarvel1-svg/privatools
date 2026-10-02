"""A PDF that needs a password to open is the visitor's to unlock, not a
server failure.

PyMuPDF opens such a file without complaint and fails only when a page is
read ("document closed or encrypted"). PDF to PNG (and the other PDF to Image
pages), Invert Colors, Deskew and PDF to EPUB answered that as a 500, which
the visitor sees as "Processing failed. Please try again.", so they tried
again, and analytics counted a server fault. Split in Half answered a 400
whose detail was MuPDF's own wording. Each now answers a 400 that says the
PDF is password-protected. A PDF with only an owner password (restrictions,
nothing needed to open it) is processed as before.
"""

from __future__ import annotations

import io

import fitz  # PyMuPDF
import pikepdf
import pytest


def _text_pdf(pages: int) -> bytes:
    doc = fitz.open()
    for n in range(pages):
        doc.new_page().insert_text((72, 72), f"Statement page {n + 1}", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


def _encrypted(pages: int, user: str) -> bytes:
    with pikepdf.open(io.BytesIO(_text_pdf(pages))) as pdf:
        out = io.BytesIO()
        pdf.save(out, encryption=pikepdf.Encryption(user=user, owner="owner-secret", R=6))
        return out.getvalue()


# Every route of this group that opens the PDF with PyMuPDF, and the other
# pages that share PDF to EPUB's opener. Multi-page files take the parallel
# paths (PDF to Image over 3 pages, Invert over 2, Deskew over 2).
ROUTES = {
    "pdf-to-png": ("/api/pdf-to-image", {"format": "png", "dpi": "72"}),
    "pdf-to-tiff": ("/api/pdf-to-image", {"format": "tiff", "dpi": "72"}),
    "invert-colors": ("/api/invert-colors", {"dpi": "72"}),
    "deskew-pdf": ("/api/deskew", {}),
    "pdf-to-epub": ("/api/pdf-to-epub", {}),
    "split-in-half": ("/api/split-in-half", {"direction": "vertical"}),
    "auto-crop": ("/api/auto-crop", {}),
    "nup": ("/api/nup", {"pages_per_sheet": "2"}),
    "add-hyperlinks": ("/api/add-hyperlinks", {}),
    "transparent-background": ("/api/transparent-background", {}),
    # Fix round 1: PDF to PowerPoint answered 500, and PDF to Long Image a
    # 400 in MuPDF's words ("document closed or encrypted").
    "pdf-to-pptx": ("/api/pdf-to-pptx", {}),
    "pdf-to-long-image": ("/api/pdf-to-long-image", {"format": "png", "dpi": "36"}),
}


@pytest.mark.parametrize("pages", [1, 5])
@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_that_needs_a_password_is_refused_with_a_400_that_says_so(client, tool, pages):
    route, form = ROUTES[tool]
    resp = client.post(route, files={"file": ("statement.pdf", _encrypted(pages, user="secret"), "application/pdf")},
                       data=form)
    assert resp.status_code == 400, (tool, resp.status_code, resp.text[:200])
    assert "password-protected" in resp.json()["detail"], resp.text[:200]


@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_with_only_an_owner_password_is_processed(client, tool):
    route, form = ROUTES[tool]
    resp = client.post(route, files={"file": ("statement.pdf", _encrypted(5, user=""), "application/pdf")}, data=form)
    assert resp.status_code == 200, (tool, resp.status_code, resp.text[:200])


def test_the_validator_reports_encryption_instead_of_refusing(client):
    resp = client.post("/api/pdfa-validator",
                       files={"file": ("statement.pdf", _encrypted(1, user="secret"), "application/pdf")})
    assert resp.status_code == 200, resp.text[:200]
    assert any("Encrypted" in note for note in resp.json()["errors"])


def test_open_pdf_document_names_what_is_wrong(tmp_path):
    from backend.app.utils.cleanup import open_pdf_document
    from backend.app.utils.exceptions import PdfCorruptError, PdfEncryptedError

    locked = tmp_path / "locked.pdf"
    locked.write_bytes(_encrypted(1, user="secret"))
    with pytest.raises(PdfEncryptedError):
        open_pdf_document(str(locked))
    with pytest.raises(PdfEncryptedError):
        open_pdf_document(locked.read_bytes())
    with pytest.raises(PdfCorruptError):
        open_pdf_document(b"%PDF-1.7\nthis is not a PDF body at all")
    doc = open_pdf_document(_encrypted(2, user=""))
    try:
        assert len(doc) == 2 and not doc.needs_pass
    finally:
        doc.close()

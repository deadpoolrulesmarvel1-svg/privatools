"""Security/privacy *property* tests.

The existing route tests assert "a PDF/zip comes back". These assert the
security property the tool actually promises — that redaction removes the
underlying text, encryption really encrypts, metadata is really gone, and the
archive extractor rejects path-traversal entries. A tool that returns a 200 but
leaves the secret extractable is a privacy failure these tests would catch.
"""

import io
import json
import zipfile

import fitz  # PyMuPDF
import pikepdf
import pytest


# ---------------------------------------------------------------------------
# /api/redact — the covered text must actually be removed, not just boxed over
# ---------------------------------------------------------------------------

class TestRedactionRemovesText:
    def _pdf_with_two_lines(self) -> bytes:
        doc = fitz.open()
        page = doc.new_page()  # A4-ish, ~595x842
        page.insert_text((72, 100), "REDACTMEPLEASE9182", fontsize=14)
        page.insert_text((72, 700), "KEEPVISIBLEFOOTER", fontsize=14)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        return buf.getvalue()

    def test_redaction_permanently_removes_covered_text(self, client):
        src = self._pdf_with_two_lines()
        # Redact the top ~300pt — covers the secret at y≈100, not the footer at y≈700.
        rects = json.dumps([{"page": 0, "x0": 0, "y0": 0, "x1": 595, "y1": 300}])
        resp = client.post(
            "/api/redact",
            files={"file": ("secret.pdf", src, "application/pdf")},
            data={"redactions": rects, "color": "#000000"},
        )
        assert resp.status_code == 200, resp.text

        out = fitz.open(stream=resp.content, filetype="pdf")
        try:
            text = "".join(page.get_text() for page in out)
        finally:
            out.close()
        # The whole point: the covered text is GONE from the content stream,
        # not merely hidden behind a black rectangle.
        assert "REDACTMEPLEASE9182" not in text, "redacted text is still extractable!"
        # And redaction must not nuke text outside the rectangle.
        assert "KEEPVISIBLEFOOTER" in text


# ---------------------------------------------------------------------------
# /api/protect + /api/unlock — encryption state must actually change
# ---------------------------------------------------------------------------

class TestProtectUnlockEncryptionState:
    PW = "test-pass-123"

    def _protect(self, client, sample_pdf) -> bytes:
        r = client.post(
            "/api/protect",
            files=[("files", ("test.pdf", sample_pdf, "application/pdf"))],
            data={"password": self.PW},
        )
        assert r.status_code == 200, r.text
        return r.content

    def test_protect_output_is_actually_encrypted(self, client, sample_pdf):
        protected = self._protect(client, sample_pdf)
        # Opening without the password must fail; with it must succeed.
        with pytest.raises(pikepdf.PasswordError):
            pikepdf.open(io.BytesIO(protected))
        with pikepdf.open(io.BytesIO(protected), password=self.PW) as pdf:
            assert pdf.is_encrypted

    def test_unlock_output_is_actually_decrypted(self, client, sample_pdf):
        protected = self._protect(client, sample_pdf)
        r = client.post(
            "/api/unlock",
            files=[("files", ("locked.pdf", protected, "application/pdf"))],
            data={"password": self.PW},
        )
        assert r.status_code == 200, r.text
        # The unlocked output opens with NO password.
        with pikepdf.open(io.BytesIO(r.content)) as pdf:
            assert not pdf.is_encrypted


# ---------------------------------------------------------------------------
# /api/strip-metadata — document info must actually be cleared
# ---------------------------------------------------------------------------

class TestStripMetadataClearsInfo:
    def _pdf_with_metadata(self) -> bytes:
        doc = fitz.open()
        doc.new_page().insert_text((72, 72), "content", fontsize=12)
        doc.set_metadata({
            "title": "SECRETTITLE42",
            "author": "SECRETAUTHOR42",
            "subject": "confidential",
            "keywords": "private,secret",
        })
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        return buf.getvalue()

    def test_strip_metadata_removes_title_and_author(self, client):
        src = self._pdf_with_metadata()
        # Sanity: the source really does carry the metadata.
        probe = fitz.open(stream=src, filetype="pdf")
        assert probe.metadata.get("title") == "SECRETTITLE42"
        probe.close()

        resp = client.post(
            "/api/strip-metadata",
            files=[("files", ("meta.pdf", src, "application/pdf"))],
        )
        assert resp.status_code == 200, resp.text

        out = fitz.open(stream=resp.content, filetype="pdf")
        try:
            md = out.metadata
        finally:
            out.close()
        assert not md.get("title"), f"title not cleared: {md.get('title')!r}"
        assert not md.get("author"), f"author not cleared: {md.get('author')!r}"
        assert not md.get("subject")
        assert not md.get("keywords")


# ---------------------------------------------------------------------------
# /api/extract-archive — must reject path-traversal / absolute entries
# ---------------------------------------------------------------------------

class TestExtractArchiveRejectsZipSlip:
    def _zip_with_name(self, name: str) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(name, "pwned")
        return buf.getvalue()

    def test_rejects_parent_traversal_entry(self, client):
        evil = self._zip_with_name("../../evil.txt")
        resp = client.post(
            "/api/extract-archive",
            files={"file": ("evil.zip", evil, "application/zip")},
        )
        assert resp.status_code == 400, resp.text
        assert "traversal" in resp.text.lower() or "unsafe" in resp.text.lower()

    def test_rejects_absolute_path_entry(self, client):
        evil = self._zip_with_name("/etc/cron.d/pwn")
        resp = client.post(
            "/api/extract-archive",
            files={"file": ("evil.zip", evil, "application/zip")},
        )
        assert resp.status_code == 400, resp.text
        assert "absolute" in resp.text.lower() or "unsafe" in resp.text.lower()

    def test_accepts_a_safe_archive(self, client):
        safe = self._zip_with_name("docs/readme.txt")
        resp = client.post(
            "/api/extract-archive",
            files={"file": ("safe.zip", safe, "application/zip")},
        )
        assert resp.status_code == 200, resp.text
        # Result is a re-zipped directory containing the extracted file.
        out = zipfile.ZipFile(io.BytesIO(resp.content))
        assert any(n.endswith("readme.txt") for n in out.namelist())

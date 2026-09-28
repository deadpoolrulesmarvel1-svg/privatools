"""The PDF/A validator reads what a file has, and says only what is true.

A file whose /Metadata is not a stream (a dictionary or an array where the XMP
packet should be) made PyMuPDF's get_xml_metadata raise, and the validator
answered a 500 ("Processing failed. Please try again."). It now reports that
the XMP metadata could not be read, as it reports a file with none.

Its notes said a title and an author are "required for PDF/A". PDF/A does
not require either; the check still looks for them, as its guide says, and
the notes now say what is missing without the false reason.
"""

from __future__ import annotations

import io

import fitz  # PyMuPDF
import pikepdf
import pytest


def _plain() -> bytes:
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Archive copy", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


def _with(modify) -> bytes:
    with pikepdf.open(io.BytesIO(_plain())) as pdf:
        modify(pdf)
        out = io.BytesIO()
        pdf.save(out, fix_metadata_version=False)
        return out.getvalue()


def _validate(client, data: bytes) -> dict:
    resp = client.post("/api/pdfa-validator", files={"file": ("archive.pdf", data, "application/pdf")})
    assert resp.status_code == 200, resp.text[:300]
    return resp.json()


@pytest.mark.parametrize("metadata", ["dictionary", "array"])
def test_metadata_that_is_not_a_stream_is_reported_not_a_500(client, metadata):
    def modify(pdf):
        pdf.Root.Metadata = (pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Metadata))
                             if metadata == "dictionary" else pikepdf.Array([1, 2]))

    result = _validate(client, _with(modify))
    assert result["valid"] is False
    assert any("could not be read" in note for note in result["errors"]), result


def test_a_file_that_claims_pdfa_with_title_and_author_passes(client):
    def modify(pdf):
        with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
            meta["pdfaid:part"] = "2"
            meta["pdfaid:conformance"] = "B"
        pdf.docinfo["/Title"] = "Archive copy"
        pdf.docinfo["/Author"] = "Records office"

    result = _validate(client, _with(modify))
    assert result == {"valid": True, "standard": "PDF/A (detected)", "errors": []}


def test_the_notes_never_say_a_title_or_an_author_is_required_by_pdfa(client):
    result = _validate(client, _plain())
    notes = result["errors"]
    assert any("title" in note.lower() for note in notes)
    assert any("author" in note.lower() for note in notes)
    assert not any("required" in note.lower() for note in notes), notes

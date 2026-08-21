"""Remove visible watermarks from a PDF, losslessly where the structure allows.

How the removal actually works, from inspecting real watermarked output: the
page content stream holds the body text in one `q … Q` block and then a second
block that just invokes the watermark form:

    q  BT … (Real body content) TJ  ET  Q
    q  1 0 0 1 0 0 cm  /QOHJ-6siw… Do  Q

The watermark text lives inside that XObject. So removing the single `Do`
operator that invokes it takes the mark away and leaves every other byte of
page content untouched — genuinely lossless, not a white box painted over it.

Two safety rules:

* Content streams are edited through pikepdf's parser (`parse_content_stream` /
  `unparse_content_stream`), never by regex over bytes. A stray edit that drops
  one half of a `q`/`Q` pair corrupts the graphics state for everything after it.
* Only `Do` operators are removed, and only for XObjects proven to contain a
  confirmed watermark string. Nothing else in the stream is rewritten.
"""

from __future__ import annotations

import pikepdf
from pikepdf import Name, Pdf

from ..utils.exceptions import ProcessingError, ValidationError
from ..utils.filenames import temp_output
from .watermark_detect_service import detect_watermarks


def _needles(text: str) -> list[bytes]:
    """Byte patterns a content stream may use for this string.

    PDF strings appear literally — `(CONFIDENTIAL) Tj` — or hex-encoded as
    `<434f4e464944454e5449414c>`, so check both.
    """
    raw = text.encode("latin-1", "replace")
    return [raw, raw.hex().encode("ascii"), raw.hex().upper().encode("ascii")]


def _xobject_holds_watermark(obj, needles: list[bytes]) -> bool:
    try:
        data = bytes(obj.read_bytes())
    except Exception:
        return False
    return any(n in data for n in needles)


def remove_watermarks(input_path: str, candidate_ids: list[str] | None = None) -> str:
    """Remove the confirmed watermark candidates and return the output path.

    `candidate_ids` comes from a prior `detect_watermarks` call. Detection is
    re-run here so the endpoint stays stateless — no server-side session between
    the preview and the apply, which suits a product that stores nothing.
    """
    detected = detect_watermarks(input_path)
    candidates = detected["candidates"]
    if candidate_ids is not None:
        wanted = set(candidate_ids)
        candidates = [c for c in candidates if c["id"] in wanted]
        unknown = wanted - {c["id"] for c in detected["candidates"]}
        if unknown:
            raise ValidationError(
                f"Unknown watermark selection: {', '.join(sorted(unknown))}. "
                "Re-run detection and try again."
            )

    if not candidates:
        raise ValidationError("No watermark was selected for removal.")

    needles: list[bytes] = []
    for candidate in candidates:
        needles.extend(_needles(candidate["text"]))

    output_path = temp_output("unwatermarked", "pdf")
    removed = 0

    try:
        pdf = Pdf.open(input_path)
    except Exception as exc:  # noqa: BLE001 — pikepdf raises several types
        raise ProcessingError("This PDF could not be opened.") from exc

    try:
        for page in pdf.pages:
            resources = page.get("/Resources")
            if resources is None:
                continue
            xobjects = resources.get("/XObject")
            if xobjects is None:
                continue

            doomed = {
                str(name)
                for name, obj in xobjects.items()
                if _xobject_holds_watermark(obj, needles)
            }
            if not doomed:
                continue

            kept = []
            for operands, operator in pikepdf.parse_content_stream(page):
                if (
                    str(operator) == "Do"
                    and operands
                    and str(operands[0]) in doomed
                ):
                    removed += 1
                    continue  # drop only this invocation; q/Q stay balanced
                kept.append((operands, operator))

            page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(kept))

            # Drop the now-unreferenced resource entries too, so the object is
            # garbage-collected on save rather than lingering in the file.
            for name in doomed:
                try:
                    del xobjects[Name(name)]
                except (KeyError, AttributeError):
                    pass

        if removed == 0:
            raise ProcessingError(
                "The watermark could not be removed automatically — it is drawn "
                "directly into the page content rather than as a separate object."
            )

        pdf.save(str(output_path))
    finally:
        pdf.close()

    return str(output_path)

"""Convert PDF → RTF (Rich Text Format).

Produces a minimal but valid RTF 1.x document containing the extracted
text, page-by-page (\\page between pages). Non-ASCII characters are
encoded as \\uN escapes per the RTF spec.
"""

from __future__ import annotations

from ..utils.cleanup import open_pdf_document
from ..utils.filenames import temp_output


def _escape_rtf(text: str) -> str:
    out: list[str] = []
    for ch in text:
        cp = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == "{":
            out.append("\\{")
        elif ch == "}":
            out.append("\\}")
        elif ch == "\n":
            out.append("\\par\n")
        elif ch == "\r":
            continue
        elif ch == "\t":
            out.append("\\tab ")
        elif cp < 128:
            out.append(ch)
        else:
            # RTF unicode escape — signed 16-bit; surrogate pairs for non-BMP.
            if cp > 0xFFFF:
                cp -= 0x10000
                hi = 0xD800 + (cp >> 10)
                lo = 0xDC00 + (cp & 0x3FF)
                out.append(f"\\u{hi - 65536 if hi > 32767 else hi}?\\u{lo - 65536 if lo > 32767 else lo}?")
            else:
                signed = cp - 65536 if cp > 32767 else cp
                out.append(f"\\u{signed}?")
    return "".join(out)


def pdf_to_rtf(input_path: str) -> str:
    output_path = temp_output("pdf_rtf", "rtf")

    doc = open_pdf_document(input_path)
    try:
        page_blocks: list[str] = []
        for i, page in enumerate(doc):
            if i > 0:
                page_blocks.append("\\page\n")
            page_blocks.append(_escape_rtf(page.get_text()))
        body = "".join(page_blocks)
    finally:
        doc.close()

    rtf = (
        "{\\rtf1\\ansi\\ansicpg1252\\deff0"
        "{\\fonttbl{\\f0\\fnil\\fcharset0 Helvetica;}}"
        "\\f0\\fs22 " + body + "}"
    )
    output_path.write_bytes(rtf.encode("ascii", errors="replace"))
    return str(output_path)

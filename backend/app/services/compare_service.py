"""PDF comparison using PyMuPDF for fast rendering (no poppler needed)."""
import difflib

import fitz  # PyMuPDF
from PIL import Image, ImageChops

from ..utils.colors import hex_to_rgb_int
from ..utils.exceptions import ValidationError
from ..utils.filenames import temp_output


# Cap text-mode diff output so a wildly different pair of large PDFs can't
# blow up the JSON response or chew through worker memory. 10k diff lines
# is already far more than any sane UI can render.
_MAX_DIFF_LINES = 10_000


def compare_text(path1: str, path2: str) -> dict:
    def extract_text(path):
        pages = []
        doc = fitz.open(path)
        try:
            for page in doc:
                pages.append(page.get_text("text") or "")
        finally:
            doc.close()
        return pages

    pages1 = extract_text(path1)
    pages2 = extract_text(path2)

    text1 = "\n".join(pages1)
    text2 = "\n".join(pages2)

    diff_iter = difflib.unified_diff(
        text1.splitlines(),
        text2.splitlines(),
        fromfile="file1.pdf",
        tofile="file2.pdf",
        lineterm=""
    )
    diff: list[str] = []
    truncated = False
    for line in diff_iter:
        if len(diff) >= _MAX_DIFF_LINES:
            truncated = True
            break
        diff.append(line)

    # Summary statistics
    additions = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
    deletions = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))

    return {
        "diff": diff,
        "page_count_1": len(pages1),
        "page_count_2": len(pages2),
        "additions": additions,
        "deletions": deletions,
        "identical": len(diff) == 0,
        "truncated": truncated,
    }


def compare_visual(path1: str, path2: str, highlight_color: str = "#ff0000") -> str:
    """Visual PDF comparison using PyMuPDF (no poppler subprocess)."""
    output_path = temp_output("compare_visual", "pdf")
    # Default to red if the caller sends garbage so the visual diff still
    # produces *some* highlight rather than a no-op overlay.
    color = hex_to_rgb_int(highlight_color, default=(255, 0, 0))

    # Open both INSIDE the try with None sentinels: if fitz.open(path2) raises
    # (path2 is a user upload that only passed a 5-byte %PDF prefix check),
    # doc1 was already open and would otherwise leak its file handle/mmap.
    doc1 = doc2 = None
    try:
        doc1 = fitz.open(path1)
        doc2 = fitz.open(path2)
        max_pages = max(len(doc1), len(doc2))
        # Hard cap to prevent OOM on very long PDFs — visual compare past ~50
        # pages is rarely useful and would tie up the worker for minutes.
        HARD_CAP = 50
        if max_pages > HARD_CAP:
            max_pages = HARD_CAP
        result_images = []

        # 100 DPI is readable for a visual diff and uses ~50% less RAM than 150.
        mat = fitz.Matrix(100 / 72, 100 / 72)

        for i in range(max_pages):
            if i < len(doc1) and i < len(doc2):
                pix1 = doc1[i].get_pixmap(matrix=mat)
                pix2 = doc2[i].get_pixmap(matrix=mat)

                img1 = Image.frombytes("RGB", [pix1.width, pix1.height], pix1.samples)
                img2 = Image.frombytes("RGB", [pix2.width, pix2.height], pix2.samples)

                w = max(img1.width, img2.width)
                h = max(img1.height, img2.height)
                img1 = img1.resize((w, h), Image.Resampling.LANCZOS)
                img2 = img2.resize((w, h), Image.Resampling.LANCZOS)

                diff = ImageChops.difference(img1, img2)
                diff_arr = diff.split()
                red_mask = diff_arr[0].point(lambda x: 255 if x > 10 else 0)
                highlighted = img1.copy()
                red_layer = Image.new("RGB", (w, h), color)
                highlighted.paste(red_layer, mask=red_mask)
                result_images.append(highlighted)
            elif i < len(doc1):
                pix = doc1[i].get_pixmap(matrix=mat)
                result_images.append(
                    Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                )
            else:
                pix = doc2[i].get_pixmap(matrix=mat)
                result_images.append(
                    Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                )
    finally:
        if doc1 is not None:
            doc1.close()
        if doc2 is not None:
            doc2.close()

    if not result_images:
        raise ValidationError("No pages to compare")

    first = result_images[0]
    rest = result_images[1:]
    first.save(str(output_path), format="PDF", save_all=True, append_images=rest)

    return str(output_path)

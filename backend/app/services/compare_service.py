"""PDF comparison using PyMuPDF for fast rendering (no poppler needed)."""
import uuid
import difflib
import io
import fitz  # PyMuPDF
from PIL import Image, ImageChops
from ..utils.cleanup import get_temp_path, ensure_temp_dir


def compare_text(path1: str, path2: str) -> dict:
    def extract_text(path):
        pages = []
        doc = fitz.open(path)
        for page in doc:
            pages.append(page.get_text("text") or "")
        doc.close()
        return pages

    pages1 = extract_text(path1)
    pages2 = extract_text(path2)

    text1 = "\n".join(pages1)
    text2 = "\n".join(pages2)

    diff = list(difflib.unified_diff(
        text1.splitlines(),
        text2.splitlines(),
        fromfile="file1.pdf",
        tofile="file2.pdf",
        lineterm=""
    ))

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
    }


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    color = (hex_color or "").strip().lstrip("#")
    if len(color) == 3:
        color = "".join(ch * 2 for ch in color)
    if len(color) != 6:
        return (255, 0, 0)
    try:
        return (int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16))
    except ValueError:
        return (255, 0, 0)


def compare_visual(path1: str, path2: str, highlight_color: str = "#ff0000") -> str:
    """Visual PDF comparison using PyMuPDF (no poppler subprocess)."""
    ensure_temp_dir()
    output_path = get_temp_path(f"compare_visual_{uuid.uuid4().hex}.pdf")
    color = _hex_to_rgb(highlight_color)

    doc1 = fitz.open(path1)
    doc2 = fitz.open(path2)

    max_pages = max(len(doc1), len(doc2))
    # Hard cap to prevent OOM on very long PDFs — visual compare past ~50 pages
    # is rarely useful anyway and ties up the worker for minutes.
    HARD_CAP = 50
    if max_pages > HARD_CAP:
        max_pages = HARD_CAP
    result_images = []

    for i in range(max_pages):
        if i < len(doc1) and i < len(doc2):
            # Render both pages at 150 DPI
            mat = fitz.Matrix(100 / 72, 100 / 72)  # 100 DPI — readable for visual diff, ~50% less RAM than 150
            pix1 = doc1[i].get_pixmap(matrix=mat)
            pix2 = doc2[i].get_pixmap(matrix=mat)

            img1 = Image.frombytes("RGB", [pix1.width, pix1.height], pix1.samples)
            img2 = Image.frombytes("RGB", [pix2.width, pix2.height], pix2.samples)

            # Resize to same dimensions
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
            mat = fitz.Matrix(100 / 72, 100 / 72)  # 100 DPI — readable for visual diff, ~50% less RAM than 150
            pix = doc1[i].get_pixmap(matrix=mat)
            result_images.append(Image.frombytes("RGB", [pix.width, pix.height], pix.samples))
        else:
            mat = fitz.Matrix(100 / 72, 100 / 72)  # 100 DPI — readable for visual diff, ~50% less RAM than 150
            pix = doc2[i].get_pixmap(matrix=mat)
            result_images.append(Image.frombytes("RGB", [pix.width, pix.height], pix.samples))

    doc1.close()
    doc2.close()

    if not result_images:
        raise ValueError("No pages to compare")

    first = result_images[0]
    rest = result_images[1:]
    first.save(str(output_path), format="PDF", save_all=True, append_images=rest)

    return str(output_path)

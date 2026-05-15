from PIL import Image
import uuid
import io
import os
from ..utils.cleanup import get_temp_path, ensure_temp_dir
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.platypus import SimpleDocTemplate, Image as RLImage

# Register HEIC/HEIF support so PIL (and therefore ReportLab) can open .heic/.heif
try:
    from pillow_heif import register_heif_opener  # type: ignore
    register_heif_opener()
except ImportError:  # pragma: no cover — falls back to JPEG/PNG/etc only
    pass

_HEIC_EXTS = {".heic", ".heif"}
_SVG_EXTS = {".svg"}


def _svg_to_png(svg_path: str) -> str:
    """Rasterize an SVG to a high-res PNG temp file via cairosvg."""
    from cairosvg import svg2png  # cairosvg ships with the rembg dep tree
    out_path = get_temp_path(f"svg_to_png_{uuid.uuid4().hex}.png")
    # Render at 2x for crisp output even after PDF embed scaling.
    svg2png(url=svg_path, write_to=str(out_path), output_width=2400)
    return str(out_path)

PAGE_SIZES = {
    "A4": A4,
    "Letter": LETTER,
}


def images_to_pdf(input_paths: list, page_size: str = "A4") -> str:
    ensure_temp_dir()
    output_path = get_temp_path(f"images_to_pdf_{uuid.uuid4().hex}.pdf")
    size = PAGE_SIZES.get(page_size, A4)

    doc = SimpleDocTemplate(str(output_path), pagesize=size)
    story = []

    page_width, page_height = size
    margin = 36  # 0.5 inch
    max_width = page_width - 2 * margin
    max_height = page_height - 2 * margin

    for path in input_paths:
        ext = os.path.splitext(path)[1].lower()
        # ReportLab can't load HEIC directly even with pillow-heif registered —
        # transcode to a temp JPEG and feed it the JPEG instead.
        if ext in _HEIC_EXTS:
            with Image.open(path) as img:
                img_width, img_height = img.size
                jpeg_path = get_temp_path(f"heic_to_jpeg_{uuid.uuid4().hex}.jpg")
                img.convert("RGB").save(jpeg_path, "JPEG", quality=92)
            embed_path = str(jpeg_path)
        elif ext in _SVG_EXTS:
            # Rasterize vector SVG → PNG so ReportLab can embed it.
            png_path = _svg_to_png(path)
            with Image.open(png_path) as img:
                img_width, img_height = img.size
            embed_path = png_path
        else:
            with Image.open(path) as img:
                img_width, img_height = img.size
            embed_path = path

        ratio = min(max_width / img_width, max_height / img_height)
        new_width = img_width * ratio
        new_height = img_height * ratio

        rl_img = RLImage(embed_path, width=new_width, height=new_height)
        story.append(rl_img)

    doc.build(story)
    return str(output_path)

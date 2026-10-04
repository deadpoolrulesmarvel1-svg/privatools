import logging
import math
import os

from PIL import Image

from ..utils.colors import hex_to_rgb_int
from ..utils.exceptions import FileTooLargeError, ValidationError
from ..utils.filenames import temp_output
from ..utils.images import image_read_error

logger = logging.getLogger(__name__)

# Caps to keep the collage from gobbling RAM on the server.
MAX_IMAGES = 100
MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB per image
MAX_TOTAL_BYTES = 250 * 1024 * 1024  # 250 MB combined input
MAX_CANVAS_PIXELS = 36_000_000  # ~6000×6000


def make_collage(image_paths: list, columns: int = 3,
                 spacing: int = 10, bg_color: str = "#ffffff") -> str:
    """Create a photo collage from multiple images.

    Args:
        image_paths: List of image file paths
        columns: Number of columns in the grid
        spacing: Pixels between images
        bg_color: Background color hex
    """
    output_path = temp_output("collage", "jpg")

    if not image_paths:
        raise ValidationError("No images provided")
    if len(image_paths) > MAX_IMAGES:
        raise ValidationError(f"Too many images for one collage (cap {MAX_IMAGES}).")

    # Validate file sizes upfront so we don't OOM mid-render.
    total_bytes = 0
    for p in image_paths:
        sz = os.path.getsize(p)
        if sz > MAX_FILE_BYTES:
            raise ValidationError(
                f"One image is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB — "
                "downscale before adding it to a collage."
            )
        total_bytes += sz
    if total_bytes > MAX_TOTAL_BYTES:
        raise ValidationError(
            f"Total image size exceeds {MAX_TOTAL_BYTES // (1024 * 1024)} MB combined."
        )

    images: list[Image.Image] = []
    for p in image_paths:
        try:
            # Eager-convert and let the source handle close to keep file
            # descriptor count bounded — a 100-image collage previously
            # held 100 open file handles for the duration of the render.
            with Image.open(p) as src:
                images.append(src.convert("RGB"))
        except Exception as exc:
            # A picture Pillow cannot read gets the words every image tool
            # gives (utils.images). They used to name the server's temp file
            # ("Could not open image upload_<hex>.png: ...") and quote
            # Pillow. Anything else is the server's own failure: a 500.
            known = image_read_error(exc)
            if known is None:
                raise
            status, detail = known
            raise (FileTooLargeError if status == 413 else ValidationError)(detail) from exc

    # Calculate cell size (use the average dimensions)
    avg_w = sum(img.width for img in images) // len(images)
    avg_h = sum(img.height for img in images) // len(images)

    # Standardize cell size
    cell_w = min(avg_w, 600)
    cell_h = min(avg_h, 600)

    rows = math.ceil(len(images) / columns)

    canvas_w = columns * cell_w + (columns + 1) * spacing
    canvas_h = rows * cell_h + (rows + 1) * spacing
    if canvas_w * canvas_h > MAX_CANVAS_PIXELS:
        raise ValidationError(
            f"Resulting canvas would be {canvas_w}×{canvas_h} px, larger than the "
            f"{MAX_CANVAS_PIXELS:,}-pixel cap. Use fewer columns or smaller images."
        )

    # Parse background color via the shared helper so malformed hex falls
    # back to white instead of throwing a confusing ValueError.
    bg = hex_to_rgb_int(bg_color, default=(255, 255, 255))
    canvas = Image.new("RGB", (canvas_w, canvas_h), bg)

    for idx, img in enumerate(images):
        row = idx // columns
        col = idx % columns

        # Resize to fit cell while maintaining aspect ratio
        img_ratio = img.width / img.height
        cell_ratio = cell_w / cell_h

        if img_ratio > cell_ratio:
            new_w = cell_w
            new_h = int(cell_w / img_ratio)
        else:
            new_h = cell_h
            new_w = int(cell_h * img_ratio)

        resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

        # Center in cell
        x = col * cell_w + (col + 1) * spacing + (cell_w - new_w) // 2
        y = row * cell_h + (row + 1) * spacing + (cell_h - new_h) // 2

        canvas.paste(resized, (x, y))

    canvas.save(str(output_path), "JPEG", quality=90)
    logger.info("collage: %d images → %dx%d", len(images), canvas_w, canvas_h)

    return str(output_path)

import math
import os
import uuid

from PIL import Image

from ..utils.cleanup import ensure_temp_dir, get_temp_path

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
    ensure_temp_dir()
    output_path = get_temp_path(f"collage_{uuid.uuid4().hex}.jpg")

    if not image_paths:
        raise ValueError("No images provided")
    if len(image_paths) > MAX_IMAGES:
        raise ValueError(f"Too many images for one collage (cap {MAX_IMAGES}).")

    # Validate file sizes upfront so we don't OOM mid-render.
    total_bytes = 0
    for p in image_paths:
        sz = os.path.getsize(p)
        if sz > MAX_FILE_BYTES:
            raise ValueError(
                f"One image is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB — "
                "downscale before adding it to a collage."
            )
        total_bytes += sz
    if total_bytes > MAX_TOTAL_BYTES:
        raise ValueError(
            f"Total image size exceeds {MAX_TOTAL_BYTES // (1024 * 1024)} MB combined."
        )

    images = []
    for p in image_paths:
        try:
            images.append(Image.open(p).convert("RGB"))
        except Exception as exc:  # corrupt or unsupported file
            raise ValueError(f"Could not open image {os.path.basename(p)}: {exc}") from exc

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
        raise ValueError(
            f"Resulting canvas would be {canvas_w}×{canvas_h} px, larger than the "
            f"{MAX_CANVAS_PIXELS:,}-pixel cap. Use fewer columns or smaller images."
        )

    # Parse background color
    bg = tuple(int(bg_color.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
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

    return str(output_path)

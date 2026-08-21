"""Remove a visible watermark from a raster image by inpainting a user mask.

Classical inpainting, deliberately — `cv2.inpaint` reconstructs the masked
pixels from their surroundings. No ML, no model download, and OpenCV is already
in the hashed lock (pulled in by rembg), so this costs no new dependency on a
2-core VM.

The honest framing, which the UI repeats: this is a RECONSTRUCTION, not a
restoration. The original pixels are gone. Over a texture or a gradient the
result is convincing; over detailed content it invents. That is why the mask is
capped — past `MAX_MASK_RATIO` the algorithm has too little surrounding signal
to work from, and the truthful answer to the user is "crop it instead".
"""

from __future__ import annotations

import cv2
import numpy as np

from ..utils.exceptions import ProcessingError, ValidationError
from ..utils.filenames import temp_output

# Beyond this share of the image, inpainting invents rather than reconstructs.
MAX_MASK_RATIO = 0.40

_METHODS = {
    "telea": cv2.INPAINT_TELEA,   # fast, good on thin marks over texture
    "ns": cv2.INPAINT_NS,         # Navier-Stokes, better on large solid areas
}

_INPAINT_RADIUS = 3


def _mask_from_regions(regions: list[dict], height: int, width: int) -> np.ndarray:
    mask = np.zeros((height, width), np.uint8)
    drawn = 0

    for region in regions:
        try:
            x = int(region["x"])
            y = int(region["y"])
            w = int(region["width"])
            h = int(region["height"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValidationError(
                "Each region needs numeric x, y, width and height."
            ) from exc

        if w <= 0 or h <= 0:
            raise ValidationError("A selection had no area — drag a box over the watermark.")

        # Clamp to the image; a drag past the edge should trim, never wrap.
        x0 = max(0, min(x, width))
        y0 = max(0, min(y, height))
        x1 = max(0, min(x + w, width))
        y1 = max(0, min(y + h, height))
        if x1 <= x0 or y1 <= y0:
            continue  # entirely off-image

        mask[y0:y1, x0:x1] = 255
        drawn += 1

    if drawn == 0:
        raise ValidationError("The selection is outside the image.")
    return mask


def remove_image_watermark(
    input_path: str,
    regions: list[dict],
    method: str = "telea",
) -> str:
    """Inpaint `regions` out of the image and return the output path."""
    if method not in _METHODS:
        raise ValidationError(
            f"Unknown method '{method}'. Use one of: {', '.join(sorted(_METHODS))}."
        )
    if not regions:
        raise ValidationError("Select the watermark area to remove.")

    image = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValidationError("That file could not be read as an image.")

    height, width = image.shape[:2]
    mask = _mask_from_regions(regions, height, width)

    covered = float(np.count_nonzero(mask)) / float(height * width)
    if covered > MAX_MASK_RATIO:
        raise ValidationError(
            f"That selection covers {int(covered * 100)}% of the image — the limit is "
            f"{int(MAX_MASK_RATIO * 100)}%. Past that there isn't enough surrounding "
            "image to rebuild from; cropping will give a better result."
        )

    try:
        result = cv2.inpaint(image, mask, _INPAINT_RADIUS, _METHODS[method])
    except cv2.error as exc:  # noqa: BLE001 — OpenCV raises its own type
        raise ProcessingError("The image could not be processed.") from exc

    suffix = (input_path.rsplit(".", 1)[-1] or "png").lower()
    if suffix not in ("png", "jpg", "jpeg", "webp", "bmp"):
        suffix = "png"
    output_path = temp_output("unwatermarked", suffix)
    if not cv2.imwrite(str(output_path), result):
        raise ProcessingError("The cleaned image could not be written.")
    return str(output_path)

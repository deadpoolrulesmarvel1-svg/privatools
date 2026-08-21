"""Mask-based watermark removal for raster images.

Classical inpainting, not ML: `cv2.inpaint` reconstructs the masked region from
the pixels around it. That is a reconstruction, never a restoration — the
original pixels are gone — so the caps matter and are tested.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.services.image_watermark_remove_service import (
    MAX_MASK_RATIO,
    remove_image_watermark,
)
from app.utils.exceptions import ValidationError


def _image(tmp_path, name="in.png", w=200, h=160, colour=(40, 90, 200)):
    """A smooth gradient — inpainting over it should reconstruct plausibly."""
    img = np.zeros((h, w, 3), np.uint8)
    for x in range(w):
        img[:, x] = [int(colour[0] * x / w), int(colour[1] * x / w), colour[2]]
    path = tmp_path / name
    cv2.imwrite(str(path), img)
    return str(path)


def _with_blob(tmp_path, name="marked.png"):
    """Gradient with a hard white rectangle standing in for a watermark."""
    path = _image(tmp_path, name)
    img = cv2.imread(path)
    cv2.rectangle(img, (60, 50), (130, 90), (255, 255, 255), -1)
    cv2.imwrite(path, img)
    return path


REGION = [{"x": 58, "y": 48, "width": 74, "height": 44}]


def test_removes_the_marked_region(tmp_path):
    src = _with_blob(tmp_path)
    out = remove_image_watermark(src, REGION)
    before = cv2.imread(src)
    after = cv2.imread(out)
    # the white blob's centre should no longer be white
    assert tuple(before[70, 95]) == (255, 255, 255)
    assert tuple(after[70, 95]) != (255, 255, 255)


def test_pixels_outside_the_mask_are_untouched(tmp_path):
    src = _with_blob(tmp_path)
    out = remove_image_watermark(src, REGION)
    before = cv2.imread(src)
    after = cv2.imread(out)
    # a corner far from the mask must be bit-identical
    assert np.array_equal(before[0:20, 0:20], after[0:20, 0:20])


def test_output_keeps_the_original_dimensions(tmp_path):
    src = _with_blob(tmp_path)
    out = remove_image_watermark(src, REGION)
    assert cv2.imread(out).shape == cv2.imread(src).shape


def test_both_inpaint_methods_work(tmp_path):
    src = _with_blob(tmp_path)
    for method in ("telea", "ns"):
        out = remove_image_watermark(src, REGION, method=method)
        assert cv2.imread(out) is not None


def test_rejects_an_unknown_method(tmp_path):
    with pytest.raises(ValidationError):
        remove_image_watermark(_with_blob(tmp_path), REGION, method="magic")


def test_rejects_an_empty_region_list(tmp_path):
    with pytest.raises(ValidationError):
        remove_image_watermark(_with_blob(tmp_path), [])


def test_rejects_a_mask_covering_too_much(tmp_path):
    """Past the cap inpainting invents rather than reconstructs — say so."""
    src = _image(tmp_path)
    whole = [{"x": 0, "y": 0, "width": 200, "height": 160}]
    with pytest.raises(ValidationError) as exc:
        remove_image_watermark(src, whole)
    assert str(int(MAX_MASK_RATIO * 100)) in str(exc.value)


def test_clamps_a_region_that_overflows_the_image(tmp_path):
    """A drag past the edge must clamp, not crash or wrap."""
    src = _with_blob(tmp_path)
    out = remove_image_watermark(src, [{"x": 150, "y": 120, "width": 999, "height": 999}])
    assert cv2.imread(out) is not None


def test_rejects_a_region_entirely_outside_the_image(tmp_path):
    with pytest.raises(ValidationError):
        remove_image_watermark(
            _with_blob(tmp_path), [{"x": 5000, "y": 5000, "width": 10, "height": 10}]
        )


def test_rejects_a_zero_area_region(tmp_path):
    with pytest.raises(ValidationError):
        remove_image_watermark(_with_blob(tmp_path), [{"x": 10, "y": 10, "width": 0, "height": 5}])


def test_handles_several_regions(tmp_path):
    src = _with_blob(tmp_path)
    out = remove_image_watermark(src, [
        {"x": 58, "y": 48, "width": 40, "height": 44},
        {"x": 98, "y": 48, "width": 34, "height": 44},
    ])
    assert tuple(cv2.imread(out)[70, 95]) != (255, 255, 255)


def test_rejects_a_file_that_is_not_an_image(tmp_path):
    bad = tmp_path / "not.png"
    bad.write_bytes(b"definitely not an image")
    with pytest.raises(ValidationError):
        remove_image_watermark(str(bad), REGION)


def test_does_not_mutate_the_input(tmp_path):
    src = _with_blob(tmp_path)
    before = open(src, "rb").read()
    remove_image_watermark(src, REGION)
    assert open(src, "rb").read() == before

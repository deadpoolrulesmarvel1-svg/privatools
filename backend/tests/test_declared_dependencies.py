"""Every third-party module the app imports must be a DIRECT dependency.

This exists because of a real outage-shaped bug. `services/
image_watermark_remove_service.py` does `import cv2`, but
`opencv-python-headless` was never listed in requirements.txt — it happened to
arrive transitively via rembg, and a comment in that service even justified the
choice on those grounds ("already in the hashed lock, pulled in by rembg").

rembg 2.0.81 dropped opencv. The lock regenerated cleanly, every hash verified,
CI's own dependency checks stayed green — and the image simply had no cv2, so
the watermark route raised ModuleNotFoundError at import time. Nothing in the
dependency tooling catches this, because from pip's perspective nothing is
wrong: the tree is consistent, it just no longer contains a package we never
asked for.

A transitive dependency is an implementation detail of another package. Relying
on one for a direct import means an unrelated upstream release can delete your
dependency. This test makes that a test failure instead of a 500.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
APP = REPO_ROOT / "backend" / "app"
REQUIREMENTS = REPO_ROOT / "requirements.txt"

# Import name -> distribution name, where they differ. Only third-party
# packages the app imports directly belong here.
IMPORT_TO_DISTRIBUTION = {
    "cv2": "opencv-python-headless",
    "fitz": "pymupdf",
    "PIL": "pillow",
    "pdf2image": "pdf2image",
    "docx": "python-docx",
    "pptx": "python-pptx",
    "barcode": "python-barcode",
    "pyzbar": "pyzbar",
    "dotenv": "python-dotenv",
    "multipart": "python-multipart",
    "yaml": "pyyaml",
    "jwt": "pyjwt",
    "bs4": "beautifulsoup4",
    "magic": "python-magic",
    "pillow_heif": "pillow-heif",
}

# Imported by app code but deliberately NOT direct dependencies.
ALLOWED_TRANSITIVE: set[str] = {
    "starlette",   # re-exported through fastapi, versioned by it
}


def _declared() -> set[str]:
    pins = set()
    pin_re = re.compile(r"^\s*([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*==")
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        m = pin_re.match(line.strip())
        if m:
            pins.add(m.group(1).lower().replace("_", "-"))
    return pins


def _top_level_imports() -> dict[str, Path]:
    """Map top-level imported module -> first file importing it."""
    found: dict[str, Path] = {}
    for path in sorted(APP.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover - a parse error is its own failure
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                # level > 0 is a relative (in-app) import
                names = [node.module.split(".")[0]] if node.module and node.level == 0 else []
            else:
                continue
            for n in names:
                found.setdefault(n, path)
    return found


def _is_third_party(mod: str) -> bool:
    if mod in sys.stdlib_module_names or mod.startswith("_"):
        return False
    if mod in ("app", "backend", "tests"):
        return False
    return True


def test_every_directly_imported_package_is_declared():
    declared = _declared()
    assert declared, "requirements.txt parsed to zero pins"

    undeclared = []
    for mod, path in sorted(_top_level_imports().items()):
        if not _is_third_party(mod) or mod in ALLOWED_TRANSITIVE:
            continue
        dist = IMPORT_TO_DISTRIBUTION.get(mod, mod).lower().replace("_", "-")
        if dist not in declared:
            undeclared.append(
                f"{mod} (-> {dist}) imported by {path.relative_to(REPO_ROOT)}"
            )

    assert not undeclared, (
        "These modules are imported directly but are not direct dependencies in "
        "requirements.txt, so an unrelated upstream release can delete them "
        "without any dependency tool noticing:\n  " + "\n  ".join(undeclared)
    )


def test_opencv_is_declared_not_inherited():
    """The specific regression: cv2 came via rembg until rembg dropped it."""
    assert "opencv-python-headless" in _declared(), (
        "opencv-python-headless must stay a direct dependency — "
        "image_watermark_remove_service.py imports cv2 at module level."
    )


def test_the_import_map_has_no_stale_entries():
    """A mapping for something no longer imported is dead weight; catch drift."""
    imported = set(_top_level_imports())
    stale = sorted(k for k in IMPORT_TO_DISTRIBUTION if k not in imported)
    assert not stale, (
        f"IMPORT_TO_DISTRIBUTION maps {stale}, which app code no longer imports. "
        "Remove the entries so the map keeps reflecting reality."
    )

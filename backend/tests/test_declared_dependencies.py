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
    "docx": "python-docx",
    "pptx": "python-pptx",
    "barcode": "python-barcode",
    "pillow_heif": "pillow-heif",
    # PyJWT installs as `pyjwt` and imports as `jwt`.
    "jwt": "pyjwt",
}

# Imported by app code but deliberately NOT direct dependencies.
ALLOWED_TRANSITIVE: set[str] = {
    # Both are fastapi's own foundations: it pins them, re-exports them, and
    # its documentation tells you to import them directly. Unlike opencv under
    # rembg, neither can be dropped without fastapi ceasing to be fastapi.
    "starlette",
    "pydantic",
}


def _declared() -> set[str]:
    pins = set()
    pin_re = re.compile(r"^\s*([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*==")
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        m = pin_re.match(line.strip())
        if m:
            pins.add(m.group(1).lower().replace("_", "-"))
    return pins


def _optional_import_nodes(tree: ast.AST) -> set[int]:
    """Nodes inside a `try:` that handles ImportError are deliberately optional.

    markdown_to_pdf tries mistune, falls back to markdown, then falls back to a
    regex. Each fallback is guarded by `except ImportError`, which is a
    considered design decision — the route degrades instead of failing. Flagging
    those as undeclared would be wrong, and would pressure someone into either
    declaring packages the app does not need or deleting a real fallback.
    """
    optional: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        catches_import_error = any(
            (h.type is None)
            or (isinstance(h.type, ast.Name) and h.type.id in ("ImportError", "ModuleNotFoundError"))
            or (isinstance(h.type, ast.Tuple) and any(
                isinstance(e, ast.Name) and e.id in ("ImportError", "ModuleNotFoundError")
                for e in h.type.elts))
            for h in node.handlers
        )
        if not catches_import_error:
            continue
        for stmt in node.body:
            for sub in ast.walk(stmt):
                if isinstance(sub, (ast.Import, ast.ImportFrom)):
                    optional.add(id(sub))
    return optional


def _top_level_imports(include_optional: bool = False) -> dict[str, Path]:
    """Map top-level module -> first file importing it.

    By default only REQUIRED imports (what the dependency check cares about).
    With include_optional=True, ImportError-guarded imports are included too —
    needed by the stale-map check, since a mapping for an optionally-imported
    module is legitimate, not dead weight.
    """
    found: dict[str, Path] = {}
    for path in sorted(APP.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover - a parse error is its own failure
            continue
        optional = set() if include_optional else _optional_import_nodes(tree)
        for node in ast.walk(tree):
            if id(node) in optional:
                continue
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


def test_optional_imports_are_not_flagged():
    """An `except ImportError` fallback must not be treated as a dependency.

    Guards the carve-out itself: without it this test would demand markdown be
    declared, when the point of that code is that it works when markdown is
    absent.
    """
    src = (
        "try:\n"
        "    import mistune\n"
        "except ImportError:\n"
        "    mistune = None\n"
        "import cv2\n"
    )
    tree = ast.parse(src)
    optional = _optional_import_nodes(tree)
    imported = [n for n in ast.walk(tree) if isinstance(n, ast.Import)]
    names = {n.names[0].name: (id(n) in optional) for n in imported}
    assert names["mistune"] is True, "guarded import should be optional"
    assert names["cv2"] is False, "unguarded import must still be required"


def test_markdown_stays_optional_in_pdf_extra():
    """The real call site that motivated the carve-out."""
    tree = ast.parse((APP / "routes" / "pdf_extra.py").read_text(encoding="utf-8"))
    optional = _optional_import_nodes(tree)
    guarded = {
        n.names[0].name
        for n in ast.walk(tree)
        if isinstance(n, ast.Import) and id(n) in optional
    }
    assert {"mistune", "markdown"} <= guarded, (
        "markdown_to_pdf's fallback chain is no longer ImportError-guarded; "
        "either restore the guard or declare the package."
    )


def test_the_import_map_has_no_stale_entries():
    """A mapping for something no longer imported is dead weight; catch drift."""
    # include_optional: pillow_heif is imported only behind an ImportError
    # guard, so the required-only view would wrongly call its mapping stale.
    imported = set(_top_level_imports(include_optional=True))
    stale = sorted(k for k in IMPORT_TO_DISTRIBUTION if k not in imported)
    assert not stale, (
        f"IMPORT_TO_DISTRIBUTION maps {stale}, which app code no longer imports. "
        "Remove the entries so the map keeps reflecting reality."
    )

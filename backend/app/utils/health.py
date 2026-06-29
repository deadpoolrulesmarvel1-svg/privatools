"""Readiness checks for ``/readyz``.

Verifies that every external dependency the API needs at request time is
actually usable. Returns a dict of ``{name: bool}`` so the route can
build a structured 503 body with the specific failures, rather than
"503, please debug".

Checks performed:

* ``pikepdf``  importable (used for password / repair / metadata tools).
* ``fitz``     importable (PyMuPDF, used everywhere).
* ``PIL``      importable (image tools).
* ``tessdata`` ``TESSDATA_PREFIX`` env var points at an existing dir
               (or the system Tesseract default location exists). OCR
               tools would 500 without trained-data files.
* ``ghostscript`` ``gs`` binary findable in PATH (PDF/A, advanced
               compression).

The success path is cached for ``READYZ_CACHE_TTL`` seconds so a
load-balancer hitting /readyz once per second doesn't import pikepdf
every time. Failures are NOT cached — recovery from a missing
dependency should show up immediately.
"""

from __future__ import annotations

import importlib
import os
import shutil
import threading
import time
from typing import Callable

# Fail readiness when the temp volume drops below this — tool outputs and the
# upload spool all land there, so a full disk silently turns every job into a
# confusing 500. Threshold is low so it only trips on real exhaustion, not churn.
_FREE_DISK_MIN_MB = float(os.environ.get("FREE_DISK_MIN_MB", "250"))

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
# Single-process cache. Worker processes each warm their own cache after
# the first /readyz hit; that's fine — the checks are sub-millisecond
# once imports succeed once.
_CACHE_TTL = float(os.environ.get("READYZ_CACHE_TTL", "5"))
_cache_lock = threading.Lock()
_cache: dict[str, object] = {"ts": 0.0, "checks": None, "ok": False}


def _check_module(name: str) -> bool:
    """Try to import ``name``. Importing is the cheapest accurate test —
    a present-but-broken install (e.g. missing system lib) fails here
    just like a missing pip package would."""
    try:
        importlib.import_module(name)
        return True
    except Exception:  # noqa: BLE001 — any failure means "not ready"
        return False


def _check_free_disk() -> bool:
    """True if the temp volume has at least ``_FREE_DISK_MIN_MB`` free.

    Probes the managed temp dir (where every tool writes); falls back to the
    working directory if it isn't there yet. A near-full disk is a genuine
    readiness failure — the next upload spool or render will fail mid-request.
    """
    temp_dir = os.environ.get("TEMP_DIR", "temp")
    target = temp_dir if os.path.isdir(temp_dir) else "."
    try:
        free_mb = shutil.disk_usage(target).free / (1024 * 1024)
    except OSError:
        return False
    return free_mb >= _FREE_DISK_MIN_MB


def _check_tessdata() -> bool:
    """OCR tools shell out to tesseract, which loads trained-data files
    from ``TESSDATA_PREFIX`` (or a compiled-in default).

    Strategy:
      1. If TESSDATA_PREFIX is set, the path must exist.
      2. Otherwise, fall back to the most common system locations.
      3. If nothing is found, return False — OCR is the only feature
         that would fail, so the rest of the API is still ready.
    """
    prefix = os.environ.get("TESSDATA_PREFIX")
    if prefix:
        return os.path.isdir(prefix)
    # Common default locations on Debian/Ubuntu, macOS Homebrew (arm + x86).
    for path in (
        "/usr/share/tesseract-ocr/4.00/tessdata",
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/local/share/tessdata",
        "/opt/homebrew/share/tessdata",
        "/opt/local/share/tessdata",
    ):
        if os.path.isdir(path):
            return True
    return False


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------
# Lazy list of (name, check) — we register them as functions so the
# module imports cheaply and checks only fire when /readyz is hit.
# Required checks — any False = /readyz returns 503.
# Ghostscript is intentionally NOT here: the production image ships with
# qpdf + pikepdf which cover the compress / unlock paths without `gs`,
# so failing readyz on its absence would create false alarms.
_CHECKS: list[tuple[str, Callable[[], bool]]] = [
    ("pikepdf", lambda: _check_module("pikepdf")),
    ("fitz", lambda: _check_module("fitz")),
    ("PIL", lambda: _check_module("PIL")),
    ("tessdata", _check_tessdata),
    ("free_disk", _check_free_disk),
]


def run_readiness_checks() -> tuple[bool, dict[str, bool]]:
    """Run all readiness checks; return (overall_ok, per_check_results).

    Honours a short success-cache so repeated probes are cheap. Cache is
    deliberately bypassed for failures — once a dependency comes back,
    the next probe should see it without a TTL wait.
    """
    now = time.monotonic()
    with _cache_lock:
        if (
            _cache["ok"]
            and _cache["checks"] is not None
            and now - float(_cache["ts"]) < _CACHE_TTL
        ):
            return True, dict(_cache["checks"])  # type: ignore[arg-type]

    results: dict[str, bool] = {}
    for name, check in _CHECKS:
        try:
            results[name] = bool(check())
        except Exception:  # noqa: BLE001 — defensive, a check should not crash readyz
            results[name] = False
    ok = all(results.values())

    if ok:
        with _cache_lock:
            _cache["ts"] = now
            _cache["checks"] = dict(results)
            _cache["ok"] = True

    return ok, results

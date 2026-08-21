"""The SPA's server-chainable step list must match the backend catalog exactly.

This guards the specific failure that made `/api/pipeline` useless: the backend
advertised 2 steps, `PipelinePage.tsx` offered 25, nobody noticed, and the SPA
quietly re-uploaded the whole document once per step for months.

`API_PIPELINE_STEPS` in PipelinePage.tsx decides when the SPA takes the
one-request fast path. If it lists a step the backend cannot run, every fast-path
run 400s and silently falls back. If it omits a step the backend CAN run, users
keep paying the per-step upload cost for no reason. Both directions are bugs,
so this asserts equality rather than a subset.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.routes.developer import PIPELINE_STEP_META

PIPELINE_PAGE = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "PipelinePage.tsx"
)


def _frontend_api_steps() -> set[str]:
    src = PIPELINE_PAGE.read_text(encoding="utf-8")
    m = re.search(r"const API_PIPELINE_STEPS = new Set\(\[(.*?)\]\);", src, re.S)
    assert m, "API_PIPELINE_STEPS not found in PipelinePage.tsx — was it renamed?"
    return set(re.findall(r'"([^"]+)"', m.group(1)))


def _frontend_offered_steps() -> set[str]:
    src = PIPELINE_PAGE.read_text(encoding="utf-8")
    m = re.search(r"const PIPELINE_TOOL_SLUGS = new Set\(\[(.*?)\]\);", src, re.S)
    assert m, "PIPELINE_TOOL_SLUGS not found in PipelinePage.tsx"
    return set(re.findall(r'"([^"]+)"', m.group(1)))


def test_pipeline_page_exists():
    assert PIPELINE_PAGE.is_file(), f"expected {PIPELINE_PAGE}"


def test_frontend_fast_path_matches_backend_catalog_exactly():
    frontend = _frontend_api_steps()
    backend = set(PIPELINE_STEP_META)

    claims_unsupported = sorted(frontend - backend)
    assert not claims_unsupported, (
        f"PipelinePage says the API can run {claims_unsupported}, but the backend "
        "catalog cannot. Every fast-path run would 400 and fall back."
    )

    missed = sorted(backend - frontend)
    assert not missed, (
        f"The backend can chain {missed} but PipelinePage does not list them, so "
        "users keep paying a full upload per step for no reason."
    )


def test_every_fast_path_step_is_actually_offered_in_the_ui():
    """A step the API can run is useless if the palette never offers it."""
    orphans = sorted(_frontend_api_steps() - _frontend_offered_steps())
    assert not orphans, f"fast-path steps not selectable in the UI: {orphans}"


def test_the_gap_is_documented_where_it_still_exists():
    """Steps the UI offers that the API cannot chain must stay a conscious list."""
    ui_only = _frontend_offered_steps() - set(PIPELINE_STEP_META)
    # These have route-inline implementations rather than reusable services.
    known = {
        "crop-pdf", "auto-crop", "resize-pdf", "invert-colors",
        "remove-blank-pages", "transparent-background", "add-hyperlinks",
        "sanitize-pdf",
    }
    surprises = sorted(ui_only - known)
    assert not surprises, (
        f"new UI-only pipeline steps appeared: {surprises}. Either add them to "
        "PIPELINE_STEP_META or record why they cannot be chained server-side."
    )
